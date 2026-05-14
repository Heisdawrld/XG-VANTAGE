// ============================================================================
// xG-Vantage V2 Engine — Calibration Layer
// ============================================================================
// Post-processes raw Monte Carlo probabilities through 5 calibration steps:
//   1. Script micro-adjustments (max ±0.04)
//   2. Polymarket blending (70/30 for 1X2, 60/40 for BTTS)
//   3. Enforced invariants (probability sum constraints)
//   4. Over 1.5 dampening (0.97 structural correction)
//   5. Isotonic regression (bin-based correction from historical data)
//
// Also provides updateCalibration() and getCalibrationData() for the
// learning loop, storing per-market calibration bins in the database.
// ============================================================================

import type {
  MonteCarloResult,
  ScriptClassification,
  FeatureVector,
  CalibratedProbabilities,
  MarketCalibration,
  CalibrationBin,
} from './types';
import { CALIBRATION } from './constants';
import { client } from '../../lib/db-turso';

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
// Step 1: Script Micro-Adjustments
// ============================================================================
// Apply small adjustments (max ±0.04) based on the match script classification.
// These represent known biases in specific match narratives.
// ============================================================================

interface ScriptAdjustments {
  homeWin: number;
  draw: number;
  awayWin: number;
  over15: number;
  over25: number;
  over35: number;
  bttsYes: number;
  bttsNo: number;
  under25: number;
}

/**
 * Get script-specific micro-adjustments from the constants table.
 * Returns zero adjustments if the script is not defined.
 */
function getScriptAdjustments(
  script: ScriptClassification,
): ScriptAdjustments {
  const scriptKey = script.primary;
  const adjustments = CALIBRATION.scriptAdjustments[scriptKey as keyof typeof CALIBRATION.scriptAdjustments];

  const empty: ScriptAdjustments = {
    homeWin: 0, draw: 0, awayWin: 0,
    over15: 0, over25: 0, over35: 0,
    bttsYes: 0, bttsNo: 0, under25: 0,
  };

  if (!adjustments) return empty;

  // Map from the constants' partial adjustment to a full adjustment object
  // Scale by script confidence
  const conf = script.confidence;
  const scale = clamp(conf, 0.3, 1.0);

  return {
    homeWin: clamp((adjustments as Record<string, number>).homeWin ?? 0, -0.04, 0.04) * scale,
    draw: clamp((adjustments as Record<string, number>).draw ?? 0, -0.04, 0.04) * scale,
    awayWin: clamp((adjustments as Record<string, number>).awayWin ?? 0, -0.04, 0.04) * scale,
    over15: clamp((adjustments as Record<string, number>).over15 ?? 0, -0.04, 0.04) * scale,
    over25: clamp((adjustments as Record<string, number>).over25 ?? 0, -0.04, 0.04) * scale,
    over35: clamp((adjustments as Record<string, number>).over35 ?? 0, -0.04, 0.04) * scale,
    bttsYes: clamp((adjustments as Record<string, number>).bttsYes ?? 0, -0.04, 0.04) * scale,
    bttsNo: clamp((adjustments as Record<string, number>).bttsNo ?? 0, -0.04, 0.04) * scale,
    under25: clamp((adjustments as Record<string, number>).under25 ?? 0, -0.04, 0.04) * scale,
  };
}

/**
 * Apply script micro-adjustments to raw probabilities.
 */
function applyScriptAdjustments(
  raw: MonteCarloResult,
  script: ScriptClassification,
): { probs: Partial<CalibratedProbabilities>; adjustments: Record<string, number> } {
  const adj = getScriptAdjustments(script);
  const adjustments: Record<string, number> = {};

  const homeWin = round4(clamp(raw.homeWinProb + adj.homeWin, 0.01, 0.97));
  const draw = round4(clamp(raw.drawProb + adj.draw, 0.01, 0.97));
  const awayWin = round4(clamp(raw.awayWinProb + adj.awayWin, 0.01, 0.97));
  const over15 = round4(clamp(raw.over15 + adj.over15, 0.01, 0.99));
  const over25 = round4(clamp(raw.over25 + adj.over25, 0.01, 0.99));
  const over35 = round4(clamp(raw.over35 + adj.over35, 0.01, 0.99));
  const bttsYes = round4(clamp(raw.bttsYes + adj.bttsYes, 0.01, 0.99));

  // Track which adjustments were applied
  if (adj.homeWin !== 0) adjustments.homeWin = adj.homeWin;
  if (adj.draw !== 0) adjustments.draw = adj.draw;
  if (adj.awayWin !== 0) adjustments.awayWin = adj.awayWin;
  if (adj.over15 !== 0) adjustments.over15 = adj.over15;
  if (adj.over25 !== 0) adjustments.over25 = adj.over25;
  if (adj.over35 !== 0) adjustments.over35 = adj.over35;
  if (adj.bttsYes !== 0) adjustments.bttsYes = adj.bttsYes;
  if (adj.bttsNo !== 0) adjustments.bttsNo = adj.bttsNo;
  if (adj.under25 !== 0) adjustments.under25 = adj.under25;

  return {
    probs: { homeWin, draw, awayWin, over15, over25, over35, bttsYes },
    adjustments,
  };
}

