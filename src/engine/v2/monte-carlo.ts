// ============================================================================
// xG-Vantage V2 Engine — Monte Carlo Simulator
// ============================================================================
// Runs 50,000 simulations of each fixture using Poisson-distributed goal
// generation with Dixon-Coles bivariate adjustment and copula correlation
// via Cholesky decomposition. Derives a full 8×8 score matrix and 24 market
// probabilities from the simulated outcomes.
// ============================================================================

import type { MonteCarloResult } from './types';
import { DIXON_COLES, MC_PARAMS } from './constants';

// ============================================================================
// Random Number Generation
// ============================================================================
// Simple, fast PRNG (xorshift32) for reproducibility and performance.
// We avoid Math.random() for better control in simulation contexts.
// ============================================================================

/** Seeded xorshift32 PRNG — fast and adequate for simulation purposes */
class XorShift32 {
  private state: number;

  constructor(seed: number) {
    // Ensure non-zero seed
    this.state = seed || 1;
  }

  /** Returns a pseudo-random integer in [0, 4294967295] */
  nextUint32(): number {
    let s = this.state;
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    this.state = s;
    return s >>> 0; // ensure unsigned
  }

  /** Returns a pseudo-random float in [0, 1) */
  nextDouble(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Returns a pseudo-random standard normal via Box-Muller */
  nextStandardNormal(): number {
    const u1 = Math.max(this.nextDouble(), 1e-10); // avoid log(0)
    const u2 = this.nextDouble();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

// ============================================================================
// Poisson Distribution
// ============================================================================

/**
 * Compute Poisson PMF: P(k | λ) = λ^k × e^(-λ) / k!
 * Used for the analytical score matrix construction.
 */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;

  // Use log-space for numerical stability with large k or lambda
  if (k > 170 || lambda > 700) {
    const logP = k * Math.log(lambda) - lambda - logFactorial(k);
    return Math.exp(logP);
  }

  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    result *= lambda / i;
  }
  return result;
}

/** Log factorial using Stirling's approximation for large k */
function logFactorial(k: number): number {
  if (k <= 1) return 0;
  if (k <= 170) {
    let logF = 0;
    for (let i = 2; i <= k; i++) {
      logF += Math.log(i);
    }
    return logF;
  }
  // Stirling's approximation
  return k * Math.log(k) - k + 0.5 * Math.log(2 * Math.PI * k);
}

/**
 * Sample a Poisson random variable using Knuth's algorithm.
 * For large lambda (>30), uses normal approximation for speed.
 */
function samplePoisson(rng: XorShift32, lambda: number): number {
  if (lambda <= 0) return 0;

  // For large lambda, use normal approximation (much faster)
  if (lambda > 30) {
    const normal = rng.nextStandardNormal();
    const approx = lambda + normal * Math.sqrt(lambda);
    return Math.max(0, Math.round(approx));
  }

  // Knuth's algorithm for small lambda
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;

  do {
    k++;
    p *= rng.nextDouble();
  } while (p > L);

  return k - 1;
}

// ============================================================================
// Dixon-Coles Adjustment
// ============================================================================
// The Dixon-Coles model adjusts probabilities for low-scoring outcomes
// (0-0, 1-0, 0-1, 1-1) to account for the dependency between team goals.
// ρ < 0 increases probability of 0-0 and 1-1, decreases 1-0 and 0-1.
// ============================================================================

/**
 * Compute the Dixon-Coles tau adjustment factor for a given scoreline.
 *
 * tau(i,j) = 1 - ρ × (λ^(-i)/i_factorial_term) × (μ^(-j)/j_factorial_term)
 * Simplified: only applied for i,j ∈ {0,1}
 *
 * For 0-0: tau = 1 - ρ × λ × μ
 * For 1-0: tau = 1 + ρ × μ
 * For 0-1: tau = 1 + ρ × λ
 * For 1-1: tau = 1 - ρ
 */
export function dixonColesTau(
  homeGoals: number,
  awayGoals: number,
  homeLambda: number,
  awayLambda: number,
  rho: number,
): number {
  if (homeGoals <= 1 && awayGoals <= 1) {
    switch (`${homeGoals}-${awayGoals}`) {
      case '0-0': return 1 - rho * homeLambda * awayLambda;
      case '1-0': return 1 + rho * awayLambda;
      case '0-1': return 1 + rho * homeLambda;
      case '1-1': return 1 - rho;
      default: return 1;
    }
  }
  return 1;
}

// ============================================================================
// Correlated Goal Generation (Copula via Cholesky)
// ============================================================================
// Generate correlated standard normals via Cholesky decomposition,
// transform to correlated uniforms, then inverse-Poisson to get goals.
// ============================================================================

/**
 * Generate a pair of correlated Poisson random variables.
 * Uses Gaussian copula with Cholesky decomposition.
 *
 * @param rng       Random number generator
 * @param homeLambda  Home team expected goals (Poisson rate)
 * @param awayLambda  Away team expected goals (Poisson rate)
 * @param correlation Target correlation between the two variables
 * @returns [homeGoals, awayGoals]
 */
function sampleCorrelatedPoisson(
  rng: XorShift32,
  homeLambda: number,
  awayLambda: number,
  correlation: number,
): [number, number] {
  // Generate two independent standard normals
  const z1 = rng.nextStandardNormal();
  const z2 = rng.nextStandardNormal();

  // Apply Cholesky decomposition for 2×2 correlation matrix:
  //   L = [[1, 0], [ρ, sqrt(1-ρ²)]]
  //   [X1, X2] = L × [Z1, Z2]
  const x1 = z1;
  const x2 = correlation * z1 + Math.sqrt(1 - correlation * correlation) * z2;

  // Transform to uniform via standard normal CDF (Φ)
  const u1 = normalCdf(x1);
  const u2 = normalCdf(x2);

  // Inverse Poisson: find k such that P(X ≤ k) ≥ u
  const homeGoals = inversePoisson(u1, homeLambda);
  const awayGoals = inversePoisson(u2, awayLambda);

  return [homeGoals, awayGoals];
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 26.2.17)
 * Maximum absolute error: 7.5e-8
 */
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1 + sign * y);
}

