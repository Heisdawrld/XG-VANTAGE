// ============================================================================
// xG-Vantage V2 Engine — Match Script Classifier
// ============================================================================
// Classifies matches into 6 narrative scripts based on feature vectors.
// Each script represents a distinct match dynamics profile that influences
// probability distributions, market fit, and confidence scoring downstream.
// ============================================================================

import type {
  FeatureVector,
  MatchScript,
  ScriptClassification,
} from './types';

// ============================================================================
// Script Definitions
// ============================================================================
// Each script is defined by its activation criteria and scoring logic.
// Scripts are scored 0-1 based on how strongly the features match the
// narrative pattern. The highest-scoring script becomes the primary.
// ============================================================================

const SCRIPTS: MatchScript[] = [
  'dominant_home_pressure',
  'dominant_away_pressure',
  'open_end_to_end',
  'balanced_high_event',
  'tight_low_event',
  'chaotic_unreliable',
];

// ============================================================================
// Internal Helpers
// ============================================================================

/** Clamp a number between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Round to 3 decimal places */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Sigmoid-like smooth activation: ramps from 0 to 1 around threshold */
function smoothActivate(value: number, threshold: number, width: number): number {
  const x = (value - threshold) / width;
  return clamp(1 / (1 + Math.exp(-x * 4)), 0, 1);
}

/** Average of an array of numbers */
function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ============================================================================
// Script Scoring Functions
// ============================================================================
// Each function returns a score 0-1 indicating how strongly the features
// match the given script. Scores use smooth activation functions to avoid
// hard thresholds and allow blended script detection.
// ============================================================================

/**
 * dominant_home_pressure: Home team clearly stronger, pressing opposition,
 * high scoring rate at home, away team defensively weak.
 *
 * Criteria:
 *   - home strength gap > 0.3
 *   - away defensive weakness (high conceded rate)
 *   - home scoring rate > 1.5
 */
function scoreDominantHomePressure(f: FeatureVector): number {
  const strengthGap = f.strength.strengthGap; // home - away
  const homeScoringRate = f.form.homeWeightedScored;
  const awayDefWeakness = f.form.awayWeightedConceded;
  const homeWinRate = f.form.homeWinRate;
  const awayLossRate = f.form.awayLossRate;
  const homeAttackAdv = f.strength.homeAttackRating - f.strength.awayDefenseRating;

  // Core signals
  const gapSignal = smoothActivate(strengthGap, 0.3, 0.15);
  const scoringSignal = smoothActivate(homeScoringRate, 1.5, 0.3);
  const defWeaknessSignal = smoothActivate(awayDefWeakness, 1.3, 0.3);
  const winRateSignal = smoothActivate(homeWinRate, 0.55, 0.10);
  const lossRateSignal = smoothActivate(awayLossRate, 0.45, 0.10);
  const attackAdvSignal = smoothActivate(homeAttackAdv, 0.2, 0.15);

  // Weighted combination — strength gap and scoring are primary
  const score = (
    gapSignal * 0.30 +
    scoringSignal * 0.25 +
    defWeaknessSignal * 0.20 +
    winRateSignal * 0.10 +
    lossRateSignal * 0.05 +
    attackAdvSignal * 0.10
  );

  return clamp(score, 0, 1);
}

/**
 * dominant_away_pressure: Away team clearly stronger, home defensive weakness,
 * away team scoring heavily on the road.
 *
 * Criteria:
 *   - away strength gap > 0.3 (i.e. strengthGap < -0.3)
 *   - home defensive weakness
 */
function scoreDominantAwayPressure(f: FeatureVector): number {
  const strengthGap = -f.strength.strengthGap; // flipped: positive = away stronger
  const awayScoringRate = f.form.awayWeightedScored;
  const homeDefWeakness = f.form.homeWeightedConceded;
  const awayWinRate = f.form.awayWinRate;
  const homeLossRate = f.form.homeLossRate;
  const awayAttackAdv = f.strength.awayAttackRating - f.strength.homeDefenseRating;

  // Core signals
  const gapSignal = smoothActivate(strengthGap, 0.3, 0.15);
  const scoringSignal = smoothActivate(awayScoringRate, 1.5, 0.3);
  const defWeaknessSignal = smoothActivate(homeDefWeakness, 1.3, 0.3);
  const winRateSignal = smoothActivate(awayWinRate, 0.45, 0.10);
  const lossRateSignal = smoothActivate(homeLossRate, 0.45, 0.10);
  const attackAdvSignal = smoothActivate(awayAttackAdv, 0.2, 0.15);

  const score = (
    gapSignal * 0.30 +
    scoringSignal * 0.25 +
    defWeaknessSignal * 0.20 +
    winRateSignal * 0.10 +
    lossRateSignal * 0.05 +
    attackAdvSignal * 0.10
  );

  return clamp(score, 0, 1);
}

