// ============================================================================
// xG-Vantage V2 Engine — Closed Feedback Learning Loop
// ============================================================================
// The self-improving feedback loop that ScorePhantom DOESN'T have.
//
// After every match settles, this module:
//   1. Compares our prediction against the actual result
//   2. Computes Brier contribution and correctness
//   3. Records structured feedback in prediction_feedback
//   4. Updates per-market calibration bins (delegates to calibration.ts)
//   5. Tracks Brier scores per market
//   6. Aggregates performance across markets, tiers, and leagues
//   7. Adjusts ensemble model weights based on recent performance
//
// The loop is "closed" because feedback flows back into the model:
//   - Calibration bins → isotonic regression → better probabilities
//   - Model weight adjustments → different ensemble mix → better predictions
// ============================================================================

import type {
  LearningFeedback,
  ModelPerformance,
  FixtureRow,
  V2Prediction,
  MarketKey,
  MatchScript,
} from './types';
import { LEARNING_PARAMS, DEFAULT_MODEL_WEIGHTS, ENGINE_VERSION } from './constants';
import { client } from '../../lib/db-turso';
import { updateCalibration } from './calibration';

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
// Table Management
// ============================================================================

/** Ensure the prediction_feedback table exists */
async function ensureFeedbackTable(): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS prediction_feedback (
      fixture_id INTEGER NOT NULL,
      was_correct INTEGER NOT NULL,
      pick_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      actual_result TEXT NOT NULL,
      predicted_prob REAL NOT NULL,
      market_key TEXT NOT NULL,
      brier_contribution REAL NOT NULL,
      settled_at TEXT NOT NULL,
      PRIMARY KEY (fixture_id)
    )
  `);
}

/** Ensure the brier_scores table exists */
async function ensureBrierTable(): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS brier_scores (
      market_key TEXT NOT NULL PRIMARY KEY,
      total_brier REAL NOT NULL DEFAULT 0.0,
      count INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    )
  `);
}

/** Ensure the model_weights table exists */
async function ensureModelWeightsTable(): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS model_weights (
      model_name TEXT NOT NULL PRIMARY KEY,
      weight REAL NOT NULL,
      last_adjusted TEXT NOT NULL,
      adjustment_reason TEXT NOT NULL DEFAULT ''
    )
  `);
}

/** Ensure the predictions table has the columns we need */
async function ensurePredictionsTable(): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS predictions (
      id TEXT PRIMARY KEY,
      fixture_id INTEGER NOT NULL,
      home_team_id INTEGER NOT NULL,
      away_team_id INTEGER NOT NULL,
      league_id INTEGER NOT NULL,
      pick_market TEXT NOT NULL DEFAULT '',
      pick_selection TEXT NOT NULL DEFAULT '',
      predicted_prob REAL NOT NULL DEFAULT 0.0,
      confidence REAL NOT NULL DEFAULT 0.0,
      tier TEXT NOT NULL DEFAULT 'medium',
      risk_class TEXT NOT NULL DEFAULT 'MODERATE',
      engine_version TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      settled INTEGER NOT NULL DEFAULT 0
    )
  `);
}

/** Initialize model weights from defaults if table is empty */
async function ensureDefaultWeights(): Promise<void> {
  await ensureModelWeightsTable();

  const result = await client.execute('SELECT COUNT(*) as cnt FROM model_weights');
  const count = (result.rows[0]?.cnt as number) ?? 0;

  if (count === 0) {
    const now = new Date().toISOString();
    for (const [name, weight] of Object.entries(DEFAULT_MODEL_WEIGHTS)) {
      await client.execute({
        sql: `INSERT INTO model_weights (model_name, weight, last_adjusted, adjustment_reason)
              VALUES (?, ?, ?, ?)`,
        args: [name, weight, now, 'initial_default'],
      });
    }
  }
}

// ============================================================================
// Outcome Determination
// ============================================================================

/**
 * Determine the actual outcome for a given market based on the final score.
 * Returns `true` if the predicted outcome actually occurred.
 */
