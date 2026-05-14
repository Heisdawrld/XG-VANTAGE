// ============================================================================
// xG-Vantage V2 Engine — Smart ACCA Builder
// ============================================================================
// Builds accumulator (ACCA) recommendations from a pool of V2 predictions.
//
// Two modes:
//   SAFE  — Only SAFE risk picks, min 60% probability, 3-4 legs, max 1/league
//   VALUE — SAFE + MODERATE risk, min 57% probability, 3-5 legs, max 2/league
//
// The builder enforces strict diversity constraints to avoid correlated
// failures:
//   - League caps (prevent all picks from the same league)
//   - Script caps (prevent all picks from the same match script)
//   - Under-pick caps (limit defensive picks)
//   - Attacking pick requirement (at least 1 over/BTTS pick)
//
// If not enough qualifying picks exist, the builder REFUSES to force filler
// and returns with refused=true.
// ============================================================================

import type {
  V2Prediction,
  AccaPick,
  AccaResult,
  MarketKey,
  MatchScript,
  MarketCandidate,
} from './types';
import {
  ACCA_PARAMS,
  getLeaguePrestige,
  DEFAULT_LEAGUE_PRESTIGE,
  ENGINE_VERSION,
} from './constants';

// ============================================================================
// Internal Helpers
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ============================================================================
// Pick Extraction
// ============================================================================

/**
 * Extract an AccaPick from a V2Prediction's best market pick.
 * Returns null if the prediction has no viable market selection.
 */
function extractAccaPick(prediction: V2Prediction): AccaPick | null {
  const bestPick = prediction.marketSelection.bestPick;
  if (!bestPick || bestPick.rejected) {
    return null;
  }

  return {
    fixtureId: prediction.fixtureId,
    homeTeamName: prediction.homeTeamName,
    awayTeamName: prediction.awayTeamName,
    marketKey: bestPick.marketKey,
    selection: bestPick.selection,
    probability: bestPick.probability,
    odds: bestPick.odds,
    riskLevel: bestPick.riskClassification as 'SAFE' | 'MODERATE',
    confidence: prediction.confidence.composite / 100, // 0-1 scale
    leagueName: prediction.leagueName,
    leaguePrestige: getLeaguePrestige(prediction.leagueId),
    scriptType: prediction.script.primary,
  };
}

// ============================================================================
// Market Classification Helpers
// ============================================================================

/** Check if a market key is an "attacking" pick (over/BTTS) */
function isAttackingPick(marketKey: MarketKey): boolean {
  return (
    marketKey.startsWith('over_') ||
    marketKey === 'btts_yes' ||
    marketKey === 'home_over_05' ||
    marketKey === 'away_over_05' ||
    marketKey === 'home_over_15' ||
    marketKey === 'away_over_15'
  );
}

/** Check if a market key is an "under" pick */
function isUnderPick(marketKey: MarketKey): boolean {
  return marketKey.startsWith('under_');
}

/** Check if a market key is a 1X2/win pick */
function isWinPick(marketKey: MarketKey): boolean {
  return (
    marketKey === 'home_win' ||
    marketKey === 'away_win' ||
    marketKey === 'dnb_home' ||
    marketKey === 'dnb_away' ||
    marketKey === 'double_chance_home' ||
    marketKey === 'double_chance_away' ||
    marketKey === 'double_chance_no_draw'
  );
}

// ============================================================================
// Scoring
// ============================================================================

interface ScoredPick extends AccaPick {
  accaScore: number;
}

/**
 * Score each eligible prediction using the ACCA_PARAMS.scoring weights:
 *   - probability   (36%)
 *   - dataQuality   (16%)
 *   - volatility    (16%)
 *   - histAccuracy  (22%)
 *   - prestige      (10%)
 */
