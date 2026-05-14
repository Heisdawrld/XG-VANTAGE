// ============================================================================
// xG-Vantage V2 Engine — 10-Layer Progressive xG Refinement Pipeline
// ============================================================================
// The core goal expectation model. Each layer progressively refines the xG
// estimate from a naive base toward a deeply contextualised prediction.
// Every layer is a pure, testable function that returns an XgLayerResult
// for full auditability and debugging.
// ============================================================================

import type {
  FeatureVector,
  XgEstimate,
  XgLayerResult,
  ScriptClassification,
  MatchScript,
} from './types';
import {
  XG_PARAMS,
  SCRIPT_XG_NUDGES,
  MANAGER_STYLE_MULTIPLIERS,
  CONTEXT_PARAMS,
  MOMENTUM_PARAMS,
  ENRICHMENT_TIERS,
  LEAGUE_AVG_GOALS,
  HOME_ADVANTAGE_FACTOR,
} from './constants';

// ============================================================================
// Internal Helpers
// ============================================================================

/** Clamp a number between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Blend two values by weight: result = a * weightA + b * weightB */
function blend(a: number, b: number, weightA: number, weightB: number): number {
  const total = weightA + weightB;
  if (total === 0) return (a + b) / 2;
  return (a * weightA + b * weightB) / total;
}

/** Create a layer result capturing before/after state and description */
function makeLayer(
  name: string,
  homeBefore: number,
  awayBefore: number,
  homeAfter: number,
  awayAfter: number,
  adjustment: string,
): XgLayerResult {
  return {
    layer: name,
    homeBefore: round3(homeBefore),
    awayBefore: round3(awayBefore),
    homeAfter: round3(homeAfter),
    awayAfter: round3(awayAfter),
    adjustment,
  };
}

/** Round to 3 decimal places for readability */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ============================================================================
// Layer 1: Base xG — Attack/Defense Ratio Model
// ============================================================================
// The foundational Poisson-inspired estimate:
//   homeXg = (homeAttackStrength / awayDefenseStrength) × leagueAvg × homeAdv
//   awayXg = (awayAttackStrength / homeDefenseStrength) × leagueAvg
//
// Attack strength = team's avg goals scored / league avg goals
// Defense strength = team's avg goals conceded / league avg goals
// ============================================================================

export function computeBaseXg(features: FeatureVector): { homeXg: number; awayXg: number; layer: XgLayerResult } {
  const leagueAvg = XG_PARAMS.leagueAvg;
  const homeAdv = XG_PARAMS.homeAdvFactor;

  // Attack strength: weighted goals scored / league average
  const homeAttackStrength = features.form.homeWeightedScored / leagueAvg;
  const awayAttackStrength = features.form.awayWeightedScored / leagueAvg;

  // Defense strength: weighted goals conceded / league average
  const homeDefenseStrength = features.form.homeWeightedConceded / leagueAvg;
  const awayDefenseStrength = features.form.awayWeightedConceded / leagueAvg;

  // Guard against zero defense strength (would produce Infinity)
  const safeHomeDef = Math.max(homeDefenseStrength, 0.15);
  const safeAwayDef = Math.max(awayDefenseStrength, 0.15);

  const homeXg = (homeAttackStrength / safeAwayDef) * leagueAvg * homeAdv;
  const awayXg = (awayAttackStrength / safeHomeDef) * leagueAvg;

  const layer = makeLayer(
    'base_xg',
    0, 0,
    homeXg, awayXg,
    `homeAS=${round3(homeAttackStrength)} awayDS=${round3(safeAwayDef)} awayAS=${round3(awayAttackStrength)} homeDS=${round3(safeHomeDef)}`,
  );

  return { homeXg, awayXg, layer };
}

// ============================================================================
// Layer 2: Thin Data Regression
// ============================================================================
// When we don't have enough matches, we regress toward league average.
// This prevents extreme estimates from small sample sizes.
//   < 3 matches: blend 50% toward league avg
//   3-5 matches: blend 25% toward league avg
//   > 5 matches: no regression
// ============================================================================

export function applyThinDataRegression(
  homeXg: number,
  awayXg: number,
  features: FeatureVector,
): { homeXg: number; awayXg: number; layer: XgLayerResult } {
  const leagueAvg = XG_PARAMS.leagueAvg;
  const homeMatches = features.form.homeMatchCount;
  const awayMatches = features.form.awayMatchCount;

  let homeBlendWeight = 0;
  let awayBlendWeight = 0;
  const details: string[] = [];

  // Home team regression
  if (homeMatches < 3) {
    homeBlendWeight = XG_PARAMS.thinDataBlendBase; // 0.50
    details.push(`home<3(${homeMatches}):blend${(homeBlendWeight * 100).toFixed(0)}%`);
  } else if (homeMatches <= 5) {
    homeBlendWeight = 1 - XG_PARAMS.thinDataBlendWeak; // 0.25
    details.push(`home3-5(${homeMatches}):blend${(homeBlendWeight * 100).toFixed(0)}%`);
  } else {
    details.push(`home>5(${homeMatches}):no-reg`);
  }

  // Away team regression
  if (awayMatches < 3) {
    awayBlendWeight = XG_PARAMS.thinDataBlendBase;
    details.push(`away<3(${awayMatches}):blend${(awayBlendWeight * 100).toFixed(0)}%`);
  } else if (awayMatches <= 5) {
    awayBlendWeight = 1 - XG_PARAMS.thinDataBlendWeak;
    details.push(`away3-5(${awayMatches}):blend${(awayBlendWeight * 100).toFixed(0)}%`);
  } else {
    details.push(`away>5(${awayMatches}):no-reg`);
  }

  // Blend current estimate toward league avg with calculated weights
  // If blendWeight = 0.5, result = 50% current + 50% leagueAvg
  const regressedHomeXg = blend(homeXg, leagueAvg, 1 - homeBlendWeight, homeBlendWeight);
  const regressedAwayXg = blend(awayXg, leagueAvg, 1 - awayBlendWeight, awayBlendWeight);

  const layer = makeLayer(
    'thin_data_regression',
    homeXg, awayXg,
    regressedHomeXg, regressedAwayXg,
    details.join('; '),
  );

  return { homeXg: regressedHomeXg, awayXg: regressedAwayXg, layer };
}