function resolveMarketOutcome(
  marketKey: string,
  homeScore: number,
  awayScore: number,
): boolean {
  const totalGoals = homeScore + awayScore;

  switch (marketKey) {
    // ── 1X2 ──────────────────────────────────────────────────────────────
    case 'home_win':
      return homeScore > awayScore;
    case 'draw':
      return homeScore === awayScore;
    case 'away_win':
      return awayScore > homeScore;

    // ── Over markets ─────────────────────────────────────────────────────
    case 'over_15':
      return totalGoals > 1.5;
    case 'over_25':
      return totalGoals > 2.5;
    case 'over_35':
      return totalGoals > 3.5;

    // ── Under markets ────────────────────────────────────────────────────
    case 'under_15':
      return totalGoals < 1.5;
    case 'under_25':
      return totalGoals < 2.5;
    case 'under_35':
      return totalGoals < 3.5;

    // ── BTTS ─────────────────────────────────────────────────────────────
    case 'btts_yes':
      return homeScore > 0 && awayScore > 0;
    case 'btts_no':
      return homeScore === 0 || awayScore === 0;

    // ── Double chance ────────────────────────────────────────────────────
    case 'double_chance_home':
      return homeScore >= awayScore;
    case 'double_chance_away':
      return awayScore >= homeScore;
    case 'double_chance_no_draw':
      return homeScore !== awayScore;

    // ── Draw No Bet ──────────────────────────────────────────────────────
    case 'dnb_home':
      return homeScore > awayScore; // draw = void, but we count as not-correct
    case 'dnb_away':
      return awayScore > homeScore;

    // ── Player-level over markets ────────────────────────────────────────
    case 'home_over_05':
      return homeScore > 0.5;
    case 'away_over_05':
      return awayScore > 0.5;
    case 'home_over_15':
      return homeScore > 1.5;
    case 'away_over_15':
      return awayScore > 1.5;

    // ── Handicap markets ─────────────────────────────────────────────────
    case 'handicap_home_-1':
      return (homeScore - 1) > awayScore; // home wins by 2+
    case 'handicap_away_-1':
      return (awayScore - 1) > homeScore; // away wins by 2+
    case 'handicap_home_+1':
      return (homeScore + 1) > awayScore; // home+1 wins or draws
    case 'handicap_away_+1':
      return (awayScore + 1) > homeScore; // away+1 wins or draws

    default:
      // Unknown market — conservatively return false
      console.warn(`[learning-loop] Unknown market key: ${marketKey}`);
      return false;
  }
}

/**
 * Produce a human-readable actual result string from the score.
 */
function formatActualResult(
  marketKey: string,
  homeScore: number,
  awayScore: number,
): string {
  const outcome = resolveMarketOutcome(marketKey, homeScore, awayScore);
  return `${homeScore}-${awayScore} | ${marketKey}=${outcome ? 'WIN' : 'LOSS'}`;
}

// ============================================================================
// settlePrediction
// ============================================================================

/**
 * Check a settled match result against our prediction, record feedback.
 *
 * 1. Fetch prediction from DB
 * 2. Fetch fixture result
 * 3. Determine correctness and Brier contribution
 * 4. Store feedback in prediction_feedback
 * 5. Update calibration bins
 * 6. Update Brier score tracking
 * 7. Mark prediction as settled
 *
 * @param fixtureId  The fixture ID to settle
 * @returns LearningFeedback or null if no prediction/result available
 */