// ============================================================================
// Step 2: Polymarket Blending
// ============================================================================
// Blend engine probabilities with market-implied probabilities.
// 1X2: 70% engine / 30% market
// BTTS: 60% engine / 40% market
// Market features serve as the proxy for Polymarket odds.
// ============================================================================

function applyPolymarketBlend(
  probs: Partial<CalibratedProbabilities>,
  features: FeatureVector,
): Partial<CalibratedProbabilities> {
  // Only blend if market odds are available
  if (!features.market.hasOdds || features.market.oddsConfidence < 0.3) {
    return probs;
  }

  const engine1X2Weight = CALIBRATION.blendEngine;       // 0.70
  const market1X2Weight = CALIBRATION.blendPolymarket;   // 0.30
  const engineBttsWeight = CALIBRATION.blendEngineBtts;  // 0.60
  const marketBttsWeight = CALIBRATION.blendPolymarketBtts; // 0.40

  // Scale market weight by odds confidence
  const confidenceScale = features.market.oddsConfidence;
  const effectiveMarket1X2 = market1X2Weight * confidenceScale;
  const effectiveEngine1X2 = engine1X2Weight + (market1X2Weight - effectiveMarket1X2);
  const effectiveMarketBtts = marketBttsWeight * confidenceScale;
  const effectiveEngineBtts = engineBttsWeight + (marketBttsWeight - effectiveMarketBtts);

  // 1X2 blending
  const blendedHomeWin = round4(
    (probs.homeWin! * effectiveEngine1X2 + features.market.impliedHomeWin * effectiveMarket1X2) /
    (effectiveEngine1X2 + effectiveMarket1X2)
  );
  const blendedDraw = round4(
    (probs.draw! * effectiveEngine1X2 + features.market.impliedDraw * effectiveMarket1X2) /
    (effectiveEngine1X2 + effectiveMarket1X2)
  );
  const blendedAwayWin = round4(
    (probs.awayWin! * effectiveEngine1X2 + features.market.impliedAwayWin * effectiveMarket1X2) /
    (effectiveEngine1X2 + effectiveMarket1X2)
  );

  // BTTS blending
  const blendedBttsYes = round4(
    (probs.bttsYes! * effectiveEngineBtts + features.market.impliedBttsYes * effectiveMarketBtts) /
    (effectiveEngineBtts + effectiveMarketBtts)
  );

  return {
    ...probs,
    homeWin: blendedHomeWin,
    draw: blendedDraw,
    awayWin: blendedAwayWin,
    bttsYes: blendedBttsYes,
  };
}

// ============================================================================
// Step 3: Enforced Invariants
// ============================================================================
// Ensure probability constraints are satisfied:
//   - homeWin + draw + awayWin = 1
//   - over_X + under_X = 1
//   - over15 ≥ over25 ≥ over35
//   - bttsYes + bttsNo = 1 (approximately)
// ============================================================================

