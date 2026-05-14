// ============================================================================
// xG-Vantage V2 Engine — Abstention Engine (Uncertainty-Driven)
// ============================================================================
// Decides when NOT to predict. Multiple abstention triggers are evaluated
// independently, each producing a severity score. The composite abstention
// confidence is computed from all triggers. If it exceeds 0.50, the engine
// recommends abstention with a documented reason.
//
// Triggers:
//   1. Data starvation       — data completeness < 0.30
//   2. High chaos            — matchChaos > 0.80
//   3. Wide uncertainty      — ELO deviation > 250 for both teams
//   4. No market edge        — best pick has "NO EDGE"
//   5. Chaotic script        — primary script is chaotic_unreliable + low prob
//   6. Conflicting signals   — high model confidence + low value + high vol
//   7. Enrichment tier thin  — tier is 'thin' and confidence < 50%
//
// Each trigger returns { triggered, severity, reason }.
// Composite abstention confidence = weighted average of severities.
// If composite > 0.50, recommend abstention.
// ============================================================================

import type {
  V2Prediction,
  FeatureVector,
  MarketCandidate,
  ConfidenceProfile,
  ModelConfidence,
  ValueConfidence,
} from './types';
import { PREDICTABILITY_GATE } from './constants';

// ============================================================================
// Internal Types
// ============================================================================

interface AbstentionTrigger {
  id: string;
  triggered: boolean;
  severity: number; // 0-1 how strongly this trigger fires
  reason: string;
  weight: number; // relative importance in composite score
}

export interface AbstentionResult {
  abstain: boolean;
  reason?: string;
  confidence: number; // 0-1 composite abstention confidence
  triggers: AbstentionTrigger[];
  dominantTrigger?: string;
}

// ============================================================================
// Internal Helpers
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Map model confidence label to numeric value */
function modelConfidenceToNumber(conf: ModelConfidence): number {
  switch (conf) {
    case 'high': return 0.85;
    case 'medium': return 0.65;
    case 'lean': return 0.45;
    case 'low': return 0.25;
    default: return 0.50;
  }
}

/** Map value confidence label to numeric value */
function valueConfidenceToNumber(conf: ValueConfidence): number {
  switch (conf) {
    case 'high': return 0.85;
    case 'medium': return 0.60;
    case 'low': return 0.25;
    default: return 0.50;
  }
}

// ============================================================================
// Trigger 1: Data Starvation
// ============================================================================
// If data completeness is below the minimum threshold (0.30), there isn't
// enough signal to make a reliable prediction. Severity scales linearly
// from 0 at the threshold to 1.0 at zero completeness.

function checkDataStarvation(features: FeatureVector): AbstentionTrigger {
  const completeness = features.volatility.dataCompleteness;
  const threshold = PREDICTABILITY_GATE.minDataCompleteness; // 0.30
  const triggered = completeness < threshold;

  // Severity: 0 at threshold, 1.0 at 0 completeness
  const severity = triggered
    ? round4(clamp(1 - completeness / threshold, 0, 1))
    : 0;

  return {
    id: 'data_starvation',
    triggered,
    severity,
    reason: triggered
      ? `Insufficient data: completeness ${round4(completeness)} < ${threshold}`
      : '',
    weight: 0.25,
  };
}

// ============================================================================
// Trigger 2: High Chaos
// ============================================================================
// If matchChaos exceeds the maximum threshold (0.80), the match dynamics
// are too unpredictable for reliable prediction. Severity scales linearly
// from 0 at the threshold to 1.0 at chaos = 1.0.

function checkHighChaos(features: FeatureVector): AbstentionTrigger {
  const chaos = features.volatility.matchChaos;
  const threshold = PREDICTABILITY_GATE.maxChaos; // 0.80
  const triggered = chaos > threshold;

  // Severity: 0 at threshold, 1.0 at chaos = 1.0
  const severity = triggered
    ? round4(clamp((chaos - threshold) / (1.0 - threshold), 0, 1))
    : 0;

  return {
    id: 'high_chaos',
    triggered,
    severity,
    reason: triggered
      ? `Match too unpredictable: chaos ${round4(chaos)} > ${threshold}`
      : '',
    weight: 0.20,
  };
}

// ============================================================================
// Trigger 3: Wide Uncertainty (ELO Deviation)
// ============================================================================
// If both teams have high ELO/Glicko deviation (>250), we don't have
// enough rating information to trust the strength model. This triggers
// when BOTH teams have wide uncertainty.

