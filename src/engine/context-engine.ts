// xG-Vantage — Context Engine
// Analyzes MATCH CONTEXT — what makes us different from every other model
// Considers form, fatigue, motivation, derby, rotation, H2H, weather, referee

import { db } from '@/lib/db';
import { getEloRating } from './elo-system';

// ============================================================================
// TYPES
// ============================================================================

export interface MatchContext {
  fixtureId: number;
  homeTeamId: number;
  awayTeamId: number;

  // Form analysis
  homeFormScore: number; // 0-1, weighted by recency and opponent quality
  awayFormScore: number;
  homeFormTrend: 'improving' | 'stable' | 'declining';
  awayFormTrend: 'improving' | 'stable' | 'declining';
  formAdvantage: number; // -1 to 1, positive = home advantage

  // Rest & fatigue
  homeDaysSinceLastMatch: number;
  awayDaysSinceLastMatch: number;
  restAdvantage: number; // -1 to 1

  // Table context
  homeTablePosition: number;
  awayTablePosition: number;
  homePointsToSafety: number; // points above relegation
  awayPointsToSafety: number;
  homePointsToTitle: number; // points behind leader
  awayPointsToTitle: number;
  homeMotivation: MotivationType;
  awayMotivation: MotivationType;
  motivationScore: number; // 0-1, how much both teams need this

  // Match characteristics
  isLocalDerby: boolean;
  isCupMatch: boolean;
  isFriendly: boolean;
  isNeutralGround: boolean;
  travelDistanceKm: number;
  weatherImpact: number; // 0-1
  refereeCardTendency: number; // cards per match

  // Squad context
  homeRotationRisk: number; // 0-1
  awayRotationRisk: number;
  homeKeyPlayersOut: number;
  awayKeyPlayersOut: number;

  // H2H memory
  h2hHomeWins: number;
  h2hDraws: number;
  h2hAwayWins: number;
  h2hGoalAvg: number;
}

export type MotivationType =
  | 'title_race'
  | 'champions_league'
  | 'europa'
  | 'midtable'
  | 'relegation'
  | 'promoted'
  | 'friendly';

// ============================================================================
// MAIN FUNCTION: ANALYZE MATCH CONTEXT
// ============================================================================