/**
 * open_end_to_end: Both teams attack strongly, both defenses leak goals,
 * high BTTS rate. End-to-end basketball-style football.
 *
 * Criteria:
 *   - both attacks strong (>1.3 avg goals)
 *   - both defenses leaky (>1.2 conceded)
 *   - high BTTS rate
 */
function scoreOpenEndToEnd(f: FeatureVector): number {
  const homeScoring = f.form.homeWeightedScored;
  const awayScoring = f.form.awayWeightedScored;
  const homeConceded = f.form.homeWeightedConceded;
  const awayConceded = f.form.awayWeightedConceded;
  const homeBtts = f.form.homeBttsRate;
  const awayBtts = f.form.awayBttsRate;
  const avgBtts = (homeBtts + awayBtts) / 2;
  const avgScoring = (homeScoring + awayScoring) / 2;
  const avgConceded = (homeConceded + awayConceded) / 2;

  // Both teams must score well
  const bothAttackSignal = smoothActivate(
    Math.min(homeScoring, awayScoring), 1.3, 0.25
  );
  // Both defenses must be leaky
  const bothLeakySignal = smoothActivate(
    Math.min(homeConceded, awayConceded), 1.2, 0.25
  );
  // High BTTS confirms end-to-end
  const bttsSignal = smoothActivate(avgBtts, 0.60, 0.10);
  // Average scoring should be high
  const avgScoreSignal = smoothActivate(avgScoring, 1.4, 0.25);
  // Average conceded should be high
  const avgConcededSignal = smoothActivate(avgConceded, 1.3, 0.25);
  // Over 2.5 rate confirmation
  const over25Signal = smoothActivate(
    (f.form.homeOver25Rate + f.form.awayOver25Rate) / 2, 0.55, 0.10
  );

  const score = (
    bothAttackSignal * 0.25 +
    bothLeakySignal * 0.25 +
    bttsSignal * 0.20 +
    avgScoreSignal * 0.10 +
    avgConcededSignal * 0.10 +
    over25Signal * 0.10
  );

  return clamp(score, 0, 1);
}

/**
 * balanced_high_event: Moderate attacking quality but lots of events,
 * reasonable BTTS, neither team dominant. Typical mid-table clash.
 *
 * Criteria:
 *   - moderate attack (neither exceptional nor poor)
 *   - moderate BTTS (>0.55)
 */
function scoreBalancedHighEvent(f: FeatureVector): number {
  const homeScoring = f.form.homeWeightedScored;
  const awayScoring = f.form.awayWeightedScored;
  const avgScoring = (homeScoring + awayScoring) / 2;
  const avgBtts = (f.form.homeBttsRate + f.form.awayBttsRate) / 2;
  const strengthGap = Math.abs(f.strength.strengthGap);
  const avgOver25 = (f.form.homeOver25Rate + f.form.awayOver25Rate) / 2;

  // Moderate scoring (not too high, not too low)
  const moderateAttack = 1 - clamp(Math.abs(avgScoring - 1.3) / 0.6, 0, 1);
  // BTTS signal
  const bttsSignal = smoothActivate(avgBtts, 0.55, 0.10);
  // Low strength gap (balanced teams)
  const balancedSignal = 1 - smoothActivate(strengthGap, 0.25, 0.10);
  // Moderate over 2.5 (not extreme)
  const over25Signal = smoothActivate(avgOver25, 0.50, 0.10);

  const score = (
    moderateAttack * 0.25 +
    bttsSignal * 0.30 +
    balancedSignal * 0.25 +
    over25Signal * 0.20
  );

  return clamp(score, 0, 1);
}

/**
 * tight_low_event: Low scoring rates, strong defenses, few goals expected.
 * Typical relegation battle or defensive-minded clash.
 *
 * Criteria:
 *   - low scoring rates (<1.1 avg)
 *   - strong defenses (<0.9 conceded)
 */