/**
 * Inverse Poisson CDF: find the smallest k such that P(X ≤ k | λ) ≥ p
 * Uses cumulative sum of Poisson PMF.
 */
function inversePoisson(p: number, lambda: number): number {
  if (lambda <= 0 || p <= 0) return 0;
  if (p >= 1) return 7; // cap at 7 (our matrix size)

  let cumProb = Math.exp(-lambda); // P(X=0)
  if (cumProb >= p) return 0;

  for (let k = 1; k <= 7; k++) {
    cumProb += poissonPmf(k, lambda);
    if (cumProb >= p) return k;
  }

  return 7; // cap at 7
}

// ============================================================================
// Analytical Score Matrix with Dixon-Coles
// ============================================================================
// Build the 8×8 score matrix analytically from Poisson PMFs with the
// Dixon-Coles bivariate adjustment applied to low-scoring cells.
// ============================================================================

/**
 * Build an analytical 8×8 score matrix using Poisson PMFs + Dixon-Coles.
 * This serves as the probability backbone, supplemented by Monte Carlo
 * sampling for markets that require correlation modelling.
 */
function buildAnalyticalScoreMatrix(
  homeLambda: number,
  awayLambda: number,
  rho: number,
): number[][] {
  const size = DIXON_COLES.matrixSize; // 8
  const matrix: number[][] = Array.from({ length: size }, () =>
    Array(size).fill(0),
  );

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const poissonProb = poissonPmf(i, homeLambda) * poissonPmf(j, awayLambda);
      const tau = dixonColesTau(i, j, homeLambda, awayLambda, rho);
      matrix[i][j] = Math.max(0, poissonProb * tau);
    }
  }

  // Normalise so the matrix sums to 1 (some probability mass is beyond 7-7)
  const total = matrix.reduce(
    (sum, row) => sum + row.reduce((s, v) => s + v, 0),
    0,
  );

  if (total > 0) {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        matrix[i][j] /= total;
      }
    }
  }

  return matrix;
}

// ============================================================================
// Monte Carlo Simulation Engine
// ============================================================================

/**
 * Run Monte Carlo simulation for a fixture.
 *
 * Combines analytical score matrix (Poisson + Dixon-Coles) with
 * Monte Carlo sampling (copula correlation) to derive market probabilities.
 *
 * @param homeXg      Home team expected goals
 * @param awayXg      Away team expected goals
 * @param chaosScore  Match chaos score (0-1), affects correlation
 * @param correlation Optional override for copula correlation
 * @returns MonteCarloResult with all probabilities and distributions
 */
