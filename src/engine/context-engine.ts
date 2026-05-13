// xG-Vantage Context Engine — Turso/libSQL version
// Analyzes MATCH CONTEXT — form, fatigue, motivation, derby, rotation, H2H, weather

import { client } from '@/lib/db-turso';
import { getEloRating } from './elo-system';

// ============================================================================
// TYPES
// ============================================================================

export interface MatchContext {
  fixtureId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeFormScore: number;
  awayFormScore: number;
  homeFormTrend: 'improving' | 'stable' | 'declining';
  awayFormTrend: 'improving' | 'stable' | 'declining';
  formAdvantage: number;
  homeDaysSinceLastMatch: number;
  awayDaysSinceLastMatch: number;
  restAdvantage: number;
  homeTablePosition: number;
  awayTablePosition: number;
  homePointsToSafety: number;
  awayPointsToSafety: number;
  homePointsToTitle: number;
  awayPointsToTitle: number;
  homeMotivation: MotivationType;
  awayMotivation: MotivationType;
  motivationScore: number;
  isLocalDerby: boolean;
  isCupMatch: boolean;
  isFriendly: boolean;
  isNeutralGround: boolean;
  travelDistanceKm: number;
  weatherImpact: number;
  refereeCardTendency: number;
  homeRotationRisk: number;
  awayRotationRisk: number;
  homeKeyPlayersOut: number;
  awayKeyPlayersOut: number;
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
// MAIN FUNCTION
// ============================================================================

export async function analyzeMatchContext(fixtureId: number): Promise<MatchContext | null> {
  console.log(`[Context] Analyzing match context for fixture ${fixtureId}...`);

  const fixtureResult = await client.execute({
    sql: 'SELECT * FROM fixtures WHERE id = ?',
    args: [fixtureId],
  });
  if (fixtureResult.rows.length === 0) return null;

  const f = fixtureResult.rows[0];
  const homeTeamId = f.home_team_id as number;
  const awayTeamId = f.away_team_id as number;
  const eventDate = f.event_date as string;
  const leagueId = f.league_id as number;

  // Form
  const homeForm = await calculateFormScore(homeTeamId, eventDate);
  const awayForm = await calculateFormScore(awayTeamId, eventDate);

  // Rest
  const homeRest = await getDaysSinceLastMatch(homeTeamId, eventDate);
  const awayRest = await getDaysSinceLastMatch(awayTeamId, eventDate);

  // Table context
  const tableContext = await getTableContext(homeTeamId, awayTeamId, leagueId);

  // Match characteristics
  const isLocalDerby = (f.is_local_derby as number) === 1;
  const travelDistanceKm = (f.travel_distance_km as number) ?? 200;

  // Weather
  const weatherImpact = calculateWeatherImpact(
    f.weather_code as number | null,
    f.wind_speed as number | null,
    f.temperature as number | null,
  );

  // H2H
  const h2h = await getHeadToHead(homeTeamId, awayTeamId);

  const context: MatchContext = {
    fixtureId,
    homeTeamId,
    awayTeamId,
    homeFormScore: homeForm.score,
    awayFormScore: awayForm.score,
    homeFormTrend: homeForm.trend,
    awayFormTrend: awayForm.trend,
    formAdvantage: calculateFormAdvantage(homeForm.score, awayForm.score),
    homeDaysSinceLastMatch: homeRest,
    awayDaysSinceLastMatch: awayRest,
    restAdvantage: calculateRestAdvantage(homeRest, awayRest),
    homeTablePosition: tableContext.homePosition,
    awayTablePosition: tableContext.awayPosition,
    homePointsToSafety: tableContext.homePointsToSafety,
    awayPointsToSafety: tableContext.awayPointsToSafety,
    homePointsToTitle: tableContext.homePointsToTitle,
    awayPointsToTitle: tableContext.awayPointsToTitle,
    homeMotivation: tableContext.homeMotivation,
    awayMotivation: tableContext.awayMotivation,
    motivationScore: calculateMotivationScore(tableContext.homeMotivation, tableContext.awayMotivation),
    isLocalDerby,
    isCupMatch: false,
    isFriendly: false,
    isNeutralGround: false,
    travelDistanceKm,
    weatherImpact,
    refereeCardTendency: 0.5,
    homeRotationRisk: 0.3,
    awayRotationRisk: 0.3,
    homeKeyPlayersOut: 0,
    awayKeyPlayersOut: 0,
    h2hHomeWins: h2h.homeWins,
    h2hDraws: h2h.draws,
    h2hAwayWins: h2h.awayWins,
    h2hGoalAvg: h2h.goalAvg,
  };

  return context;
}

// ============================================================================
// FORM SCORE
// ============================================================================

interface FormResult {
  score: number;
  trend: 'improving' | 'stable' | 'declining';
}

async function calculateFormScore(teamId: number, _referenceDate: string): Promise<FormResult> {
  const fixtures = await client.execute({
    sql: `SELECT home_team_id, away_team_id, home_score, away_score, event_date
          FROM fixtures WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'finished'
            AND home_score IS NOT NULL AND away_score IS NOT NULL
          ORDER BY event_date DESC LIMIT 10`,
    args: [teamId, teamId],
  });

  if (fixtures.rows.length === 0) return { score: 0.5, trend: 'stable' };

  let weightedScore = 0;
  let totalWeight = 0;
  const formPoints: number[] = [];

  for (let i = 0; i < fixtures.rows.length; i++) {
    const f = fixtures.rows[i];
    const isHome = (f.home_team_id as number) === teamId;
    const goalsFor = isHome ? (f.home_score as number) : (f.away_score as number);
    const goalsAgainst = isHome ? (f.away_score as number) : (f.home_score as number);

    let points: number;
    if (goalsFor > goalsAgainst) points = 3;
    else if (goalsFor === goalsAgainst) points = 1;
    else points = 0;

    formPoints.push(points);

    const recencyWeight = Math.pow(0.85, i);
    const opponentId = isHome ? (f.away_team_id as number) : (f.home_team_id as number);
    const opponentElo = await getEloRating(opponentId);
    const qualityWeight = 0.5 + (opponentElo.overall - 1500) / 800;
    const combinedWeight = recencyWeight * Math.max(0.3, qualityWeight);

    weightedScore += (points / 3) * combinedWeight;
    totalWeight += combinedWeight;
  }

  const score = totalWeight > 0 ? clamp(weightedScore / totalWeight, 0, 1) : 0.5;

  let trend: 'improving' | 'stable' | 'declining' = 'stable';
  if (formPoints.length >= 4) {
    const recent3 = formPoints.slice(0, 3);
    const previous3 = formPoints.slice(3, 6);
    if (previous3.length >= 2) {
      const recentAvg = recent3.reduce((s, p) => s + p, 0) / recent3.length;
      const previousAvg = previous3.reduce((s, p) => s + p, 0) / previous3.length;
      if (recentAvg - previousAvg > 0.5) trend = 'improving';
      else if (previousAvg - recentAvg > 0.5) trend = 'declining';
    }
  }

  return { score, trend };
}

// ============================================================================
// REST / FATIGUE
// ============================================================================

async function getDaysSinceLastMatch(teamId: number, referenceDate: string): Promise<number> {
  const lastMatch = await client.execute({
    sql: `SELECT event_date FROM fixtures
          WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'finished' AND event_date < ?
          ORDER BY event_date DESC LIMIT 1`,
    args: [teamId, teamId, referenceDate],
  });

  if (lastMatch.rows.length === 0) return 14;
  return Math.floor((new Date(referenceDate).getTime() - new Date(lastMatch.rows[0].event_date as string).getTime()) / (1000 * 60 * 60 * 24));
}

function calculateRestAdvantage(homeDays: number, awayDays: number): number {
  const homeScore = calculateRestScore(homeDays);
  const awayScore = calculateRestScore(awayDays);
  return clamp(homeScore - awayScore, -1, 1);
}

function calculateRestScore(days: number): number {
  if (days <= 2) return 0.2;
  if (days <= 3) return 0.5;
  if (days <= 7) return 1.0;
  if (days <= 10) return 0.8;
  return 0.5;
}

// ============================================================================
// TABLE CONTEXT
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

async function getTableContext(homeTeamId: number, awayTeamId: number, leagueId: number): Promise<TableContextResult> {
  const defaults: TableContextResult = {
    homePosition: 10, awayPosition: 10,
    homePointsToSafety: 10, awayPointsToSafety: 10,
    homePointsToTitle: 20, awayPointsToTitle: 20,
    homeMotivation: 'midtable', awayMotivation: 'midtable',
  };

  const standings = await client.execute({
    sql: 'SELECT * FROM standings WHERE league_id = ? ORDER BY position ASC',
    args: [leagueId],
  });

  if (standings.rows.length === 0) return defaults;

  const homeStanding = standings.rows.find(s => (s.team_id as number) === homeTeamId);
  const awayStanding = standings.rows.find(s => (s.team_id as number) === awayTeamId);
  if (!homeStanding || !awayStanding) return defaults;

  const totalTeams = standings.rows.length;
  const leaderPoints = (standings.rows[0].pts as number) ?? 0;
  const relegationLine = Math.max(totalTeams - 3, Math.ceil(totalTeams * 0.8));
  const safetyPoints = relegationLine <= standings.rows.length ? (standings.rows[relegationLine - 1].pts as number) : 0;

  return {
    homePosition: homeStanding.position as number,
    awayPosition: awayStanding.position as number,
    homePointsToSafety: (homeStanding.pts as number) - safetyPoints,
    awayPointsToSafety: (awayStanding.pts as number) - safetyPoints,
    homePointsToTitle: leaderPoints - (homeStanding.pts as number),
    awayPointsToTitle: leaderPoints - (awayStanding.pts as number),
    homeMotivation: determineMotivation(homeStanding.position as number, totalTeams, (homeStanding.pts as number) - safetyPoints, leaderPoints - (homeStanding.pts as number)),
    awayMotivation: determineMotivation(awayStanding.position as number, totalTeams, (awayStanding.pts as number) - safetyPoints, leaderPoints - (awayStanding.pts as number)),
  };
}

function determineMotivation(position: number, totalTeams: number, pointsToSafety: number, pointsToTitle: number): MotivationType {
  if (position <= 3 && pointsToTitle <= 6) return 'title_race';
  if (position <= 4) return 'champions_league';
  if (position <= 6) return 'europa';
  if (position > totalTeams - 4 || pointsToSafety <= 3) return 'relegation';
  if (position > totalTeams * 0.6 && pointsToSafety > 6) return 'promoted';
  return 'midtable';
}

function calculateFormAdvantage(homeFormScore: number, awayFormScore: number): number {
  return clamp((homeFormScore - awayFormScore) * 2, -1, 1);
}

function calculateMotivationScore(homeMotivation: MotivationType, awayMotivation: MotivationType): number {
  const motivationValues: Record<MotivationType, number> = {
    title_race: 1.0, champions_league: 0.9, europa: 0.75,
    relegation: 0.95, promoted: 0.6, midtable: 0.3, friendly: 0.1,
  };
  const homeMot = motivationValues[homeMotivation] ?? 0.5;
  const awayMot = motivationValues[awayMotivation] ?? 0.5;
  const avgMotivation = (homeMot + awayMot) / 2;
  const motivationAlignment = 1 - Math.abs(homeMot - awayMot) / 2;
  return avgMotivation * 0.7 + motivationAlignment * 0.3;
}

// ============================================================================
// WEATHER
// ============================================================================

function calculateWeatherImpact(weatherCode: number | null, windSpeed: number | null, temperature: number | null): number {
  let impact = 0;
  if (windSpeed !== null) {
    if (windSpeed > 50) impact += 0.3;
    else if (windSpeed > 30) impact += 0.15;
  }
  if (temperature !== null && (temperature > 35 || temperature < -5)) impact += 0.25;
  if (weatherCode !== null) {
    if (weatherCode >= 95) impact += 0.3;
    else if (weatherCode >= 71 && weatherCode <= 75) impact += 0.25;
    else if (weatherCode >= 61 && weatherCode <= 65) impact += 0.15;
  }
  return clamp(impact, 0, 1);
}

// ============================================================================
// H2H
// ============================================================================

interface H2HResult {
  homeWins: number;
  draws: number;
  awayWins: number;
  goalAvg: number;
}

async function getHeadToHead(homeTeamId: number, awayTeamId: number): Promise<H2HResult> {
  const fixtures = await client.execute({
    sql: `SELECT home_team_id, away_team_id, home_score, away_score FROM fixtures
          WHERE ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))
            AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
          ORDER BY event_date DESC LIMIT 10`,
    args: [homeTeamId, awayTeamId, awayTeamId, homeTeamId],
  });

  if (fixtures.rows.length === 0) return { homeWins: 0, draws: 0, awayWins: 0, goalAvg: 2.5 };

  let homeWins = 0, draws = 0, awayWins = 0, totalGoals = 0;
  for (const f of fixtures.rows) {
    const isTeamHome = (f.home_team_id as number) === homeTeamId;
    const teamGoals = isTeamHome ? (f.home_score as number) : (f.away_score as number);
    const oppGoals = isTeamHome ? (f.away_score as number) : (f.home_score as number);
    totalGoals += teamGoals + oppGoals;
    if (teamGoals > oppGoals) homeWins++;
    else if (teamGoals === oppGoals) draws++;
    else awayWins++;
  }

  return { homeWins, draws, awayWins, goalAvg: totalGoals / fixtures.rows.length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