// ============================================================================
// Layer 3: Venue Anchoring
// ============================================================================
// Blend current estimate with venue-specific (home-at-home / away-away) data.
// Home-at-home scoring rate for the home team.
// Away-away scoring rate for the away team.
// Weight: 65% current estimate / 35% venue-specific data
// ============================================================================

export function applyVenueAnchoring(
  homeXg: number,
  awayXg: number,
  features: FeatureVector,
): { homeXg: number; awayXg: number; layer: XgLayerResult } {
  const modelWeight = XG_PARAMS.venueModelWeight; // 0.65
  const dataWeight = XG_PARAMS.venueDataWeight;   // 0.35

  // Venue-specific xG from split features
  const homeAtHomeXg = features.split.homeAtHomeXg;
  const awayAtAwayXg = features.split.awayAtAwayXg;

  // Also consider venue scoring rates (goals scored at venue)
  const homeVenueRate = features.split.homeAtHomeScored;
  const awayVenueRate = features.split.awayAtAwayScored;

  // Venue estimate: average of venue xG and venue scoring rate
  const homeVenueEstimate = (homeAtHomeXg + homeVenueRate) / 2;
  const awayVenueEstimate = (awayAtAwayXg + awayVenueRate) / 2;

  const anchoredHomeXg = blend(homeXg, homeVenueEstimate, modelWeight, dataWeight);
  const anchoredAwayXg = blend(awayXg, awayVenueEstimate, modelWeight, dataWeight);

  const layer = makeLayer(
    'venue_anchoring',
    homeXg, awayXg,
    anchoredHomeXg, anchoredAwayXg,
    `venue_home=${round3(homeVenueEstimate)} venue_away=${round3(awayVenueEstimate)} w=${modelWeight}/${dataWeight}`,
  );

  return { homeXg: anchoredHomeXg, awayXg: anchoredAwayXg, layer };
}

// ============================================================================
// Layer 4: Script Adjustments
// ============================================================================
// Apply nudges from SCRIPT_XG_NUDGES based on the match script classification.
// These represent tactical/structural patterns that shift goal expectation.
// ============================================================================

export function applyScriptAdjustments(
  homeXg: number,
  awayXg: number,
  script: ScriptClassification,
): { homeXg: number; awayXg: number; layer: XgLayerResult } {
  const primaryScript = script.primary;
  const nudge = SCRIPT_XG_NUDGES[primaryScript];

  // If no nudge defined for this script, pass through
  if (!nudge) {
    return {
      homeXg,
      awayXg,
      layer: makeLayer('script_adjustments', homeXg, awayXg, homeXg, awayXg, `no-nudge:${primaryScript}`),
    };
  }

  // Scale nudge by script confidence — a weak script gets dampened adjustment
  const confidenceScale = clamp(script.confidence, 0.3, 1.0);
  const homeNudge = nudge.home * confidenceScale;
  const awayNudge = nudge.away * confidenceScale;

  const adjustedHomeXg = homeXg + homeNudge;
  const adjustedAwayXg = awayXg + awayNudge;

  const layer = makeLayer(
    'script_adjustments',
    homeXg, awayXg,
    adjustedHomeXg, adjustedAwayXg,
    `script=${primaryScript} conf=${round3(confidenceScale)} homeΔ=${round3(homeNudge)} awayΔ=${round3(awayNudge)}`,
  );

  return { homeXg: adjustedHomeXg, awayXg: adjustedAwayXg, layer };
}

// ============================================================================
// Layer 5: Form Boosts
// ============================================================================
// Attack momentum: hot streak (3+ wins) → boost homeXg by 0.10
// Defensive leakiness: away team conceding heavily → boost homeXg by 0.08
// Luck regression: overperforming xG by >0.5 → reduce by 0.10
// Last match memory: big win (3+ goals) → slight boost +0.05
// Lineup penalty: key players missing → reduce by injury xG impact
// ============================================================================

