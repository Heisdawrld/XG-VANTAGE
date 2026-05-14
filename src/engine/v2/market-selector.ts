// ============================================================================
// xG-Vantage V2 Engine — Market Selector (9-Step Pipeline)
// ============================================================================
// The core market selection pipeline that ScorePhantom dominates on.
// Takes calibrated probabilities, features, script classification, and raw
// Monte Carlo results through a rigorous 9-step pipeline to either select
// the best market pick or abstain with a documented reason.
//
// Steps:
//   1. assessMatchPredictability  — gate-check data quality
//   2. buildMarketCandidates      — generate 24 market candidates
//   3. applyMarketRestrictions    — remove context-blocked markets
//   4. computeImpliedProbabilities — derive bookmaker-implied probs
//   5. scoreMarketCandidates      — 10-factor weighted scoring
//   6. pruneWeakCandidates        — floors, value traps, min score
//   7. rankMarkets                — sort, classify risk, label edge
//   8. computeLayer2Override      — compare calibrated vs raw
//   9. selectBestPickOrAbstain    — strict multi-gate decision
// ============================================================================

import type {
  CalibratedProbabilities,
  FeatureVector,
  ScriptClassification,
  MonteCarloResult,
  MarketCandidate,
  MarketSelection,
  MarketKey,
} from './types';
import {
  PREDICTABILITY_GATE,
  MARKET_FLOORS,
  VALUE_TRAP_EDGE,
  MARKET_SCORING,
  SCRIPT_MARKET_FIT,
  RISK_THRESHOLDS,
  EDGE_LABELS,
  SEPARATION,
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

/** Create a blank MarketCandidate with sensible defaults */
function blankCandidate(
  marketKey: MarketKey,
  selection: string,
  probability: number,
): MarketCandidate {
  return {
    marketKey,
    selection,
    probability: round4(clamp(probability, 0.001, 0.999)),
    impliedProbability: 0,
    edge: 0,
    odds: null,
    tacticalFit: 0.5,
    predictability: 0.5,
    dataSupport: 0.5,
    historicalAccuracy: 0.5,
    leagueCalibration: 0.5,
    formMomentum: 0.5,
    finalScore: 0,
    riskClassification: 'MODERATE',
    edgeLabel: 'NO EDGE',
    rejected: false,
  };
}

// ============================================================================
// Step 1: Assess Match Predictability
// ============================================================================
// Gate-check whether this match has enough signal to warrant market selection.
// If any gate fails, the match is marked as unpredictable and we abstain.

interface PredictabilityAssessment {
  isPredictable: boolean;
  failureReasons: string[];
  dataCompleteness: number;
  matchChaos: number;
  minMatchCount: number;
}

function assessMatchPredictability(
  features: FeatureVector,
): PredictabilityAssessment {
  const failureReasons: string[] = [];

  const dataCompleteness = features.volatility.dataCompleteness;
  const matchChaos = features.volatility.matchChaos;
  const minMatchCount = Math.min(
    features.form.homeMatchCount,
    features.form.awayMatchCount,
  );

  // Gate 1: Data completeness
  if (dataCompleteness < PREDICTABILITY_GATE.minDataCompleteness) {
    failureReasons.push(
      `Data completeness ${round4(dataCompleteness)} < ${PREDICTABILITY_GATE.minDataCompleteness}`,
    );
  }

  // Gate 2: Match chaos
  if (matchChaos > PREDICTABILITY_GATE.maxChaos) {
    failureReasons.push(
      `Match chaos ${round4(matchChaos)} > ${PREDICTABILITY_GATE.maxChaos}`,
    );
  }

  // Gate 3: Match count
  if (minMatchCount < PREDICTABILITY_GATE.minMatchCount) {
    failureReasons.push(
      `Match count ${minMatchCount} < ${PREDICTABILITY_GATE.minMatchCount}`,
    );
  }

  return {
    isPredictable: failureReasons.length === 0,
    failureReasons,
    dataCompleteness,
    matchChaos,
    minMatchCount,
  };
}

// ============================================================================
// Step 2: Build Market Candidates
// ============================================================================
// Generate 24 MarketCandidate objects from calibrated probabilities.
// Each candidate gets an initial probability derived from the calibration
// layer. Derived markets (double chance, DNB, handicaps) are computed from
// the base 1X2 and goals probabilities.

function buildMarketCandidates(
  calibrated: CalibratedProbabilities,
  features: FeatureVector,
  raw: MonteCarloResult,
): MarketCandidate[] {
  const homeWin = calibrated.homeWin;
  const draw = calibrated.draw;
  const awayWin = calibrated.awayWin;
  const over15 = calibrated.over15;
  const over25 = calibrated.over25;
  const over35 = calibrated.over35;
  const bttsYes = calibrated.bttsYes;
  const bttsNo = calibrated.bttsNo;

  // Derived probabilities
  const under15 = round4(1 - over15);
  const under25 = round4(1 - over25);
  const under35 = round4(1 - over35);

  // Double chance
  const doubleChanceHome = round4(clamp(homeWin + draw, 0.01, 0.99));
  const doubleChanceAway = round4(clamp(awayWin + draw, 0.01, 0.99));
  const doubleChanceNoDraw = round4(clamp(homeWin + awayWin, 0.01, 0.99));

  // Draw No Bet (remove draw, renormalise)
  const dnbHomeDenom = homeWin + awayWin;
  const dnbHome = dnbHomeDenom > 0 ? round4(clamp(homeWin / dnbHomeDenom, 0.01, 0.99)) : 0.5;
  const dnbAway = dnbHomeDenom > 0 ? round4(clamp(awayWin / dnbHomeDenom, 0.01, 0.99)) : 0.5;

  // Player-level over markets from raw Monte Carlo
  const homeOver05 = round4(clamp(raw.homeOver05, 0.01, 0.99));
  const awayOver05 = round4(clamp(raw.awayOver05, 0.01, 0.99));
  const homeOver15 = round4(clamp(raw.homeOver15, 0.01, 0.99));
  const awayOver15 = round4(clamp(raw.awayOver15, 0.01, 0.99));

  // Handicap probabilities — estimated from score matrix
  // handicap_home_-1: home wins by 2+ goals
  // handicap_away_-1: away wins by 2+ goals
  // handicap_home_+1: home wins or draws or loses by exactly 1
  // handicap_away_+1: away wins or draws or loses by exactly 1
  let handicapHomeMinus1 = 0;
  let handicapAwayMinus1 = 0;
  let handicapHomePlus1 = 0;
  let handicapAwayPlus1 = 0;

  for (let h = 0; h < raw.scoreMatrix.length; h++) {
    for (let a = 0; a < raw.scoreMatrix[h].length; a++) {
      const prob = raw.scoreMatrix[h][a];
      if (h - a >= 2) handicapHomeMinus1 += prob;
      if (a - h >= 2) handicapAwayMinus1 += prob;
      if (h - a >= -1) handicapHomePlus1 += prob;
      if (a - h >= -1) handicapAwayPlus1 += prob;
    }
  }

  handicapHomeMinus1 = round4(clamp(handicapHomeMinus1, 0.01, 0.99));
  handicapAwayMinus1 = round4(clamp(handicapAwayMinus1, 0.01, 0.99));
  handicapHomePlus1 = round4(clamp(handicapHomePlus1, 0.01, 0.99));
  handicapAwayPlus1 = round4(clamp(handicapAwayPlus1, 0.01, 0.99));

  // Data support: use data completeness as a proxy for each market
  const dataSupport = clamp(features.volatility.dataCompleteness, 0.1, 1.0);

  // Form momentum: derived from form points
  const formMomentum = round4(clamp(
    (features.form.formPointsHome + features.form.formPointsAway) / 2,
    0.1, 1.0,
  ));

  // Predictability: inverse of volatility score
  const predictability = round4(clamp(1 - features.volatility.volatilityScore, 0.1, 1.0));

  // League calibration: based on enrichment tier and odds confidence
  const tierMap: Record<string, number> = { rich: 0.90, good: 0.75, partial: 0.55, thin: 0.30 };
  const leagueCalibration = tierMap[features.volatility.enrichmentTier] ?? 0.40;

  // Build all 24 candidates
  const candidates: MarketCandidate[] = [
    // ── 1X2 ──────────────────────────────────────────────────────────────
    { ...blankCandidate('home_win', 'Home Win', homeWin), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('draw', 'Draw', draw), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('away_win', 'Away Win', awayWin), dataSupport, predictability, formMomentum, leagueCalibration },

    // ── Over markets ─────────────────────────────────────────────────────
    { ...blankCandidate('over_15', 'Over 1.5', over15), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('over_25', 'Over 2.5', over25), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('over_35', 'Over 3.5', over35), dataSupport, predictability, formMomentum, leagueCalibration },

    // ── Under markets ────────────────────────────────────────────────────
    { ...blankCandidate('under_15', 'Under 1.5', under15), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('under_25', 'Under 2.5', under25), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('under_35', 'Under 3.5', under35), dataSupport, predictability, formMomentum, leagueCalibration },

    // ── BTTS ─────────────────────────────────────────────────────────────
    { ...blankCandidate('btts_yes', 'BTTS Yes', bttsYes), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('btts_no', 'BTTS No', bttsNo), dataSupport, predictability, formMomentum, leagueCalibration },

    // ── Double chance ────────────────────────────────────────────────────
    { ...blankCandidate('double_chance_home', 'DC Home', doubleChanceHome), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('double_chance_away', 'DC Away', doubleChanceAway), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('double_chance_no_draw', 'DC No Draw', doubleChanceNoDraw), dataSupport, predictability, formMomentum, leagueCalibration },

    // ── Draw No Bet ──────────────────────────────────────────────────────
    { ...blankCandidate('dnb_home', 'DNB Home', dnbHome), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('dnb_away', 'DNB Away', dnbAway), dataSupport, predictability, formMomentum, leagueCalibration },

    // ── Player-level over markets ────────────────────────────────────────
    { ...blankCandidate('home_over_05', 'Home Over 0.5', homeOver05), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('away_over_05', 'Away Over 0.5', awayOver05), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('home_over_15', 'Home Over 1.5', homeOver15), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('away_over_15', 'Away Over 1.5', awayOver15), dataSupport, predictability, formMomentum, leagueCalibration },

    // ── Handicap markets ─────────────────────────────────────────────────
    { ...blankCandidate('handicap_home_-1', 'Home -1', handicapHomeMinus1), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('handicap_away_-1', 'Away -1', handicapAwayMinus1), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('handicap_home_+1', 'Home +1', handicapHomePlus1), dataSupport, predictability, formMomentum, leagueCalibration },
    { ...blankCandidate('handicap_away_+1', 'Away +1', handicapAwayPlus1), dataSupport, predictability, formMomentum, leagueCalibration },
  ];

  return candidates;
}

// ============================================================================
// Step 3: Apply Market Restrictions
// ============================================================================
// Remove markets blocked by context gates:
//   - No lineup data → remove lineup-dependent markets
//   - High volatility → remove low-probability markets
//   - Thin enrichment tier → remove niche markets (handicaps, DNB)

function applyMarketRestrictions(
  candidates: MarketCandidate[],
  features: FeatureVector,
): MarketCandidate[] {
  const hasLineupData = features.lineup.hasLineupData;
  const isHighVolatility = features.volatility.volatilityScore > 0.65;
  const isThinTier = features.volatility.enrichmentTier === 'thin';

  // Lineup-dependent markets: player over markets, handicaps
  const lineupDependentMarkets: MarketKey[] = [
    'home_over_05', 'away_over_05',
    'home_over_15', 'away_over_15',
    'handicap_home_-1', 'handicap_away_-1',
    'handicap_home_+1', 'handicap_away_+1',
  ];

  // Niche markets removed when enrichment is thin
  const nicheMarkets: MarketKey[] = [
    'dnb_home', 'dnb_away',
    'handicap_home_-1', 'handicap_away_-1',
    'handicap_home_+1', 'handicap_away_+1',
    'home_over_15', 'away_over_15',
  ];

  // Low-probability threshold for high-volatility removal
  const LOW_PROB_THRESHOLD = 0.35;

  for (const c of candidates) {
    // Gate 1: Lineup data check
    if (!hasLineupData && lineupDependentMarkets.includes(c.marketKey)) {
      c.rejected = true;
      c.rejectionReason = 'No lineup data available';
      continue;
    }

    // Gate 2: High volatility removes low-probability markets
    if (isHighVolatility && c.probability < LOW_PROB_THRESHOLD) {
      c.rejected = true;
      c.rejectionReason = `High volatility: probability ${round4(c.probability)} below threshold`;
      continue;
    }

    // Gate 3: Thin enrichment removes niche markets
    if (isThinTier && nicheMarkets.includes(c.marketKey)) {
      c.rejected = true;
      c.rejectionReason = 'Thin enrichment tier: niche market removed';
      continue;
    }
  }

  return candidates;
}

// ============================================================================
// Step 4: Compute Implied Probabilities
// ============================================================================
// For candidates with available odds, compute the bookmaker-implied
// probability and account for the overround (bookmaker margin).

function computeImpliedProbabilities(
  candidates: MarketCandidate[],
  features: FeatureVector,
): MarketCandidate[] {
  const hasOdds = features.market.hasOdds;
  const margin = features.market.bookmakerMargin;

  // Map market keys to their corresponding odds fields
  // We only have limited odds from OddsRow, so derive where possible
  const oddsMap: Partial<Record<MarketKey, number | null>> = {};

  if (hasOdds) {
    // Direct odds from market features
    oddsMap.home_win = features.market.impliedHomeWin > 0
      ? round4(1 / features.market.impliedHomeWin)
      : null;
    oddsMap.draw = features.market.impliedDraw > 0
      ? round4(1 / features.market.impliedDraw)
      : null;
    oddsMap.away_win = features.market.impliedAwayWin > 0
      ? round4(1 / features.market.impliedAwayWin)
      : null;
    oddsMap.over_25 = features.market.impliedOver25 > 0
      ? round4(1 / features.market.impliedOver25)
      : null;
    oddsMap.under_25 = features.market.impliedUnder25 > 0
      ? round4(1 / features.market.impliedUnder25)
      : null;
    oddsMap.btts_yes = features.market.impliedBttsYes > 0
      ? round4(1 / features.market.impliedBttsYes)
      : null;
    oddsMap.btts_no = features.market.impliedBttsNo > 0
      ? round4(1 / features.market.impliedBttsNo)
      : null;
  }

  for (const c of candidates) {
    const odds = oddsMap[c.marketKey] ?? null;
    c.odds = odds;

    if (odds !== null && odds > 1.0) {
      // Compute raw implied probability and remove overround
      const rawImplied = 1 / odds;
      const overround = margin > 0 ? margin : 0.05; // default 5% margin
      c.impliedProbability = round4(clamp(rawImplied / (1 + overround), 0.01, 0.99));

      // Edge = our probability - implied probability
      c.edge = round4(c.probability - c.impliedProbability);
    } else {
      // No odds available — use probability as a proxy
      c.impliedProbability = round4(c.probability);
      c.edge = 0;
    }
  }

  return candidates;
}

// ============================================================================
// Step 5: Score Market Candidates
// ============================================================================
// 10-factor weighted scoring using MARKET_SCORING constants.
// Produces a finalScore on a 0-100 scale.
// Applies risk and product penalties.

function scoreMarketCandidates(
  candidates: MarketCandidate[],
  script: ScriptClassification,
  features: FeatureVector,
): MarketCandidate[] {
  const scriptKey = script.primary;

  for (const c of candidates) {
    if (c.rejected) continue;

    // ── Factor 1: Model confidence (30%) ──────────────────────────────────
    // Based on probability — higher probability = higher confidence
    const modelConfidence = clamp(c.probability, 0, 1);

    // ── Factor 2: Market edge (20%) ───────────────────────────────────────
    // Normalise edge to 0-1 scale (edges > 20% are capped at 1.0)
    const edgeNorm = clamp(c.edge / 0.20, 0, 1);

    // ── Factor 3: Tactical fit (15%) ──────────────────────────────────────
    // Look up in SCRIPT_MARKET_FIT matrix, default 0.5
    const scriptFitMap = SCRIPT_MARKET_FIT[scriptKey];
    const tacticalFit = scriptFitMap
      ? (scriptFitMap[c.marketKey] ?? 0.50)
      : 0.50;
    c.tacticalFit = round4(tacticalFit);

    // ── Factors 4-8: Already populated from Step 2 ────────────────────────
    // predictability, dataSupport, historicalAccuracy, leagueCalibration,
    // formMomentum — already set in buildMarketCandidates

    // ── Weighted sum (0-100 scale) ────────────────────────────────────────
    const rawScore =
      modelConfidence * MARKET_SCORING.modelConfidence +
      edgeNorm * MARKET_SCORING.marketEdge +
      tacticalFit * MARKET_SCORING.tacticalFit +
      c.predictability * MARKET_SCORING.predictability +
      c.dataSupport * MARKET_SCORING.dataSupport +
      c.historicalAccuracy * MARKET_SCORING.historicalAccuracy +
      c.leagueCalibration * MARKET_SCORING.leagueCalibration +
      c.formMomentum * MARKET_SCORING.formMomentum;

    // Scale to 0-100
    let finalScore = round4(rawScore * 100);

    // ── Risk penalty ──────────────────────────────────────────────────────
    // High volatility penalises the score
    const volatilityPenalty = features.volatility.volatilityScore * 0.22 * 100;
    finalScore -= round4(volatilityPenalty);

    // ── Product penalty ───────────────────────────────────────────────────
    // Markets with very low tactical fit get penalised
    if (tacticalFit < 0.30) {
      const productPenalty = 0.14 * 100;
      finalScore -= round4(productPenalty);
    }

    c.finalScore = round4(clamp(finalScore, 0, 100));
  }

  return candidates;
}

// ============================================================================
// Step 6: Prune Weak Candidates
// ============================================================================
// Apply three filters:
//   1. Per-market probability floors from MARKET_FLOORS
//   2. Value trap filter: reject edge > VALUE_TRAP_EDGE (35%)
//   3. Remove candidates with finalScore < 20

function pruneWeakCandidates(
  candidates: MarketCandidate[],
): MarketCandidate[] {
  for (const c of candidates) {
    if (c.rejected) continue;

    // Filter 1: Probability floor
    const floor = MARKET_FLOORS[c.marketKey];
    if (floor !== undefined && c.probability < floor) {
      c.rejected = true;
      c.rejectionReason = `Probability ${round4(c.probability)} < floor ${floor}`;
      continue;
    }

    // Filter 2: Value trap — edge too good to be true
    if (c.edge > VALUE_TRAP_EDGE) {
      c.rejected = true;
      c.rejectionReason = `Value trap: edge ${round4(c.edge)} > ${VALUE_TRAP_EDGE}`;
      continue;
    }

    // Filter 3: Minimum final score
    if (c.finalScore < 20) {
      c.rejected = true;
      c.rejectionReason = `Final score ${round4(c.finalScore)} < minimum 20`;
      continue;
    }
  }

  return candidates;
}

// ============================================================================
// Step 7: Rank Markets
// ============================================================================
// Sort surviving candidates by finalScore descending.
// Assign risk classification (SAFE/MODERATE/AGGRESSIVE).
// Assign edge labels (STRONG EDGE / PLAYABLE EDGE / MODERATE EDGE / LEAN / NO EDGE).

function rankMarkets(
  candidates: MarketCandidate[],
  features: FeatureVector,
): MarketCandidate[] {
  // Separate surviving and rejected
  const surviving = candidates.filter((c) => !c.rejected);
  const rejected = candidates.filter((c) => c.rejected);

  // Sort surviving by finalScore descending
  surviving.sort((a, b) => b.finalScore - a.finalScore);

  // Assign risk classification and edge labels
  for (const c of surviving) {
    // ── Risk classification ─────────────────────────────────────────────
    const chaos = features.volatility.matchChaos;
    const isStable = chaos <= RISK_THRESHOLDS.SAFE.maxChaos;

    if (
      c.probability >= RISK_THRESHOLDS.SAFE.minProb &&
      isStable
    ) {
      c.riskClassification = 'SAFE';
    } else if (
      c.probability >= RISK_THRESHOLDS.SAFE.orMinProb &&
      isStable
    ) {
      // Alternative SAFE gate: slightly lower prob but still stable
      c.riskClassification = 'SAFE';
    } else if (c.probability >= RISK_THRESHOLDS.MODERATE.minProb) {
      c.riskClassification = 'MODERATE';
    } else {
      c.riskClassification = 'AGGRESSIVE';
    }

    // ── Edge label ──────────────────────────────────────────────────────
    if (c.edge >= EDGE_LABELS.STRONG) {
      c.edgeLabel = 'STRONG EDGE';
    } else if (c.edge >= EDGE_LABELS.PLAYABLE) {
      c.edgeLabel = 'PLAYABLE EDGE';
    } else if (c.edge >= EDGE_LABELS.MODERATE) {
      c.edgeLabel = 'MODERATE EDGE';
    } else if (c.edge >= EDGE_LABELS.LEAN) {
      c.edgeLabel = 'LEAN';
    } else {
      c.edgeLabel = 'NO EDGE';
    }
  }

  // Return all candidates (surviving first, then rejected for reference)
  return [...surviving, ...rejected];
}

// ============================================================================
// Step 8: Compute Layer 2 Override
// ============================================================================
// Compare calibrated probabilities to raw Poisson probabilities.
// If the shift exceeds 10% on any major market, flag as Layer 2 override.
// This detects when calibration significantly altered the raw model output.

interface Layer2Result {
  override: boolean;
  details: string;
  shifts: Array<{ market: string; raw: number; calibrated: number; shift: number }>;
}

function computeLayer2Override(
  calibrated: CalibratedProbabilities,
  raw: MonteCarloResult,
): Layer2Result {
  const SHIFT_THRESHOLD = 0.10; // 10% shift triggers override

  const comparisons: Array<{ market: string; raw: number; calibrated: number; shift: number }> = [
    {
      market: 'home_win',
      raw: raw.homeWinProb,
      calibrated: calibrated.homeWin,
      shift: round4(calibrated.homeWin - raw.homeWinProb),
    },
    {
      market: 'draw',
      raw: raw.drawProb,
      calibrated: calibrated.draw,
      shift: round4(calibrated.draw - raw.drawProb),
    },
    {
      market: 'away_win',
      raw: raw.awayWinProb,
      calibrated: calibrated.awayWin,
      shift: round4(calibrated.awayWin - raw.awayWinProb),
    },
    {
      market: 'over_25',
      raw: raw.over25,
      calibrated: calibrated.over25,
      shift: round4(calibrated.over25 - raw.over25),
    },
    {
      market: 'btts_yes',
      raw: raw.bttsYes,
      calibrated: calibrated.bttsYes,
      shift: round4(calibrated.bttsYes - raw.bttsYes),
    },
  ];

  const significantShifts = comparisons.filter((c) => Math.abs(c.shift) > SHIFT_THRESHOLD);
  const override = significantShifts.length > 0;

  let details = '';
  if (override) {
    details = significantShifts
      .map((s) => `${s.market}: raw=${round4(s.raw)} → calibrated=${round4(s.calibrated)} (shift=${round4(s.shift)})`)
      .join('; ');
  }

  return { override, details, shifts: comparisons };
}

// ============================================================================
// Step 9: Select Best Pick or Abstain
// ============================================================================
// Strict multi-gate selection process. A candidate must pass ALL gates
// to become the best pick. Failure at any gate results in abstention.

function selectBestPickOrAbstain(
  rankedCandidates: MarketCandidate[],
  script: ScriptClassification,
  features: FeatureVector,
): { bestPick: MarketCandidate | null; abstained: boolean; abstentionReason?: string } {
  const surviving = rankedCandidates.filter((c) => !c.rejected);

  // ── Pre-check: no surviving candidates at all ─────────────────────────
  if (surviving.length === 0) {
    return {
      bestPick: null,
      abstained: true,
      abstentionReason: 'No viable market candidates after pruning',
    };
  }

  const topCandidate = surviving[0];

  // ── Gate 1: Priced markets OR model-only eligibility ──────────────────
  const hasPricedMarkets = surviving.some((c) => c.odds !== null);
  const modelOnlyEligible =
    topCandidate.probability >= 0.62 && topCandidate.finalScore >= 48;

  if (!hasPricedMarkets && !modelOnlyEligible) {
    return {
      bestPick: null,
      abstained: true,
      abstentionReason: `No priced markets and model-only eligibility not met (prob=${round4(topCandidate.probability)}, score=${round4(topCandidate.finalScore)})`,
    };
  }

  // ── Gate 2: Headline quality gates ────────────────────────────────────
  if (topCandidate.probability < 0.50) {
    return {
      bestPick: null,
      abstained: true,
      abstentionReason: `Best candidate probability ${round4(topCandidate.probability)} < 0.50 headline gate`,
    };
  }

  if (topCandidate.finalScore < 42) {
    return {
      bestPick: null,
      abstained: true,
      abstentionReason: `Best candidate score ${round4(topCandidate.finalScore)} < 42 headline gate`,
    };
  }

  // ── Gate 3: Separation check ─────────────────────────────────────────
  if (surviving.length >= 2) {
    const secondCandidate = surviving[1];
    const gap = topCandidate.finalScore - secondCandidate.finalScore;
    const separationThreshold = SEPARATION.withOdds; // 0.010 scaled to score
    const scoreGap = gap; // already on 0-100 scale, so use 1.0 as threshold

    if (scoreGap < 1.0) {
      // Very close scores — check if the gap is meaningful
      // The SEPARATION constant (0.010) applies to probability gaps
      const probGap = topCandidate.probability - secondCandidate.probability;
      if (probGap < SEPARATION.withOdds) {
        return {
          bestPick: null,
          abstained: true,
          abstentionReason: `Insufficient separation: prob gap ${round4(probGap)} < ${SEPARATION.withOdds}`,
        };
      }
    }
  }

  // ── Gate 4: No-edge rejection ─────────────────────────────────────────
  if (topCandidate.edgeLabel === 'NO EDGE') {
    return {
      bestPick: null,
      abstained: true,
      abstentionReason: 'Best pick has NO EDGE — no value detected',
    };
  }

  // ── Gate 5: Chaotic match abstention ──────────────────────────────────
  if (
    script.primary === 'chaotic_unreliable' &&
    topCandidate.probability < 0.65
  ) {
    return {
      bestPick: null,
      abstained: true,
      abstentionReason: `Chaotic match script with best probability ${round4(topCandidate.probability)} < 0.65`,
    };
  }

  // ── All gates passed ──────────────────────────────────────────────────
  return {
    bestPick: topCandidate,
    abstained: false,
  };
}

// ============================================================================
// MAIN: Select Markets (9-Step Pipeline)
// ============================================================================

/**
 * Execute the full 9-step market selection pipeline.
 *
 * Takes calibrated probabilities, the feature vector, script classification,
 * and raw Monte Carlo results through a rigorous selection process to either
 * identify the best market pick or abstain with a documented reason.
 *
 * @param calibratedProbs  Calibrated probabilities from the calibration layer
 * @param features         The full feature vector for this fixture
 * @param script           The match script classification
 * @param rawProbs         Raw Monte Carlo simulation results
 * @returns MarketSelection with best pick, all candidates, and abstention status
 */
export function selectMarkets(
  calibratedProbs: CalibratedProbabilities,
  features: FeatureVector,
  script: ScriptClassification,
  rawProbs: MonteCarloResult,
): MarketSelection {
  // ── Step 1: Assess match predictability ─────────────────────────────────
  const predictability = assessMatchPredictability(features);

  if (!predictability.isPredictable) {
    // Build candidates anyway for transparency, but mark all as rejected
    const candidates = buildMarketCandidates(calibratedProbs, features, rawProbs);
    for (const c of candidates) {
      c.rejected = true;
      c.rejectionReason = 'Match failed predictability gate';
    }

    return {
      bestPick: null,
      allCandidates: candidates,
      abstained: true,
      abstentionReason: `Unpredictable match: ${predictability.failureReasons.join('; ')}`,
      layer2Override: false,
    };
  }

  // ── Step 2: Build market candidates ─────────────────────────────────────
  let candidates = buildMarketCandidates(calibratedProbs, features, rawProbs);

  // ── Step 3: Apply market restrictions ───────────────────────────────────
  candidates = applyMarketRestrictions(candidates, features);

  // ── Step 4: Compute implied probabilities ───────────────────────────────
  candidates = computeImpliedProbabilities(candidates, features);

  // ── Step 5: Score market candidates ─────────────────────────────────────
  candidates = scoreMarketCandidates(candidates, script, features);

  // ── Step 6: Prune weak candidates ───────────────────────────────────────
  candidates = pruneWeakCandidates(candidates);

  // ── Step 7: Rank markets ────────────────────────────────────────────────
  candidates = rankMarkets(candidates, features);

  // ── Step 8: Compute Layer 2 override ────────────────────────────────────
  const layer2 = computeLayer2Override(calibratedProbs, rawProbs);

  // ── Step 9: Select best pick or abstain ─────────────────────────────────
  const selection = selectBestPickOrAbstain(candidates, script, features);

  return {
    bestPick: selection.bestPick,
    allCandidates: candidates,
    abstained: selection.abstained,
    abstentionReason: selection.abstentionReason,
    layer2Override: layer2.override,
    layer2Details: layer2.override ? layer2.details : undefined,
  };
}