function scorePick(prediction: V2Prediction, pick: AccaPick): ScoredPick {
  const scoring = ACCA_PARAMS.scoring;

  // ── probability component (36%) ────────────────────────────────────────
  const probScore = clamp(pick.probability, 0, 1);

  // ── dataQuality component (16%) ────────────────────────────────────────
  // Map enrichment tier to a quality score
  const tierMap: Record<string, number> = { rich: 1.0, good: 0.8, partial: 0.55, thin: 0.25 };
  const dataQuality = tierMap[prediction.dataQuality] ?? 0.4;

  // ── volatility component (16%) ─────────────────────────────────────────
  // Inverse: low volatility = high score
  const volatilityValue = prediction.confidence.volatility === 'low' ? 0.2 :
    prediction.confidence.volatility === 'medium' ? 0.5 : 0.8;
  const volatilityScore = clamp(1 - volatilityValue, 0, 1);

  // ── histAccuracy component (22%) ───────────────────────────────────────
  // Use the market candidate's historicalAccuracy as proxy
  const bestPick = prediction.marketSelection.bestPick;
  const histAccuracy = bestPick ? clamp(bestPick.historicalAccuracy, 0, 1) : 0.5;

  // ── prestige component (10%) ───────────────────────────────────────────
  const prestige = clamp(pick.leaguePrestige, 0, 1);

  // ── Weighted sum ───────────────────────────────────────────────────────
  const accaScore = round4(
    probScore * scoring.probability +
    dataQuality * scoring.dataQuality +
    volatilityScore * scoring.volatility +
    histAccuracy * scoring.histAccuracy +
    prestige * scoring.prestige
  );

  return { ...pick, accaScore };
}

// ============================================================================
// Diversity Constraint Enforcement
// ============================================================================

interface DiversityState {
  leagueCounts: Map<string, number>;
  scriptCounts: Map<MatchScript, number>;
  underCount: number;
  attackingCount: number;
}

function createDiversityState(): DiversityState {
  return {
    leagueCounts: new Map(),
    scriptCounts: new Map(),
    underCount: 0,
    attackingCount: 0,
  };
}

/**
 * Check if adding a pick would violate diversity constraints.
 * Returns true if the pick is allowed.
 */
function isDiversityAllowed(
  pick: AccaPick,
  state: DiversityState,
  mode: 'SAFE' | 'VALUE',
): boolean {
  const config = ACCA_PARAMS[mode];

  // ── League cap ─────────────────────────────────────────────────────────
  const currentLeagueCount = state.leagueCounts.get(pick.leagueName) ?? 0;
  if (currentLeagueCount >= config.maxPerLeague) {
    return false;
  }

  // ── Script cap ─────────────────────────────────────────────────────────
  const currentScriptCount = state.scriptCounts.get(pick.scriptType) ?? 0;
  if (currentScriptCount >= config.maxSameScript) {
    return false;
  }

  // ── Under pick cap ─────────────────────────────────────────────────────
  if (isUnderPick(pick.marketKey) && state.underCount >= config.maxUnderPicks) {
    return false;
  }

  return true;
}

/**
 * Update diversity state after adding a pick.
 */
function updateDiversityState(pick: AccaPick, state: DiversityState): void {
  state.leagueCounts.set(
    pick.leagueName,
    (state.leagueCounts.get(pick.leagueName) ?? 0) + 1,
  );
  state.scriptCounts.set(
    pick.scriptType,
    (state.scriptCounts.get(pick.scriptType) ?? 0) + 1,
  );
  if (isUnderPick(pick.marketKey)) {
    state.underCount++;
  }
  if (isAttackingPick(pick.marketKey)) {
    state.attackingCount++;
  }
}

// ============================================================================
// Attacking Pick Requirement Enforcement
// ============================================================================

/**
 * After initial selection, ensure at least 1 attacking pick is included.
 * If none, try to swap the weakest non-attacking pick for an attacking one.
 * If no attacking alternative exists, mark the result as refused.
 */
function enforceAttackingRequirement(
  selected: ScoredPick[],
  allScored: ScoredPick[],
  mode: 'SAFE' | 'VALUE',
): { picks: ScoredPick[]; hasAttacking: boolean } {
  const hasAttacking = selected.some((p) => isAttackingPick(p.marketKey));

  if (hasAttacking) {
    return { picks: selected, hasAttacking: true };
  }

  const config = ACCA_PARAMS[mode];

  // Find attacking candidates that aren't already selected
  const selectedFixtureIds = new Set(selected.map((p) => p.fixtureId));
  const attackingAlternatives = allScored.filter(
    (p) =>
      isAttackingPick(p.marketKey) &&
      !selectedFixtureIds.has(p.fixtureId) &&
      p.probability >= config.minProb,
  );

  if (attackingAlternatives.length === 0) {
    // No attacking alternatives available → refuse
    return { picks: selected, hasAttacking: false };
  }

  // Sort alternatives by accaScore descending
  attackingAlternatives.sort((a, b) => b.accaScore - a.accaScore);

  // Find the weakest non-attacking pick in current selection
  const nonAttackingPicks = selected.filter((p) => !isAttackingPick(p.marketKey));
  nonAttackingPicks.sort((a, b) => a.accaScore - b.accaScore);

  if (nonAttackingPicks.length === 0) {
    // All picks are attacking already (shouldn't reach here, but safety check)
    return { picks: selected, hasAttacking: true };
  }

  // Swap the weakest non-attacking for the best attacking alternative
  const weakestNonAttacking = nonAttackingPicks[0];
  const bestAlternative = attackingAlternatives[0];

  const updated = selected.map((p) =>
    p.fixtureId === weakestNonAttacking.fixtureId &&
    p.marketKey === weakestNonAttacking.marketKey
      ? bestAlternative
      : p,
  );

  return { picks: updated, hasAttacking: true };
}