function enforceInvariants(
  probs: Partial<CalibratedProbabilities>,
  raw: MonteCarloResult,
): Partial<CalibratedProbabilities> {
  // ── 1X2 normalisation ──────────────────────────────────────────────────
  let homeWin = probs.homeWin ?? raw.homeWinProb;
  let draw = probs.draw ?? raw.drawProb;
  let awayWin = probs.awayWin ?? raw.awayWinProb;
  const total1X2 = homeWin + draw + awayWin;
  if (total1X2 > 0) {
    homeWin = round4(homeWin / total1X2);
    draw = round4(draw / total1X2);
    awayWin = round4(awayWin / total1X2);
  }

  // ── Over/Under pairing ─────────────────────────────────────────────────
  let over15 = probs.over15 ?? raw.over15;
  let over25 = probs.over25 ?? raw.over25;
  let over35 = probs.over35 ?? raw.over35;
  const under15 = round4(1 - over15);
  const under25 = round4(1 - over25);
  const under35 = round4(1 - over35);

  // ── Monotonicity: over15 ≥ over25 ≥ over35 ────────────────────────────
  // If violated, nudge toward compliance rather than hard-set
  if (over15 < over25) {
    const avg = (over15 + over25) / 2;
    over15 = round4(avg + 0.005);
    over25 = round4(avg - 0.005);
  }
  if (over25 < over35) {
    const avg = (over25 + over35) / 2;
    over25 = round4(avg + 0.005);
    over35 = round4(avg - 0.005);
  }

  // Recompute unders after monotonicity fix
  const fixedUnder15 = round4(1 - over15);
  const fixedUnder25 = round4(1 - over25);
  const fixedUnder35 = round4(1 - over35);

  // ── BTTS pairing ───────────────────────────────────────────────────────
  let bttsYes = probs.bttsYes ?? raw.bttsYes;
  const bttsNo = round4(1 - bttsYes);

  return {
    homeWin,
    draw,
    awayWin,
    over15,
    over25,
    over35,
    bttsYes,
    bttsNo,
  };
}

// ============================================================================
// Step 4: Over 1.5 Dampening
// ============================================================================
// Structural overconfidence correction: our model tends to over-estimate
// Over 1.5 by ~3%, so apply a 0.97 dampening factor.
// ============================================================================

function applyOver15Dampening(
  probs: Partial<CalibratedProbabilities>,
): Partial<CalibratedProbabilities> {
  const dampFactor = CALIBRATION.over15Dampen; // 0.97
  const over15 = round4(clamp(probs.over15! * dampFactor, 0.01, 0.99));
  return {
    ...probs,
    over15,
  };
}

// ============================================================================
// Step 5: Isotonic Regression
// ============================================================================
// For each market, store predicted vs actual outcomes in bins.
// When enough data exists (>50 samples), apply bin-based correction.
//
// Bins are 0.10 wide: [0.0, 0.1), [0.1, 0.2), ..., [0.9, 1.0]
// For each bin, track: predicted_count, actual_count, actual_rate
// Correction: if predicted=0.65 but actual_rate=0.58, adjust 0.65→0.58
// ============================================================================

/**
 * Apply isotonic regression correction to a single probability value.
 * Finds the bin containing the predicted probability and replaces it
 * with the historical actual rate from that bin (if enough data).
 */
async function applyIsotonicCorrection(
  marketKey: string,
  predictedProb: number,
): Promise<number> {
  try {
    const calibration = await getCalibrationData(marketKey);
    if (!calibration || calibration.totalSamples < CALIBRATION.minSamplesForCalibration) {
      return predictedProb; // Not enough data for correction
    }

    // Find the bin containing this predicted probability
    const bin = calibration.bins.find(
      (b) => predictedProb >= b.lowerBound && predictedProb < b.upperBound,
    );

    if (!bin || bin.predictedCount < 5) {
      return predictedProb; // Insufficient bin-level data
    }

    // Blend correction: 70% original + 30% historical actual rate
    // (gentle correction to avoid overfitting to limited historical data)
    const correctionWeight = Math.min(bin.predictedCount / 200, 0.30);
    const corrected = predictedProb * (1 - correctionWeight) + bin.actualRate * correctionWeight;

    return round4(clamp(corrected, 0.01, 0.99));
  } catch {
    // If DB read fails, return uncorrected probability
    return predictedProb;
  }
}

/**
 * Apply isotonic regression to all key probabilities.
 */
async function applyIsotonicRegression(
  probs: Partial<CalibratedProbabilities>,
): Promise<Partial<CalibratedProbabilities>> {
  const [
    homeWin, draw, awayWin,
    over15, over25, over35,
    bttsYes,
  ] = await Promise.all([
    applyIsotonicCorrection('home_win', probs.homeWin!),
    applyIsotonicCorrection('draw', probs.draw!),
    applyIsotonicCorrection('away_win', probs.awayWin!),
    applyIsotonicCorrection('over_15', probs.over15!),
    applyIsotonicCorrection('over_25', probs.over25!),
    applyIsotonicCorrection('over_35', probs.over35!),
    applyIsotonicCorrection('btts_yes', probs.bttsYes!),
  ]);

  return {
    homeWin,
    draw,
    awayWin,
    over15,
    over25,
    over35,
    bttsYes,
    bttsNo: round4(1 - bttsYes),
  };
}

// ============================================================================
// Calibration Confidence
// ============================================================================
// How confident are we in the calibration itself?
// Based on: data completeness, number of isotonic samples, market confidence.
// ============================================================================