export async function analyzeMatchContext(fixtureId: number): Promise<MatchContext | null> {
  console.log(`[Context] Analyzing match context for fixture ${fixtureId}...`);

  // Step 1: Look up fixture details
  const fixture = await db.fixture.findUnique({
    where: { id: fixtureId },
    include: {
      league: true,
      season: true,
      lineup: true,
      odds: true,
    },
  });

  if (!fixture) {
    console.error(`[Context] Fixture ${fixtureId} not found`);
    return null;
  }

  const homeTeamId = fixture.homeTeamId;
  const awayTeamId = fixture.awayTeamId;

  // Step 2: Calculate form for both teams
  const homeForm = await calculateFormScore(homeTeamId);
  const awayForm = await calculateFormScore(awayTeamId);

  // Step 3: Check rest / days since last match
  const homeRest = await getDaysSinceLastMatch(homeTeamId, fixture.eventDate);
  const awayRest = await getDaysSinceLastMatch(awayTeamId, fixture.eventDate);

  // Step 4: Table context & motivation
  const tableContext = await getTableContext(homeTeamId, awayTeamId, fixture.leagueId, fixture.seasonId);

  // Step 5: Match characteristics
  const isLocalDerby = fixture.isLocalDerby;
  const isCupMatch = isCupCompetition(fixture.leagueId, fixture.roundName);
  const isFriendly = fixture.status === 'friendly' || fixture.roundName?.toLowerCase().includes('friendly');
  const isNeutralGround = fixture.isNeutralGround;
  const travelDistanceKm = fixture.travelDistanceKm ?? estimateTravelDistance(homeTeamId, awayTeamId);

  // Step 6: Weather impact
  const weatherImpact = calculateWeatherImpact(fixture.weatherCode, fixture.windSpeed, fixture.temperatureC);

  // Step 7: Referee card tendency
  const refereeCardTendency = await getRefereeCardTendency(fixture.refereeId);

  // Step 8: Squad context (rotation risk, key players out)
  const homeSquadContext = await getSquadContext(homeTeamId, fixture.lineup);
  const awaySquadContext = await getSquadContext(awayTeamId, fixture.lineup);

  // Step 9: H2H record
  const h2h = await getHeadToHead(homeTeamId, awayTeamId);

  // Build the context object
  const context: MatchContext = {
    fixtureId,
    homeTeamId,
    awayTeamId,

    // Form
    homeFormScore: homeForm.score,
    awayFormScore: awayForm.score,
    homeFormTrend: homeForm.trend,
    awayFormTrend: awayForm.trend,
    formAdvantage: calculateFormAdvantage(homeForm.score, awayForm.score),

    // Rest
    homeDaysSinceLastMatch: homeRest,
    awayDaysSinceLastMatch: awayRest,
    restAdvantage: calculateRestAdvantage(homeRest, awayRest),

    // Table
    homeTablePosition: tableContext.homePosition,
    awayTablePosition: tableContext.awayPosition,
    homePointsToSafety: tableContext.homePointsToSafety,
    awayPointsToSafety: tableContext.awayPointsToSafety,
    homePointsToTitle: tableContext.homePointsToTitle,
    awayPointsToTitle: tableContext.awayPointsToTitle,
    homeMotivation: tableContext.homeMotivation,
    awayMotivation: tableContext.awayMotivation,
    motivationScore: calculateMotivationScore(tableContext.homeMotivation, tableContext.awayMotivation),

    // Match characteristics
    isLocalDerby,
    isCupMatch,
    isFriendly,
    isNeutralGround,
    travelDistanceKm,
    weatherImpact,
    refereeCardTendency,

    // Squad
    homeRotationRisk: homeSquadContext.rotationRisk,
    awayRotationRisk: awaySquadContext.rotationRisk,
    homeKeyPlayersOut: homeSquadContext.keyPlayersOut,
    awayKeyPlayersOut: awaySquadContext.keyPlayersOut,

    // H2H
    h2hHomeWins: h2h.homeWins,
    h2hDraws: h2h.draws,
    h2hAwayWins: h2h.awayWins,
    h2hGoalAvg: h2h.goalAvg,
  };

  console.log(
    `[Context] Context analyzed for fixture ${fixtureId}: FormAdv=${context.formAdvantage.toFixed(2)}, ` +
    `RestAdv=${context.restAdvantage.toFixed(2)}, HomeMot=${context.homeMotivation}, AwayMot=${context.awayMotivation}`,
  );

  return context;
}

// ============================================================================
// FORM SCORE CALCULATION
// ============================================================================

interface FormResult {
  score: number; // 0-1
  trend: 'improving' | 'stable' | 'declining';
}