export function applyFormBoosts(
  homeXg: number,
  awayXg: number,
  features: FeatureVector,
): { homeXg: number; awayXg: number; layer: XgLayerResult } {
  const adjustments: string[] = [];
  let homeDelta = 0;
  let awayDelta = 0;

  // --- Attack momentum: hot streak ---
  if (features.form.homeStreakScore >= 0.6) {
    // 3+ wins in streak score terms (≥0.6)
    homeDelta += MOMENTUM_PARAMS.hotBoost; // 0.10
    adjustments.push(`home_hot_streak:+${MOMENTUM_PARAMS.hotBoost}`);
  }
  if (features.form.awayStreakScore >= 0.6) {
    awayDelta += MOMENTUM_PARAMS.hotBoost;
    adjustments.push(`away_hot_streak:+${MOMENTUM_PARAMS.hotBoost}`);
  }

  // Cold streak penalty
  if (features.form.homeStreakScore <= -0.6) {
    homeDelta -= MOMENTUM_PARAMS.coldPenalty; // -0.10
    adjustments.push(`home_cold_streak:-${MOMENTUM_PARAMS.coldPenalty}`);
  }
  if (features.form.awayStreakScore <= -0.6) {
    awayDelta -= MOMENTUM_PARAMS.coldPenalty;
    adjustments.push(`away_cold_streak:-${MOMENTUM_PARAMS.coldPenalty}`);
  }

  // --- Defensive leakiness ---
  // If away team is conceding heavily (weighted conceded > 1.5), boost home xG
  if (features.form.awayWeightedConceded > 1.5) {
    const leakinessBoost = 0.08;
    homeDelta += leakinessBoost;
    adjustments.push(`away_leaky_def:+${leakinessBoost}`);
  }
  // If home team is conceding heavily, boost away xG
  if (features.form.homeWeightedConceded > 1.5) {
    const leakinessBoost = 0.08;
    awayDelta += leakinessBoost;
    adjustments.push(`home_leaky_def:+${leakinessBoost}`);
  }

  // --- Luck regression ---
  // If team is overperforming xG by >0.5 goals, reduce by 0.10 (regression to mean)
  const homeXgOverperformance = features.form.homeWeightedScored - features.form.homeXgAvg;
  if (homeXgOverperformance > 0.5) {
    homeDelta -= 0.10;
    adjustments.push(`home_luck_regression:-0.10(overperf=${round3(homeXgOverperformance)})`);
  }
  const awayXgOverperformance = features.form.awayWeightedScored - features.form.awayXgAvg;
  if (awayXgOverperformance > 0.5) {
    awayDelta -= 0.10;
    adjustments.push(`away_luck_regression:-0.10(overperf=${round3(awayXgOverperformance)})`);
  }

  // --- Last match memory ---
  // If last match was a big win (3+ goals margin), slight boost
  if (features.lastMatch.homeAttackSignal > 0.5) {
    homeDelta += 0.05;
    adjustments.push('home_last_big_win:+0.05');
  }
  if (features.lastMatch.awayAttackSignal > 0.5) {
    awayDelta += 0.05;
    adjustments.push('away_last_big_win:+0.05');
  }

  // --- Lineup penalty: key players missing ---
  if (features.injury.homeXgImpact > 0) {
    homeDelta -= features.injury.homeXgImpact;
    adjustments.push(`home_injury_penalty:-${round3(features.injury.homeXgImpact)}`);
  }
  if (features.injury.awayXgImpact > 0) {
    awayDelta -= features.injury.awayXgImpact;
    adjustments.push(`away_injury_penalty:-${round3(features.injury.awayXgImpact)}`);
  }

  // Squad depth mitigation: if squad depth is high, reduce penalty
  if (features.injury.homeXgImpact > 0 && features.injury.homeSquadDepth > 0.7) {
    const mitigation = features.injury.homeXgImpact * 0.4; // recover 40% of penalty
    homeDelta += mitigation;
    adjustments.push(`home_depth_mitigation:+${round3(mitigation)}`);
  }
  if (features.injury.awayXgImpact > 0 && features.injury.awaySquadDepth > 0.7) {
    const mitigation = features.injury.awayXgImpact * 0.4;
    awayDelta += mitigation;
    adjustments.push(`away_depth_mitigation:+${round3(mitigation)}`);
  }

  const adjustedHomeXg = homeXg + homeDelta;
  const adjustedAwayXg = awayXg + awayDelta;

  const layer = makeLayer(
    'form_boosts',
    homeXg, awayXg,
    adjustedHomeXg, adjustedAwayXg,
    adjustments.length > 0 ? adjustments.join('; ') : 'no-adjustments',
  );

  return { homeXg: adjustedHomeXg, awayXg: adjustedAwayXg, layer };
}

// ============================================================================
// Layer 6: Odds Anchor
// ============================================================================
// If market odds available, blend: 65% engine / 35% implied total from odds.
// implied total = -ln(1 - impliedOver25Prob) × 2.2
// Split implied total proportionally between home/away based on odds ratio
// ============================================================================