// ============================================================================
// Diversity Score Computation
// ============================================================================

/**
 * Compute a diversity score (0-1) for the selected picks.
 * Higher is better — measures how spread out the picks are across:
 *   - Leagues
 *   - Scripts
 *   - Market types
 */
function computeDiversityScore(picks: AccaPick[]): number {
  if (picks.length <= 1) return 1.0;

  // ── League diversity ───────────────────────────────────────────────────
  const uniqueLeagues = new Set(picks.map((p) => p.leagueName)).size;
  const leagueDiversity = clamp(uniqueLeagues / picks.length, 0, 1);

  // ── Script diversity ───────────────────────────────────────────────────
  const uniqueScripts = new Set(picks.map((p) => p.scriptType)).size;
  const scriptDiversity = clamp(uniqueScripts / picks.length, 0, 1);

  // ── Market type diversity ──────────────────────────────────────────────
  const marketCategories = new Set(picks.map((p) => {
    if (isWinPick(p.marketKey)) return 'win';
    if (isAttackingPick(p.marketKey)) return 'attacking';
    if (isUnderPick(p.marketKey)) return 'under';
    return 'other';
  })).size;
  const marketDiversity = clamp(marketCategories / Math.min(picks.length, 3), 0, 1);

  // ── Composite diversity ────────────────────────────────────────────────
  // Weight: league diversity most important, then script, then market type
  return round4(
    leagueDiversity * 0.45 +
    scriptDiversity * 0.30 +
    marketDiversity * 0.25
  );
}

// ============================================================================
// Quality Score Computation
// ============================================================================

/**
 * Compute overall ACCA quality score (0-100).
 *
 * Based on:
 *   - Average pick probability (higher = safer)
 *   - Average ACCA score of picks
 *   - Diversity score
 *   - Combined probability penalty (too low = risky)
 */
function computeQualityScore(
  picks: ScoredPick[],
  combinedProbability: number,
  diversityScore: number,
): number {
  if (picks.length === 0) return 0;

  // ── Average probability score ──────────────────────────────────────────
  const avgProb = picks.reduce((sum, p) => sum + p.probability, 0) / picks.length;
  const probScore = clamp(avgProb, 0, 1);

  // ── Average ACCA score ─────────────────────────────────────────────────
  const avgAccaScore = picks.reduce((sum, p) => sum + p.accaScore, 0) / picks.length;

  // ── Combined probability penalty ───────────────────────────────────────
  // Even if individual picks are good, very low combined probability is bad
  const combinedPenalty = combinedProbability < 0.15 ? 0.70 :
    combinedProbability < 0.25 ? 0.85 :
    combinedProbability < 0.40 ? 0.95 : 1.0;

  // ── Final quality score ────────────────────────────────────────────────
  const quality = round4(
    (probScore * 35 +
    avgAccaScore * 100 * 0.30 +
    diversityScore * 100 * 0.20 +
    combinedPenalty * 15)
  );

  return clamp(Math.round(quality), 0, 100);
}

// ============================================================================
// MAIN: buildAcca
// ============================================================================

/**
 * Build a smart ACCA from a pool of V2 predictions.
 *
 * @param predictions  Pool of V2 predictions to select from
 * @param mode         'SAFE' or 'VALUE' — controls risk tolerance and constraints
 * @returns AccaResult with selected picks, combined metrics, and diversity score
 */