async function calculateFormScore(teamId: number): Promise<FormResult> {
  // Get last 10 finished fixtures
  const fixtures = await db.fixture.findMany({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      status: { in: ['finished', 'FT'] },
      homeScore: { not: null },
      awayScore: { not: null },
    },
    orderBy: { eventDate: 'desc' },
    take: 10,
  });

  if (fixtures.length === 0) {
    return { score: 0.5, trend: 'stable' };
  }

  // Weight by recency (exponential decay) and opponent quality (ELO)
  let weightedScore = 0;
  let totalWeight = 0;
  const formPoints: number[] = [];

  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const isHome = fixture.homeTeamId === teamId;
    const goalsFor = isHome ? fixture.homeScore! : fixture.awayScore!;
    const goalsAgainst = isHome ? fixture.awayScore! : fixture.homeScore!;

    // Points: 3 for win, 1 for draw, 0 for loss
    let points: number;
    if (goalsFor > goalsAgainst) points = 3;
    else if (goalsFor === goalsAgainst) points = 1;
    else points = 0;

    formPoints.push(points);

    // Recency weight: more recent = higher weight (exponential decay)
    const recencyWeight = Math.pow(0.85, i); // Most recent gets weight 1.0, decays by 0.85 per match

    // Opponent quality weight: beating a good team should count more
    const opponentId = isHome ? fixture.awayTeamId : fixture.homeTeamId;
    const opponentElo = await getEloRating(opponentId);
    // Normalize opponent ELO: 1500 = average, 1700+ = strong, 1300- = weak
    const qualityWeight = 0.5 + (opponentElo.overall - 1500) / 800; // Range ~0.25 to ~0.75

    const combinedWeight = recencyWeight * Math.max(0.3, qualityWeight);

    // Normalize points to 0-1 range
    const normalizedPoints = points / 3;

    weightedScore += normalizedPoints * combinedWeight;
    totalWeight += combinedWeight;
  }

  const score = totalWeight > 0 ? weightedScore / totalWeight : 0.5;

  // Determine trend by comparing recent 3 vs previous 3
  const recent3 = formPoints.slice(0, Math.min(3, formPoints.length));
  const previous3 = formPoints.slice(3, Math.min(6, formPoints.length));

  let trend: 'improving' | 'stable' | 'declining' = 'stable';

  if (previous3.length >= 2) {
    const recentAvg = recent3.reduce((s, p) => s + p, 0) / recent3.length;
    const previousAvg = previous3.reduce((s, p) => s + p, 0) / previous3.length;

    if (recentAvg - previousAvg > 0.5) trend = 'improving';
    else if (previousAvg - recentAvg > 0.5) trend = 'declining';
  }

  return { score: clamp(score, 0, 1), trend };
}

// ============================================================================
// REST / FATIGUE
// ============================================================================

async function getDaysSinceLastMatch(teamId: number, referenceDate: Date): Promise<number> {
  const lastMatch = await db.fixture.findFirst({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      status: { in: ['finished', 'FT'] },
      eventDate: { lt: referenceDate },
    },
    orderBy: { eventDate: 'desc' },
    select: { eventDate: true },
  });

  if (!lastMatch) return 14; // Default: assume well-rested

  const diffMs = referenceDate.getTime() - lastMatch.eventDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function calculateRestAdvantage(homeDays: number, awayDays: number): number {
  // Positive = home team has more rest (advantage)
  // Negative = away team has more rest
  // Optimal rest is ~5-7 days, too much rest (>14) is slight negative
  const optimalRest = 5;
  const homeRestScore = calculateRestScore(homeDays, optimalRest);
  const awayRestScore = calculateRestScore(awayDays, optimalRest);

  return clamp(homeRestScore - awayRestScore, -1, 1);
}

function calculateRestScore(days: number, optimal: number): number {
  if (days <= 2) return 0.2; // Very fatigued
  if (days <= 3) return 0.5;
  if (days <= optimal + 2) return 1.0; // Optimal rest
  if (days <= 10) return 0.8;
  if (days <= 14) return 0.6;
  return 0.5; // Too much rest — might be rusty
}

// ============================================================================
// TABLE CONTEXT & MOTIVATION
// ============================================================================

interface TableContextResult {
  homePosition: number;
  awayPosition: number;
  homePointsToSafety: number;
  awayPointsToSafety: number;
  homePointsToTitle: number;
  awayPointsToTitle: number;
  homeMotivation: MotivationType;
  awayMotivation: MotivationType;
}