export function applyOddsAnchor(
  homeXg: number,
  awayXg: number,
  features: FeatureVector,
): { homeXg: number; awayXg: number; layer: XgLayerResult } {
  // If no odds available, pass through
  if (!features.market.hasOdds || features.market.impliedOver25 <= 0 || features.market.impliedOver25 >= 1) {
    return {
      homeXg,
      awayXg,
      layer: makeLayer('odds_anchor', homeXg, awayXg, homeXg, awayXg, 'no-odds'),
    };
  }

  const engineWeight = XG_PARAMS.oddsEngineWeight;   // 0.65
  const impliedWeight = XG_PARAMS.oddsImpliedWeight;  // 0.35

  // Compute implied total goals from over 2.5 probability
  // Using the approximation: total = -ln(1 - P(over2.5)) × 2.2
  const impliedOver25Prob = clamp(features.market.impliedOver25, 0.05, 0.95);
  const impliedTotal = -Math.log(1 - impliedOver25Prob) * 2.2;

  // Split implied total between home and away based on odds ratio
  const homeWinProb = features.market.impliedHomeWin;
  const awayWinProb = features.market.impliedAwayWin;
  const totalWinProb = homeWinProb + awayWinProb;

  let impliedHomeXg: number;
  let impliedAwayXg: number;

  if (totalWinProb > 0) {
    const homeProportion = homeWinProb / totalWinProb;
    // Home team typically gets a slight edge (home advantage baked into odds)
    const adjustedProportion = homeProportion * 0.55 + 0.45 * (1 - homeProportion) * (homeProportion / (homeProportion + (1 - homeProportion)));
    impliedHomeXg = impliedTotal * clamp(homeProportion * 1.1, 0.3, 0.7); // slight home bias
    impliedAwayXg = impliedTotal - impliedHomeXg;
  } else {
    // Fallback: 55/45 split
    impliedHomeXg = impliedTotal * 0.55;
    impliedAwayXg = impliedTotal * 0.45;
  }

  // Blend engine estimate with odds-implied estimate
  const anchoredHomeXg = blend(homeXg, impliedHomeXg, engineWeight, impliedWeight);
  const anchoredAwayXg = blend(awayXg, impliedAwayXg, engineWeight, impliedWeight);

  const layer = makeLayer(
    'odds_anchor',
    homeXg, awayXg,
    anchoredHomeXg, anchoredAwayXg,
    `implied_total=${round3(impliedTotal)} implied_home=${round3(impliedHomeXg)} implied_away=${round3(impliedAwayXg)} w=${engineWeight}/${impliedWeight}`,
  );

  return { homeXg: anchoredHomeXg, awayXg: anchoredAwayXg, layer };
}

// ============================================================================
// Layer 7: Tactical AI
// ============================================================================
// Manager style multipliers: conservative ×0.85, attacking ×1.05, gung_ho ×1.12
// Counter-attack vs high-line: possession mismatch → boost counter-attack team +0.08
// High press vs low possession: pressing team gets +0.05 xG
// ============================================================================

export function applyTacticalAI(
  homeXg: number,
  awayXg: number,
  features: FeatureVector,
): { homeXg: number; awayXg: number; layer: XgLayerResult } {
  const adjustments: string[] = [];
  let homeMultiplier = 1.0;
  let awayMultiplier = 1.0;
  let homeDelta = 0;
  let awayDelta = 0;

  // --- Manager style multipliers ---
  const homeStyle = features.bsdIntel.homeManagerStyle;
  const awayStyle = features.bsdIntel.awayManagerStyle;

  if (homeStyle && MANAGER_STYLE_MULTIPLIERS[homeStyle]) {
    homeMultiplier *= MANAGER_STYLE_MULTIPLIERS[homeStyle].xgMultiplier;
    adjustments.push(`home_mgr_style:${homeStyle}×${MANAGER_STYLE_MULTIPLIERS[homeStyle].xgMultiplier}`);
  }
  if (awayStyle && MANAGER_STYLE_MULTIPLIERS[awayStyle]) {
    awayMultiplier *= MANAGER_STYLE_MULTIPLIERS[awayStyle].xgMultiplier;
    adjustments.push(`away_mgr_style:${awayStyle}×${MANAGER_STYLE_MULTIPLIERS[awayStyle].xgMultiplier}`);
  }

  // --- Counter-attack vs high-line ---
  // If one team has high possession (>58%) and the other has low (<42%), boost the
  // low-possession team (counter-attacking) by +0.08
  const homePoss = features.profile.homePossession;
  const awayPoss = features.profile.awayPossession;
  const possessionDiff = homePoss - awayPoss;

  if (possessionDiff > 16) {
    // Home dominates possession, away is counter-attacking
    awayDelta += 0.08;
    adjustments.push('away_counter_vs_high_line:+0.08');
  } else if (possessionDiff < -16) {
    // Away dominates possession, home is counter-attacking
    homeDelta += 0.08;
    adjustments.push('home_counter_vs_high_line:+0.08');
  }

  // --- High press vs low possession ---
  // Pressing team gets +0.05 xG (identified by style string containing 'press')
  const homePressing = features.profile.homeStyle.toLowerCase().includes('press');
  const awayPressing = features.profile.awayStyle.toLowerCase().includes('press');

  if (homePressing) {
    homeDelta += 0.05;
    adjustments.push('home_high_press:+0.05');
  }
  if (awayPressing) {
    awayDelta += 0.05;
    adjustments.push('away_high_press:+0.05');
  }

  // --- Style clash bonus ---
  // When styles clash significantly, there's often more open play
  if (features.profile.styleClash > 0.7) {
    const clashBonus = 0.03;
    homeDelta += clashBonus;
    awayDelta += clashBonus;
    adjustments.push(`style_clash:+${clashBonus}(both)`);
  }

  // Apply multipliers first, then deltas
  const adjustedHomeXg = homeXg * homeMultiplier + homeDelta;
  const adjustedAwayXg = awayXg * awayMultiplier + awayDelta;

  const layer = makeLayer(
    'tactical_ai',
    homeXg, awayXg,
    adjustedHomeXg, adjustedAwayXg,
    adjustments.length > 0 ? adjustments.join('; ') : 'no-tactical-adjustments',
  );

  return { homeXg: adjustedHomeXg, awayXg: adjustedAwayXg, layer };
}

// ============================================================================
// Layer 8: BSD Intelligence
// ============================================================================
// xG table data from standings (if available): blend 30% table xG
// Manager over/under bias: adjust total xG by manager's historical bias
// Player impact gap: significantly better player ratings → boost by 0.05 × gap
// Player rating gap: similar adjustment
// ============================================================================

