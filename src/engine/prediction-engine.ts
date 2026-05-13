// xG-Vantage Prediction Engine
// Completely independent — never uses BSD's predictions
// Models: Poisson-xG + Dixon-Coles + ELO + Form + Style Matchup + Context

import { db } from '@/lib/db';

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
    // Use normal approximation for large lambda
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * boxMullerRandom()));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
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

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TeamData {
  teamId: number;
  name: string;
  // DNA
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
  // ELO
  eloRating: number;
  eloHomeRating: number;
  eloAwayRating: number;
  // Form
  formScore: number;
  formTrend: 'improving' | 'stable' | 'declining';
  last5Results: string[];
}

interface MatchContextData {
  restAdvantage: number;       // -1 to 1
  motivationScore: number;     // 0-1
  isDerby: boolean;
  isCupMatch: boolean;
  isFriendly: boolean;
  travelDistanceKm: number;
  weatherImpact: number;       // 0-1
  homeRotationRisk: number;
  awayRotationRisk: number;
  h2hHomeWins: number;
  h2hDraws: number;
  h2hAwayWins: number;
}

export interface PredictionResult {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;

  // Match result probabilities
  probHomeWin: number;
  probDraw: number;
  probAwayWin: number;
  predictedResult: 'H' | 'D' | 'A';

  // Expected goals
  expectedHomeGoals: number;
  expectedAwayGoals: number;

  // Over/Under
  probOver15: number;
  probOver25: number;
  probOver35: number;

  // BTTS
  probBttsYes: number;

  // Most likely score
  mostLikelyScore: string;

  // Confidence
  confidence: number;

  // Context
  homeAdvantageAdj: number;
  formAdvantage: number;
  restAdvantage: number;
  motivationScore: number;
  derbyFactor: number;
  rotationRisk: number;

  // Value
  valueDetected: boolean;
  valueEdge: number;
  kellyStake: number;
  recommendedBet: string;

  // Model breakdown
  models: {
    poissonXg: { probHome: number; probDraw: number; probAway: number; lambdaHome: number; lambdaAway: number };
    elo: { probHome: number; probDraw: number; probAway: number };
    form: { probHome: number; probDraw: number; probAway: number };
    styleMatchup: { probHome: number; probDraw: number; probAway: number };
    context: { probHome: number; probDraw: number; probAway: number };
  };
}

// ============================================================================
// DATA GATHERING
// ============================================================================

async function getTeamData(teamId: number, isHome: boolean): Promise<TeamData> {
  const team = await db.team.findUnique({ where: { id: teamId } });
  const dna = await db.teamDNA.findUnique({ where: { teamId } });
  const elo = await db.teamELO.findFirst({ where: { teamId }, orderBy: { updatedAt: 'desc' } });
  const recentForm = await db.teamForm.findMany({
    where: { teamId },
    orderBy: { eventDate: 'desc' },
    take: 10,
  });

  const prefix = isHome ? 'home' : 'away';

  return {
    teamId,
    name: team?.name ?? `Team ${teamId}`,
    attackStrength: dna ? (isHome ? dna.homeAttackStrength : dna.awayAttackStrength) : 1.0,
    defenseStrength: dna ? (isHome ? dna.homeDefenseStrength : dna.awayDefenseStrength) : 1.0,
    avgGoalsScored: dna ? (isHome ? dna.homeAvgGoalsScored : dna.awayAvgGoalsScored) : 1.3,
    avgGoalsConceded: dna ? (isHome ? dna.homeAvgGoalsConceded : dna.awayAvgGoalsConceded) : 1.1,
    avgXgScored: dna ? (isHome ? dna.homeAvgXgScored : dna.awayAvgXgScored) : 1.2,
    avgXgConceded: dna ? (isHome ? dna.homeAvgXgConceded : dna.awayAvgXgConceded) : 1.0,
    homeAdvantageCoeff: dna?.homeAdvantageCoefficient ?? 0.2,
    possessionStyle: dna?.possessionStyle ?? 0.5,
    pressingIntensity: dna?.pressingIntensity ?? 0.5,
    counterAttackPropensity: dna?.counterAttackPropensity ?? 0.5,
    defensiveSolidity: dna?.defensiveSolidity ?? 0.5,
    xgOverperformance: dna?.xgOverperformance ?? 1.0,
    eloRating: elo?.eloRating ?? 1500,
    eloHomeRating: elo?.eloHomeRating ?? 1500,
    eloAwayRating: elo?.eloAwayRating ?? 1500,
    formScore: computeFormScore(recentForm),
    formTrend: computeFormTrend(recentForm),
    last5Results: recentForm.slice(0, 5).map(f => f.result),
  };
}

