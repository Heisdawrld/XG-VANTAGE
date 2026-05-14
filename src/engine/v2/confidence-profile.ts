// ============================================================================
// xG-Vantage V2 Engine — 3-Axis Confidence Profiler
// ============================================================================
// Produces a ConfidenceProfile with three orthogonal confidence axes:
//   1. Model Confidence  — how reliable is the prediction itself
//   2. Value Confidence   — how good is the value edge
//   3. Volatility         — how stable / predictable the match is
//
// Each axis is classified into discrete levels. A composite score (0-100)
// is derived from weighted contributions of all three axes. Downgrade
// penalties are tracked for full transparency and audit logging.
// ============================================================================

import type {
  MarketSelection,
  FeatureVector,
  XgEstimate,
  ConfidenceProfile,
  ModelConfidence,
  ValueConfidence,
  VolatilityLevel,
} from './types';

// ============================================================================
// Internal Helpers
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================================
// Axis 1: Model Confidence
// ============================================================================
// Based on the best market candidate's probability, data completeness,
// and enrichment tier. Penalties downgrade the level when specific
// conditions are met.
//
// Levels:
//   high   (≥68%): strong model probability, good data
//   medium (≥55%): moderate probability, decent data
//   lean   (≥44%): weak probability or thin data
//   low    (<44%): very weak or very thin

function computeModelConfidence(
  marketSelection: MarketSelection,
  features: FeatureVector,
  xg: XgEstimate,
  downgrades: string[],
): ModelConfidence {
  // ── Base probability from best pick ────────────────────────────────────
  const bestPick = marketSelection.bestPick;
  const baseProb = bestPick ? bestPick.probability : 0;
  const dataCompleteness = features.volatility.dataCompleteness;
  const enrichmentTier = features.volatility.enrichmentTier;

  // Weighted composite of probability + data quality
  // Probability counts 60%, data completeness 40%
  const rawScore = baseProb * 0.60 + dataCompleteness * 0.40;

  // ── Determine initial level ────────────────────────────────────────────
  let level: ModelConfidence;
  if (rawScore >= 0.68) {
    level = 'high';
  } else if (rawScore >= 0.55) {
    level = 'medium';
  } else if (rawScore >= 0.44) {
    level = 'lean';
  } else {
    level = 'low';
  }

  // ── Penalty: Thin enrichment → force lean ──────────────────────────────
  if (enrichmentTier === 'thin' && level !== 'low') {
    if (level === 'high' || level === 'medium') {
      downgrades.push(`Thin enrichment (${enrichmentTier}): ${level} → lean`);
      level = 'lean';
    }
  }

  // ── Penalty: Missing lineup → high→medium ─────────────────────────────
  if (!features.lineup.hasLineupData && level === 'high') {
    downgrades.push('Missing lineup data: high → medium');
    level = 'medium';
  }

  // ── Penalty: Low motivation → high→medium ─────────────────────────────
  const homeMotivation = features.context.homeMotivationScore;
  const awayMotivation = features.context.awayMotivationScore;
  const avgMotivation = (homeMotivation + awayMotivation) / 2;

  if (avgMotivation < 0.40 && level === 'high') {
    downgrades.push(`Low motivation (${round2(avgMotivation)}): high → medium`);
    level = 'medium';
  }

  // ── Penalty: High variance → high/medium→lean ─────────────────────────
  const avgFormVariance = (features.volatility.homeFormVariance + features.volatility.awayFormVariance) / 2;
  if (avgFormVariance > 2.0 && (level === 'high' || level === 'medium')) {
    const prev = level;
    level = 'lean';
    downgrades.push(`High form variance (${round2(avgFormVariance)}): ${prev} → lean`);
  }

  // ── Penalty: Low xG confidence from estimator ─────────────────────────
  if (xg.confidence < 0.35 && level !== 'low') {
    const prev = level;
    level = 'lean';
    downgrades.push(`Low xG confidence (${round2(xg.confidence)}): ${prev} → lean`);
  }

  return level;
}

// ============================================================================
// Axis 2: Value Confidence
// ============================================================================
// Based on the edge between our model probability and the implied
// probability from bookmaker odds. When no odds are available, we
// fall back to the absolute model probability as a proxy.
//
// Levels:
//   high   (>12% edge): strong value detected
//   medium (>6%):       decent value
//   low    (<6%):       minimal value