export function applyBsdIntelligence(
  homeXg: number,
  awayXg: number,
  features: FeatureVector,
): { homeXg: number; awayXg: number; layer: XgLayerResult } {
  const adjustments: string[] = [];
  let homeXgAdj = homeXg;
  let awayXgAdj = awayXg;

  // --- xG table data from standings ---
  if (features.bsdIntel.homeXgTable !== null && features.bsdIntel.awayXgTable !== null) {
    const tableWeight = 0.30;
    const modelWeight = 0.70;

    // Per-game table xG (use as-is, they're typically per-game already)
    const homeTableXg = features.bsdIntel.homeXgTable;
    const awayTableXg = features.bsdIntel.awayXgTable;

    homeXgAdj = blend(homeXgAdj, homeTableXg, modelWeight, tableWeight);
    awayXgAdj = blend(awayXgAdj, awayTableXg, modelWeight, tableWeight);
    adjustments.push(`table_xg_blend:home=${round3(homeTableXg)} away=${round3(awayTableXg)} w=${modelWeight}/${tableWeight}`);
  }

  // --- Manager over/under bias ---
  // Adjust total xG by each manager's historical bias
  const homeManagerBias = features.bsdIntel.homeManagerOverBias;
  const awayManagerBias = features.bsdIntel.awayManagerOverBias;

  if (features.bsdIntel.hasManagerData) {
    // Home manager bias affects total xG proportionally
    const totalXgBefore = homeXgAdj + awayXgAdj;
    if (totalXgBefore > 0) {
      const homeBiasAdjust = homeManagerBias * 0.15; // scale bias effect
      const awayBiasAdjust = awayManagerBias * 0.15;

      // Adjust each team's xG proportionally
      homeXgAdj += homeBiasAdjust * (homeXgAdj / totalXgBefore) + awayBiasAdjust * (homeXgAdj / totalXgBefore);
      awayXgAdj += awayBiasAdjust * (awayXgAdj / totalXgBefore) + homeBiasAdjust * (awayXgAdj / totalXgBefore);
      adjustments.push(`mgr_bias:home=${round3(homeManagerBias)} away=${round3(awayManagerBias)}`);
    }
  }

  // --- Player impact gap ---
  if (features.bsdIntel.hasPlayerData) {
    const playerImpactGap = features.bsdIntel.playerImpactGap; // home - away
    const playerRatingGap = features.bsdIntel.playerRatingGap;

    // If one team has significantly better players (gap > 0.3), boost their xG
    if (Math.abs(playerImpactGap) > 0.3) {
      const boost = 0.05 * playerImpactGap; // positive = home advantage
      homeXgAdj += boost;
      awayXgAdj -= boost;
      adjustments.push(`player_impact_gap:${round3(playerImpactGap)} boost=${round3(boost)}`);
    }

    if (Math.abs(playerRatingGap) > 0.3) {
      const boost = 0.03 * playerRatingGap; // smaller effect for rating gap
      homeXgAdj += boost;
      awayXgAdj -= boost;
      adjustments.push(`player_rating_gap:${round3(playerRatingGap)} boost=${round3(boost)}`);
    }
  }

  const layer = makeLayer(
    'bsd_intelligence',
    homeXg, awayXg,
    homeXgAdj, awayXgAdj,
    adjustments.length > 0 ? adjustments.join('; ') : 'no-bsd-data',
  );

  return { homeXg: homeXgAdj, awayXg: awayXgAdj, layer };
}

// ============================================================================
// Layer 9: Deep Signals
// ============================================================================
// Profile-based xG: high shots on target per game → slight xG boost
// Referee chaos dampener: high card/goals rate → slightly increase total xG
// Form volatility: high variance → widen xG spread (increase total slightly)
// ============================================================================