function computeCalibrationConfidence(
  features: FeatureVector,
  script: ScriptClassification,
): number {
  let confidence = 0.5;

  // Data completeness boost
  confidence += features.volatility.dataCompleteness * 0.15;

  // Market odds boost (external signal available)
  if (features.market.hasOdds) {
    confidence += 0.10 * features.market.oddsConfidence;
  }

  // Script confidence boost
  confidence += script.confidence * 0.10;

  // Low volatility boost (easier to calibrate)
  if (features.volatility.volatilityScore < 0.3) {
    confidence += 0.10;
  } else if (features.volatility.volatilityScore > 0.6) {
    confidence -= 0.10;
  }

  return clamp(confidence, 0.15, 0.95);
}

// ============================================================================
// MAIN: Calibrate Probabilities
// ============================================================================

/**
 * Apply the full 5-step calibration pipeline to raw Monte Carlo probabilities.
 *
 * Steps:
 *   1. Script micro-adjustments (max ±0.04)
 *   2. Polymarket blending (70/30 for 1X2, 60/40 for BTTS)
 *   3. Enforced invariants (probability constraints)
 *   4. Over 1.5 dampening (0.97 correction)
 *   5. Isotonic regression (bin-based historical correction)
 *
 * @param rawProbs  Raw Monte Carlo simulation results
 * @param script    Script classification for this match
 * @param features  Feature vector (needed for market blending)
 * @returns CalibratedProbabilities with all corrections applied
 */
export async function calibrateProbabilities(
  rawProbs: MonteCarloResult,
  script: ScriptClassification,
  features: FeatureVector,
): Promise<CalibratedProbabilities> {
  // ── Step 1: Script micro-adjustments ───────────────────────────────────
  const { probs: step1, adjustments: scriptAdjustments } = applyScriptAdjustments(rawProbs, script);

  // ── Step 2: Polymarket blending ────────────────────────────────────────
  const step2 = applyPolymarketBlend(step1, features);

  // ── Step 3: Enforced invariants ────────────────────────────────────────
  const step3 = enforceInvariants(step2, rawProbs);

  // ── Step 4: Over 1.5 dampening ─────────────────────────────────────────
  const step4 = applyOver15Dampening(step3);

  // ── Step 5: Isotonic regression (async — reads from DB) ───────────────
  const step5 = await applyIsotonicRegression(step4);

  // ── Final invariant enforcement (isotonic may have broken them) ────────
  const final = enforceInvariants(step5, rawProbs);

  // ── Calibration confidence ─────────────────────────────────────────────
  const calibrationConfidence = round4(
    computeCalibrationConfidence(features, script),
  );

  return {
    homeWin: final.homeWin!,
    draw: final.draw!,
    awayWin: final.awayWin!,
    over15: final.over15!,
    over25: final.over25!,
    over35: final.over35!,
    bttsYes: final.bttsYes!,
    bttsNo: final.bttsNo!,
    scriptAdjustments,
    calibrationConfidence,
  };
}

// ============================================================================
// Calibration Data Management (Learning Loop)
// ============================================================================
// Store and retrieve calibration bins per market for isotonic regression.
// Uses the libsql client for database operations.
// ============================================================================

