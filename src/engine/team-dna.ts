// xG-Vantage — Team DNA Engine
// THE BRAIN — learns everything about a team over time
// Computes attack/defense strengths, style vectors, behavioral patterns, and home advantage

import { db } from '@/lib/db';

// ============================================================================
// TYPES
// ============================================================================

export interface TeamProfile {
  teamId: number;
  // Home identity
  homeAttackStrength: number;
  homeDefenseStrength: number;
  homeAvgGoalsScored: number;
  homeAvgGoalsConceded: number;
  homeAvgXgScored: number;
  homeAvgXgConceded: number;
  homeWinPct: number;
  // Away identity
  awayAttackStrength: number;
  awayDefenseStrength: number;
  awayAvgGoalsScored: number;
  awayAvgGoalsConceded: number;
  awayAvgXgScored: number;
  awayAvgXgConceded: number;
  awayWinPct: number;
  // Style vectors
  possessionStyle: number;
  pressingIntensity: number;
  counterAttackPropensity: number;
  // Behavioral patterns
  homeAdvantageCoefficient: number;
  xgOverperformance: number;
  rotationPct: number;
  comebackPct: number;
  collapsePct: number;
  formVolatility: number;
}

interface FixtureWithStats {
  fixtureId: number;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number;
  xgAgainst: number;
  possession: number;
  shots: number;
  shotsOnTarget: number;
  shotsInsideBox: number;
  shotsOutsideBox: number;
  corners: number;
  tackles: number;
  interceptions: number;
  clearances: number;
  dribblesSuccess: number;
  dribblesTotal: number;
  attacks: number;
  dangerousAttacks: number;
  passes: number;
  accuratePasses: number;
  fouls: number;
  opponentId: number;
  eventDate: Date;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_MATCHES_FOR_DNA = 3;
const MAX_MATCHES_FOR_DNA = 30;
const DEFAULT_LEAGUE_AVG_GOALS = 1.35; // Typical league average goals per team per match

// ============================================================================
// MAIN FUNCTION: COMPUTE TEAM DNA
// ============================================================================

export async function computeTeamDNA(teamId: number): Promise<TeamProfile | null> {
  console.log(`[TeamDNA] Computing DNA for team ${teamId}...`);

  // Step 1: Fetch finished fixtures for this team
  const homeFixtures = await fetchTeamFixtures(teamId, true);
  const awayFixtures = await fetchTeamFixtures(teamId, false);

  if (homeFixtures.length < MIN_MATCHES_FOR_DNA && awayFixtures.length < MIN_MATCHES_FOR_DNA) {
    console.warn(`[TeamDNA] Not enough matches for team ${teamId} (home: ${homeFixtures.length}, away: ${awayFixtures.length}). Need at least ${MIN_MATCHES_FOR_DNA}.`);
    return null;
  }

  // Step 2: Get league averages for normalization
  const leagueAvg = await getLeagueAvgGoals(teamId);

  // Step 3: Calculate home and away identities
  const homeIdentity = calculateVenueIdentity(homeFixtures, leagueAvg);
  const awayIdentity = calculateVenueIdentity(awayFixtures, leagueAvg);

  // Step 4: Calculate style vectors
  const allFixtures = [...homeFixtures, ...awayFixtures];
  const styleVectors = calculateStyleVectors(allFixtures);

  // Step 5: Calculate behavioral patterns
  const behavioralPatterns = await calculateBehavioralPatterns(teamId, homeFixtures, awayFixtures, leagueAvg);

  // Step 6: Build the profile
  const profile: TeamProfile = {
    teamId,
    homeAttackStrength: homeIdentity.attackStrength,
    homeDefenseStrength: homeIdentity.defenseStrength,
    homeAvgGoalsScored: homeIdentity.avgGoalsScored,
    homeAvgGoalsConceded: homeIdentity.avgGoalsConceded,
    homeAvgXgScored: homeIdentity.avgXgScored,
    homeAvgXgConceded: homeIdentity.avgXgConceded,
    homeWinPct: homeIdentity.winPct,
    awayAttackStrength: awayIdentity.attackStrength,
    awayDefenseStrength: awayIdentity.defenseStrength,
    awayAvgGoalsScored: awayIdentity.avgGoalsScored,
    awayAvgGoalsConceded: awayIdentity.avgGoalsConceded,
    awayAvgXgScored: awayIdentity.avgXgScored,
    awayAvgXgConceded: awayIdentity.avgXgConceded,
    awayWinPct: awayIdentity.winPct,
    possessionStyle: styleVectors.possessionStyle,
    pressingIntensity: styleVectors.pressingIntensity,
    counterAttackPropensity: styleVectors.counterAttackPropensity,
    homeAdvantageCoefficient: behavioralPatterns.homeAdvantageCoefficient,
    xgOverperformance: behavioralPatterns.xgOverperformance,
    rotationPct: behavioralPatterns.rotationPct,
    comebackPct: behavioralPatterns.comebackPct,
    collapsePct: behavioralPatterns.collapsePct,
    formVolatility: behavioralPatterns.formVolatility,
  };

  // Step 7: Store in database
  await storeTeamDNA(profile, homeIdentity, awayIdentity, styleVectors, homeFixtures.length, awayFixtures.length);

  console.log(`[TeamDNA] DNA computed for team ${teamId}: Home Attack=${profile.homeAttackStrength.toFixed(2)}, Away Attack=${profile.awayAttackStrength.toFixed(2)}, HomeAdv=${profile.homeAdvantageCoefficient.toFixed(3)}`);

  return profile;
}

// ============================================================================
// FETCH FIXTURES WITH STATS
// ============================================================================

async function fetchTeamFixtures(teamId: number, isHome: boolean): Promise<FixtureWithStats[]> {
  const teamField = isHome ? 'homeTeamId' : 'awayTeamId';
  const fixtures = await db.fixture.findMany({
    where: {
      [teamField]: teamId,
      status: { in: ['finished', 'FT'] },
      homeScore: { not: null },
      awayScore: { not: null },
    },
    include: {
      stats: true,
    },
    orderBy: { eventDate: 'desc' },
    take: MAX_MATCHES_FOR_DNA,
  });

  return fixtures.map((f) => mapFixtureWithStats(f, teamId)).filter((f): f is FixtureWithStats => f !== null);
}

function mapFixtureWithStats(
  fixture: {
    id: number;
    homeTeamId: number;
    awayTeamId: number;
    homeScore: number | null;
    awayScore: number | null;
    eventDate: Date;
    stats: {
      homeTotalShots: number; homeShotsOnTarget: number; homeShotsInsideBox: number;
      homeShotsOutsideBox: number; homeCornerKicks: number; homeBallPossession: number;
      homeTotalTackles: number; homeInterceptions: number; homeClearances: number;
      homeDribblesSuccess: number; homeDribblesTotal: number; homeAttacks: number;
      homeDangerousAttacks: number; homePasses: number; homeAccuratePasses: number;
      homeFouls: number; homeExpectedGoals: number;
      awayTotalShots: number; awayShotsOnTarget: number; awayShotsInsideBox: number;
      awayShotsOutsideBox: number; awayCornerKicks: number; awayBallPossession: number;
      awayTotalTackles: number; awayInterceptions: number; awayClearances: number;
      awayDribblesSuccess: number; awayDribblesTotal: number; awayAttacks: number;
      awayDangerousAttacks: number; awayPasses: number; awayAccuratePasses: number;
      awayFouls: number; awayExpectedGoals: number;
    } | null;
  },
  teamId: number,
): FixtureWithStats | null {
  if (!fixture || fixture.homeScore === null || fixture.awayScore === null || !fixture.stats) {
    return null;
  }

  const isHome = fixture.homeTeamId === teamId;
  const s = fixture.stats;

  const getStat = (prefix: 'home' | 'away', key: string): number => {
    const field = `${prefix}${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof typeof s;
    return (s[field] as number) ?? 0;
  };

  const myPrefix: 'home' | 'away' = isHome ? 'home' : 'away';
  const oppPrefix: 'home' | 'away' = isHome ? 'away' : 'home';

  return {
    fixtureId: fixture.id,
    isHome,
    goalsFor: isHome ? fixture.homeScore : fixture.awayScore,
    goalsAgainst: isHome ? fixture.awayScore : fixture.homeScore,
    xgFor: getStat(myPrefix, 'expectedGoals'),
    xgAgainst: getStat(oppPrefix, 'expectedGoals'),
    possession: getStat(myPrefix, 'ballPossession'),
    shots: getStat(myPrefix, 'totalShots'),
    shotsOnTarget: getStat(myPrefix, 'shotsOnTarget'),
    shotsInsideBox: getStat(myPrefix, 'shotsInsideBox'),
    shotsOutsideBox: getStat(myPrefix, 'shotsOutsideBox'),
    corners: getStat(myPrefix, 'cornerKicks'),
    tackles: getStat(myPrefix, 'totalTackles'),
    interceptions: getStat(myPrefix, 'interceptions'),
    clearances: getStat(myPrefix, 'clearances'),
    dribblesSuccess: getStat(myPrefix, 'dribblesSuccess'),
    dribblesTotal: getStat(myPrefix, 'dribblesTotal'),
    attacks: getStat(myPrefix, 'attacks'),
    dangerousAttacks: getStat(myPrefix, 'dangerousAttacks'),
    passes: getStat(myPrefix, 'passes'),
    accuratePasses: getStat(myPrefix, 'accuratePasses'),
    fouls: getStat(myPrefix, 'fouls'),
    opponentId: isHome ? fixture.awayTeamId : fixture.homeTeamId,
    eventDate: fixture.eventDate,
  };
}

// ============================================================================
// LEAGUE AVERAGES
// ============================================================================

async function getLeagueAvgGoals(teamId: number): Promise<{ home: number; away: number; overall: number }> {
  // Find the most recent league this team plays in
  const recentFixture = await db.fixture.findFirst({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      status: { in: ['finished', 'FT'] },
    },
    orderBy: { eventDate: 'desc' },
    select: { leagueId: true },
  });

  if (!recentFixture) {
    return { home: DEFAULT_LEAGUE_AVG_GOALS, away: DEFAULT_LEAGUE_AVG_GOALS, overall: DEFAULT_LEAGUE_AVG_GOALS };
  }

  // Calculate league averages from standings
  const standings = await db.standing.findMany({
    where: { leagueId: recentFixture.leagueId },
  });

  if (standings.length === 0) {
    return { home: DEFAULT_LEAGUE_AVG_GOALS, away: DEFAULT_LEAGUE_AVG_GOALS, overall: DEFAULT_LEAGUE_AVG_GOALS };
  }

  const totalPlayed = standings.reduce((sum, s) => sum + s.played, 0);
  const totalGF = standings.reduce((sum, s) => sum + s.gf, 0);

  if (totalPlayed === 0) {
    return { home: DEFAULT_LEAGUE_AVG_GOALS, away: DEFAULT_LEAGUE_AVG_GOALS, overall: DEFAULT_LEAGUE_AVG_GOALS };
  }

  const overall = totalGF / totalPlayed;
  // Typically home teams score ~55% of goals, away ~45%
  return {
    home: overall * 1.1,
    away: overall * 0.9,
    overall,
  };
}

// ============================================================================
// VENUE IDENTITY CALCULATION
// ============================================================================

interface VenueIdentity {
  attackStrength: number;
  defenseStrength: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  avgXgScored: number;
  avgXgConceded: number;
  avgPossession: number;
  avgShots: number;
  avgShotsOnTarget: number;
  avgCorners: number;
  winPct: number;
  drawPct: number;
  lossPct: number;
  cleanSheetPct: number;
  bttsPct: number;
  over25Pct: number;
}

function calculateVenueIdentity(
  fixtures: FixtureWithStats[],
  leagueAvg: { home: number; away: number; overall: number },
): VenueIdentity {
  if (fixtures.length === 0) {
    return {
      attackStrength: 1.0,
      defenseStrength: 1.0,
      avgGoalsScored: leagueAvg.overall,
      avgGoalsConceded: leagueAvg.overall,
      avgXgScored: leagueAvg.overall,
      avgXgConceded: leagueAvg.overall,
      avgPossession: 50,
      avgShots: 12,
      avgShotsOnTarget: 4,
      avgCorners: 5,
      winPct: 0,
      drawPct: 0,
      lossPct: 0,
      cleanSheetPct: 0,
      bttsPct: 0,
      over25Pct: 0,
    };
  }

  const n = fixtures.length;

  // Basic averages
  const avgGoalsScored = fixtures.reduce((s, f) => s + f.goalsFor, 0) / n;
  const avgGoalsConceded = fixtures.reduce((s, f) => s + f.goalsAgainst, 0) / n;
  const avgXgScored = fixtures.reduce((s, f) => s + f.xgFor, 0) / n;
  const avgXgConceded = fixtures.reduce((s, f) => s + f.xgAgainst, 0) / n;
  const avgPossession = fixtures.reduce((s, f) => s + f.possession, 0) / n;
  const avgShots = fixtures.reduce((s, f) => s + f.shots, 0) / n;
  const avgShotsOnTarget = fixtures.reduce((s, f) => s + f.shotsOnTarget, 0) / n;
  const avgCorners = fixtures.reduce((s, f) => s + f.corners, 0) / n;

  // Attack strength = team's avg goals / league avg goals
  const leagueAvgForVenue = fixtures[0]?.isHome ? leagueAvg.home : leagueAvg.away;
  const attackStrength = safeDivide(avgGoalsScored, leagueAvgForVenue, 1.0);
  const defenseStrength = safeDivide(avgGoalsConceded, leagueAvgForVenue, 1.0);

  // Clamp to reasonable range
  const clampedAttack = clamp(attackStrength, 0.3, 2.5);
  const clampedDefense = clamp(defenseStrength, 0.3, 2.5);

  // Win/Draw/Loss percentages
  const wins = fixtures.filter((f) => f.goalsFor > f.goalsAgainst).length;
  const draws = fixtures.filter((f) => f.goalsFor === f.goalsAgainst).length;
  const losses = fixtures.filter((f) => f.goalsFor < f.goalsAgainst).length;

  // Clean sheet, BTTS, Over 2.5
  const cleanSheets = fixtures.filter((f) => f.goalsAgainst === 0).length;
  const btts = fixtures.filter((f) => f.goalsFor > 0 && f.goalsAgainst > 0).length;
  const over25 = fixtures.filter((f) => f.goalsFor + f.goalsAgainst > 2).length;

  return {
    attackStrength: clampedAttack,
    defenseStrength: clampedDefense,
    avgGoalsScored,
    avgGoalsConceded,
    avgXgScored,
    avgXgConceded,
    avgPossession,
    avgShots,
    avgShotsOnTarget,
    avgCorners,
    winPct: wins / n,
    drawPct: draws / n,
    lossPct: losses / n,
    cleanSheetPct: cleanSheets / n,
    bttsPct: btts / n,
    over25Pct: over25 / n,
  };
}

// ============================================================================
// STYLE VECTORS
// ============================================================================

interface StyleVectors {
  possessionStyle: number;
  pressingIntensity: number;
  counterAttackPropensity: number;
  defensiveSolidity: number;
  setPieceThreat: number;
  crossingPropensity: number;
  longBallPropensity: number;
  tempo: number;
  lateGoalThreat: number;
  earlyGoalThreat: number;
}

function calculateStyleVectors(fixtures: FixtureWithStats[]): StyleVectors {
  if (fixtures.length === 0) {
    return {
      possessionStyle: 0.5,
      pressingIntensity: 0.5,
      counterAttackPropensity: 0.5,
      defensiveSolidity: 0.5,
      setPieceThreat: 0.5,
      crossingPropensity: 0.5,
      longBallPropensity: 0.5,
      tempo: 0.5,
      lateGoalThreat: 0.5,
      earlyGoalThreat: 0.5,
    };
  }

  const n = fixtures.length;

  // Possession style: based on average possession (> 55% = possession-heavy)
  const avgPossession = fixtures.reduce((s, f) => s + f.possession, 0) / n;
  const possessionStyle = clamp((avgPossession - 35) / 40, 0, 1); // 35%->0, 75%->1

  // Pressing intensity: based on tackles, interceptions, and high attacks
  const avgTackles = fixtures.reduce((s, f) => s + f.tackles, 0) / n;
  const avgInterceptions = fixtures.reduce((s, f) => s + f.interceptions, 0) / n;
  const avgDangerousAttacks = fixtures.reduce((s, f) => s + f.dangerousAttacks, 0) / n;
  const pressingRaw = ((avgTackles + avgInterceptions) / 25 + avgDangerousAttacks / 60) / 2;
  const pressingIntensity = clamp(pressingRaw, 0, 1);

  // Counter-attack propensity: low possession + high dribbles + shots outside box
  const avgDribblesSuccess = fixtures.reduce((s, f) => s + f.dribblesSuccess, 0) / n;
  const avgShotsOutsideBox = fixtures.reduce((s, f) => s + f.shotsOutsideBox, 0) / n;
  const counterRaw = ((1 - possessionStyle) + avgDribblesSuccess / 12 + avgShotsOutsideBox / 8) / 3;
  const counterAttackPropensity = clamp(counterRaw, 0, 1);

  // Defensive solidity: based on clean sheets, low goals conceded, high clearances
  const avgClearances = fixtures.reduce((s, f) => s + f.clearances, 0) / n;
  const avgGoalsConceded = fixtures.reduce((s, f) => s + f.goalsAgainst, 0) / n;
  const cleanSheetRate = fixtures.filter((f) => f.goalsAgainst === 0).length / n;
  const defensiveSolidity = clamp((cleanSheetRate + (1 - avgGoalsConceded / 3) + avgClearances / 30) / 3, 0, 1);

  // Set piece threat: high corners suggest set piece threat
  const avgCorners = fixtures.reduce((s, f) => s + f.corners, 0) / n;
  const setPieceThreat = clamp(avgCorners / 8, 0, 1);

  // Crossing propensity: related to wide play and attacking
  const crossingPropensity = clamp((avgCorners / 7 + avgDangerousAttacks / 50) / 2, 0, 1);

  // Long ball propensity: low pass accuracy + high shots outside box
  const avgPassAccuracy = fixtures.reduce((s, f) => s + (f.passes > 0 ? f.accuratePasses / f.passes : 0), 0) / n;
  const longBallPropensity = clamp(((1 - avgPassAccuracy) + avgShotsOutsideBox / 10) / 2, 0, 1);

  // Tempo: high number of attacks and dangerous attacks per match
  const avgAttacks = fixtures.reduce((s, f) => s + f.attacks, 0) / n;
  const tempo = clamp((avgAttacks / 60 + avgDangerousAttacks / 40) / 2, 0, 1);

  // Late/Early goal threat: approximated from overall attacking strength
  const avgGoals = fixtures.reduce((s, f) => s + f.goalsFor, 0) / n;
  const lateGoalThreat = clamp(avgGoals / 2.5, 0, 1);
  const earlyGoalThreat = clamp(avgGoals / 3, 0, 1);

  return {
    possessionStyle,
    pressingIntensity,
    counterAttackPropensity,
    defensiveSolidity,
    setPieceThreat,
    crossingPropensity,
    longBallPropensity,
    tempo,
    lateGoalThreat,
    earlyGoalThreat,
  };
}

// ============================================================================
// BEHAVIORAL PATTERNS
// ============================================================================

interface BehavioralPatterns {
  homeAdvantageCoefficient: number;
  xgOverperformance: number;
  rotationPct: number;
  comebackPct: number;
  collapsePct: number;
  formVolatility: number;
}

async function calculateBehavioralPatterns(
  teamId: number,
  homeFixtures: FixtureWithStats[],
  awayFixtures: FixtureWithStats[],
  leagueAvg: { home: number; away: number; overall: number },
): Promise<BehavioralPatterns> {
  const allFixtures = [...homeFixtures, ...awayFixtures];

  // Home advantage coefficient: how much better this team is at home vs away
  const homeAdvantageCoefficient = calculateHomeAdvantageCoefficient(homeFixtures, awayFixtures);

  // xG overperformance: goals scored vs xG
  const xgOverperformance = calculateXgOverperformance(allFixtures);

  // Rotation percentage
  const rotationPct = await calculateRotationPct(teamId);

  // Comeback percentage
  const comebackPct = await calculateComebackPct(teamId);

  // Collapse percentage
  const collapsePct = await calculateCollapsePct(teamId);

  // Form volatility
  const formVolatility = calculateFormVolatility(allFixtures);

  return {
    homeAdvantageCoefficient,
    xgOverperformance,
    rotationPct,
    comebackPct,
    collapsePct,
    formVolatility,
  };
}

function calculateHomeAdvantageCoefficient(
  homeFixtures: FixtureWithStats[],
  awayFixtures: FixtureWithStats[],
): number {
  if (homeFixtures.length < 2 || awayFixtures.length < 2) {
    return 0.2; // Default generic home advantage
  }

  const homePPG = homeFixtures.reduce((s, f) => {
    if (f.goalsFor > f.goalsAgainst) return s + 3;
    if (f.goalsFor === f.goalsAgainst) return s + 1;
    return s;
  }, 0) / homeFixtures.length;

  const awayPPG = awayFixtures.reduce((s, f) => {
    if (f.goalsFor > f.goalsAgainst) return s + 3;
    if (f.goalsFor === f.goalsAgainst) return s + 1;
    return s;
  }, 0) / awayFixtures.length;

  // Convert PPG difference to a coefficient
  // League average home advantage is ~0.2 (teams score 0.2 more goals at home)
  // Scale: PPG diff of 1.0 ≈ coefficient of 0.4
  const ppgDiff = homePPG - awayPPG;
  const coefficient = clamp(ppgDiff / 2.5, -0.2, 0.6);

  return Math.max(0.05, coefficient + 0.2); // Minimum 0.05, centered around 0.2
}

function calculateXgOverperformance(fixtures: FixtureWithStats[]): number {
  if (fixtures.length === 0) return 1.0;

  const totalGoals = fixtures.reduce((s, f) => s + f.goalsFor, 0);
  const totalXg = fixtures.reduce((s, f) => s + f.xgFor, 0);

  if (totalXg === 0) return 1.0;

  return totalGoals / totalXg;
}

async function calculateRotationPct(teamId: number): Promise<number> {
  // Look at consecutive lineups and count how many players change
  const fixtures = await db.fixture.findMany({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      status: { in: ['finished', 'FT'] },
    },
    include: { lineup: true },
    orderBy: { eventDate: 'desc' },
    take: 10,
  });

  const lineupPlayerSets: Set<number>[] = [];

  for (const fixture of fixtures) {
    if (!fixture.lineup) continue;

    const isHome = fixture.homeTeamId === teamId;
    const playersKey = isHome ? 'homePlayers' : 'awayPlayers';

    try {
      const raw = JSON.parse(fixture.lineup[playersKey] as string || '[]') as Array<{ id: number }>;
      const playerIds = new Set(raw.map((p) => p.id));
      if (playerIds.size > 0) {
        lineupPlayerSets.push(playerIds);
      }
    } catch {
      // Skip unparseable lineups
    }
  }

  if (lineupPlayerSets.length < 2) return 0;

  let totalRotationRate = 0;
  let comparisons = 0;

  for (let i = 0; i < lineupPlayerSets.length - 1; i++) {
    const current = lineupPlayerSets[i];
    const previous = lineupPlayerSets[i + 1];

    const union = new Set([...current, ...previous]);
    const intersection = new Set([...current].filter((x) => previous.has(x)));

    const rotationRate = 1 - intersection.size / Math.max(union.size, 1);
    totalRotationRate += rotationRate;
    comparisons++;
  }

  return comparisons > 0 ? totalRotationRate / comparisons : 0;
}

async function calculateComebackPct(teamId: number): Promise<number> {
  const fixtures = await db.fixture.findMany({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      status: { in: ['finished', 'FT'] },
    },
    include: { incidents: { orderBy: { minute: 'asc' } } },
    orderBy: { eventDate: 'desc' },
    take: 30,
  });

  let timesBehind = 0;
  let comebacks = 0;

  for (const fixture of fixtures) {
    const isHome = fixture.homeTeamId === teamId;
    let wasBehind = false;

    for (const incident of fixture.incidents) {
      if (incident.type !== 'goal') continue;

      const isTeamGoal = incident.isHome === isHome;
      if (!isTeamGoal) {
        // Opponent scored — team is now behind
        if (!wasBehind) {
          wasBehind = true;
          timesBehind++;
        }
      } else if (wasBehind) {
        // Our team scored after being behind — check if we equalized or took the lead
        const currentDiff = isHome
          ? (incident.homeScore ?? 0) - (incident.awayScore ?? 0)
          : (incident.awayScore ?? 0) - (incident.homeScore ?? 0);
        if (currentDiff >= 0) {
          comebacks++;
          wasBehind = false;
        }
      }
    }
  }

  return timesBehind > 0 ? comebacks / timesBehind : 0;
}

async function calculateCollapsePct(teamId: number): Promise<number> {
  const fixtures = await db.fixture.findMany({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      status: { in: ['finished', 'FT'] },
    },
    include: { incidents: { orderBy: { minute: 'asc' } } },
    orderBy: { eventDate: 'desc' },
    take: 30,
  });

  let timesAhead = 0;
  let collapses = 0;

  for (const fixture of fixtures) {
    const isHome = fixture.homeTeamId === teamId;
    const teamGoals = isHome ? fixture.homeScore ?? 0 : fixture.awayScore ?? 0;
    const oppGoals = isHome ? fixture.awayScore ?? 0 : fixture.homeScore ?? 0;

    // Did the team score first?
    const firstGoal = fixture.incidents.find((inc) => inc.type === 'goal');
    if (!firstGoal) continue;

    const teamScoredFirst = firstGoal.isHome === isHome;
    if (!teamScoredFirst) continue;

    timesAhead++;

    // Did they end up losing?
    if (teamGoals < oppGoals) {
      collapses++;
    }
  }

  return timesAhead > 0 ? collapses / timesAhead : 0;
}

function calculateFormVolatility(fixtures: FixtureWithStats[]): number {
  if (fixtures.length < 3) return 0.5;

  // Calculate points per game for each fixture
  const points = fixtures.map((f) => {
    if (f.goalsFor > f.goalsAgainst) return 3;
    if (f.goalsFor === f.goalsAgainst) return 1;
    return 0;
  });

  // Calculate standard deviation of points (volatility)
  const mean = points.reduce((s, p) => s + p, 0) / points.length;
  const variance = points.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / points.length;
  const stdDev = Math.sqrt(variance);

  // Normalize: max stdDev for 0/3 binary is ~1.5
  return clamp(stdDev / 1.5, 0, 1);
}

// ============================================================================
// STORE TEAM DNA
// ============================================================================

async function storeTeamDNA(
  profile: TeamProfile,
  homeIdentity: VenueIdentity,
  awayIdentity: VenueIdentity,
  styleVectors: StyleVectors,
  homeSampleSize: number,
  awaySampleSize: number,
): Promise<void> {
  await db.teamDNA.upsert({
    where: { teamId: profile.teamId },
    update: {
      // Home identity
      homeAttackStrength: profile.homeAttackStrength,
      homeDefenseStrength: profile.homeDefenseStrength,
      homeAvgGoalsScored: profile.homeAvgGoalsScored,
      homeAvgGoalsConceded: profile.homeAvgGoalsConceded,
      homeAvgXgScored: profile.homeAvgXgScored,
      homeAvgXgConceded: profile.homeAvgXgConceded,
      homeAvgPossession: homeIdentity.avgPossession,
      homeAvgShots: homeIdentity.avgShots,
      homeAvgShotsOnTarget: homeIdentity.avgShotsOnTarget,
      homeAvgCorners: homeIdentity.avgCorners,
      homeWinPct: homeIdentity.winPct,
      homeDrawPct: homeIdentity.drawPct,
      homeLossPct: homeIdentity.lossPct,
      homeCleanSheetPct: homeIdentity.cleanSheetPct,
      homeBttsPct: homeIdentity.bttsPct,
      homeOver25Pct: homeIdentity.over25Pct,
      // Away identity
      awayAttackStrength: profile.awayAttackStrength,
      awayDefenseStrength: profile.awayDefenseStrength,
      awayAvgGoalsScored: profile.awayAvgGoalsScored,
      awayAvgGoalsConceded: profile.awayAvgGoalsConceded,
      awayAvgXgScored: profile.awayAvgXgScored,
      awayAvgXgConceded: profile.awayAvgXgConceded,
      awayAvgPossession: awayIdentity.avgPossession,
      awayAvgShots: awayIdentity.avgShots,
      awayAvgShotsOnTarget: awayIdentity.avgShotsOnTarget,
      awayAvgCorners: awayIdentity.avgCorners,
      awayWinPct: awayIdentity.winPct,
      awayDrawPct: awayIdentity.drawPct,
      awayLossPct: awayIdentity.lossPct,
      awayCleanSheetPct: awayIdentity.cleanSheetPct,
      awayBttsPct: awayIdentity.bttsPct,
      awayOver25Pct: awayIdentity.over25Pct,
      // Style vectors
      possessionStyle: styleVectors.possessionStyle,
      pressingIntensity: styleVectors.pressingIntensity,
      counterAttackPropensity: styleVectors.counterAttackPropensity,
      defensiveSolidity: styleVectors.defensiveSolidity,
      setPieceThreat: styleVectors.setPieceThreat,
      crossingPropensity: styleVectors.crossingPropensity,
      longBallPropensity: styleVectors.longBallPropensity,
      tempo: styleVectors.tempo,
      lateGoalThreat: styleVectors.lateGoalThreat,
      earlyGoalThreat: styleVectors.earlyGoalThreat,
      // Behavioral patterns
      rotationPct: profile.rotationPct,
      homeAdvantageCoefficient: profile.homeAdvantageCoefficient,
      xgOverperformance: profile.xgOverperformance,
      formVolatility: profile.formVolatility,
      comebackPct: profile.comebackPct,
      collapsePct: profile.collapsePct,
      // Sample sizes
      homeSampleSize,
      awaySampleSize,
      lastComputedAt: new Date(),
    },
    create: {
      teamId: profile.teamId,
      homeAttackStrength: profile.homeAttackStrength,
      homeDefenseStrength: profile.homeDefenseStrength,
      homeAvgGoalsScored: profile.homeAvgGoalsScored,
      homeAvgGoalsConceded: profile.homeAvgGoalsConceded,
      homeAvgXgScored: profile.homeAvgXgScored,
      homeAvgXgConceded: profile.homeAvgXgConceded,
      homeAvgPossession: homeIdentity.avgPossession,
      homeAvgShots: homeIdentity.avgShots,
      homeAvgShotsOnTarget: homeIdentity.avgShotsOnTarget,
      homeAvgCorners: homeIdentity.avgCorners,
      homeWinPct: homeIdentity.winPct,
      homeDrawPct: homeIdentity.drawPct,
      homeLossPct: homeIdentity.lossPct,
      homeCleanSheetPct: homeIdentity.cleanSheetPct,
      homeBttsPct: homeIdentity.bttsPct,
      homeOver25Pct: homeIdentity.over25Pct,
      awayAttackStrength: profile.awayAttackStrength,
      awayDefenseStrength: profile.awayDefenseStrength,
      awayAvgGoalsScored: profile.awayAvgGoalsScored,
      awayAvgGoalsConceded: profile.awayAvgGoalsConceded,
      awayAvgXgScored: profile.awayAvgXgScored,
      awayAvgXgConceded: profile.awayAvgXgConceded,
      awayAvgPossession: awayIdentity.avgPossession,
      awayAvgShots: awayIdentity.avgShots,
      awayAvgShotsOnTarget: awayIdentity.avgShotsOnTarget,
      awayAvgCorners: awayIdentity.avgCorners,
      awayWinPct: awayIdentity.winPct,
      awayDrawPct: awayIdentity.drawPct,
      awayLossPct: awayIdentity.lossPct,
      awayCleanSheetPct: awayIdentity.cleanSheetPct,
      awayBttsPct: awayIdentity.bttsPct,
      awayOver25Pct: awayIdentity.over25Pct,
      possessionStyle: styleVectors.possessionStyle,
      pressingIntensity: styleVectors.pressingIntensity,
      counterAttackPropensity: styleVectors.counterAttackPropensity,
      defensiveSolidity: styleVectors.defensiveSolidity,
      setPieceThreat: styleVectors.setPieceThreat,
      crossingPropensity: styleVectors.crossingPropensity,
      longBallPropensity: styleVectors.longBallPropensity,
      tempo: styleVectors.tempo,
      lateGoalThreat: styleVectors.lateGoalThreat,
      earlyGoalThreat: styleVectors.earlyGoalThreat,
      rotationPct: profile.rotationPct,
      homeAdvantageCoefficient: profile.homeAdvantageCoefficient,
      xgOverperformance: profile.xgOverperformance,
      formVolatility: profile.formVolatility,
      comebackPct: profile.comebackPct,
      collapsePct: profile.collapsePct,
      homeSampleSize,
      awaySampleSize,
      lastComputedAt: new Date(),
    },
  });
}

// ============================================================================
// GET TEAM DNA (from database)
// ============================================================================

export async function getTeamDNA(teamId: number): Promise<TeamProfile | null> {
  const dna = await db.teamDNA.findUnique({
    where: { teamId },
  });

  if (!dna) return null;

  return {
    teamId: dna.teamId,
    homeAttackStrength: dna.homeAttackStrength,
    homeDefenseStrength: dna.homeDefenseStrength,
    homeAvgGoalsScored: dna.homeAvgGoalsScored,
    homeAvgGoalsConceded: dna.homeAvgGoalsConceded,
    homeAvgXgScored: dna.homeAvgXgScored,
    homeAvgXgConceded: dna.homeAvgXgConceded,
    homeWinPct: dna.homeWinPct,
    awayAttackStrength: dna.awayAttackStrength,
    awayDefenseStrength: dna.awayDefenseStrength,
    awayAvgGoalsScored: dna.awayAvgGoalsScored,
    awayAvgGoalsConceded: dna.awayAvgGoalsConceded,
    awayAvgXgScored: dna.awayAvgXgScored,
    awayAvgXgConceded: dna.awayAvgXgConceded,
    awayWinPct: dna.awayWinPct,
    possessionStyle: dna.possessionStyle,
    pressingIntensity: dna.pressingIntensity,
    counterAttackPropensity: dna.counterAttackPropensity,
    homeAdvantageCoefficient: dna.homeAdvantageCoefficient,
    xgOverperformance: dna.xgOverperformance,
    rotationPct: dna.rotationPct,
    comebackPct: dna.comebackPct,
    collapsePct: dna.collapsePct,
    formVolatility: dna.formVolatility,
  };
}

// ============================================================================
// COMPUTE OR GET (convenience)
// ============================================================================

export async function getOrComputeTeamDNA(teamId: number): Promise<TeamProfile | null> {
  const existing = await getTeamDNA(teamId);
  if (existing) {
    const dna = await db.teamDNA.findUnique({ where: { teamId } });
    if (dna?.lastComputedAt) {
      const hoursSinceLastCompute = (Date.now() - dna.lastComputedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastCompute < 24) {
        return existing;
      }
    }
  }

  return computeTeamDNA(teamId);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function safeDivide(numerator: number, denominator: number, fallback: number): number {
  if (denominator === 0 || !isFinite(denominator)) return fallback;
  const result = numerator / denominator;
  return isFinite(result) ? result : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