export function applyDeepSignals(
  homeXg: number,
  awayXg: number,
  features: FeatureVector,
): { homeXg: number; awayXg: number; layer: XgLayerResult } {
  const adjustments: string[] = [];
  let homeDelta = 0;
  let awayDelta = 0;

  // --- Profile-based xG: shots on target boost ---
  // Teams averaging >5.5 shots on target per game get a slight xG boost
  const homeSot = features.profile.homeShotsOnTargetPerGame;
  const awaySot = features.profile.awayShotsOnTargetPerGame;

  if (homeSot > 5.5) {
    const boost = clamp((homeSot - 5.5) * 0.02, 0, 0.08);
    homeDelta += boost;
    adjustments.push(`home_sot_boost:+${round3(boost)}(sot=${round3(homeSot)})`);
  }
  if (awaySot > 5.5) {
    const boost = clamp((awaySot - 5.5) * 0.02, 0, 0.08);
    awayDelta += boost;
    adjustments.push(`away_sot_boost:+${round3(boost)}(sot=${round3(awaySot)})`);
  }

  // Low shots on target penalty (under 3.0)
  if (homeSot < 3.0 && homeSot > 0) {
    const penalty = clamp((3.0 - homeSot) * 0.015, 0, 0.06);
    homeDelta -= penalty;
    adjustments.push(`home_low_sot:-${round3(penalty)}(sot=${round3(homeSot)})`);
  }
  if (awaySot < 3.0 && awaySot > 0) {
    const penalty = clamp((3.0 - awaySot) * 0.015, 0, 0.06);
    awayDelta -= penalty;
    adjustments.push(`away_low_sot:-${round3(penalty)}(sot=${round3(awaySot)})`);
  }

  // --- Referee chaos dampener ---
  // If the match has high chaos score, slightly increase total xG
  // (chaotic matches tend to have more goals than expected)
  const matchChaos = features.volatility.matchChaos;
  if (matchChaos > 0.5) {
    const chaosBoost = (matchChaos - 0.5) * 0.12; // up to +0.06
    const totalXg = homeXg + awayXg;
    if (totalXg > 0) {
      homeDelta += chaosBoost * (homeXg / totalXg);
      awayDelta += chaosBoost * (awayXg / totalXg);
      adjustments.push(`chaos_boost:+${round3(chaosBoost)}(chaos=${round3(matchChaos)})`);
    }
  }

  // --- Form volatility: widen spread ---
  // High variance in recent results → slightly increase total xG
  // (volatile teams tend to produce more extreme results)
  const homeVol = features.volatility.homeFormVariance;
  const awayVol = features.volatility.awayFormVariance;
  const avgVol = (homeVol + awayVol) / 2;

  if (avgVol > 1.5) {
    const volatilityBoost = clamp((avgVol - 1.5) * 0.03, 0, 0.08);
    const totalXg = homeXg + awayXg;
    if (totalXg > 0) {
      homeDelta += volatilityBoost * (homeXg / totalXg);
      awayDelta += volatilityBoost * (awayXg / totalXg);
      adjustments.push(`volatility_spread:+${round3(volatilityBoost)}(var=${round3(avgVol)})`);
    }
  }

  // --- Corners threat signal ---
  // Teams averaging >7 corners per game tend to create more set-piece xG
  if (features.profile.homeCornersPerGame > 7.0) {
    homeDelta += 0.03;
    adjustments.push(`home_corners_boost:+0.03(corners=${round3(features.profile.homeCornersPerGame)})`);
  }
  if (features.profile.awayCornersPerGame > 7.0) {
    awayDelta += 0.03;
    adjustments.push(`away_corners_boost:+0.03(corners=${round3(features.profile.awayCornersPerGame)})`);
  }

  const adjustedHomeXg = homeXg + homeDelta;
  const adjustedAwayXg = awayXg + awayDelta;

  const layer = makeLayer(
    'deep_signals',
    homeXg, awayXg,
    adjustedHomeXg, adjustedAwayXg,
    adjustments.length > 0 ? adjustments.join('; ') : 'no-deep-signals',
  );

  return { homeXg: adjustedHomeXg, awayXg: adjustedAwayXg, layer };
}

// ============================================================================
// Layer 10: Context Adjustments
// ============================================================================
// Derby dampener: ×0.97 total xG (derbies are tighter)
// Travel distance dampener: if away team traveled far, reduce away xG
// Bad weather: ×0.95 total xG for heavy rain/snow
// Strict referee: ×0.98 total xG
// ============================================================================

export function applyContextAdjustments(
  homeXg: number,
  awayXg: number,
  features: FeatureVector,
): { homeXg: number; awayXg: number; layer: XgLayerResult } {
  const adjustments: string[] = [];
  let homeXgAdj = homeXg;
  let awayXgAdj = awayXg;

  // --- Derby dampener ---
  // Derbies tend to be tighter, lower-scoring affairs
  if (features.context.isDerby) {
    const derbyFactor = 0.97;
    homeXgAdj *= derbyFactor;
    awayXgAdj *= derbyFactor;
    adjustments.push(`derby_dampener:×${derbyFactor}`);
  }

  // --- Travel distance dampener ---
  // If away team traveled far (>500km), reduce their xG
  const travelImpact = features.context.travelImpact; // 0-1
  if (travelImpact > 0) {
    // Scale: 0.05 at travelImpact=0.3, up to 0.12 at travelImpact=0.8+
    const travelPenalty = clamp(travelImpact * 0.15, 0, 0.15);
    awayXgAdj *= (1 - travelPenalty);
    adjustments.push(`travel_dampener:away×${round3(1 - travelPenalty)}(impact=${round3(travelImpact)})`);
  }

  // --- Bad weather ---
  // Heavy rain/snow reduces total xG (harder to score in bad conditions)
  const weatherImpact = features.volatility.matchChaos > 0.6 ? 0 : 0; // placeholder
  // Use context travel/derby as proxy — real weather would come from fixture data
  // For now, check if volatility.dataCompleteness is very low (could indicate weather disruption)
  // A more sophisticated version would read weather_code from fixture data
  // We'll use a simplified approach: check if the context suggests weather issues
  const estimatedWeatherImpact = estimateWeatherImpact(features);
  if (estimatedWeatherImpact > 0.10) {
    const weatherFactor = 1 - clamp(estimatedWeatherImpact * 0.5, 0, 0.15);
    homeXgAdj *= weatherFactor;
    awayXgAdj *= weatherFactor;
    adjustments.push(`weather_dampener:×${round3(weatherFactor)}(impact=${round3(estimatedWeatherImpact)})`);
  }

  // --- Rest advantage ---
  // If one team has significantly more rest, they perform better
  const restAdv = features.context.restAdvantage; // home - away days rest
  if (restAdv > 2) {
    // Home team well-rested relative to away
    const restBoost = clamp((restAdv - 2) * 0.02, 0, 0.06);
    homeXgAdj += restBoost;
    awayXgAdj -= restBoost * 0.5; // away team suffers half the penalty
    adjustments.push(`rest_adv_home:+${round3(restBoost)}(rest_diff=${restAdv}d)`);
  } else if (restAdv < -2) {
    // Away team well-rested relative to home
    const restBoost = clamp((-restAdv - 2) * 0.02, 0, 0.06);
    awayXgAdj += restBoost;
    homeXgAdj -= restBoost * 0.5;
    adjustments.push(`rest_adv_away:+${round3(restBoost)}(rest_diff=${restAdv}d)`);
  }

  // --- Fixture congestion ---
  // If a team has played many games recently, they may be fatigued
  if (features.context.fixtureCongestion > 0.7) {
    const congestionPenalty = (features.context.fixtureCongestion - 0.7) * 0.10;
    // Penalize both teams slightly (both likely congested in same league)
    homeXgAdj -= congestionPenalty * 0.5;
    awayXgAdj -= congestionPenalty * 0.5;
    adjustments.push(`congestion_penalty:-${round3(congestionPenalty)}(cong=${round3(features.context.fixtureCongestion)})`);
  }

  // --- Motivation asymmetry ---
  // If one team has much higher motivation, they tend to overperform
  const homeMotivation = features.context.homeMotivationScore;
  const awayMotivation = features.context.awayMotivationScore;
  const motivationDiff = homeMotivation - awayMotivation;

  if (Math.abs(motivationDiff) > 0.3) {
    const motivationBoost = clamp(Math.abs(motivationDiff) * 0.06, 0, 0.08);
    if (motivationDiff > 0) {
      homeXgAdj += motivationBoost;
      adjustments.push(`home_motivation_boost:+${round3(motivationBoost)}(m=${round3(homeMotivation)})`);
    } else {
      awayXgAdj += motivationBoost;
      adjustments.push(`away_motivation_boost:+${round3(motivationBoost)}(m=${round3(awayMotivation)})`);
    }
  }

  // --- Strict referee (proxy via low chaos and low volatility) ---
  // Matches with low chaos tend to have fewer goals
  if (features.volatility.matchChaos < 0.2) {
    const strictFactor = 0.98;
    homeXgAdj *= strictFactor;
    awayXgAdj *= strictFactor;
    adjustments.push(`strict_referee:×${strictFactor}`);
  }

  const layer = makeLayer(
    'context_adjustments',
    homeXg, awayXg,
    homeXgAdj, awayXgAdj,
    adjustments.length > 0 ? adjustments.join('; ') : 'no-context-adjustments',
  );

  return { homeXg: homeXgAdj, awayXg: awayXgAdj, layer };
}