/** Ensure the calibration_bins table exists */
async function ensureCalibrationTable(): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS calibration_bins (
      market_key TEXT NOT NULL,
      bin_lower REAL NOT NULL,
      bin_upper REAL NOT NULL,
      predicted_count INTEGER NOT NULL DEFAULT 0,
      actual_count INTEGER NOT NULL DEFAULT 0,
      actual_rate REAL NOT NULL DEFAULT 0.0,
      last_updated TEXT NOT NULL,
      PRIMARY KEY (market_key, bin_lower)
    )
  `);
}

/**
 * Update calibration data for a specific market after a match settles.
 *
 * Records the predicted probability and actual outcome, incrementing
 * the appropriate bin's counters. The actual_rate is recalculated
 * from the running totals.
 *
 * @param marketKey      The market identifier (e.g., 'home_win', 'over_25')
 * @param predictedProb  The probability our model predicted
 * @param actualOutcome  Whether the outcome actually occurred
 */
export async function updateCalibration(
  marketKey: string,
  predictedProb: number,
  actualOutcome: boolean,
): Promise<void> {
  try {
    await ensureCalibrationTable();

    // Determine which bin this prediction falls into
    const binWidth = CALIBRATION.binWidth; // 0.10
    const binLower = Math.floor(predictedProb / binWidth) * binWidth;
    const binUpper = binLower + binWidth;
    const now = new Date().toISOString();

    // Upsert the bin: increment predicted_count, conditionally increment actual_count
    // Use a transaction to ensure consistency
    await client.execute({
      sql: `
        INSERT INTO calibration_bins (market_key, bin_lower, bin_upper, predicted_count, actual_count, actual_rate, last_updated)
        VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(market_key, bin_lower) DO UPDATE SET
          predicted_count = predicted_count + 1,
          actual_count = actual_count + ?,
          actual_rate = CAST(actual_count + ? AS REAL) / CAST(predicted_count + 1 AS REAL),
          last_updated = ?
      `,
      args: [
        marketKey, binLower, binUpper,
        actualOutcome ? 1 : 0,
        actualOutcome ? 1.0 : 0.0,
        now,
        actualOutcome ? 1 : 0,
        actualOutcome ? 1 : 0,
        now,
      ],
    });
  } catch (error) {
    // Silently fail — calibration updates should not crash the pipeline
    console.error(`[calibration] Failed to update ${marketKey}:`, error);
  }
}

/**
 * Retrieve calibration data for a specific market.
 *
 * Returns all bins with sufficient data, the total sample count,
 * and a Brier score approximation for monitoring model performance.
 *
 * @param marketKey  The market identifier
 * @returns MarketCalibration or null if no data exists
 */
export async function getCalibrationData(
  marketKey: string,
): Promise<MarketCalibration | null> {
  try {
    await ensureCalibrationTable();

    const result = await client.execute({
      sql: `
        SELECT market_key, bin_lower, bin_upper, predicted_count, actual_count, actual_rate, last_updated
        FROM calibration_bins
        WHERE market_key = ?
        ORDER BY bin_lower ASC
      `,
      args: [marketKey],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const bins: CalibrationBin[] = result.rows.map((row) => ({
      lowerBound: row.bin_lower as number,
      upperBound: row.bin_upper as number,
      predictedCount: row.predicted_count as number,
      actualCount: row.actual_count as number,
      actualRate: row.actual_rate as number,
    }));

    const totalSamples = bins.reduce((sum, b) => sum + b.predictedCount, 0);

    // Approximate Brier score from binned data
    // Brier = (1/N) × Σ (predicted - actual)²
    // Using bins: Brier ≈ Σ (bin_count/N) × (bin_midpoint - actual_rate)²
    const binWidth = CALIBRATION.binWidth;
    let brierNumerator = 0;
    for (const bin of bins) {
      const midpoint = bin.lowerBound + binWidth / 2;
      const diff = midpoint - bin.actualRate;
      brierNumerator += bin.predictedCount * diff * diff;
    }
    const brierScore = totalSamples > 0 ? round4(brierNumerator / totalSamples) : 1.0;

    // Use the most recent last_updated from any bin
    const lastUpdated = (result.rows[result.rows.length - 1].last_updated as string) ??
      new Date().toISOString();

    return {
      marketKey,
      bins,
      totalSamples,
      brierScore,
      lastUpdated,
    };
  } catch (error) {
    console.error(`[calibration] Failed to get calibration for ${marketKey}:`, error);
    return null;
  }
}

// ============================================================================
// Batch Calibration Update (for learning loop efficiency)
// ============================================================================

/**
 * Update calibration for multiple markets at once after a fixture settles.
 *
 * @param updates  Array of {marketKey, predictedProb, actualOutcome}
 */
export async function batchUpdateCalibration(
  updates: Array<{ marketKey: string; predictedProb: number; actualOutcome: boolean }>,
): Promise<void> {
  await Promise.all(
    updates.map((u) => updateCalibration(u.marketKey, u.predictedProb, u.actualOutcome)),
  );
}

// ============================================================================
// Calibration Diagnostics
// ============================================================================

/**
 * Compute a calibration reliability diagram for a market.
 * Groups predictions into bins and compares predicted vs actual rates.
 * Returns bins sorted by predicted probability.
 */
export async function getCalibrationReliability(
  marketKey: string,
): Promise<Array<{ predicted: number; actual: number; count: number }>> {
  const data = await getCalibrationData(marketKey);
  if (!data) return [];

  const binWidth = CALIBRATION.binWidth;
  return data.bins
    .filter((b) => b.predictedCount >= 3) // minimum samples per bin
    .map((b) => ({
      predicted: round4(b.lowerBound + binWidth / 2),
      actual: round4(b.actualRate),
      count: b.predictedCount,
    }));
}
