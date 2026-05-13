// xG-Vantage MONSTER Prediction Engine — Turso/libSQL version
// Completely independent — NEVER uses BSD's predictions
// Models: Poisson-xG + Dixon-Coles, Dynamic ELO, Form-weighted, Style matchup, Context
// Pick classification: ELITE, PLAYABLE, VALUE, MEDIUM, LOW
// Kelly staking, Value detection, Decision stack transparency

import { client } from '@/lib/db-turso';
import { getEloRating } from './elo-system';

// ============================================================================
// MATH UTILITIES
// ============================================================================

/** Poisson probability: P(k events) = (lambda^k * e^-lambda) / k! */
function poissonProb(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** Generate Poisson random variable using Knuth's algorithm */
function poissonRandom(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * boxMullerRandom()));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function boxMullerRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Dixon-Coles adjustment for low-scoring bias in football */
function dixonColesRho(homeGoals: number, awayGoals: number, lambdaHome: number, lambdaAway: number, rho: number): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - (lambdaHome * lambdaAway * rho);
  if (homeGoals === 0 && awayGoals === 1) return 1 + (lambdaHome * rho);
  if (homeGoals === 1 && awayGoals === 0) return 1 + (lambdaAway * rho);
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

/** ELO expected score */
function eloExpected(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TeamData {
  teamId: number;
  name: string;
  // DNA / Profile
  attackStrength: number;
  defenseStrength: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  avgXgScored: number;
  avgXgConceded: number;
  homeAdvantageCoeff: number;
  possessionStyle: number;
  pressingIntensity: number;
  counterAttackPropensity: number;
  defensiveSolidity: number;
  xgOverperformance: number;
  style: string;
  preferredFormation: string;
  pressIntensity: string;
  defLine: string;
  form: string;
  // ELO
  eloRating: number;
  eloHomeRating: number;
  eloAwayRating: number;
  // Form
  formScore: number;
  formTrend: 'improving' | 'stable' | 'declining';
  last5Results: string[];
  cleanSheetPct: number;
  bttsPct: number;
  over25Pct: number;
}

interface MatchContextData {
  restAdvantage: number;
  motivationScore: number;
  isDerby: boolean;
  isCupMatch: boolean;
  isFriendly: boolean;
  travelDistanceKm: number;
  weatherImpact: number;
  homeRotationRisk: number;
  awayRotationRisk: number;
  h2hHomeWins: number;
  h2hDraws: number;
  h2hAwayWins: number;
  h2hGoalAvg: number;
}

export interface MatchPrediction {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  // Main pick
  pickType: string;
  pickLabel: string;
  confidence: number;
  tier: string;
  phantomScore: number;
  edge: number;
  // Probabilities
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  over25Prob: number;
  under25Prob: number;
  bttsYesProb: number;
  bttsNoProb: number;
  // xG
  homeXg: number;
  awayXg: number;
  // Context
  verdict: string;
  decisionStack: Record<string, unknown>;
  keyReasons: string[];
  tacticalMatchup: Record<string, unknown>;
  odds: Record<string, number | null>;
  // Other good picks
  otherGoodPicks: Array<{ pickType: string; pickLabel: string; confidence: number; tier: string }>;
  // Raw model output (for display)
  probOver15: number;
  probOver35: number;
  mostLikelyScore: string;
  modelBreakdown: {
    poissonXg: { probHome: number; probDraw: number; probAway: number; lambdaHome: number; lambdaAway: number };
    elo: { probHome: number; probDraw: number; probAway: number };
    form: { probHome: number; probDraw: number; probAway: number };
    styleMatchup: { probHome: number; probDraw: number; probAway: number };
    context: { probHome: number; probDraw: number; probAway: number };
  };
}

// ============================================================================
// TIER CLASSIFICATION
// ============================================================================

function classifyTier(confidence: number, edge: number): string {
  if (confidence >= 80) return 'elite';
  if (confidence >= 70) return 'playable';
  if (confidence >= 55 && edge >= 10) return 'value';
  if (confidence >= 60) return 'medium';
  return 'low';
}

function classifyVerdict(confidence: number): string {
  if (confidence >= 75) return 'STRONG';
  if (confidence >= 60) return 'MODERATE';
  return 'WEAK';
}

// ============================================================================
// DATA GATHERING
// ============================================================================

async function getTeamData(teamId: number, isHome: boolean): Promise<TeamData> {
  const teamResult = await client.execute({
    sql: 'SELECT name FROM teams WHERE id = ?',
    args: [teamId],
  });
  const teamName = teamResult.rows.length > 0 ? (teamResult.rows[0].name as string) : `Team ${teamId}`;

  // Get team profile
  const profileResult = await client.execute({
    sql: `SELECT * FROM team_profiles WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1`,
    args: [teamId],
  });
  const profile = profileResult.rows.length > 0 ? profileResult.rows[0] : null;

  // Get ELO
  const elo = await getEloRating(teamId);

  // Get recent form from fixtures
  const recentFixtures = await client.execute({
    sql: `SELECT f.id, f.home_team_id, f.away_team_id, f.home_score, f.away_score, f.event_date
          FROM fixtures f
          WHERE (f.home_team_id = ? OR f.away_team_id = ?) AND f.status = 'finished'
            AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
          ORDER BY f.event_date DESC LIMIT 10`,
    args: [teamId, teamId],
  });

  // Compute form score and trend
  const formResults: string[] = [];
  let weightedScore = 0;
  let totalWeight = 0;
  const formPoints: number[] = [];

  for (let i = 0; i < recentFixtures.rows.length; i++) {
    const f = recentFixtures.rows[i];
    const isHomeTeam = (f.home_team_id as number) === teamId;
    const goalsFor = isHomeTeam ? (f.home_score as number) : (f.away_score as number);
    const goalsAgainst = isHomeTeam ? (f.away_score as number) : (f.home_score as number);

    let result: string;
    let points: number;
    if (goalsFor > goalsAgainst) { result = 'W'; points = 3; }
    else if (goalsFor === goalsAgainst) { result = 'D'; points = 1; }
    else { result = 'L'; points = 0; }

    formResults.push(result);
    formPoints.push(points);

    const recencyWeight = Math.pow(0.85, i);
    const combinedWeight = recencyWeight;
    const normalizedPoints = points / 3;
    weightedScore += normalizedPoints * combinedWeight;
    totalWeight += combinedWeight;
  }

  const formScore = totalWeight > 0 ? weightedScore / totalWeight : 0.5;

  // Determine trend
  let formTrend: 'improving' | 'stable' | 'declining' = 'stable';
  if (formPoints.length >= 4) {
    const recent3 = formPoints.slice(0, Math.min(3, formPoints.length));
    const previous3 = formPoints.slice(3, Math.min(6, formPoints.length));
    if (previous3.length >= 2) {
      const recentAvg = recent3.reduce((s, p) => s + p, 0) / recent3.length;
      const previousAvg = previous3.reduce((s, p) => s + p, 0) / previous3.length;
      if (recentAvg - previousAvg > 0.5) formTrend = 'improving';
      else if (previousAvg - recentAvg > 0.5) formTrend = 'declining';
    }
  }

  const last5Results = formResults.slice(0, 5);

  // Profile-based values
  const avgGS = isHome ? ((profile?.home_avg_scored as number) ?? 1.3) : ((profile?.away_avg_scored as number) ?? 1.1);
  const avgGC = isHome ? ((profile?.home_avg_conceded as number) ?? 1.1) : ((profile?.away_avg_conceded as number) ?? 1.3);
  const leagueAvgGoals = 1.3;
  const attackStrength = Math.max(0.5, Math.min(2.0, avgGS / leagueAvgGoals));
  const defenseStrength = Math.max(0.5, Math.min(2.0, avgGC / leagueAvgGoals));

  return {
    teamId,
    name: teamName,
    attackStrength,
    defenseStrength,
    avgGoalsScored: avgGS,
    avgGoalsConceded: avgGC,
    avgXgScored: (profile?.avg_xg_for as number) ?? 1.2,
    avgXgConceded: (profile?.avg_xg_against as number) ?? 1.0,
    homeAdvantageCoeff: 0.2,
    possessionStyle: ((profile?.possession as number) ?? 50) / 100,
    pressingIntensity: (profile?.press_intensity as string) === 'high' ? 0.8 : (profile?.press_intensity as string) === 'medium' ? 0.5 : 0.2,
    counterAttackPropensity: 0.5,
    defensiveSolidity: 1 - (avgGC / 3),
    xgOverperformance: 1.0,
    style: (profile?.style as string) ?? 'balanced',
    preferredFormation: (profile?.preferred_formation as string) ?? '4-3-3',
    pressIntensity: (profile?.press_intensity as string) ?? 'medium',
    defLine: (profile?.def_line as string) ?? 'medium',
    form: (profile?.form as string) ?? formResults.join(''),
    eloRating: elo.overall,
    eloHomeRating: elo.home,
    eloAwayRating: elo.away,
    formScore,
    formTrend,
    last5Results,
    cleanSheetPct: (profile?.clean_sheet_pct as number) ?? 25,
    bttsPct: (profile?.btts_pct as number) ?? 50,
    over25Pct: (profile?.over_25_pct as number) ?? 50,
  };
}

async function getMatchContext(fixtureId: number): Promise<MatchContextData> {
  const fixtureResult = await client.execute({
    sql: 'SELECT * FROM fixtures WHERE id = ?',
    args: [fixtureId],
  });
  if (fixtureResult.rows.length === 0) return defaultContext();

  const f = fixtureResult.rows[0];
  const homeTeamId = f.home_team_id as number;
  const awayTeamId = f.away_team_id as number;
  const eventDate = f.event_date as string;

  // Rest advantage
  const homeLastMatch = await client.execute({
    sql: `SELECT event_date FROM fixtures WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'finished' AND event_date < ? ORDER BY event_date DESC LIMIT 1`,
    args: [homeTeamId, homeTeamId, eventDate],
  });
  const awayLastMatch = await client.execute({
    sql: `SELECT event_date FROM fixtures WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'finished' AND event_date < ? ORDER BY event_date DESC LIMIT 1`,
    args: [awayTeamId, awayTeamId, eventDate],
  });

  const homeRestDays = homeLastMatch.rows.length > 0
    ? (new Date(eventDate).getTime() - new Date(homeLastMatch.rows[0].event_date as string).getTime()) / (1000 * 60 * 60 * 24)
    : 7;
  const awayRestDays = awayLastMatch.rows.length > 0
    ? (new Date(eventDate).getTime() - new Date(awayLastMatch.rows[0].event_date as string).getTime()) / (1000 * 60 * 60 * 24)
    : 7;

  const restAdvantage = clamp((calculateRestScore(homeRestDays) - calculateRestScore(awayRestDays)) * 2, -1, 1);

  // Motivation from standings
  const homeStanding = await client.execute({
    sql: 'SELECT position, pts FROM standings WHERE team_id = ? AND league_id = ? LIMIT 1',
    args: [homeTeamId, f.league_id as number],
  });
  const awayStanding = await client.execute({
    sql: 'SELECT position, pts FROM standings WHERE team_id = ? AND league_id = ? LIMIT 1',
    args: [awayTeamId, f.league_id as number],
  });
  const homeMot = getMotivationLevel(homeStanding.rows.length > 0 ? (homeStanding.rows[0].position as number) : 10);
  const awayMot = getMotivationLevel(awayStanding.rows.length > 0 ? (awayStanding.rows[0].position as number) : 10);
  const motivationScore = (homeMot + awayMot) / 2;

  // H2H
  const h2hFixtures = await client.execute({
    sql: `SELECT home_team_id, away_team_id, home_score, away_score FROM fixtures
          WHERE ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))
            AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
          ORDER BY event_date DESC LIMIT 10`,
    args: [homeTeamId, awayTeamId, awayTeamId, homeTeamId],
  });

  let h2hHomeWins = 0, h2hDraws = 0, h2hAwayWins = 0, totalGoals = 0;
  for (const h2h of h2hFixtures.rows) {
    const isTeamHome = (h2h.home_team_id as number) === homeTeamId;
    const teamGoals = isTeamHome ? (h2h.home_score as number) : (h2h.away_score as number);
    const oppGoals = isTeamHome ? (h2h.away_score as number) : (h2h.home_score as number);
    totalGoals += teamGoals + oppGoals;
    if (teamGoals > oppGoals) h2hHomeWins++;
    else if (teamGoals === oppGoals) h2hDraws++;
    else h2hAwayWins++;
  }

  // Weather impact
  let weatherImpact = 0;
  const windSpeed = f.wind_speed as number | null;
  const temperature = f.temperature as number | null;
  const weatherCode = f.weather_code as number | null;
  if (windSpeed && windSpeed > 50) weatherImpact += 0.3;
  else if (windSpeed && windSpeed > 30) weatherImpact += 0.15;
  if (temperature && (temperature > 35 || temperature < -5)) weatherImpact += 0.25;
  if (weatherCode && weatherCode >= 95) weatherImpact += 0.3;
  else if (weatherCode && weatherCode >= 71) weatherImpact += 0.25;
  else if (weatherCode && weatherCode >= 61) weatherImpact += 0.15;
  weatherImpact = clamp(weatherImpact, 0, 1);

  return {
    restAdvantage,
    motivationScore,
    isDerby: (f.is_local_derby as number) === 1,
    isCupMatch: false,
    isFriendly: false,
    travelDistanceKm: (f.travel_distance_km as number) ?? 0,
    weatherImpact,
    homeRotationRisk: 0,
    awayRotationRisk: 0,
    h2hHomeWins,
    h2hDraws,
    h2hAwayWins,
    h2hGoalAvg: h2hFixtures.rows.length > 0 ? totalGoals / h2hFixtures.rows.length : 2.5,
  };
}

function calculateRestScore(days: number): number {
  if (days <= 2) return 0.2;
  if (days <= 3) return 0.5;
  if (days <= 7) return 1.0;
  if (days <= 10) return 0.8;
  return 0.5;
}

function getMotivationLevel(position: number): number {
  if (position <= 1) return 0.95;
  if (position <= 4) return 0.9;
  if (position <= 6) return 0.75;
  if (position >= 17) return 0.9;
  if (position >= 14) return 0.65;
  return 0.4;
}

function defaultContext(): MatchContextData {
  return {
    restAdvantage: 0, motivationScore: 0.5, isDerby: false,
    isCupMatch: false, isFriendly: false, travelDistanceKm: 0,
    weatherImpact: 0, homeRotationRisk: 0, awayRotationRisk: 0,
    h2hHomeWins: 0, h2hDraws: 0, h2hAwayWins: 0, h2hGoalAvg: 2.5,
  };
}

// ============================================================================
// PREDICTION MODELS
// ============================================================================

function poissonXgModel(home: TeamData, away: TeamData, context: MatchContextData) {
  let lambdaHome = home.avgXgScored * home.attackStrength / away.defenseStrength;
  let lambdaAway = away.avgXgScored * away.attackStrength / home.defenseStrength;

  // Home advantage (TEAM-SPECIFIC)
  lambdaHome *= (1 + home.homeAdvantageCoeff);
  lambdaAway *= (1 - home.homeAdvantageCoeff * 0.3);

  // xG overperformance adjustment
  lambdaHome *= Math.sqrt(home.xgOverperformance || 1);
  lambdaAway *= Math.sqrt(away.xgOverperformance || 1);

  // Form adjustment
  lambdaHome *= (0.9 + home.formScore * 0.2);
  lambdaAway *= (0.9 + away.formScore * 0.2);

  // Rest advantage
  if (context.restAdvantage > 0) lambdaHome *= (1 + context.restAdvantage * 0.05);
  if (context.restAdvantage < 0) lambdaAway *= (1 + Math.abs(context.restAdvantage) * 0.05);

  // Clamp
  lambdaHome = Math.max(0.3, Math.min(4.5, lambdaHome));
  lambdaAway = Math.max(0.3, Math.min(4.5, lambdaAway));

  // Monte Carlo with Dixon-Coles
  const rho = -0.13;
  let homeWins = 0, draws = 0, awayWins = 0;
  let over15 = 0, over25 = 0, over35 = 0, bttsYes = 0;
  const scoreMap = new Map<string, number>();
  const SIMULATIONS = 10000;

  for (let i = 0; i < SIMULATIONS; i++) {
    let hGoals = poissonRandom(lambdaHome);
    let aGoals = poissonRandom(lambdaAway);

    const dcAdj = dixonColesRho(hGoals, aGoals, lambdaHome, lambdaAway, rho);
    if (Math.random() > dcAdj) {
      if (hGoals === 0 && aGoals === 0 && Math.random() < 0.5) hGoals = 1;
      else if (hGoals === 1 && aGoals === 0 && Math.random() < 0.5) aGoals = 1;
    }

    const totalGoals = hGoals + aGoals;
    if (hGoals > aGoals) homeWins++;
    else if (hGoals === aGoals) draws++;
    else awayWins++;
    if (totalGoals > 1.5) over15++;
    if (totalGoals > 2.5) over25++;
    if (totalGoals > 3.5) over35++;
    if (hGoals > 0 && aGoals > 0) bttsYes++;

    const scoreKey = `${hGoals}-${aGoals}`;
    scoreMap.set(scoreKey, (scoreMap.get(scoreKey) ?? 0) + 1);
  }

  let mostLikely = '1-1';
  let maxCount = 0;
  for (const [score, count] of scoreMap) {
    if (count > maxCount) { maxCount = count; mostLikely = score; }
  }

  return {
    probHome: homeWins / SIMULATIONS,
    probDraw: draws / SIMULATIONS,
    probAway: awayWins / SIMULATIONS,
    lambdaHome, lambdaAway,
    probOver15: over15 / SIMULATIONS,
    probOver25: over25 / SIMULATIONS,
    probOver35: over35 / SIMULATIONS,
    probBttsYes: bttsYes / SIMULATIONS,
    mostLikelyScore: mostLikely,
  };
}

function eloModel(home: TeamData, away: TeamData) {
  const homeElo = home.eloHomeRating;
  const awayElo = away.eloAwayRating;
  const homeBonus = home.homeAdvantageCoeff * 65;
  const expectedHome = eloExpected(homeElo + homeBonus, awayElo);
  const closeness = 1 - Math.abs(expectedHome - (1 - expectedHome));
  const drawProb = 0.15 + 0.15 * closeness;
  const probHome = expectedHome * (1 - drawProb);
  const probAway = (1 - expectedHome) * (1 - drawProb);
  return { probHome, probDraw: drawProb, probAway };
}

function formModel(home: TeamData, away: TeamData) {
  const formDiff = home.formScore - away.formScore;
  let probHome = 0.4 + formDiff * 0.3;
  let probDraw = 0.3 - Math.abs(formDiff) * 0.15;
  let probAway = 0.3 - formDiff * 0.3;

  if (home.formTrend === 'improving') probHome += 0.03;
  if (home.formTrend === 'declining') probHome -= 0.03;
  if (away.formTrend === 'improving') probAway += 0.03;
  if (away.formTrend === 'declining') probAway -= 0.03;

  const total = probHome + probDraw + probAway;
  return { probHome: probHome / total, probDraw: probDraw / total, probAway: probAway / total };
}

function styleMatchupModel(home: TeamData, away: TeamData) {
  let homeBoost = 0, awayBoost = 0;

  if (home.possessionStyle > 0.6 && away.counterAttackPropensity > 0.6) awayBoost += 0.05;
  if (away.possessionStyle > 0.6 && home.counterAttackPropensity > 0.6) homeBoost += 0.05;
  if (home.pressingIntensity > 0.6 && away.possessionStyle < 0.4) awayBoost += 0.03;
  if (away.pressingIntensity > 0.6 && home.possessionStyle < 0.4) homeBoost += 0.03;

  let probHome = 0.42 + homeBoost - awayBoost;
  let probDraw = 0.28;
  let probAway = 0.30 + awayBoost - homeBoost;

  const total = probHome + probDraw + probAway;
  return { probHome: probHome / total, probDraw: probDraw / total, probAway: probAway / total };
}

function contextModel(home: TeamData, away: TeamData, context: MatchContextData) {
  let probHome = 0.42, probDraw = 0.28, probAway = 0.30;

  if (context.isDerby) { probDraw += 0.08; probHome -= 0.04; probAway -= 0.04; }
  if (context.isFriendly) { probDraw += 0.1; probHome -= 0.05; probAway -= 0.05; }
  if (context.motivationScore > 0.8) {
    if (home.formScore > away.formScore) probHome += 0.03;
    else probAway += 0.03;
  }
  if (context.restAdvantage > 0.3) probHome += 0.02;
  if (context.restAdvantage < -0.3) probAway += 0.02;
  if (context.travelDistanceKm > 500) probAway -= 0.02;
  if (context.weatherImpact > 0.5) probAway -= 0.02;
  if (context.homeRotationRisk > 0.5) probHome -= 0.03;
  if (context.awayRotationRisk > 0.5) probAway -= 0.03;

  const h2hTotal = context.h2hHomeWins + context.h2hDraws + context.h2hAwayWins;
  if (h2hTotal >= 3) {
    probHome += (context.h2hHomeWins / h2hTotal - 0.4) * 0.1;
    probDraw += (context.h2hDraws / h2hTotal - 0.28) * 0.1;
  }

  const total = probHome + probDraw + probAway;
  return { probHome: probHome / total, probDraw: probDraw / total, probAway: probAway / total };
}

// ============================================================================
// VALUE DETECTION & KELLY STAKING
// ============================================================================

interface ValueCheck {
  pickType: string;
  pickLabel: string;
  ourProb: number;
  marketOdds: number | null;
  edge: number;
  kellyStake: number;
}

function detectValue(
  homeWinProb: number, drawProb: number, awayWinProb: number,
  over25Prob: number, bttsYesProb: number,
  odds: Record<string, number | null>,
): ValueCheck[] {
  const checks: ValueCheck[] = [
    { pickType: 'home_win', pickLabel: 'Home Win', ourProb: homeWinProb, marketOdds: odds.homeWin ?? null, edge: 0, kellyStake: 0 },
    { pickType: 'draw', pickLabel: 'Draw', ourProb: drawProb, marketOdds: odds.draw ?? null, edge: 0, kellyStake: 0 },
    { pickType: 'away_win', pickLabel: 'Away Win', ourProb: awayWinProb, marketOdds: odds.awayWin ?? null, edge: 0, kellyStake: 0 },
    { pickType: 'over_25', pickLabel: 'Over 2.5 Goals', ourProb: over25Prob, marketOdds: odds.over25 ?? null, edge: 0, kellyStake: 0 },
    { pickType: 'under_25', pickLabel: 'Under 2.5 Goals', ourProb: 1 - over25Prob, marketOdds: odds.under25 ?? null, edge: 0, kellyStake: 0 },
    { pickType: 'btts_yes', pickLabel: 'BTTS Yes', ourProb: bttsYesProb, marketOdds: odds.bttsYes ?? null, edge: 0, kellyStake: 0 },
    { pickType: 'btts_no', pickLabel: 'BTTS No', ourProb: 1 - bttsYesProb, marketOdds: odds.bttsNo ?? null, edge: 0, kellyStake: 0 },
  ];

  for (const check of checks) {
    if (check.marketOdds && check.marketOdds > 1) {
      const impliedProb = 1 / check.marketOdds;
      check.edge = (check.ourProb - impliedProb) * 100;
      // Fractional Kelly (25% of full Kelly)
      const fullKelly = (check.ourProb * check.marketOdds - 1) / (check.marketOdds - 1);
      check.kellyStake = Math.max(0, fullKelly * 0.25);
    }
  }

  return checks.sort((a, b) => b.edge - a.edge);
}

// ============================================================================
// MAIN PREDICTION FUNCTION
// ============================================================================

export async function predictMatch(fixtureId: number): Promise<MatchPrediction> {
  console.log(`[Engine] Predicting match ${fixtureId}...`);

  const fixtureResult = await client.execute({
    sql: 'SELECT * FROM fixtures WHERE id = ?',
    args: [fixtureId],
  });
  if (fixtureResult.rows.length === 0) throw new Error(`Fixture ${fixtureId} not found`);

  const fixture = fixtureResult.rows[0];
  const homeTeamId = fixture.home_team_id as number;
  const awayTeamId = fixture.away_team_id as number;

  // Step 1: Gather team data
  const homeData = await getTeamData(homeTeamId, true);
  const awayData = await getTeamData(awayTeamId, false);

  // Step 2: Get match context
  const context = await getMatchContext(fixtureId);

  // Step 3: Run all models
  const poisson = poissonXgModel(homeData, awayData, context);
  const elo = eloModel(homeData, awayData);
  const form = formModel(homeData, awayData);
  const style = styleMatchupModel(homeData, awayData);
  const ctx = contextModel(homeData, awayData, context);

  // Step 4: Get ensemble weights
  const weightsResult = await client.execute('SELECT * FROM model_weights WHERE is_active = 1 LIMIT 1');
  const w = weightsResult.rows.length > 0 ? weightsResult.rows[0] : null;
  const weights = {
    poisson: (w?.poisson_weight as number) ?? 0.35,
    elo: (w?.elo_weight as number) ?? 0.25,
    form: (w?.form_weight as number) ?? 0.20,
    style: (w?.style_matchup_weight as number) ?? 0.10,
    context: (w?.context_weight as number) ?? 0.10,
  };

  // Step 5: Ensemble
  const rawHomeWin = poisson.probHome * weights.poisson + elo.probHome * weights.elo + form.probHome * weights.form + style.probHome * weights.style + ctx.probHome * weights.context;
  const rawDraw = poisson.probDraw * weights.poisson + elo.probDraw * weights.elo + form.probDraw * weights.form + style.probDraw * weights.style + ctx.probDraw * weights.context;
  const rawAwayWin = poisson.probAway * weights.poisson + elo.probAway * weights.elo + form.probAway * weights.form + style.probAway * weights.style + ctx.probAway * weights.context;

  const totalProb = rawHomeWin + rawDraw + rawAwayWin;
  const homeWinProb = Math.round((rawHomeWin / totalProb) * 1000) / 1000;
  const drawProb = Math.round((rawDraw / totalProb) * 1000) / 1000;
  const awayWinProb = Math.round((rawAwayWin / totalProb) * 1000) / 1000;

  const over25Prob = poisson.probOver25;
  const bttsYesProb = poisson.probBttsYes;

  // Step 6: Get odds for value detection
  const oddsResult = await client.execute({
    sql: 'SELECT * FROM fixture_odds WHERE fixture_id = ?',
    args: [fixtureId],
  });
  const oddsRow = oddsResult.rows.length > 0 ? oddsResult.rows[0] : null;
  const odds: Record<string, number | null> = {
    homeWin: (oddsRow?.home_win as number) ?? null,
    draw: (oddsRow?.draw as number) ?? null,
    awayWin: (oddsRow?.away_win as number) ?? null,
    over25: (oddsRow?.over_25_goals as number) ?? null,
    under25: (oddsRow?.under_25_goals as number) ?? null,
    over15: (oddsRow?.over_15_goals as number) ?? null,
    over35: (oddsRow?.over_35_goals as number) ?? null,
    bttsYes: (oddsRow?.btts_yes as number) ?? null,
    bttsNo: (oddsRow?.btts_no as number) ?? null,
  };

  // Step 7: Value detection
  const valueChecks = detectValue(homeWinProb, drawProb, awayWinProb, over25Prob, bttsYesProb, odds);

  // Step 8: Determine best pick
  const bestValue = valueChecks[0];
  const maxProb = Math.max(homeWinProb, drawProb, awayWinProb, over25Prob, bttsYesProb, 1 - over25Prob, 1 - bttsYesProb);

  // Pick the highest confidence pick (either result or goals market)
  let pickType: string;
  let pickLabel: string;
  let confidence: number;

  if (maxProb === homeWinProb) { pickType = 'home_win'; pickLabel = `${homeData.name} Win`; confidence = homeWinProb * 100; }
  else if (maxProb === awayWinProb) { pickType = 'away_win'; pickLabel = `${awayData.name} Win`; confidence = awayWinProb * 100; }
  else if (maxProb === over25Prob) { pickType = 'over_25'; pickLabel = 'Over 2.5 Goals'; confidence = over25Prob * 100; }
  else if (maxProb === (1 - over25Prob)) { pickType = 'under_25'; pickLabel = 'Under 2.5 Goals'; confidence = (1 - over25Prob) * 100; }
  else if (maxProb === bttsYesProb) { pickType = 'btts_yes'; pickLabel = 'BTTS Yes'; confidence = bttsYesProb * 100; }
  else if (maxProb === (1 - bttsYesProb)) { pickType = 'btts_no'; pickLabel = 'BTTS No'; confidence = (1 - bttsYesProb) * 100; }
  else { pickType = 'draw'; pickLabel = 'Draw'; confidence = drawProb * 100; }

  // If there's a better value pick (higher edge), prefer that
  if (bestValue.edge > 5 && bestValue.ourProb > 0.45) {
    pickType = bestValue.pickType;
    pickLabel = bestValue.pickLabel;
    confidence = bestValue.ourProb * 100;
  }

  // Model agreement for phantom score
  const modelAgreement = 1 - Math.sqrt(
    Math.pow(poisson.probHome - homeWinProb, 2) +
    Math.pow(elo.probHome - homeWinProb, 2) +
    Math.pow(form.probHome - homeWinProb, 2) +
    Math.pow(style.probHome - homeWinProb, 2) +
    Math.pow(ctx.probHome - homeWinProb, 2),
  ) * 2;

  const phantomScore = clamp(confidence * (0.5 + modelAgreement * 0.5), 0, 100);
  const tier = classifyTier(confidence, bestValue.edge);
  const verdict = classifyVerdict(confidence);

  // Build key reasons
  const keyReasons: string[] = [];
  if (homeWinProb > awayWinProb + 0.15) keyReasons.push(`${homeData.name} strong at home (${(homeWinProb * 100).toFixed(0)}%)`);
  if (awayWinProb > homeWinProb + 0.15) keyReasons.push(`${awayData.name} strong away (${(awayWinProb * 100).toFixed(0)}%)`);
  if (over25Prob > 0.6) keyReasons.push(`High goal expectation (${(over25Prob * 100).toFixed(0)}% Over 2.5)`);
  if (over25Prob < 0.4) keyReasons.push(`Low goal expectation (${((1 - over25Prob) * 100).toFixed(0)}% Under 2.5)`);
  if (bttsYesProb > 0.6) keyReasons.push(`Both teams likely to score (${(bttsYesProb * 100).toFixed(0)}%)`);
  if (homeData.formTrend === 'improving') keyReasons.push(`${homeData.name} form improving`);
  if (awayData.formTrend === 'declining') keyReasons.push(`${awayData.name} form declining`);
  if (context.isDerby) keyReasons.push('Local derby — increased intensity');
  if (Math.abs(context.restAdvantage) > 0.5) keyReasons.push(context.restAdvantage > 0 ? 'Home team better rested' : 'Away team better rested');
  if (bestValue.edge > 10) keyReasons.push(`Value detected: +${bestValue.edge.toFixed(1)}% edge vs market`);
  if (homeData.cleanSheetPct > 40) keyReasons.push(`${homeData.name} ${homeData.cleanSheetPct.toFixed(0)}% clean sheet rate`);
  if (awayData.bttsPct > 60) keyReasons.push(`${awayData.name} concedes in ${awayData.bttsPct.toFixed(0)}% of matches`);

  if (keyReasons.length === 0) keyReasons.push('Evenly matched contest');

  // Tactical matchup
  const tacticalMatchup = {
    homeStyle: homeData.style,
    awayStyle: awayData.style,
    homeFormation: homeData.preferredFormation,
    awayFormation: awayData.preferredFormation,
    homePress: homeData.pressIntensity,
    awayPress: awayData.pressIntensity,
    homeDefLine: homeData.defLine,
    awayDefLine: awayData.defLine,
  };

  // Decision stack
  const decisionStack = {
    modelWeights: weights,
    modelAgreement: Math.round(modelAgreement * 100) / 100,
    contextFactors: {
      restAdvantage: context.restAdvantage,
      motivationScore: context.motivationScore,
      isDerby: context.isDerby,
      weatherImpact: context.weatherImpact,
      h2h: { homeWins: context.h2hHomeWins, draws: context.h2hDraws, awayWins: context.h2hAwayWins },
    },
    valueAnalysis: { bestEdge: bestValue.edge, bestPick: bestValue.pickType, kellyStake: bestValue.kellyStake },
  };

  // Other good picks
  const otherGoodPicks = valueChecks
    .filter(v => v.pickType !== pickType && (v.edge > 3 || v.ourProb > 0.55))
    .slice(0, 3)
    .map(v => ({
      pickType: v.pickType,
      pickLabel: v.pickLabel,
      confidence: Math.round(v.ourProb * 100 * 10) / 10,
      tier: classifyTier(v.ourProb * 100, v.edge),
    }));

  const prediction: MatchPrediction = {
    fixtureId,
    homeTeam: homeData.name,
    awayTeam: awayData.name,
    pickType,
    pickLabel,
    confidence: Math.round(confidence * 10) / 10,
    tier,
    phantomScore: Math.round(phantomScore * 10) / 10,
    edge: Math.round(bestValue.edge * 10) / 10,
    homeWinProb,
    drawProb,
    awayWinProb,
    over25Prob: Math.round(over25Prob * 1000) / 1000,
    under25Prob: Math.round((1 - over25Prob) * 1000) / 1000,
    bttsYesProb: Math.round(bttsYesProb * 1000) / 1000,
    bttsNoProb: Math.round((1 - bttsYesProb) * 1000) / 1000,
    homeXg: Math.round(poisson.lambdaHome * 100) / 100,
    awayXg: Math.round(poisson.lambdaAway * 100) / 100,
    verdict,
    decisionStack,
    keyReasons,
    tacticalMatchup,
    odds,
    otherGoodPicks,
    probOver15: poisson.probOver15,
    probOver35: poisson.probOver35,
    mostLikelyScore: poisson.mostLikelyScore,
    modelBreakdown: {
      poissonXg: { probHome: Math.round(poisson.probHome * 1000) / 1000, probDraw: Math.round(poisson.probDraw * 1000) / 1000, probAway: Math.round(poisson.probAway * 1000) / 1000, lambdaHome: Math.round(poisson.lambdaHome * 100) / 100, lambdaAway: Math.round(poisson.lambdaAway * 100) / 100 },
      elo: { probHome: Math.round(elo.probHome * 1000) / 1000, probDraw: Math.round(elo.probDraw * 1000) / 1000, probAway: Math.round(elo.probAway * 1000) / 1000 },
      form: { probHome: Math.round(form.probHome * 1000) / 1000, probDraw: Math.round(form.probDraw * 1000) / 1000, probAway: Math.round(form.probAway * 1000) / 1000 },
      styleMatchup: { probHome: Math.round(style.probHome * 1000) / 1000, probDraw: Math.round(style.probDraw * 1000) / 1000, probAway: Math.round(style.probAway * 1000) / 1000 },
      context: { probHome: Math.round(ctx.probHome * 1000) / 1000, probDraw: Math.round(ctx.probDraw * 1000) / 1000, probAway: Math.round(ctx.probAway * 1000) / 1000 },
    },
  };

  // Step 9: Store prediction in database
  await storePrediction(prediction);

  console.log(`[Engine] Prediction for ${homeData.name} vs ${awayData.name}: ${pickLabel} (${confidence.toFixed(1)}% conf, ${tier})`);
  return prediction;
}

// ============================================================================
// STORE PREDICTION
// ============================================================================

async function storePrediction(pred: MatchPrediction): Promise<void> {
  // Check if prediction exists for this fixture
  const existing = await client.execute({
    sql: 'SELECT id FROM predictions WHERE fixture_id = ?',
    args: [pred.fixtureId],
  });

  const oddsJson = JSON.stringify(pred.odds);
  const decisionStackJson = JSON.stringify(pred.decisionStack);
  const keyReasonsJson = JSON.stringify(pred.keyReasons);
  const tacticalMatchupJson = JSON.stringify(pred.tacticalMatchup);

  if (existing.rows.length > 0) {
    await client.execute({
      sql: `UPDATE predictions SET
        pick_type = ?, pick_label = ?, confidence = ?, tier = ?, phantom_score = ?, edge = ?,
        home_win_prob = ?, draw_prob = ?, away_win_prob = ?,
        over_25_prob = ?, under_25_prob = ?, btts_yes_prob = ?, btts_no_prob = ?,
        home_xg = ?, away_xg = ?, verdict = ?, decision_stack = ?, key_reasons = ?,
        tactical_matchup = ?, odds_json = ?, result = 'pending'
        WHERE fixture_id = ?`,
      args: [
        pred.pickType, pred.pickLabel, pred.confidence, pred.tier, pred.phantomScore, pred.edge,
        pred.homeWinProb, pred.drawProb, pred.awayWinProb,
        pred.over25Prob, pred.under25Prob, pred.bttsYesProb, pred.bttsNoProb,
        pred.homeXg, pred.awayXg, pred.verdict, decisionStackJson, keyReasonsJson,
        tacticalMatchupJson, oddsJson, pred.fixtureId,
      ],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO predictions (
        fixture_id, pick_type, pick_label, confidence, tier, phantom_score, edge,
        home_win_prob, draw_prob, away_win_prob,
        over_25_prob, under_25_prob, btts_yes_prob, btts_no_prob,
        home_xg, away_xg, verdict, decision_stack, key_reasons, tactical_matchup, odds_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        pred.fixtureId, pred.pickType, pred.pickLabel, pred.confidence, pred.tier, pred.phantomScore, pred.edge,
        pred.homeWinProb, pred.drawProb, pred.awayWinProb,
        pred.over25Prob, pred.under25Prob, pred.bttsYesProb, pred.bttsNoProb,
        pred.homeXg, pred.awayXg, pred.verdict, decisionStackJson, keyReasonsJson,
        tacticalMatchupJson, oddsJson,
      ],
    });
  }
}

// ============================================================================
// BATCH PREDICTION
// ============================================================================

export async function predictUpcomingMatches(): Promise<MatchPrediction[]> {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const fixtures = await client.execute({
    sql: `SELECT id FROM fixtures WHERE status = 'notstarted' AND event_date >= ? AND event_date < ? LIMIT 50`,
    args: [today, tomorrow],
  });

  const predictions: MatchPrediction[] = [];
  for (const f of fixtures.rows) {
    try {
      const pred = await predictMatch(f.id as number);
      predictions.push(pred);
    } catch (err) {
      console.error(`[Engine] Failed to predict fixture ${f.id}:`, err);
    }
  }

  predictions.sort((a, b) => b.confidence - a.confidence);
  return predictions;
}

/** Get top picks — highest confidence predictions for today */
export async function getTopPicks(maxPicks: number = 10): Promise<MatchPrediction[]> {
  const predictions = await predictUpcomingMatches();
  const picks = predictions.filter(p => p.confidence >= 55);
  return picks.slice(0, maxPicks);
}

/** Settle predictions for finished matches */
export async function settlePredictions(): Promise<number> {
  const pending = await client.execute({
    sql: `SELECT p.id, p.pick_type, p.confidence, p.home_win_prob, p.draw_prob, p.away_win_prob,
                 p.over_25_prob, p.btts_yes_prob, f.home_score, f.away_score
          FROM predictions p JOIN fixtures f ON p.fixture_id = f.id
          WHERE p.result = 'pending' AND f.status = 'finished' AND f.home_score IS NOT NULL`,
    args: [],
  });

  let settled = 0;
  for (const row of pending.rows) {
    const homeScore = row.home_score as number;
    const awayScore = row.away_score as number;
    const pickType = row.pick_type as string;
    const totalGoals = homeScore + awayScore;
    const homeWon = homeScore > awayScore;
    const draw = homeScore === awayScore;

    let won = false;
    switch (pickType) {
      case 'home_win': won = homeWon; break;
      case 'away_win': won = awayScore > homeScore; break;
      case 'draw': won = draw; break;
      case 'over_25': won = totalGoals > 2.5; break;
      case 'under_25': won = totalGoals < 2.5; break;
      case 'btts_yes': won = homeScore > 0 && awayScore > 0; break;
      case 'btts_no': won = !(homeScore > 0 && awayScore > 0); break;
    }

    await client.execute({
      sql: `UPDATE predictions SET result = ?, settled_at = datetime('now') WHERE id = ?`,
      args: [won ? 'won' : 'lost', row.id as number],
    });
    settled++;
  }

  console.log(`[Engine] Settled ${settled} predictions`);
  return settled;
}