// ============================================================================
// Weather Impact Estimation (helper for Layer 10)
// ============================================================================
// Estimates weather impact from available features.
// In a full implementation, this would use weather_code from fixture data.
// ============================================================================

function estimateWeatherImpact(features: FeatureVector): number {
  // If we have extremely low data completeness, it might indicate weather issues
  // (matches with weather disruptions often have incomplete data)
  if (features.volatility.dataCompleteness < 0.4) {
    return 0.10;
  }
  // No weather impact detected from available signals
  return 0;
}

// ============================================================================
// Capping Logic
// ============================================================================
// Per-team: [0.20, 2.50]
// Total: [0.80, 4.50]
// ============================================================================

function applyXgCaps(
  homeXg: number,
  awayXg: number,
): { homeXg: number; awayXg: number; wasCapped: boolean } {
  let wasCapped = false;

  // Per-team cap
  let cappedHome = clamp(homeXg, XG_PARAMS.perTeamMin, XG_PARAMS.perTeamMax);
  let cappedAway = clamp(awayXg, XG_PARAMS.perTeamMin, XG_PARAMS.perTeamMax);

  if (cappedHome !== homeXg || cappedAway !== awayXg) {
    wasCapped = true;
  }

  // Total cap
  const total = cappedHome + cappedAway;
  if (total < XG_PARAMS.totalMin) {
    // Scale up proportionally to reach minimum
    const scale = XG_PARAMS.totalMin / total;
    cappedHome *= scale;
    cappedAway *= scale;
    wasCapped = true;
  } else if (total > XG_PARAMS.totalMax) {
    // Scale down proportionally to reach maximum
    const scale = XG_PARAMS.totalMax / total;
    cappedHome *= scale;
    cappedAway *= scale;
    wasCapped = true;
  }

  // Final per-team clamp after total scaling
  cappedHome = clamp(cappedHome, XG_PARAMS.perTeamMin, XG_PARAMS.perTeamMax);
  cappedAway = clamp(cappedAway, XG_PARAMS.perTeamMin, XG_PARAMS.perTeamMax);

  return { homeXg: round3(cappedHome), awayXg: round3(cappedAway), wasCapped };
}

// ============================================================================
// Confidence Calculation
// ============================================================================
// Confidence is based on data quality, match count, and enrichment tier.
// Returns a value between 0 and 1.
// ============================================================================

function computeConfidence(features: FeatureVector): number {
  let confidence = 0.5; // start at neutral

  // Data completeness boost (0-0.25)
  confidence += features.volatility.dataCompleteness * 0.25;

  // Match count boost (0-0.15)
  const homeMatchBonus = clamp(features.form.homeMatchCount / 10, 0, 0.075);
  const awayMatchBonus = clamp(features.form.awayMatchCount / 10, 0, 0.075);
  confidence += homeMatchBonus + awayMatchBonus;

  // Odds availability boost (0-0.05)
  if (features.market.hasOdds) {
    confidence += 0.05;
  }

  // BSD intelligence boost (0-0.05)
  if (features.bsdIntel.hasManagerData) confidence += 0.02;
  if (features.bsdIntel.hasPlayerData) confidence += 0.03;

  // Lineup data boost (0-0.03)
  if (features.lineup.hasLineupData) {
    confidence += 0.03 * features.lineup.lineupConfidence;
  }

  // Penalty for high volatility (-0.10)
  if (features.volatility.volatilityScore > 0.6) {
    confidence -= 0.10;
  }

  // Penalty for thin match data (-0.05)
  if (features.form.homeMatchCount < 3 || features.form.awayMatchCount < 3) {
    confidence -= 0.05;
  }

  return clamp(confidence, 0.15, 0.95);
}