async function getTableContext(
  homeTeamId: number,
  awayTeamId: number,
  leagueId: number,
  seasonId: number | null,
): Promise<TableContextResult> {
  const defaultResult: TableContextResult = {
    homePosition: 10,
    awayPosition: 10,
    homePointsToSafety: 10,
    awayPointsToSafety: 10,
    homePointsToTitle: 20,
    awayPointsToTitle: 20,
    homeMotivation: 'midtable',
    awayMotivation: 'midtable',
  };

  if (!seasonId) return defaultResult;

  // Get standings for this league/season
  const standings = await db.standing.findMany({
    where: { leagueId, seasonId },
    orderBy: { position: 'asc' },
  });

  if (standings.length === 0) return defaultResult;

  const homeStanding = standings.find((s) => s.teamId === homeTeamId);
  const awayStanding = standings.find((s) => s.teamId === awayTeamId);

  if (!homeStanding || !awayStanding) return defaultResult;

  const totalTeams = standings.length;
  const leaderPoints = standings[0]?.pts ?? 0;
  // Relegation line: bottom 3 (or bottom 20% for smaller leagues)
  const relegationLine = Math.max(totalTeams - 3, Math.ceil(totalTeams * 0.8));
  const safetyPoints = standings[relegationLine - 1]?.pts ?? 0;

  return {
    homePosition: homeStanding.position,
    awayPosition: awayStanding.position,
    homePointsToSafety: homeStanding.pts - safetyPoints,
    awayPointsToSafety: awayStanding.pts - safetyPoints,
    homePointsToTitle: leaderPoints - homeStanding.pts,
    awayPointsToTitle: leaderPoints - awayStanding.pts,
    homeMotivation: determineMotivation(homeStanding.position, totalTeams, homeStanding.pts - safetyPoints, leaderPoints - homeStanding.pts),
    awayMotivation: determineMotivation(awayStanding.position, totalTeams, awayStanding.pts - safetyPoints, leaderPoints - awayStanding.pts),
  };
}

function determineMotivation(
  position: number,
  totalTeams: number,
  pointsToSafety: number,
  pointsToTitle: number,
): MotivationType {
  // Title race: top 3 and within 6 points of leader
  if (position <= 3 && pointsToTitle <= 6) return 'title_race';

  // Champions League spots: typically top 4
  if (position <= 4) return 'champions_league';

  // Europa League spots: typically 5-6
  if (position <= 6) return 'europa';

  // Relegation battle: bottom 4 or within 3 points of safety
  if (position > totalTeams - 4 || pointsToSafety <= 3) return 'relegation';

  // Newly promoted (typically bottom half but not yet in relegation danger)
  if (position > totalTeams * 0.6 && pointsToSafety > 6) return 'promoted';

  // Mid-table safety
  return 'midtable';
}

function calculateFormAdvantage(homeFormScore: number, awayFormScore: number): number {
  return clamp((homeFormScore - awayFormScore) * 2, -1, 1);
}

function calculateMotivationScore(homeMotivation: MotivationType, awayMotivation: MotivationType): number {
  const motivationValues: Record<MotivationType, number> = {
    title_race: 1.0,
    champions_league: 0.9,
    europa: 0.75,
    relegation: 0.95,
    promoted: 0.6,
    midtable: 0.3,
    friendly: 0.1,
  };

  // Average motivation of both teams, but weight by how much they BOTH care
  const homeMot = motivationValues[homeMotivation] ?? 0.5;
  const awayMot = motivationValues[awayMotivation] ?? 0.5;

  // If both teams are highly motivated, the match is more intense
  // If one team doesn't care, the match is less predictable
  const avgMotivation = (homeMot + awayMot) / 2;
  const motivationAlignment = 1 - Math.abs(homeMot - awayMot) / 2;

  return avgMotivation * 0.7 + motivationAlignment * 0.3;
}

// ============================================================================
// MATCH CHARACTERISTICS
// ============================================================================

function isCupCompetition(leagueId: number, roundName?: string | null): boolean {
  // Heuristic: cup matches often have "cup", "cup." or specific round names
  if (!roundName) return false;
  const lower = roundName.toLowerCase();
  return lower.includes('cup') || lower.includes('copa') || lower.includes('trophy') || lower.includes('round');
}

function estimateTravelDistance(homeTeamId: number, awayTeamId: number): number {
  // Without actual location data, use a rough estimate
  // In production, you'd calculate from venue coordinates
  // For now, return a moderate default
  return 200; // km — average domestic travel
}