export async function settlePrediction(
  fixtureId: number,
): Promise<LearningFeedback | null> {
  try {
    await ensurePredictionsTable();
    await ensureFeedbackTable();

    // ── 1. Get prediction from DB ─────────────────────────────────────────
    const predResult = await client.execute({
      sql: `SELECT fixture_id, pick_market, pick_selection, predicted_prob,
                   confidence, tier, risk_class
            FROM predictions
            WHERE fixture_id = ? AND settled = 0`,
      args: [fixtureId],
    });

    if (predResult.rows.length === 0) {
      return null; // No unsettled prediction for this fixture
    }

    const pred = predResult.rows[0];
    const marketKey = pred.pick_market as string;
    const predictedProb = pred.predicted_prob as number;
    const confidence = pred.confidence as number;
    const pickType = pred.tier as string;

    // ── 2. Get fixture result ──────────────────────────────────────────────
    const fixtureResult = await client.execute({
      sql: `SELECT id, home_score, away_score, match_status
            FROM fixtures
            WHERE id = ?`,
      args: [fixtureId],
    });

    if (fixtureResult.rows.length === 0) {
      return null; // Fixture not found
    }

    const fixture = fixtureResult.rows[0];
    const homeScore = fixture.home_score as number | null;
    const awayScore = fixture.away_score as number | null;

    // Match must be finished with scores available
    if (homeScore === null || awayScore === null) {
      return null;
    }

    // ── 3. Determine correctness ───────────────────────────────────────────
    const wasCorrect = resolveMarketOutcome(marketKey, homeScore, awayScore);
    const actualOutcome = wasCorrect ? 1 : 0;

    // ── 4. Compute Brier contribution ──────────────────────────────────────
    const brierContribution = round4(
      (predictedProb - actualOutcome) ** 2,
    );

    const actualResult = formatActualResult(marketKey, homeScore, awayScore);

    // ── 5. Store feedback ──────────────────────────────────────────────────
    const now = new Date().toISOString();

    await client.execute({
      sql: `INSERT INTO prediction_feedback
              (fixture_id, was_correct, pick_type, confidence, actual_result,
               predicted_prob, market_key, brier_contribution, settled_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fixture_id) DO UPDATE SET
              was_correct = excluded.was_correct,
              pick_type = excluded.pick_type,
              confidence = excluded.confidence,
              actual_result = excluded.actual_result,
              predicted_prob = excluded.predicted_prob,
              market_key = excluded.market_key,
              brier_contribution = excluded.brier_contribution,
              settled_at = excluded.settled_at`,
      args: [
        fixtureId,
        wasCorrect ? 1 : 0,
        pickType,
        confidence,
        actualResult,
        predictedProb,
        marketKey,
        brierContribution,
        now,
      ],
    });

    // ── 6. Update calibration bins ─────────────────────────────────────────
    await updateCalibration(marketKey, predictedProb, wasCorrect);

    // ── 7. Update Brier score tracking ─────────────────────────────────────
    await updateBrierScore(marketKey, predictedProb, actualOutcome);

    // ── 8. Mark prediction as settled ───────────────────────────────────────
    await client.execute({
      sql: `UPDATE predictions SET settled = 1 WHERE fixture_id = ?`,
      args: [fixtureId],
    });

    return {
      fixtureId,
      wasCorrect,
      pickType,
      confidence,
      actualResult,
      predictedProb,
      marketKey,
      brierContribution,
    };
  } catch (error) {
    console.error(`[learning-loop] Failed to settle prediction for fixture ${fixtureId}:`, error);
    return null;
  }
}

// ============================================================================
// settleAllPending
// ============================================================================

/**
 * Batch settle all unsettled predictions whose fixtures have finished.
 *
 * @returns Count of successfully settled and failed settlements
 */