export function buildAcca(
  predictions: V2Prediction[],
  mode: 'SAFE' | 'VALUE',
): AccaResult {
  const config = ACCA_PARAMS[mode];

  // ── Step 1: Extract picks and filter by mode requirements ───────────────
  const allPicks: AccaPick[] = [];
  const allScored: ScoredPick[] = [];

  for (const prediction of predictions) {
    const pick = extractAccaPick(prediction);
    if (!pick) continue;

    // Risk filter: SAFE mode only allows SAFE risk
    if (!config.riskAllowed.includes(pick.riskLevel)) {
      continue;
    }

    allPicks.push(pick);
  }

  // ── Step 2: Filter by minimum probability ───────────────────────────────
  const eligiblePicks = allPicks.filter(
    (p) => p.probability >= config.minProb,
  );

  if (eligiblePicks.length === 0) {
    return {
      mode,
      picks: [],
      combinedProbability: 0,
      combinedOdds: null,
      quality: 0,
      diversityScore: 0,
      refused: true,
      refusalReason: `No predictions meet minimum probability threshold (${(config.minProb * 100).toFixed(0)}%) for ${mode} mode`,
    };
  }

  // ── Step 3: Score each eligible prediction ──────────────────────────────
  // We need to match picks back to predictions for scoring
  const predictionMap = new Map<number, V2Prediction>();
  for (const pred of predictions) {
    predictionMap.set(pred.fixtureId, pred);
  }

  for (const pick of eligiblePicks) {
    const prediction = predictionMap.get(pick.fixtureId);
    if (prediction) {
      allScored.push(scorePick(prediction, pick));
    } else {
      // Fallback: use the pick with a default score
      allScored.push({
        ...pick,
        accaScore: round4(pick.probability * 0.50 + pick.leaguePrestige * 0.20 + 0.15),
      });
    }
  }

  // Sort by accaScore descending
  allScored.sort((a, b) => b.accaScore - a.accaScore);

  // ── Step 4: Select picks with diversity constraints ─────────────────────
  const diversityState = createDiversityState();
  const selected: ScoredPick[] = [];

  for (const scored of allScored) {
    // Stop if we've reached the maximum number of picks
    if (selected.length >= config.maxPicks) break;

    // Check diversity constraints
    if (!isDiversityAllowed(scored, diversityState, mode)) {
      continue;
    }

    selected.push(scored);
    updateDiversityState(scored, diversityState);
  }

  // ── Step 5: Enforce attacking pick requirement ──────────────────────────
  let { picks: finalPicks, hasAttacking } = enforceAttackingRequirement(
    selected,
    allScored,
    mode,
  );

  // ── Step 6: Check minimum pick count ────────────────────────────────────
  if (finalPicks.length < config.minPicks) {
    return {
      mode,
      picks: [],
      combinedProbability: 0,
      combinedOdds: null,
      quality: 0,
      diversityScore: 0,
      refused: true,
      refusalReason: `Only ${finalPicks.length} qualifying picks found, minimum is ${config.minPicks} for ${mode} mode`,
    };
  }

  if (!hasAttacking && config.requireAttacking) {
    return {
      mode,
      picks: [],
      combinedProbability: 0,
      combinedOdds: null,
      quality: 0,
      diversityScore: 0,
      refused: true,
      refusalReason: `No attacking picks (over/BTTS) available — refusing to build ${mode} ACCA without attacking diversity`,
    };
  }

  // ── Step 7: Compute combined probability ────────────────────────────────
  // Product of individual probabilities (assumes independence)
  let combinedProbability = 1.0;
  for (const pick of finalPicks) {
    combinedProbability *= pick.probability;
  }
  combinedProbability = round4(clamp(combinedProbability, 0, 1));

  // ── Step 8: Compute combined odds ───────────────────────────────────────
  // Product of individual odds (if all picks have odds)
  let combinedOdds: number | null = null;
  const allHaveOdds = finalPicks.every((p) => p.odds !== null && p.odds > 1.0);

  if (allHaveOdds) {
    combinedOdds = round4(
      finalPicks.reduce((product, p) => product * (p.odds ?? 1.0), 1.0),
    );
  }

  // ── Step 9: Compute diversity score ─────────────────────────────────────
  const diversityScore = computeDiversityScore(finalPicks);

  // ── Step 10: Compute quality score ──────────────────────────────────────
  const quality = computeQualityScore(finalPicks, combinedProbability, diversityScore);

  // ── Strip accaScore from output (it's internal) ─────────────────────────
  const outputPicks: AccaPick[] = finalPicks.map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ accaScore: _, ...rest }) => rest,
  );

  return {
    mode,
    picks: outputPicks,
    combinedProbability,
    combinedOdds,
    quality,
    diversityScore,
    refused: false,
  };
}