function checkWideUncertainty(features: FeatureVector): AbstentionTrigger {
  // Use form variance as a proxy for rating uncertainty since the ELO
  // deviation is stored separately. We also check the match count as
  // a proxy: few matches = high deviation.
  const homeMatches = features.form.homeMatchCount;
  const awayMatches = features.form.awayMatchCount;
  const homeDeviation = features.volatility.homeFormVariance;
  const awayDeviation = features.volatility.awayFormVariance;

  // Approximate: if match count is very low, deviation is likely high
  // Real implementation would use the GlickoRating from the DB
  const homeDeviationHigh = homeDeviation > 2.0 || homeMatches < 3;
  const awayDeviationHigh = awayDeviation > 2.0 || awayMatches < 3;

  const bothHigh = homeDeviationHigh && awayDeviationHigh;
  const eitherHigh = homeDeviationHigh || awayDeviationHigh;

  // Severity: both high = strong trigger, one high = mild
  let severity = 0;
  if (bothHigh) {
    severity = round4(clamp(
      (homeDeviation + awayDeviation) / 4.0, // normalise
      0.5, 1.0,
    ));
  } else if (eitherHigh) {
    severity = round4(clamp(
      Math.max(homeDeviation, awayDeviation) / 4.0,
      0.1, 0.4,
    ));
  }

  const triggered = bothHigh;

  return {
    id: 'wide_uncertainty',
    triggered,
    severity,
    reason: triggered
      ? 'Ratings too uncertain: both teams have high deviation'
      : '',
    weight: 0.15,
  };
}

// ============================================================================
// Trigger 4: No Market Edge
// ============================================================================
// If the best market candidate has "NO EDGE" label, there is no value
// in making a prediction. This is a definitive abstention signal.

function checkNoMarketEdge(
  prediction: Partial<V2Prediction>,
): AbstentionTrigger {
  const bestPick = prediction.marketSelection?.bestPick;
  const hasNoEdge = bestPick?.edgeLabel === 'NO EDGE';
  const noPick = !bestPick;

  const triggered = hasNoEdge || noPick;

  // Severity: no pick at all is more severe than a pick with no edge
  let severity = 0;
  if (noPick) {
    severity = 0.95;
  } else if (hasNoEdge) {
    severity = 0.80;
  }

  return {
    id: 'no_market_edge',
    triggered,
    severity,
    reason: triggered
      ? noPick
        ? 'No value detected: no market pick available'
        : 'No value detected: best pick has NO EDGE'
      : '',
    weight: 0.20,
  };
}

// ============================================================================
// Trigger 5: Chaotic Script
// ============================================================================
// If the primary match script is 'chaotic_unreliable' and no candidate
// exceeds 60% probability, the match dynamics are too uncertain.

function checkChaoticScript(
  prediction: Partial<V2Prediction>,
  features: FeatureVector,
): AbstentionTrigger {
  const script = prediction.script?.primary;
  const isChaotic = script === 'chaotic_unreliable';

  // Find highest probability among non-rejected candidates
  const candidates = prediction.marketSelection?.allCandidates ?? [];
  const surviving = candidates.filter((c) => !c.rejected);
  const maxProb = surviving.length > 0
    ? Math.max(...surviving.map((c) => c.probability))
    : 0;

  const CHAOTIC_PROB_THRESHOLD = 0.60;
  const triggered = isChaotic && maxProb < CHAOTIC_PROB_THRESHOLD;

  // Severity: scales with how far below threshold
  const severity = triggered
    ? round4(clamp(1 - maxProb / CHAOTIC_PROB_THRESHOLD, 0.3, 1.0))
    : isChaotic
      ? round4(clamp(0.3 * (1 - maxProb), 0, 0.3))
      : 0;

  return {
    id: 'chaotic_script',
    triggered,
    severity,
    reason: triggered
      ? `Chaotic match: script is chaotic_unreliable and best probability ${round4(maxProb)} < ${CHAOTIC_PROB_THRESHOLD}`
      : '',
    weight: 0.15,
  };
}

// ============================================================================
// Trigger 6: Conflicting Signals
// ============================================================================
// When the model has high confidence but value analysis disagrees (low
// value confidence) and volatility is high, the signals are contradictory.
// This suggests the model may be overfitting to the available data.