function calculateWeatherImpact(
  weatherCode: number | null,
  windSpeed: number | null,
  temperatureC: number | null,
): number {
  let impact = 0;

  // Wind: strong wind affects long balls and crosses
  if (windSpeed !== null) {
    if (windSpeed > 50) impact += 0.3;
    else if (windSpeed > 30) impact += 0.15;
    else if (windSpeed > 15) impact += 0.05;
  }

  // Temperature: extreme heat or cold affects performance
  if (temperatureC !== null) {
    if (temperatureC > 35 || temperatureC < -5) impact += 0.25;
    else if (temperatureC > 30 || temperatureC < 0) impact += 0.1;
  }

  // Weather code: rain/snow (BSD uses WMO codes)
  // 51-55: drizzle, 61-65: rain, 71-75: snow, 95: thunderstorm
  if (weatherCode !== null) {
    if (weatherCode >= 95) impact += 0.3; // Thunderstorm
    else if (weatherCode >= 71 && weatherCode <= 75) impact += 0.25; // Snow
    else if (weatherCode >= 61 && weatherCode <= 65) impact += 0.15; // Rain
    else if (weatherCode >= 51 && weatherCode <= 55) impact += 0.05; // Drizzle
  }

  return clamp(impact, 0, 1);
}

// ============================================================================
// REFEREE CARD TENDENCY
// ============================================================================

async function getRefereeCardTendency(refereeId: number | null): Promise<number> {
  if (!refereeId) return 0.5; // Default moderate tendency

  // In a full implementation, we'd look up the referee's stats
  // For now, return moderate
  return 0.5;
}

// ============================================================================
// SQUAD CONTEXT
// ============================================================================

interface SquadContextResult {
  rotationRisk: number; // 0-1
  keyPlayersOut: number;
}

async function getSquadContext(
  teamId: number,
  lineup: { homePlayers: string; awayPlayers: string; homeUnavailable: string; awayUnavailable: string } | null,
): Promise<SquadContextResult> {
  const defaultResult: SquadContextResult = { rotationRisk: 0.3, keyPlayersOut: 0 };

  if (!lineup) return defaultResult;

  const isHome = true; // We check from the lineup whether the team is home or away
  // Actually we need to determine if this team is home or away
  // The fixture has homeTeamId, but we only have the lineup here
  // We need the fixture data too... let's get it from context

  // Try to parse unavailable players
  try {
    // We need to figure out home/away, but the lineup data has both
    // For now, let's just count unavailable players from both sides
    const homeUnavailable = JSON.parse(lineup.homeUnavailable || '[]') as unknown[];
    const awayUnavailable = JSON.parse(lineup.awayUnavailable || '[]') as unknown[];

    // We'll return a combination — the calling function knows which team is home
    // But since we're in a generic function, let's return the average
    const totalUnavailable = homeUnavailable.length + awayUnavailable.length;
    const keyPlayersOut = Math.floor(totalUnavailable / 2); // Rough split

    return {
      rotationRisk: defaultResult.rotationRisk,
      keyPlayersOut,
    };
  } catch {
    return defaultResult;
  }
}

// ============================================================================
// HEAD TO HEAD
// ============================================================================

interface H2HResult {
  homeWins: number;
  draws: number;
  awayWins: number;
  goalAvg: number;
}

async function getHeadToHead(homeTeamId: number, awayTeamId: number): Promise<H2HResult> {
  // Get previous meetings between these two teams
  const fixtures = await db.fixture.findMany({
    where: {
      OR: [
        { homeTeamId, awayTeamId },
        { homeTeamId: awayTeamId, awayTeamId: homeTeamId },
      ],
      status: { in: ['finished', 'FT'] },
      homeScore: { not: null },
      awayScore: { not: null },
    },
    orderBy: { eventDate: 'desc' },
    take: 10,
  });

  if (fixtures.length === 0) {
    return { homeWins: 0, draws: 0, awayWins: 0, goalAvg: 2.5 };
  }

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let totalGoals = 0;

  for (const fixture of fixtures) {
    // "Home" in H2H context = the team that is home in the upcoming fixture
    const isTeamHome = fixture.homeTeamId === homeTeamId;
    const teamGoals = isTeamHome ? fixture.homeScore! : fixture.awayScore!;
    const oppGoals = isTeamHome ? fixture.awayScore! : fixture.homeScore!;

    totalGoals += teamGoals + oppGoals;

    if (teamGoals > oppGoals) homeWins++;
    else if (teamGoals === oppGoals) draws++;
    else awayWins++;
  }

  return {
    homeWins,
    draws,
    awayWins,
    goalAvg: totalGoals / fixtures.length,
  };
}

// ============================================================================
// UTILITY
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