export function runMonteCarlo(
  homeXg: number,
  awayXg: number,
  chaosScore: number,
  correlation?: number,
): MonteCarloResult {
  const numSims = MC_PARAMS.defaultSims; // 50,000
  const rho = DIXON_COLES.rho; // -0.10

  // Determine copula correlation based on chaos score
  const copulaCorr = correlation ?? (
    chaosScore > 0.5
      ? MC_PARAMS.chaosCorrelation  // 0.35 in chaotic matches
      : MC_PARAMS.copulaCorrelation // 0.12 in normal matches
  );

  // ── Step 1: Build analytical score matrix ──────────────────────────────
  const analyticalMatrix = buildAnalyticalScoreMatrix(homeXg, awayXg, rho);

  // ── Step 2: Run Monte Carlo simulations ────────────────────────────────
  const rng = new XorShift32(42 + Math.floor(homeXg * 1000 + awayXg * 100));

  // Accumulators
  const scoreMatrix: number[][] = Array.from({ length: 8 }, () =>
    Array(8).fill(0),
  );
  const homeGoalsDist = Array(8).fill(0);
  const awayGoalsDist = Array(8).fill(0);

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let bttsYes = 0;
  let homeOver05 = 0;
  let awayOver05 = 0;
  let homeOver15 = 0;
  let awayOver15 = 0;
  let handicapHomeMinus1 = 0; // home win by 2+
  let handicapAwayMinus1 = 0; // away win by 2+
  let handicapHomePlus1 = 0;  // home win OR draw OR home lose by 1
  let handicapAwayPlus1 = 0;  // away win OR draw OR away lose by 1
  let doubleChanceHome = 0;   // home win or draw
  let doubleChanceAway = 0;   // away win or draw
  let doubleChanceNoDraw = 0; // home win or away win
  let dnbHome = 0;            // home win (draw → void, not counted)
  let dnbAway = 0;            // away win (draw → void, not counted)
  let dnbTotal = 0;           // non-draw count for DNB normalization

  for (let sim = 0; sim < numSims; sim++) {
    const [hg, ag] = sampleCorrelatedPoisson(rng, homeXg, awayXg, copulaCorr);
    const cappedHg = Math.min(hg, 7);
    const cappedAg = Math.min(ag, 7);
    const totalGoals = cappedHg + cappedAg;
    const goalDiff = cappedHg - cappedAg;

    // Score matrix
    scoreMatrix[cappedHg][cappedAg] += 1;

    // Goal distributions
    homeGoalsDist[cappedHg] += 1;
    awayGoalsDist[cappedAg] += 1;

    // 1X2
    if (goalDiff > 0) homeWins++;
    else if (goalDiff === 0) draws++;
    else awayWins++;

    // Over/Under
    if (totalGoals > 1) over15++;
    if (totalGoals > 2) over25++;
    if (totalGoals > 3) over35++;

    // BTTS
    if (cappedHg > 0 && cappedAg > 0) bttsYes++;

    // Team Over
    if (cappedHg > 0) homeOver05++;
    if (cappedAg > 0) awayOver05++;
    if (cappedHg > 1) homeOver15++;
    if (cappedAg > 1) awayOver15++;

    // Handicap -1 (win by 2+)
    if (goalDiff >= 2) handicapHomeMinus1++;
    if (goalDiff <= -2) handicapAwayMinus1++;

    // Handicap +1 (lose by 0 or 1, or draw, or win)
    if (goalDiff >= -1) handicapHomePlus1++;
    if (goalDiff <= 1) handicapAwayPlus1++;

    // Double chance
    if (goalDiff >= 0) doubleChanceHome++;
    if (goalDiff <= 0) doubleChanceAway++;
    if (goalDiff !== 0) doubleChanceNoDraw++;

    // Draw No Bet
    if (goalDiff !== 0) {
      dnbTotal++;
      if (goalDiff > 0) dnbHome++;
      if (goalDiff < 0) dnbAway++;
    }
  }

  // ── Step 3: Blend analytical matrix with MC matrix ─────────────────────
  // 40% analytical (well-calibrated Poisson+DC) / 60% MC (captures copula)
  const blendAnalytical = 0.40;
  const blendMC = 0.60;
  const blendedMatrix: number[][] = Array.from({ length: 8 }, () =>
    Array(8).fill(0),
  );

  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const mcProb = scoreMatrix[i][j] / numSims;
      blendedMatrix[i][j] = round4(
        analyticalMatrix[i][j] * blendAnalytical + mcProb * blendMC,
      );
    }
  }

  // Normalise blended matrix
  const blendedTotal = blendedMatrix.reduce(
    (sum, row) => sum + row.reduce((s, v) => s + v, 0), 0,
  );
  if (blendedTotal > 0) {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        blendedMatrix[i][j] = round4(blendedMatrix[i][j] / blendedTotal);
      }
    }
  }

  // ── Step 4: Derive probabilities from blended matrix ───────────────────
  // Use blended matrix for core markets (more stable than raw MC)
  const m = blendedMatrix; // shorthand

  let matrixHomeWin = 0;
  let matrixDraw = 0;
  let matrixAwayWin = 0;
  let matrixOver15 = 0;
  let matrixOver25 = 0;
  let matrixOver35 = 0;
  let matrixBttsYes = 0;

  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const prob = m[i][j];
      if (i > j) matrixHomeWin += prob;
      else if (i === j) matrixDraw += prob;
      else matrixAwayWin += prob;

      if (i + j > 1) matrixOver15 += prob;
      if (i + j > 2) matrixOver25 += prob;
      if (i + j > 3) matrixOver35 += prob;

      if (i > 0 && j > 0) matrixBttsYes += prob;
    }
  }

  // ── Step 5: Derive MC-based markets (more granular) ────────────────────
  const n = numSims;

  // Handicap probabilities from MC
  const handHomeMinus1 = handicapHomeMinus1 / n;
  const handAwayMinus1 = handicapAwayMinus1 / n;
  const handHomePlus1 = handicapHomePlus1 / n;
  const handAwayPlus1 = handicapAwayPlus1 / n;

  // Double chance from MC
  const dcHome = doubleChanceHome / n;
  const dcAway = doubleChanceAway / n;
  const dcNoDraw = doubleChanceNoDraw / n;

  // DNB from MC
  const dnbHomeProb = dnbTotal > 0 ? dnbHome / dnbTotal : matrixHomeWin / (matrixHomeWin + matrixAwayWin);
  const dnbAwayProb = dnbTotal > 0 ? dnbAway / dnbTotal : matrixAwayWin / (matrixHomeWin + matrixAwayWin);

  // ── Step 6: Find most likely scoreline and top 10 ──────────────────────
  const scorelines: Array<{ home: number; away: number; prob: number }> = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      scorelines.push({ home: i, away: j, prob: m[i][j] });
    }
  }
  scorelines.sort((a, b) => b.prob - a.prob);

  const mostLikelyScore: [number, number] = [
    scorelines[0].home,
    scorelines[0].away,
  ];
  const mostLikelyScoreProb = scorelines[0].prob;
  const topScores = scorelines.slice(0, 10);

  // ── Step 7: Goal distributions from blended matrix ─────────────────────
  const homeDist = Array(8).fill(0);
  const awayDist = Array(8).fill(0);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      homeDist[i] += m[i][j];
      awayDist[j] += m[i][j];
    }
  }

  // ── Step 8: Build final result ─────────────────────────────────────────
  return {
    simulations: numSims,
    homeWinProb: round4(matrixHomeWin),
    drawProb: round4(matrixDraw),
    awayWinProb: round4(matrixAwayWin),
    over15: round4(matrixOver15),
    over25: round4(matrixOver25),
    over35: round4(matrixOver35),
    under15: round4(1 - matrixOver15),
    under25: round4(1 - matrixOver25),
    under35: round4(1 - matrixOver35),
    bttsYes: round4(matrixBttsYes),
    bttsNo: round4(1 - matrixBttsYes),
    homeOver05: round4(homeOver05 / n),
    awayOver05: round4(awayOver05 / n),
    homeOver15: round4(homeOver15 / n),
    awayOver15: round4(awayOver15 / n),
    scoreMatrix: blendedMatrix,
    mostLikelyScore,
    mostLikelyScoreProb: round4(mostLikelyScoreProb),
    topScores: topScores.map((s) => ({
      home: s.home,
      away: s.away,
      prob: round4(s.prob),
    })),
    homeGoalsDist: homeDist.map(round4),
    awayGoalsDist: awayDist.map(round4),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