function scoreTightLowEvent(f: FeatureVector): number {
  const homeScoring = f.form.homeWeightedScored;
  const awayScoring = f.form.awayWeightedScored;
  const homeConceded = f.form.homeWeightedConceded;
  const awayConceded = f.form.awayWeightedConceded;
  const avgScoring = (homeScoring + awayScoring) / 2;
  const avgConceded = (homeConceded + awayConceded) / 2;
  const avgBtts = (f.form.homeBttsRate + f.form.awayBttsRate) / 2;
  const avgCleanSheet = (f.form.homeCleanSheetRate + f.form.awayCleanSheetRate) / 2;
  const homeDrawRate = f.form.homeDrawRate;
  const awayDrawRate = f.form.awayDrawRate;
  const avgDrawRate = (homeDrawRate + awayDrawRate) / 2;

  // Inverse scoring signal: lower scoring = higher tight score
  const lowScoringSignal = 1 - smoothActivate(avgScoring, 1.1, 0.2);
  // Inverse conceded signal: lower conceded = higher tight score
  const lowConcededSignal = 1 - smoothActivate(avgConceded, 0.9, 0.2);
  // Low BTTS signal
  const lowBttsSignal = 1 - smoothActivate(avgBtts, 0.50, 0.10);
  // High clean sheet signal
  const cleanSheetSignal = smoothActivate(avgCleanSheet, 0.30, 0.10);
  // High draw rate (tight matches often draw)
  const drawSignal = smoothActivate(avgDrawRate, 0.30, 0.08);

  const score = (
    lowScoringSignal * 0.30 +
    lowConcededSignal * 0.25 +
    lowBttsSignal * 0.15 +
    cleanSheetSignal * 0.15 +
    drawSignal * 0.15
  );

  return clamp(score, 0, 1);
}

/**
 * chaotic_unreliable: High volatility, low data completeness, high upset risk.
 * Matches where prediction is unreliable — abstention trigger.
 *
 * Criteria:
 *   - high volatility (>0.6)
 *   - low data completeness (<0.4)
 *   - high upset risk
 */
function scoreChaoticUnreliable(f: FeatureVector): number {
  const volScore = f.volatility.volatilityScore;
  const dataCompleteness = f.volatility.dataCompleteness;
  const matchChaos = f.volatility.matchChaos;
  const homeUpsetRisk = f.volatility.homeUpsetRisk;
  const awayUpsetRisk = f.volatility.awayUpsetRisk;
  const avgUpsetRisk = (homeUpsetRisk + awayUpsetRisk) / 2;
  const homeFormVar = f.volatility.homeFormVariance;
  const awayFormVar = f.volatility.awayFormVariance;
  const avgFormVar = (homeFormVar + awayFormVar) / 2;
  const homeMatches = f.form.homeMatchCount;
  const awayMatches = f.form.awayMatchCount;
  const minMatches = Math.min(homeMatches, awayMatches);

  // High volatility signal
  const volSignal = smoothActivate(volScore, 0.6, 0.15);
  // Low data completeness signal (inverted)
  const dataSignal = 1 - smoothActivate(dataCompleteness, 0.4, 0.15);
  // High chaos signal
  const chaosSignal = smoothActivate(matchChaos, 0.5, 0.15);
  // High upset risk signal
  const upsetSignal = smoothActivate(avgUpsetRisk, 0.5, 0.15);
  // High form variance signal
  const varSignal = smoothActivate(avgFormVar, 1.5, 0.5);
  // Low match count signal (inverted)
  const thinDataSignal = 1 - smoothActivate(minMatches, 5, 2);

  const score = (
    volSignal * 0.20 +
    dataSignal * 0.25 +
    chaosSignal * 0.20 +
    upsetSignal * 0.15 +
    varSignal * 0.10 +
    thinDataSignal * 0.10
  );

  return clamp(score, 0, 1);
}

// ============================================================================
// Composite Score Computation
// ============================================================================

/**
 * Compute controlScore: how much one side dominates the match.
 * 0 = perfectly balanced, 1 = total one-sided dominance.
 */
function computeControlScore(f: FeatureVector): number {
  const strengthGap = Math.abs(f.strength.strengthGap);
  const winRateGap = Math.abs(f.form.homeWinRate - f.form.awayWinRate);
  const attackGap = Math.abs(f.strength.attackGap);
  const ratingGap = Math.abs(
    f.strength.homeBaseRating - f.strength.awayBaseRating
  ) / 400; // normalise ELO-style

  return clamp(
    strengthGap * 0.40 +
    winRateGap * 0.25 +
    attackGap * 0.20 +
    ratingGap * 0.15,
    0, 1
  );
}

/**
 * Compute eventLevelScore: how many goal-scoring events are expected.
 * 0 = very few events, 1 = lots of action.
 */