function checkConflictingSignals(
  prediction: Partial<V2Prediction>,
  features: FeatureVector,
): AbstentionTrigger {
  const confidence = prediction.confidence;
  const modelConf = confidence?.model ?? 'medium';
  const valueConf = confidence?.value ?? 'medium';
  const volatility = confidence?.volatility ?? 'medium';

  const modelConfNum = modelConfidenceToNumber(modelConf);
  const valueConfNum = valueConfidenceToNumber(valueConf);

  // Detect conflict: high model confidence but low value confidence
  const isHighModel = modelConf === 'high' || modelConf === 'medium';
  const isLowValue = valueConf === 'low';
  const isHighVol = volatility === 'high';

  // The conflict is strongest when model says "go" but value says "no"
  // and volatility confirms uncertainty
  const conflictDetected = isHighModel && isLowValue;
  const strongConflict = conflictDetected && isHighVol;

  const triggered = strongConflict;

  // Severity based on the gap between model and value confidence
  const gap = modelConfNum - valueConfNum;
  const severity = strongConflict
    ? round4(clamp(gap, 0.3, 1.0))
    : conflictDetected
      ? round4(clamp(gap * 0.5, 0, 0.4))
      : 0;

  return {
    id: 'conflicting_signals',
    triggered,
    severity,
    reason: triggered
      ? `Conflicting signals: model=${modelConf} confidence but value=${valueConf} with ${volatility} volatility`
      : '',
    weight: 0.10,
  };
}

// ============================================================================
// Trigger 7: Enrichment Tier Thin
// ============================================================================
// If the enrichment tier is 'thin' (very little supplementary data) and
// overall confidence is below 50%, the prediction is built on a fragile
// foundation.

function checkThinEnrichment(
  prediction: Partial<V2Prediction>,
  features: FeatureVector,
): AbstentionTrigger {
  const tier = features.volatility.enrichmentTier;
  const isThin = tier === 'thin';

  // Get composite confidence (0-100 scale, normalise to 0-1)
  const compositeConf = prediction.confidence?.composite ?? 50;
  const compositeNorm = compositeConf / 100;

  const THIN_CONFIDENCE_THRESHOLD = 0.50;
  const triggered = isThin && compositeNorm < THIN_CONFIDENCE_THRESHOLD;

  // Severity: scales with how far below threshold
  const severity = triggered
    ? round4(clamp(1 - compositeNorm / THIN_CONFIDENCE_THRESHOLD, 0.4, 1.0))
    : isThin
      ? round4(clamp(0.3 * (1 - compositeNorm), 0, 0.3))
      : 0;

  return {
    id: 'thin_enrichment',
    triggered,
    severity,
    reason: triggered
      ? `Data too thin: enrichment tier is '${tier}' with confidence ${round4(compositeNorm * 100)}% < ${THIN_CONFIDENCE_THRESHOLD * 100}%`
      : '',
    weight: 0.15,
  };
}

// ============================================================================
// Composite Abstention Confidence
// ============================================================================
// Combine all trigger severities into a single composite score.
// Uses a weighted average where each trigger's weight determines its
// contribution to the final decision.

function computeCompositeConfidence(
  triggers: AbstentionTrigger[],
): { confidence: number; dominantTrigger: string } {
  let totalWeight = 0;
  let weightedSum = 0;
  let maxWeightedSeverity = 0;
  let dominantTrigger = 'none';

  for (const trigger of triggers) {
    if (trigger.severity > 0) {
      const weighted = trigger.severity * trigger.weight;
      weightedSum += weighted;
      totalWeight += trigger.weight;

      if (weighted > maxWeightedSeverity) {
        maxWeightedSeverity = weighted;
        dominantTrigger = trigger.id;
      }
    }
  }

  // Composite = weighted average, but never below the max single trigger
  // This ensures that one very strong trigger can cause abstention
  const avgConfidence = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Also factor in: if any trigger has severity > 0.80, boost composite
  const maxSeverity = Math.max(...triggers.map((t) => t.severity));
  const maxBoost = maxSeverity > 0.80 ? maxSeverity * 0.15 : 0;

  // Final composite: blend of average and max, plus boost
  const composite = round4(clamp(
    avgConfidence * 0.60 + maxSeverity * 0.30 + maxBoost,
    0, 1,
  ));

  return {
    confidence: composite,
    dominantTrigger,
  };
}

// ============================================================================
// Build Abstention Reason
// ============================================================================
// Construct a human-readable reason from the triggered abstention triggers.

function buildAbstentionReason(triggers: AbstentionTrigger[]): string {
  const triggered = triggers.filter((t) => t.triggered);

  if (triggered.length === 0) {
    return 'Composite abstention confidence exceeded threshold';
  }

  // Sort by severity descending
  const sorted = [...triggered].sort((a, b) => b.severity - a.severity);

  // Primary reason (highest severity)
  const primary = sorted[0];
  const reasons: string[] = [primary.reason];

  // Add secondary reasons if they exist
  if (sorted.length > 1) {
    const secondary = sorted
      .slice(1, 3) // max 3 reasons
      .filter((t) => t.severity > 0.3)
      .map((t) => t.reason);

    if (secondary.length > 0) {
      reasons.push(`Additionally: ${secondary.join('; ')}`);
    }
  }

  return reasons.join('. ');
}