function computeValueConfidence(
  marketSelection: MarketSelection,
  features: FeatureVector,
  downgrades: string[],
): ValueConfidence {
  const bestPick = marketSelection.bestPick;
  const edge = bestPick ? bestPick.edge : 0;

  // If we have actual odds, use edge directly
  if (features.market.hasOdds) {
    if (edge > 0.12) return 'high';
    if (edge > 0.06) return 'medium';
    return 'low';
  }

  // Without odds, use probability as a proxy for value
  // Higher probability markets still carry implicit value
  const probability = bestPick ? bestPick.probability : 0;

  // Proxy thresholds (slightly relaxed since we lack real odds)
  if (probability > 0.72) return 'high';
  if (probability > 0.58) return 'medium';
  return 'low';
}

// ============================================================================
// Axis 3: Volatility
// ============================================================================
// Based on the match chaos score and composite volatility from the
// feature vector. Represents how unpredictable the match is.
//
// Levels:
//   low    (<35% chaos): stable, predictable match
//   medium (<60%):        some uncertainty
//   high   (≥60%):        very uncertain

function computeVolatility(
  features: FeatureVector,
  downgrades: string[],
): VolatilityLevel {
  const chaos = features.volatility.matchChaos;
  const volatilityScore = features.volatility.volatilityScore;

  // Blend chaos and volatility score (chaos weighted more)
  const composite = chaos * 0.60 + volatilityScore * 0.40;

  if (composite >= 0.60) return 'high';
  if (composite >= 0.35) return 'medium';
  return 'low';
}

// ============================================================================
// Numeric Mapping (for composite score calculation)
// ============================================================================

function modelConfidenceToNumeric(level: ModelConfidence): number {
  switch (level) {
    case 'high':   return 0.85;
    case 'medium': return 0.65;
    case 'lean':   return 0.45;
    case 'low':    return 0.25;
  }
}

function valueConfidenceToNumeric(level: ValueConfidence): number {
  switch (level) {
    case 'high':   return 0.85;
    case 'medium': return 0.60;
    case 'low':    return 0.25;
  }
}

function volatilityToNumeric(level: VolatilityLevel): number {
  // Inverted: low volatility = high confidence
  switch (level) {
    case 'low':    return 0.85;  // stable → contributes positively
    case 'medium': return 0.55;
    case 'high':   return 0.20;  // chaotic → drags composite down
  }
}

// ============================================================================
// Composite Score
// ============================================================================
// 50% model confidence + 25% value confidence + 25% volatility (inverted)
// Result is on a 0-100 scale.

function computeCompositeScore(
  model: ModelConfidence,
  value: ValueConfidence,
  volatility: VolatilityLevel,
): number {
  const modelNum = modelConfidenceToNumeric(model);
  const valueNum = valueConfidenceToNumeric(value);
  const volNum = volatilityToNumeric(volatility);

  const raw = modelNum * 0.50 + valueNum * 0.25 + volNum * 0.25;
  return Math.round(clamp(raw * 100, 0, 100));
}

// ============================================================================
// MAIN: Build Confidence Profile
// ============================================================================

/**
 * Build a 3-axis confidence profile for a prediction.
 *
 * Axes:
 *   1. Model Confidence  — how reliable is the prediction (high/medium/lean/low)
 *   2. Value Confidence   — how good is the value edge (high/medium/low)
 *   3. Volatility         — how stable the match is (low/medium/high)
 *
 * Composite score (0-100) = 50% model + 25% value + 25% volatility (inverted)
 *
 * All applied downgrades are tracked for transparency.
 *
 * @param marketSelection  The market selection result from market-selector
 * @param features         The full feature vector for this fixture
 * @param xg               The xG estimate from the xg-estimator
 * @returns ConfidenceProfile with all three axes, composite, and downgrades
 */
export function buildConfidenceProfile(
  marketSelection: MarketSelection,
  features: FeatureVector,
  xg: XgEstimate,
): ConfidenceProfile {
  const downgrades: string[] = [];

  // ── Compute each axis ──────────────────────────────────────────────────
  const model = computeModelConfidence(marketSelection, features, xg, downgrades);
  const value = computeValueConfidence(marketSelection, features, downgrades);
  const volatility = computeVolatility(features, downgrades);

  // ── Compute composite ──────────────────────────────────────────────────
  const composite = computeCompositeScore(model, value, volatility);

  return {
    model,
    value,
    volatility,
    composite,
    downgrades,
  };
}