function computeEventLevelScore(f: FeatureVector): number {
  const avgScoring = (f.form.homeWeightedScored + f.form.awayWeightedScored) / 2;
  const avgConceded = (f.form.homeWeightedConceded + f.form.awayWeightedConceded) / 2;
  const avgBtts = (f.form.homeBttsRate + f.form.awayBttsRate) / 2;
  const avgOver25 = (f.form.homeOver25Rate + f.form.awayOver25Rate) / 2;
  const avgOver15 = (f.form.homeOver15Rate + f.form.awayOver15Rate) / 2;

  return clamp(
    smoothActivate(avgScoring, 1.3, 0.4) * 0.30 +
    smoothActivate(avgConceded, 1.2, 0.4) * 0.20 +
    avgBtts * 0.20 +
    avgOver25 * 0.15 +
    avgOver15 * 0.15,
    0, 1
  );
}

/**
 * Compute volatilityScore: how unpredictable the match is.
 * 0 = very predictable, 1 = highly unpredictable.
 */
function computeVolatilityScore(f: FeatureVector): number {
  const vol = f.volatility.volatilityScore;
  const chaos = f.volatility.matchChaos;
  const avgUpsetRisk = (f.volatility.homeUpsetRisk + f.volatility.awayUpsetRisk) / 2;
  const avgFormVar = (f.volatility.homeFormVariance + f.volatility.awayFormVariance) / 2;
  const dataQuality = f.volatility.dataCompleteness;

  return clamp(
    vol * 0.35 +
    chaos * 0.25 +
    avgUpsetRisk * 0.20 +
    smoothActivate(avgFormVar, 1.5, 0.8) * 0.10 +
    (1 - dataQuality) * 0.10,
    0, 1
  );
}

/**
 * Compute classification confidence: how decisive the primary script is.
 * High confidence = one script clearly dominates. Low = many scripts tied.
 */
function computeClassificationConfidence(
  scriptScores: Record<MatchScript, number>,
): number {
  const scores = Object.values(scriptScores);
  const maxScore = Math.max(...scores);
  const sorted = [...scores].sort((a, b) => b - a);
  const secondScore = sorted.length > 1 ? sorted[1] : 0;

  // Confidence based on margin between top-2 scripts and absolute strength of primary
  const margin = maxScore - secondScore;
  const marginFactor = clamp(margin / 0.20, 0, 1); // 0.20 margin = full confidence
  const strengthFactor = clamp(maxScore / 0.50, 0, 1); // 0.50 score = full strength

  return clamp(marginFactor * 0.60 + strengthFactor * 0.40, 0.15, 1.0);
}

// ============================================================================
// MAIN: Classify Match Script
// ============================================================================

/**
 * Classify a match into one of 6 narrative scripts based on the feature vector.
 *
 * Each script is scored 0-1; the highest-scoring script is the primary.
 * Additional composite scores (control, event level, volatility) provide
 * context for downstream calibration and market selection.
 *
 * @param features  The fully assembled feature vector for this fixture
 * @returns ScriptClassification with primary script, scores, and composites
 */
export function classifyMatchScript(
  features: FeatureVector,
): ScriptClassification {
  // ── Score each script ──────────────────────────────────────────────────
  const scriptScores: Record<MatchScript, number> = {
    dominant_home_pressure: round3(scoreDominantHomePressure(features)),
    dominant_away_pressure: round3(scoreDominantAwayPressure(features)),
    open_end_to_end: round3(scoreOpenEndToEnd(features)),
    balanced_high_event: round3(scoreBalancedHighEvent(features)),
    tight_low_event: round3(scoreTightLowEvent(features)),
    chaotic_unreliable: round3(scoreChaoticUnreliable(features)),
  };

  // ── Determine primary script (highest score) ───────────────────────────
  let primary: MatchScript = 'balanced_high_event'; // default fallback
  let maxScore = -1;

  for (const script of SCRIPTS) {
    if (scriptScores[script] > maxScore) {
      maxScore = scriptScores[script];
      primary = script;
    }
  }

  // ── Compute composite scores ───────────────────────────────────────────
  const controlScore = round3(computeControlScore(features));
  const eventLevelScore = round3(computeEventLevelScore(features));
  const volatilityScore = round3(computeVolatilityScore(features));

  // ── Compute classification confidence ──────────────────────────────────
  const confidence = round3(computeClassificationConfidence(scriptScores));

  return {
    primary,
    controlScore,
    eventLevelScore,
    volatilityScore,
    scriptScores,
    confidence,
  };
}