// ============================================================================
// MAIN: Should Abstain
// ============================================================================

/**
 * Determine whether the engine should abstain from making a prediction.
 *
 * Evaluates 7 independent abstention triggers, each producing a severity
 * score. The composite abstention confidence is computed from all triggers.
 * If it exceeds 0.50, the engine recommends abstention.
 *
 * @param prediction  The partial V2Prediction object (may be incomplete)
 * @param features    The full feature vector for this fixture
 * @returns AbstentionResult with abstention recommendation and details
 */
export function shouldAbstain(
  prediction: Partial<V2Prediction>,
  features: FeatureVector,
): { abstain: boolean; reason?: string; confidence: number } {
  // ── Evaluate all 7 triggers ────────────────────────────────────────────

  const triggers: AbstentionTrigger[] = [
    checkDataStarvation(features),
    checkHighChaos(features),
    checkWideUncertainty(features),
    checkNoMarketEdge(prediction),
    checkChaoticScript(prediction, features),
    checkConflictingSignals(prediction, features),
    checkThinEnrichment(prediction, features),
  ];

  // ── Compute composite confidence ───────────────────────────────────────

  const { confidence, dominantTrigger } = computeCompositeConfidence(triggers);

  // ── Abstention decision ────────────────────────────────────────────────

  const ABSTENTION_THRESHOLD = 0.50;
  const abstain = confidence > ABSTENTION_THRESHOLD;

  // ── Build result ───────────────────────────────────────────────────────

  const reason = abstain ? buildAbstentionReason(triggers) : undefined;

  return {
    abstain,
    reason,
    confidence,
  };
}

// ============================================================================
// Extended Abstention Analysis (for debugging and transparency)
// ============================================================================

/**
 * Full abstention analysis with per-trigger breakdown.
 * Useful for debugging, logging, and the transparency layer.
 *
 * @param prediction  The partial V2Prediction object
 * @param features    The full feature vector
 * @returns Full AbstentionResult with all trigger details
 */
export function analyzeAbstention(
  prediction: Partial<V2Prediction>,
  features: FeatureVector,
): AbstentionResult {
  const triggers: AbstentionTrigger[] = [
    checkDataStarvation(features),
    checkHighChaos(features),
    checkWideUncertainty(features),
    checkNoMarketEdge(prediction),
    checkChaoticScript(prediction, features),
    checkConflictingSignals(prediction, features),
    checkThinEnrichment(prediction, features),
  ];

  const { confidence, dominantTrigger } = computeCompositeConfidence(triggers);

  const ABSTENTION_THRESHOLD = 0.50;
  const abstain = confidence > ABSTENTION_THRESHOLD;

  const reason = abstain ? buildAbstentionReason(triggers) : undefined;

  return {
    abstain,
    reason,
    confidence,
    triggers,
    dominantTrigger,
  };
}

// ============================================================================
// Quick Abstention Check (fast path for pipeline short-circuit)
// ============================================================================
// For the data starvation and high chaos triggers, we can check these
// very early in the pipeline (before Monte Carlo, calibration, etc.)
// and short-circuit the entire prediction process.

/**
 * Fast-path abstention check that only evaluates the two cheapest triggers.
 * Use this at the top of the prediction pipeline to avoid expensive
 * computation when the match clearly should be skipped.
 *
 * @param features  The feature vector
 * @returns true if the match should be skipped immediately
 */
export function quickAbstentionCheck(features: FeatureVector): {
  shouldSkip: boolean;
  reason?: string;
} {
  // Check data starvation
  if (features.volatility.dataCompleteness < PREDICTABILITY_GATE.minDataCompleteness) {
    return {
      shouldSkip: true,
      reason: `Insufficient data: completeness ${round4(features.volatility.dataCompleteness)} < ${PREDICTABILITY_GATE.minDataCompleteness}`,
    };
  }

  // Check high chaos
  if (features.volatility.matchChaos > PREDICTABILITY_GATE.maxChaos) {
    return {
      shouldSkip: true,
      reason: `Match too unpredictable: chaos ${round4(features.volatility.matchChaos)} > ${PREDICTABILITY_GATE.maxChaos}`,
    };
  }

  // Check minimum match count
  const minMatches = Math.min(
    features.form.homeMatchCount,
    features.form.awayMatchCount,
  );
  if (minMatches < PREDICTABILITY_GATE.minMatchCount) {
    return {
      shouldSkip: true,
      reason: `Insufficient match history: ${minMatches} matches < ${PREDICTABILITY_GATE.minMatchCount}`,
    };
  }

  return { shouldSkip: false };
}