export async function settleAllPending(): Promise<{ settled: number; failed: number }> {
  try {
    await ensurePredictionsTable();

    // Find all unsettled predictions
    const pendingResult = await client.execute({
      sql: `SELECT p.fixture_id
            FROM predictions p
            INNER JOIN fixtures f ON p.fixture_id = f.id
            WHERE p.settled = 0
              AND f.home_score IS NOT NULL
              AND f.away_score IS NOT NULL`,
      args: [],
    });

    let settled = 0;
    let failed = 0;

    for (const row of pendingResult.rows) {
      const fixtureId = row.fixture_id as number;
      try {
        const result = await settlePrediction(fixtureId);
        if (result) {
          settled++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    console.log(`[learning-loop] Batch settle complete: ${settled} settled, ${failed} failed`);
    return { settled, failed };
  } catch (error) {
    console.error('[learning-loop] Failed to batch settle:', error);
    return { settled: 0, failed: 0 };
  }
}

// ============================================================================
// getModelPerformance
// ============================================================================

/**
 * Get current model accuracy metrics aggregated from prediction_feedback.
 *
 * Computes:
 *   - Overall accuracy and Brier score
 *   - Breakdown by market, tier, and league
 *   - Calibration drift (how much predicted probs differ from actual rates)
 *
 * @returns ModelPerformance with all aggregated metrics
 */
export async function getModelPerformance(): Promise<ModelPerformance> {
  try {
    await ensureFeedbackTable();

    // ── Overall accuracy ───────────────────────────────────────────────────
    const overallResult = await client.execute(`
      SELECT
        COUNT(*) as total,
        SUM(was_correct) as correct,
        AVG(brier_contribution) as avg_brier
      FROM prediction_feedback
    `);

    const total = (overallResult.rows[0]?.total as number) ?? 0;
    const correct = (overallResult.rows[0]?.correct as number) ?? 0;
    const overallBrier = (overallResult.rows[0]?.avg_brier as number) ?? 1.0;
    const overallAccuracy = total > 0 ? round4(correct / total) : 0;

    // ── By market ──────────────────────────────────────────────────────────
    const marketResult = await client.execute(`
      SELECT
        market_key,
        COUNT(*) as cnt,
        SUM(was_correct) as correct,
        AVG(brier_contribution) as avg_brier
      FROM prediction_feedback
      GROUP BY market_key
    `);

    const byMarket: Record<string, { accuracy: number; brier: number; count: number }> = {};
    for (const row of marketResult.rows) {
      const key = row.market_key as string;
      const cnt = row.cnt as number;
      const corr = row.correct as number;
      const brier = row.avg_brier as number;
      byMarket[key] = {
        accuracy: cnt > 0 ? round4(corr / cnt) : 0,
        brier: round4(brier),
        count: cnt,
      };
    }

    // ── By tier ────────────────────────────────────────────────────────────
    const tierResult = await client.execute(`
      SELECT
        pick_type as tier,
        COUNT(*) as cnt,
        SUM(was_correct) as correct
      FROM prediction_feedback
      GROUP BY pick_type
    `);

    const byTier: Record<string, { accuracy: number; count: number }> = {};
    for (const row of tierResult.rows) {
      const tier = row.tier as string;
      const cnt = row.cnt as number;
      const corr = row.correct as number;
      byTier[tier] = {
        accuracy: cnt > 0 ? round4(corr / cnt) : 0,
        count: cnt,
      };
    }

    // ── By league ──────────────────────────────────────────────────────────
    const leagueResult = await client.execute(`
      SELECT
        f.league_id,
        COUNT(*) as cnt,
        SUM(pf.was_correct) as correct
      FROM prediction_feedback pf
      INNER JOIN fixtures f ON pf.fixture_id = f.id
      GROUP BY f.league_id
    `);

    const byLeague: Record<string, { accuracy: number; count: number }> = {};
    for (const row of leagueResult.rows) {
      const leagueId = String(row.league_id ?? 'unknown');
      const cnt = row.cnt as number;
      const corr = row.correct as number;
      byLeague[leagueId] = {
        accuracy: cnt > 0 ? round4(corr / cnt) : 0,
        count: cnt,
      };
    }

    // ── Calibration drift ──────────────────────────────────────────────────
    // Drift = average absolute difference between predicted probability and
    // actual hit rate. We compute this by binning predictions.
    const driftResult = await client.execute(`
      SELECT
        predicted_prob,
        was_correct
      FROM prediction_feedback
      ORDER BY predicted_prob
    `);

    let calibrationDrift = 0;
    if (driftResult.rows.length > 0) {
      // Bin predictions into 0.10-wide buckets and compare predicted vs actual
      const bins: Record<string, { sumPredicted: number; correct: number; count: number }> = {};

      for (const row of driftResult.rows) {
        const predProb = row.predicted_prob as number;
        const wasCorrect = row.was_correct as number;
        const binKey = String(Math.floor(predProb * 10));

        if (!bins[binKey]) {
          bins[binKey] = { sumPredicted: 0, correct: 0, count: 0 };
        }
        bins[binKey].sumPredicted += predProb;
        bins[binKey].correct += wasCorrect;
        bins[binKey].count += 1;
      }

      let totalDrift = 0;
      let binCount = 0;
      for (const bin of Object.values(bins)) {
        const avgPredicted = bin.sumPredicted / bin.count;
        const actualRate = bin.correct / bin.count;
        totalDrift += Math.abs(avgPredicted - actualRate);
        binCount++;
      }

      calibrationDrift = binCount > 0 ? round4(totalDrift / binCount) : 0;
    }

    // ── Last retrained ─────────────────────────────────────────────────────
    const lastAdjustedResult = await client.execute(
      `SELECT MAX(last_adjusted) as last_adj FROM model_weights`
    );
    const lastRetrained = (lastAdjustedResult.rows[0]?.last_adj as string)
      ?? new Date().toISOString();

    return {
      overallAccuracy,
      overallBrier: round4(overallBrier),
      byMarket,
      byTier,
      byLeague,
      calibrationDrift,
      lastRetrained,
      totalSettled: total,
    };
  } catch (error) {
    console.error('[learning-loop] Failed to get model performance:', error);
    // Return safe defaults on failure
    return {
      overallAccuracy: 0,
      overallBrier: 1.0,
      byMarket: {},
      byTier: {},
      byLeague: {},
      calibrationDrift: 1.0,
      lastRetrained: new Date().toISOString(),
      totalSettled: 0,
    };
  }
}

// ============================================================================
// adjustModelWeights
// ============================================================================

/**
 * Adjust ensemble model weights based on recent performance.
 *
 * Learning rules (from LEARNING_PARAMS):
 *   - If overall accuracy < 45%: decrease Poisson weight, increase ELO + Context
 *   - If overall accuracy > 60%: slightly increase Poisson
 *   - If specific market Brier is high: adjust weights for that market
 *   - Apply weight decay toward equal distribution (0.995 factor)
 *
 * After adjustment, weights are normalised to sum to 1.0 and persisted.
 */
export async function adjustModelWeights(): Promise<void> {
  try {
    await ensureModelWeightsTable();
    await ensureDefaultWeights();

    // ── 1. Get current performance ─────────────────────────────────────────
    const performance = await getModelPerformance();

    if (performance.totalSettled < LEARNING_PARAMS.minSettledForRetrain) {
      console.log(
        `[learning-loop] Not enough settled predictions to adjust weights ` +
        `(${performance.totalSettled}/${LEARNING_PARAMS.minSettledForRetrain})`
      );
      return;
    }

    // ── 2. Get current weights from DB ─────────────────────────────────────
    const weightsResult = await client.execute(
      `SELECT model_name, weight FROM model_weights`
    );

    const weights: Record<string, number> = {};
    for (const row of weightsResult.rows) {
      weights[row.model_name as string] = row.weight as number;
    }

    const lr = LEARNING_PARAMS.learningRate; // 0.02
    const decay = LEARNING_PARAMS.weightDecay; // 0.995
    const equalWeight = 1 / Object.keys(DEFAULT_MODEL_WEIGHTS).length;
    const adjustments: string[] = [];

    // ── 3. Apply learning rules ────────────────────────────────────────────

    // Rule 1: Poor overall accuracy → decrease Poisson, increase ELO + Context
    if (performance.overallAccuracy < 0.45) {
      if (weights['poisson_xg'] !== undefined) {
        weights['poisson_xg'] -= lr * 2;
        adjustments.push(`poisson_xg -${round4(lr * 2)} (low accuracy)`);
      }
      if (weights['bayesian_elo'] !== undefined) {
        weights['bayesian_elo'] += lr;
        adjustments.push(`bayesian_elo +${lr} (low accuracy)`);
      }
      if (weights['context_model'] !== undefined) {
        weights['context_model'] += lr;
        adjustments.push(`context_model +${lr} (low accuracy)`);
      }
    }

    // Rule 2: Good overall accuracy → increase Poisson slightly
    if (performance.overallAccuracy > 0.60) {
      if (weights['poisson_xg'] !== undefined) {
        weights['poisson_xg'] += lr * 0.5;
        adjustments.push(`poisson_xg +${round4(lr * 0.5)} (high accuracy)`);
      }
    }

    // Rule 3: High Brier in specific markets → adjust specialised models
    // Over/Under markets with high Brier → adjust Poisson and form_momentum
    const goalMarkets = ['over_15', 'over_25', 'over_35', 'under_15', 'under_25', 'under_35'];
    let goalBrierSum = 0;
    let goalBrierCount = 0;
    for (const mk of goalMarkets) {
      const marketPerf = performance.byMarket[mk];
      if (marketPerf && marketPerf.count >= 10) {
        goalBrierSum += marketPerf.brier;
        goalBrierCount++;
      }
    }
    const avgGoalBrier = goalBrierCount > 0 ? goalBrierSum / goalBrierCount : 0;

    if (avgGoalBrier > 0.25 && weights['poisson_xg'] !== undefined) {
      // Goals markets have high Brier → reduce reliance on Poisson, boost form
      weights['poisson_xg'] -= lr;
      weights['form_momentum'] += lr * 0.5;
      adjustments.push(`poisson_xg -${lr}, form_momentum +${round4(lr * 0.5)} (high goal Brier)`);
    }

    // 1X2 markets with high Brier → adjust ELO and style_matchup
    const x12Markets = ['home_win', 'draw', 'away_win'];
    let x12BrierSum = 0;
    let x12BrierCount = 0;
    for (const mk of x12Markets) {
      const marketPerf = performance.byMarket[mk];
      if (marketPerf && marketPerf.count >= 10) {
        x12BrierSum += marketPerf.brier;
        x12BrierCount++;
      }
    }
    const avgX12Brier = x12BrierCount > 0 ? x12BrierSum / x12BrierCount : 0;

    if (avgX12Brier > 0.25 && weights['style_matchup'] !== undefined) {
      weights['style_matchup'] += lr * 0.5;
      adjustments.push(`style_matchup +${round4(lr * 0.5)} (high 1X2 Brier)`);
    }

    // Rule 4: Weight decay toward equal distribution
    for (const key of Object.keys(weights)) {
      weights[key] = weights[key] * decay + equalWeight * (1 - decay);
    }
    adjustments.push(`decay toward equal (factor ${decay})`);

    // ── 4. Normalise weights to sum to 1.0 ─────────────────────────────────
    let totalWeight = 0;
    for (const key of Object.keys(weights)) {
      weights[key] = clamp(weights[key], 0.01, 0.80); // no weight below 1% or above 80%
      totalWeight += weights[key];
    }

    if (totalWeight > 0) {
      for (const key of Object.keys(weights)) {
        weights[key] = round4(weights[key] / totalWeight);
      }
    }

    // Fix rounding: ensure sum = 1.0 exactly
    let finalSum = 0;
    for (const key of Object.keys(weights)) {
      finalSum += weights[key];
    }
    const roundingError = round4(1.0 - finalSum);
    if (roundingError !== 0 && Object.keys(weights).length > 0) {
      // Apply rounding correction to the largest weight
      const largestKey = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
      weights[largestKey] = round4(weights[largestKey] + roundingError);
    }

    // ── 5. Store updated weights ───────────────────────────────────────────
    const now = new Date().toISOString();
    const reason = adjustments.join('; ');

    for (const [name, weight] of Object.entries(weights)) {
      await client.execute({
        sql: `UPDATE model_weights
              SET weight = ?, last_adjusted = ?, adjustment_reason = ?
              WHERE model_name = ?`,
        args: [weight, now, reason, name],
      });
    }

    console.log(`[learning-loop] Weights adjusted: ${reason}`);
  } catch (error) {
    console.error('[learning-loop] Failed to adjust model weights:', error);
  }
}

// ============================================================================
// updateBrierScore
// ============================================================================

/**
 * Update Brier score tracking per market.
 *
 * Brier score = average of (predicted - actual)² across all predictions.
 * This tracks running totals so we can compute the rolling average.
 *
 * @param marketKey  The market identifier
 * @param predicted  The predicted probability (0-1)
 * @param actual     The actual outcome (0 or 1)
 */
export async function updateBrierScore(
  marketKey: string,
  predicted: number,
  actual: number,
): Promise<void> {
  try {
    await ensureBrierTable();

    const brierContrib = (predicted - actual) ** 2;
    const now = new Date().toISOString();

    // Apply decay to older contributions
    // Instead of storing raw total, we apply brierDecay to existing total
    // This gives exponential weighting toward recent predictions
    const existingResult = await client.execute({
      sql: `SELECT total_brier, count FROM brier_scores WHERE market_key = ?`,
      args: [marketKey],
    });

    if (existingResult.rows.length > 0) {
      const oldTotal = existingResult.rows[0].total_brier as number;
      const oldCount = existingResult.rows[0].count as number;

      // Apply exponential decay to existing data
      const decayedTotal = oldTotal * LEARNING_PARAMS.brierDecay;
      const decayedCount = Math.floor(oldCount * LEARNING_PARAMS.brierDecay);

      const newTotal = decayedTotal + brierContrib;
      const newCount = decayedCount + 1;

      await client.execute({
        sql: `UPDATE brier_scores
              SET total_brier = ?, count = ?, last_updated = ?
              WHERE market_key = ?`,
        args: [round4(newTotal), newCount, now, marketKey],
      });
    } else {
      // First entry for this market
      await client.execute({
        sql: `INSERT INTO brier_scores (market_key, total_brier, count, last_updated)
              VALUES (?, ?, ?, ?)`,
        args: [marketKey, round4(brierContrib), 1, now],
      });
    }
  } catch (error) {
    console.error(`[learning-loop] Failed to update Brier score for ${marketKey}:`, error);
  }
}

// ============================================================================
// Utility: Get Current Model Weights
// ============================================================================

/**
 * Retrieve the current model weights from the database.
 * Falls back to DEFAULT_MODEL_WEIGHTS if the table is empty or missing.
 */
export async function getModelWeights(): Promise<Record<string, number>> {
  try {
    await ensureModelWeightsTable();
    await ensureDefaultWeights();

    const result = await client.execute(
      `SELECT model_name, weight FROM model_weights`
    );

    if (result.rows.length === 0) {
      return { ...DEFAULT_MODEL_WEIGHTS };
    }

    const weights: Record<string, number> = {};
    for (const row of result.rows) {
      weights[row.model_name as string] = row.weight as number;
    }

    return weights;
  } catch {
    return { ...DEFAULT_MODEL_WEIGHTS };
  }
}

// ============================================================================
// Utility: Get Brier Score for a Market
// ============================================================================

/**
 * Get the current Brier score for a specific market.
 * Returns null if no data exists.
 */
export async function getBrierScore(
  marketKey: string,
): Promise<{ brier: number; count: number } | null> {
  try {
    await ensureBrierTable();

    const result = await client.execute({
      sql: `SELECT total_brier, count FROM brier_scores WHERE market_key = ?`,
      args: [marketKey],
    });

    if (result.rows.length === 0) return null;

    const totalBrier = result.rows[0].total_brier as number;
    const count = result.rows[0].count as number;

    return {
      brier: count > 0 ? round4(totalBrier / count) : 1.0,
      count,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Utility: Get Recent Feedback for a Fixture
// ============================================================================

/**
 * Retrieve the feedback record for a specific fixture, if settled.
 */
export async function getFeedback(
  fixtureId: number,
): Promise<LearningFeedback | null> {
  try {
    await ensureFeedbackTable();

    const result = await client.execute({
      sql: `SELECT fixture_id, was_correct, pick_type, confidence,
                   actual_result, predicted_prob, market_key, brier_contribution
            FROM prediction_feedback
            WHERE fixture_id = ?`,
      args: [fixtureId],
    });

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      fixtureId: row.fixture_id as number,
      wasCorrect: (row.was_correct as number) === 1,
      pickType: row.pick_type as string,
      confidence: row.confidence as number,
      actualResult: row.actual_result as string,
      predictedProb: row.predicted_prob as number,
      marketKey: row.market_key as string,
      brierContribution: row.brier_contribution as number,
    };
  } catch {
    return null;
  }
}