// ============================================================================
// Enrichment Tier Determination
// ============================================================================

function determineEnrichmentTier(features: FeatureVector): 'rich' | 'good' | 'partial' | 'thin' {
  const completeness = features.volatility.dataCompleteness;
  const homeMatches = features.form.homeMatchCount;
  const awayMatches = features.form.awayMatchCount;
  const minMatches = Math.min(homeMatches, awayMatches);

  if (completeness >= ENRICHMENT_TIERS.rich.minFeatures && minMatches >= ENRICHMENT_TIERS.rich.minMatches) {
    return 'rich';
  }
  if (completeness >= ENRICHMENT_TIERS.good.minFeatures && minMatches >= ENRICHMENT_TIERS.good.minMatches) {
    return 'good';
  }
  if (completeness >= ENRICHMENT_TIERS.partial.minFeatures && minMatches >= ENRICHMENT_TIERS.partial.minMatches) {
    return 'partial';
  }
  return 'thin';
}

// ============================================================================
// MAIN: 10-Layer Progressive xG Estimation Pipeline
// ============================================================================

/**
 * Estimate expected goals using the 10-layer progressive refinement pipeline.
 *
 * Each layer builds on the previous one, progressively refining the xG estimate
 * from a naive base toward a deeply contextualised prediction. Every layer
 * returns an XgLayerResult for full auditability.
 *
 * @param features  The fully assembled feature vector for this fixture
 * @param script    The script classification (match narrative type)
 * @returns XgEstimate with all layer results, confidence, and enrichment tier
 */
export function estimateExpectedGoals(
  features: FeatureVector,
  script: ScriptClassification,
): XgEstimate {
  const layers: XgLayerResult[] = [];

  // ── Layer 1: Base xG ──────────────────────────────────────────────────
  const l1 = computeBaseXg(features);
  layers.push(l1.layer);
  let homeXg = l1.homeXg;
  let awayXg = l1.awayXg;

  // ── Layer 2: Thin Data Regression ──────────────────────────────────────
  const l2 = applyThinDataRegression(homeXg, awayXg, features);
  layers.push(l2.layer);
  homeXg = l2.homeXg;
  awayXg = l2.awayXg;

  // ── Layer 3: Venue Anchoring ───────────────────────────────────────────
  const l3 = applyVenueAnchoring(homeXg, awayXg, features);
  layers.push(l3.layer);
  homeXg = l3.homeXg;
  awayXg = l3.awayXg;

  // ── Layer 4: Script Adjustments ────────────────────────────────────────
  const l4 = applyScriptAdjustments(homeXg, awayXg, script);
  layers.push(l4.layer);
  homeXg = l4.homeXg;
  awayXg = l4.awayXg;

  // ── Layer 5: Form Boosts ───────────────────────────────────────────────
  const l5 = applyFormBoosts(homeXg, awayXg, features);
  layers.push(l5.layer);
  homeXg = l5.homeXg;
  awayXg = l5.awayXg;

  // ── Layer 6: Odds Anchor ───────────────────────────────────────────────
  const l6 = applyOddsAnchor(homeXg, awayXg, features);
  layers.push(l6.layer);
  homeXg = l6.homeXg;
  awayXg = l6.awayXg;

  // ── Layer 7: Tactical AI ───────────────────────────────────────────────
  const l7 = applyTacticalAI(homeXg, awayXg, features);
  layers.push(l7.layer);
  homeXg = l7.homeXg;
  awayXg = l7.awayXg;

  // ── Layer 8: BSD Intelligence ──────────────────────────────────────────
  const l8 = applyBsdIntelligence(homeXg, awayXg, features);
  layers.push(l8.layer);
  homeXg = l8.homeXg;
  awayXg = l8.awayXg;

  // ── Layer 9: Deep Signals ──────────────────────────────────────────────
  const l9 = applyDeepSignals(homeXg, awayXg, features);
  layers.push(l9.layer);
  homeXg = l9.homeXg;
  awayXg = l9.awayXg;

  // ── Layer 10: Context Adjustments ──────────────────────────────────────
  const l10 = applyContextAdjustments(homeXg, awayXg, features);
  layers.push(l10.layer);
  homeXg = l10.homeXg;
  awayXg = l10.awayXg;

  // ── Apply capping ──────────────────────────────────────────────────────
  const capped = applyXgCaps(homeXg, awayXg);
  if (capped.wasCapped) {
    layers.push(makeLayer(
      'capping',
      homeXg, awayXg,
      capped.homeXg, capped.awayXg,
      `per-team:[${XG_PARAMS.perTeamMin},${XG_PARAMS.perTeamMax}] total:[${XG_PARAMS.totalMin},${XG_PARAMS.totalMax}]`,
    ));
  }

  // ── Compute confidence and enrichment ──────────────────────────────────
  const confidence = computeConfidence(features);
  const dataQuality = determineEnrichmentTier(features);

  return {
    homeXg: capped.homeXg,
    awayXg: capped.awayXg,
    totalXg: round3(capped.homeXg + capped.awayXg),
    layers,
    confidence: round3(confidence),
    dataQuality,
  };
}