function computeFormScore(form: Array<{ result: string; opponentElo: number; eventDate: Date }>): number {
  if (form.length === 0) return 0.5;
  let score = 0;
  let totalWeight = 0;
  const now = Date.now();
  for (let i = 0; i < form.length; i++) {
    const recency = Math.pow(0.85, i); // Exponential decay
    const opponentQuality = Math.min(1, (form[i].opponentElo || 1500) / 2000); // Normalize
    const weight = recency * (0.5 + 0.5 * opponentQuality);
    const resultScore = form[i].result === 'W' ? 1 : form[i].result === 'D' ? 0.4 : 0;
    score += resultScore * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? score / totalWeight : 0.5;
}

function computeFormTrend(form: Array<{ result: string }>): 'improving' | 'stable' | 'declining' {
  if (form.length < 3) return 'stable';
  const recent = form.slice(0, 3);
  const older = form.slice(3, 6);
  const recentScore = recent.reduce((s, f) => s + (f.result === 'W' ? 1 : f.result === 'D' ? 0.4 : 0), 0) / recent.length;
  const olderScore = older.length > 0
    ? older.reduce((s, f) => s + (f.result === 'W' ? 1 : f.result === 'D' ? 0.4 : 0), 0) / older.length
    : recentScore;
  const diff = recentScore - olderScore;
  if (diff > 0.15) return 'improving';
  if (diff < -0.15) return 'declining';
  return 'stable';
}

async function getMatchContext(fixtureId: number): Promise<MatchContextData> {
  const fixture = await db.fixture.findUnique({ where: { id: fixtureId } });
  if (!fixture) {
    return defaultContext();
  }

  // Rest advantage: days since last match
  const homeLastMatch = await db.teamForm.findFirst({
    where: { teamId: fixture.homeTeamId, eventDate: { lt: fixture.eventDate } },
    orderBy: { eventDate: 'desc' },
  });
  const awayLastMatch = await db.teamForm.findFirst({
    where: { teamId: fixture.awayTeamId, eventDate: { lt: fixture.eventDate } },
    orderBy: { eventDate: 'desc' },
  });

  const homeRestDays = homeLastMatch
    ? (new Date(fixture.eventDate).getTime() - new Date(homeLastMatch.eventDate).getTime()) / (1000 * 60 * 60 * 24)
    : 7;
  const awayRestDays = awayLastMatch
    ? (new Date(fixture.eventDate).getTime() - new Date(awayLastMatch.eventDate).getTime()) / (1000 * 60 * 60 * 24)
    : 7;

  const restAdvantage = Math.max(-1, Math.min(1, (homeRestDays - awayRestDays) / 5));

  // Motivation from table position
  const homeStanding = await db.standing.findFirst({
    where: { teamId: fixture.homeTeamId, leagueId: fixture.leagueId },
  });
  const awayStanding = await db.standing.findFirst({
    where: { teamId: fixture.awayTeamId, leagueId: fixture.leagueId },
  });

  const homeMotivation = getMotivationLevel(homeStanding);
  const awayMotivation = getMotivationLevel(awayStanding);
  const motivationScore = (homeMotivation + awayMotivation) / 2;

  // H2H
  const h2h = await db.teamForm.findMany({
    where: {
      teamId: fixture.homeTeamId,
      opponentId: fixture.awayTeamId,
    },
    take: 10,
  });
  const h2hHomeWins = h2h.filter(f => f.result === 'W').length;
  const h2hDraws = h2h.filter(f => f.result === 'D').length;
  const h2hAwayWins = h2h.filter(f => f.result === 'L').length;

  return {
    restAdvantage,
    motivationScore,
    isDerby: fixture.isLocalDerby,
    isCupMatch: false, // Would need league metadata
    isFriendly: false,
    travelDistanceKm: fixture.travelDistanceKm ?? 0,
    weatherImpact: getWeatherImpact(fixture.weatherCode),
    homeRotationRisk: 0, // Computed from lineup comparison
    awayRotationRisk: 0,
    h2hHomeWins,
    h2hDraws,
    h2hAwayWins,
  };
}

function getMotivationLevel(standing: { position: number; pts: number; played: number } | null): number {
  if (!standing) return 0.5;
  const pos = standing.position;
  if (pos <= 1) return 0.95; // Title chase
  if (pos <= 4) return 0.9;  // Champions league
  if (pos <= 6) return 0.75; // Europa league
  if (pos >= 17) return 0.9; // Relegation battle
  if (pos >= 14) return 0.65; // Near danger
  return 0.4; // Mid-table comfort
}

function getWeatherImpact(code: number | null | undefined): number {
  if (code === null || code === undefined) return 0;
  if (code === 5) return 0.8; // Extreme
  if (code === 4) return 0.5; // Snow
  if (code === 3) return 0.3; // Rain
  if (code === 2) return 0.1; // Cloudy
  return 0; // Clear
}

function defaultContext(): MatchContextData {
  return {
    restAdvantage: 0, motivationScore: 0.5, isDerby: false,
    isCupMatch: false, isFriendly: false, travelDistanceKm: 0,
    weatherImpact: 0, homeRotationRisk: 0, awayRotationRisk: 0,
    h2hHomeWins: 0, h2hDraws: 0, h2hAwayWins: 0,
  };
}

// ============================================================================
// PREDICTION MODELS
// ============================================================================

function poissonXgModel(home: TeamData, away: TeamData, context: MatchContextData) {
  // Calculate expected goals (lambda) for each team
  // Base xG from team DNA
  let lambdaHome = home.avgXgScored * home.attackStrength / away.defenseStrength;
  let lambdaAway = away.avgXgScored * away.attackStrength / home.defenseStrength;

  // Home advantage (TEAM-SPECIFIC)
  lambdaHome *= (1 + home.homeAdvantageCoeff);
  lambdaAway *= (1 - home.homeAdvantageCoeff * 0.3);

  // xG overperformance adjustment
  lambdaHome *= Math.sqrt(home.xgOverperformance || 1);
  lambdaAway *= Math.sqrt(away.xgOverperformance || 1);

  // Form adjustment (weighted)
  lambdaHome *= (0.9 + home.formScore * 0.2);
  lambdaAway *= (0.9 + away.formScore * 0.2);

  // Rest advantage
  if (context.restAdvantage > 0) lambdaHome *= (1 + context.restAdvantage * 0.05);
  if (context.restAdvantage < 0) lambdaAway *= (1 + Math.abs(context.restAdvantage) * 0.05);

  // Clamp lambdas
  lambdaHome = Math.max(0.3, Math.min(4.5, lambdaHome));
  lambdaAway = Math.max(0.3, Math.min(4.5, lambdaAway));

  // Monte Carlo simulation with Dixon-Coles correction
  const rho = -0.13;
  let homeWins = 0, draws = 0, awayWins = 0;
  let over15 = 0, over25 = 0, over35 = 0, bttsYes = 0;
  const scoreMap = new Map<string, number>();
  const SIMULATIONS = 10000;

  for (let i = 0; i < SIMULATIONS; i++) {
    let hGoals = poissonRandom(lambdaHome);
    let aGoals = poissonRandom(lambdaAway);

    // Apply Dixon-Coles correction for low scores
    const dcAdj = dixonColesRho(hGoals, aGoals, lambdaHome, lambdaAway, rho);
    if (Math.random() > dcAdj) {
      // Swap towards the adjusted direction
      if (hGoals === 0 && aGoals === 0 && Math.random() < 0.5) { hGoals = 1; }
      else if (hGoals === 1 && aGoals === 0 && Math.random() < 0.5) { aGoals = 1; }
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

  // Find most likely score
  let mostLikely = '1-1';
  let maxCount = 0;
  for (const [score, count] of scoreMap) {
    if (count > maxCount) { maxCount = count; mostLikely = score; }
  }

  return {
    probHome: homeWins / SIMULATIONS,
    probDraw: draws / SIMULATIONS,
    probAway: awayWins / SIMULATIONS,
    lambdaHome,
    lambdaAway,
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
  const homeBonus = home.homeAdvantageCoeff * 65; // ELO points for home advantage

  const expectedHome = eloExpected(homeElo + homeBonus, awayElo);
  const expectedAway = 1 - expectedHome;

  // Distribute draw probability (roughly 25% base, adjusted by closeness)
  const closeness = 1 - Math.abs(expectedHome - expectedAway);
  const drawProb = 0.15 + 0.15 * closeness; // 15-30% draw range

  const probHome = expectedHome * (1 - drawProb);
  const probAway = expectedAway * (1 - drawProb);

  return { probHome, probDraw: drawProb, probAway };
}

function formModel(home: TeamData, away: TeamData) {
  const homeForm = home.formScore;
  const awayForm = away.formScore;

  // Form advantage
  const formDiff = homeForm - awayForm;

  // Base probabilities influenced by form
  let probHome = 0.4 + formDiff * 0.3;
  let probAway = 0.3 - formDiff * 0.3;
  let probDraw = 0.3 - Math.abs(formDiff) * 0.15;

  // Trend adjustment
  if (home.formTrend === 'improving') probHome += 0.03;
  if (home.formTrend === 'declining') probHome -= 0.03;
  if (away.formTrend === 'improving') probAway += 0.03;
  if (away.formTrend === 'declining') probAway -= 0.03;

  // Normalize
  const total = probHome + probDraw + probAway;
  return { probHome: probHome / total, probDraw: probDraw / total, probAway: probAway / total };
}

function styleMatchupModel(home: TeamData, away: TeamData) {
  // Style clash analysis
  let homeBoost = 0;
  let awayBoost = 0;

  // Possession vs Counter-attack
  if (home.possessionStyle > 0.6 && away.counterAttackPropensity > 0.6) {
    // Counter-attack teams tend to do well vs possession
    awayBoost += 0.05;
  }
  if (away.possessionStyle > 0.6 && home.counterAttackPropensity > 0.6) {
    homeBoost += 0.05;
  }

  // High press vs long ball (long ball beats press)
  if (home.pressingIntensity > 0.6 && away.possessionStyle < 0.4) {
    awayBoost += 0.03;
  }
  if (away.pressingIntensity > 0.6 && home.possessionStyle < 0.4) {
    homeBoost += 0.03;
  }

  // Two attacking teams → more goals, less predictable
  // Two defensive teams → low scoring, more draws

  let probHome = 0.42 + homeBoost - awayBoost;
  let probDraw = 0.28;
  let probAway = 0.30 + awayBoost - homeBoost;

  const total = probHome + probDraw + probAway;
  return { probHome: probHome / total, probDraw: probDraw / total, probAway: probAway / total };
}

function contextModel(home: TeamData, away: TeamData, context: MatchContextData) {
  let probHome = 0.42;
  let probDraw = 0.28;
  let probAway = 0.30;

  // Derby → more draws
  if (context.isDerby) {
    probDraw += 0.08;
    probHome -= 0.04;
    probAway -= 0.04;
  }

  // Friendly → unpredictable, more draws
  if (context.isFriendly) {
    probDraw += 0.1;
    probHome -= 0.05;
    probAway -= 0.05;
  }

  // Motivation difference
  const homeMotivation = getMotivationLevel(null); // Would use actual standing
  if (context.motivationScore > 0.8) {
    // High stakes → form matters more
    if (home.formScore > away.formScore) probHome += 0.03;
    else probAway += 0.03;
  }

  // Rest advantage
  if (context.restAdvantage > 0.3) probHome += 0.02;
  if (context.restAdvantage < -0.3) probAway += 0.02;

  // Travel fatigue
  if (context.travelDistanceKm > 500) probAway -= 0.02;

  // Weather impact (affects away team more usually)
  if (context.weatherImpact > 0.5) {
    probAway -= 0.02;
  }

  // Rotation risk
  if (context.homeRotationRisk > 0.5) probHome -= 0.03;
  if (context.awayRotationRisk > 0.5) probAway -= 0.03;

  // H2H influence
  const h2hTotal = context.h2hHomeWins + context.h2hDraws + context.h2hAwayWins;
  if (h2hTotal >= 3) {
    const h2hHomePct = context.h2hHomeWins / h2hTotal;
    const h2hDrawPct = context.h2hDraws / h2hTotal;
    probHome += (h2hHomePct - 0.4) * 0.1;
    probDraw += (h2hDrawPct - 0.28) * 0.1;
  }

  // Normalize
  const total = probHome + probDraw + probAway;
  return { probHome: probHome / total, probDraw: probDraw / total, probAway: probAway / total };
}

// ============================================================================
// MAIN PREDICTION FUNCTION
// ============================================================================

export async function predictMatch(fixtureId: number): Promise<PredictionResult> {
  console.log(`[Engine] Predicting match ${fixtureId}...`);

  const fixture = await db.fixture.findUnique({ where: { id: fixtureId } });
  if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);

  // Step 1: Gather team data
  const homeData = await getTeamData(fixture.homeTeamId, true);
  const awayData = await getTeamData(fixture.awayTeamId, false);

  // Step 2: Get match context
  const context = await getMatchContext(fixtureId);

  // Step 3: Run all models
  const poisson = poissonXgModel(homeData, awayData, context);
  const elo = eloModel(homeData, awayData);
  const form = formModel(homeData, awayData);
  const style = styleMatchupModel(homeData, awayData);
  const ctx = contextModel(homeData, awayData, context);

  // Step 4: Get ensemble weights
  const weights = await db.modelWeights.findFirst({ where: { isActive: true } });
  const w = {
    poisson: weights?.poissonWeight ?? 0.35,
    elo: weights?.eloWeight ?? 0.25,
    form: weights?.formWeight ?? 0.20,
    style: weights?.styleMatchupWeight ?? 0.10,
    context: weights?.contextWeight ?? 0.10,
  };

  // Step 5: Ensemble
  const probHomeWin = poisson.probHome * w.poisson + elo.probHome * w.elo + form.probHome * w.form + style.probHome * w.style + ctx.probHome * w.context;
  const probDraw = poisson.probDraw * w.poisson + elo.probDraw * w.elo + form.probDraw * w.form + style.probDraw * w.style + ctx.probDraw * w.context;
  const probAwayWin = poisson.probAway * w.poisson + elo.probAway * w.elo + form.probAway * w.form + style.probAway * w.style + ctx.probAway * w.context;

  // Normalize
  const totalProb = probHomeWin + probDraw + probAwayWin;
  const finalHome = probHomeWin / totalProb;
  const finalDraw = probDraw / totalProb;
  const finalAway = probAwayWin / totalProb;

  const predictedResult: 'H' | 'D' | 'A' = finalHome > finalDraw && finalHome > finalAway ? 'H' : finalAway > finalDraw ? 'A' : 'D';

  // Step 6: Confidence calculation
  const modelAgreement = 1 - Math.sqrt(
    Math.pow(poisson.probHome - finalHome, 2) +
    Math.pow(elo.probHome - finalHome, 2) +
    Math.pow(form.probHome - finalHome, 2) +
    Math.pow(style.probHome - finalHome, 2) +
    Math.pow(ctx.probHome - finalHome, 2)
  ) * 2;
  const maxProb = Math.max(finalHome, finalDraw, finalAway);
  const confidence = Math.min(1, maxProb * (0.5 + modelAgreement * 0.5));

  // Step 7: Value detection
  const odds = await db.fixtureOdds.findUnique({ where: { fixtureId } });
  let valueDetected = false;
  let valueEdge = 0;
  let kellyStake = 0;
  let recommendedBet = '';

  if (odds) {
    const valueThreshold = weights?.valueEdgeThreshold ?? 0.05;
    const checks = [
      { ourProb: finalHome, marketOdds: odds.homeWin, label: 'Home Win' },
      { ourProb: finalDraw, marketOdds: odds.draw, label: 'Draw' },
      { ourProb: finalAway, marketOdds: odds.awayWin, label: 'Away Win' },
      { ourProb: poisson.probOver25, marketOdds: odds.over25Goals, label: 'Over 2.5' },
      { ourProb: poisson.probBttsYes, marketOdds: odds.bttsYes, label: 'BTTS Yes' },
    ];

    for (const check of checks) {
      if (check.marketOdds && check.marketOdds > 1) {
        const impliedProb = 1 / check.marketOdds;
        const edge = check.ourProb - impliedProb;
        if (edge > valueEdge) {
          valueEdge = edge;
          valueDetected = true;
          recommendedBet = check.label;
          // Kelly Criterion (fractional — 25% of full Kelly)
          const fullKelly = (check.ourProb * check.marketOdds - 1) / (check.marketOdds - 1);
          kellyStake = Math.max(0, fullKelly * 0.25);
        }
      }
    }
  }

  // Step 8: Build result
  const result: PredictionResult = {
    fixtureId,
    homeTeam: homeData.name,
    awayTeam: awayData.name,
    probHomeWin: Math.round(finalHome * 1000) / 1000,
    probDraw: Math.round(finalDraw * 1000) / 1000,
    probAwayWin: Math.round(finalAway * 1000) / 1000,
    predictedResult,
    expectedHomeGoals: Math.round(poisson.lambdaHome * 100) / 100,
    expectedAwayGoals: Math.round(poisson.lambdaAway * 100) / 100,
    probOver15: Math.round(poisson.probOver15 * 1000) / 1000,
    probOver25: Math.round(poisson.probOver25 * 1000) / 1000,
    probOver35: Math.round(poisson.probOver35 * 1000) / 1000,
    probBttsYes: Math.round(poisson.probBttsYes * 1000) / 1000,
    mostLikelyScore: poisson.mostLikelyScore,
    confidence: Math.round(confidence * 1000) / 1000,
    homeAdvantageAdj: homeData.homeAdvantageCoeff,
    formAdvantage: Math.round((homeData.formScore - awayData.formScore) * 1000) / 1000,
    restAdvantage: context.restAdvantage,
    motivationScore: context.motivationScore,
    derbyFactor: context.isDerby ? 1 : 0,
    rotationRisk: Math.max(context.homeRotationRisk, context.awayRotationRisk),
    valueDetected,
    valueEdge: Math.round(valueEdge * 1000) / 1000,
    kellyStake: Math.round(kellyStake * 10000) / 10000,
    recommendedBet,
    models: {
      poissonXg: { probHome: Math.round(poisson.probHome * 1000) / 1000, probDraw: Math.round(poisson.probDraw * 1000) / 1000, probAway: Math.round(poisson.probAway * 1000) / 1000, lambdaHome: Math.round(poisson.lambdaHome * 100) / 100, lambdaAway: Math.round(poisson.lambdaAway * 100) / 100 },
      elo: { probHome: Math.round(elo.probHome * 1000) / 1000, probDraw: Math.round(elo.probDraw * 1000) / 1000, probAway: Math.round(elo.probAway * 1000) / 1000 },
      form: { probHome: Math.round(form.probHome * 1000) / 1000, probDraw: Math.round(form.probDraw * 1000) / 1000, probAway: Math.round(form.probAway * 1000) / 1000 },
      styleMatchup: { probHome: Math.round(style.probHome * 1000) / 1000, probDraw: Math.round(style.probDraw * 1000) / 1000, probAway: Math.round(style.probAway * 1000) / 1000 },
      context: { probHome: Math.round(ctx.probHome * 1000) / 1000, probDraw: Math.round(ctx.probDraw * 1000) / 1000, probAway: Math.round(ctx.probAway * 1000) / 1000 },
    },
  };

  // Step 9: Store prediction in database
  await db.prediction.upsert({
    where: { fixtureId },
    create: {
      fixtureId,
      probHomeWin: result.probHomeWin,
      probDraw: result.probDraw,
      probAwayWin: result.probAwayWin,
      predictedResult: result.predictedResult,
      expectedHomeGoals: result.expectedHomeGoals,
      expectedAwayGoals: result.expectedAwayGoals,
      probOver15: result.probOver15,
      probOver25: result.probOver25,
      probOver35: result.probOver35,
      probBttsYes: result.probBttsYes,
      mostLikelyScore: result.mostLikelyScore,
      confidence: result.confidence,
      modelVersion: 'v1.0',
      homeAdvantageAdj: result.homeAdvantageAdj,
      formAdvantage: result.formAdvantage,
      restAdvantage: result.restAdvantage,
      motivationScore: result.motivationScore,
      derbyFactor: result.derbyFactor,
      rotationRisk: result.rotationRisk,
      valueDetected: result.valueDetected,
      valueEdge: result.valueEdge,
      kellyStake: result.kellyStake,
      recommendedBet: result.recommendedBet,
      ensembleDetail: JSON.stringify(result.models),
    },
    update: {
      probHomeWin: result.probHomeWin,
      probDraw: result.probDraw,
      probAwayWin: result.probAwayWin,
      predictedResult: result.predictedResult,
      expectedHomeGoals: result.expectedHomeGoals,
      expectedAwayGoals: result.expectedAwayGoals,
      probOver15: result.probOver15,
      probOver25: result.probOver25,
      probOver35: result.probOver35,
      probBttsYes: result.probBttsYes,
      mostLikelyScore: result.mostLikelyScore,
      confidence: result.confidence,
      homeAdvantageAdj: result.homeAdvantageAdj,
      formAdvantage: result.formAdvantage,
      restAdvantage: result.restAdvantage,
      motivationScore: result.motivationScore,
      derbyFactor: result.derbyFactor,
      rotationRisk: result.rotationRisk,
      valueDetected: result.valueDetected,
      valueEdge: result.valueEdge,
      kellyStake: result.kellyStake,
      recommendedBet: result.recommendedBet,
      ensembleDetail: JSON.stringify(result.models),
    },
  });

  console.log(`[Engine] Prediction for ${homeData.name} vs ${awayData.name}: ${result.predictedResult} (${(result.confidence * 100).toFixed(1)}% confidence)`);
  return result;
}

// ============================================================================
// BATCH PREDICTION — for daily picks
// ============================================================================

export async function predictUpcomingMatches(): Promise<PredictionResult[]> {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const fixtures = await db.fixture.findMany({
    where: {
      status: 'notstarted',
      eventDate: {
        gte: today,
        lt: tomorrow,
      },
    },
    take: 50,
  });

  const predictions: PredictionResult[] = [];
  for (const fixture of fixtures) {
    try {
      const pred = await predictMatch(fixture.id);
      predictions.push(pred);
    } catch (err) {
      console.error(`[Engine] Failed to predict fixture ${fixture.id}:`, err);
    }
  }

  // Sort by confidence descending
  predictions.sort((a, b) => b.confidence - a.confidence);
  return predictions;
}

/** Get top picks — highest confidence predictions for today */
export async function getTopPicks(maxPicks: number = 10): Promise<PredictionResult[]> {
  const predictions = await predictUpcomingMatches();

  // Filter for confidence threshold
  const picks = predictions.filter(p => p.confidence >= 0.55);
  return picks.slice(0, maxPicks);
}
