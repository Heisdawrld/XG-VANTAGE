// ============================================================================
// xG-Vantage V2 Engine — Prediction Engine (The Orchestrator)
// ============================================================================
// The main entry point that ties ALL V2 modules together into a clean,
// well-organised prediction pipeline. Every match prediction flows through
// the same 11-step pipeline, ensuring consistency and auditability.
//
// Public API:
//   1. predictMatch(fixtureId)        — full V2 prediction for a single match
//   2. predictUpcomingMatches()       — batch predictions for all upcoming
//   3. getTopPicks(max?)              — best predictions ranked by confidence
//   4. settlePredictions()            — settle finished matches, update loop
// ============================================================================

import type {
  V2Prediction,
  FeatureVector,
  FlatFeatureVector,
  ScriptClassification,
  XgEstimate,
  MonteCarloResult,
  CalibratedProbabilities,
  MarketSelection,
  ConfidenceProfile,
  FixtureRow,
} from './types';
import { ENGINE_VERSION, TIER_THRESHOLDS } from './constants';
import { buildFeatureVector, flattenFeatureVector } from './feature-builder';
import { classifyMatchScript } from './match-scripts';
import { estimateExpectedGoals } from './xg-estimator';
import { runMonteCarlo } from './monte-carlo';
import { calibrateProbabilities } from './calibration';
import { selectMarkets } from './market-selector';
import { buildConfidenceProfile } from './confidence-profile';
import { shouldAbstain, quickAbstentionCheck } from './abstention-engine';
import { settleAllPending } from './learning-loop';
import { client } from '@/lib/db-turso';

// ============================================================================
// Internal Helpers
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Generate a unique prediction ID */
function generatePredictionId(fixtureId: number): string {
  return `xgv3-${fixtureId}-${Date.now()}`;
}

// ============================================================================
// Step 9: Tier Classification
// ============================================================================
// Based on composite confidence and edge:
//   elite:    ≥80% composite
//   playable: ≥70%
//   value:    ≥55% + ≥10% edge
//   medium:   ≥60%
//   low:      <60%

function classifyTier(
  confidence: ConfidenceProfile,
  marketSelection: MarketSelection,
): V2Prediction['tier'] {
  const composite = confidence.composite;
  const edge = marketSelection.bestPick?.edge ?? 0;

  if (composite >= 80) return 'elite';
  if (composite >= 70) return 'playable';
  if (composite >= 55 && edge >= 0.10) return 'value';
  if (composite >= 60) return 'medium';
  return 'low';
}

/** Map tier to a human-readable label */
function tierLabel(tier: V2Prediction['tier'], script: ScriptClassification): string {
  const scriptName = script.primary.replace(/_/g, ' ');
  const tierCap = tier.charAt(0).toUpperCase() + tier.slice(1);
  return `${tierCap} — ${scriptName}`;
}

// ============================================================================
// Step 10a: Key Reasons (Top 5 Supporting Factors)
// ============================================================================
// Extract the strongest supporting signals from the feature vector.

function computeKeyReasons(
  features: FeatureVector,
  script: ScriptClassification,
  marketSelection: MarketSelection,
  xg: XgEstimate,
): string[] {
  const reasons: Array<{ text: string; weight: number }> = [];

  // ── Strength gap ──────────────────────────────────────────────────────
  const strengthGap = features.strength.strengthGap;
  if (Math.abs(strengthGap) > 0.3) {
    const direction = strengthGap > 0 ? 'Home' : 'Away';
    reasons.push({
      text: `${direction} team significantly stronger (gap=${round4(Math.abs(strengthGap))})`,
      weight: Math.abs(strengthGap) * 2,
    });
  }

  // ── Form momentum ─────────────────────────────────────────────────────
  if (features.form.homeStreakScore > 0.5) {
    reasons.push({
      text: `Home on hot streak (score=${round4(features.form.homeStreakScore)})`,
      weight: features.form.homeStreakScore,
    });
  }
  if (features.form.awayStreakScore > 0.5) {
    reasons.push({
      text: `Away on hot streak (score=${round4(features.form.awayStreakScore)})`,
      weight: features.form.awayStreakScore,
    });
  }

  // ── High scoring rates ────────────────────────────────────────────────
  const homeScoring = features.form.homeWeightedScored;
  const awayScoring = features.form.awayWeightedScored;
  if (homeScoring > 1.6) {
    reasons.push({
      text: `Home scoring heavily (${round4(homeScoring)} goals/game)`,
      weight: homeScoring / 2,
    });
  }
  if (awayScoring > 1.4) {
    reasons.push({
      text: `Away scoring well (${round4(awayScoring)} goals/game)`,
      weight: awayScoring / 2,
    });
  }

  // ── Defensive weakness ────────────────────────────────────────────────
  if (features.form.awayWeightedConceded > 1.5) {
    reasons.push({
      text: `Away defence leaky (${round4(features.form.awayWeightedConceded)} conceded/game)`,
      weight: features.form.awayWeightedConceded / 2,
    });
  }
  if (features.form.homeWeightedConceded > 1.5) {
    reasons.push({
      text: `Home defence leaky (${round4(features.form.homeWeightedConceded)} conceded/game)`,
      weight: features.form.homeWeightedConceded / 2,
    });
  }

  // ── Script fit ────────────────────────────────────────────────────────
  if (script.confidence > 0.7) {
    const scriptName = script.primary.replace(/_/g, ' ');
    reasons.push({
      text: `Strong script fit: ${scriptName} (conf=${round4(script.confidence)})`,
      weight: script.confidence,
    });
  }

  // ── xG differential ───────────────────────────────────────────────────
  const xgGap = Math.abs(xg.homeXg - xg.awayXg);
  if (xgGap > 0.5) {
    const direction = xg.homeXg > xg.awayXg ? 'Home' : 'Away';
    reasons.push({
      text: `${direction} xG advantage (home=${round4(xg.homeXg)} away=${round4(xg.awayXg)})`,
      weight: xgGap,
    });
  }

  // ── BTTS / Over rates ─────────────────────────────────────────────────
  const avgBtts = (features.form.homeBttsRate + features.form.awayBttsRate) / 2;
  const bestPick = marketSelection.bestPick;
  if (bestPick && (bestPick.marketKey === 'btts_yes' || bestPick.marketKey === 'over_25')) {
    if (avgBtts > 0.60) {
      reasons.push({
        text: `High BTTS rate (${round4(avgBtts)}) supports goals market`,
        weight: avgBtts,
      });
    }
  }

  // ── H2H support ───────────────────────────────────────────────────────
  if (features.h2h.totalMatches >= 3 && features.h2h.recencyWeight > 0.5) {
    reasons.push({
      text: `H2H data supports (${features.h2h.totalMatches} matches, recency=${round4(features.h2h.recencyWeight)})`,
      weight: features.h2h.recencyWeight * 0.5,
    });
  }

  // ── Motivation ────────────────────────────────────────────────────────
  const homeMotivation = features.context.homeMotivation;
  const awayMotivation = features.context.awayMotivation;
  if (homeMotivation === 'title_race' || homeMotivation === 'relegation') {
    reasons.push({
      text: `Home has high motivation (${homeMotivation})`,
      weight: 0.6,
    });
  }
  if (awayMotivation === 'title_race' || awayMotivation === 'relegation') {
    reasons.push({
      text: `Away has high motivation (${awayMotivation})`,
      weight: 0.5,
    });
  }

  // ── Market edge ───────────────────────────────────────────────────────
  if (bestPick && bestPick.edge > 0.10) {
    reasons.push({
      text: `Strong edge detected: ${bestPick.edgeLabel} (${round4(bestPick.edge)})`,
      weight: bestPick.edge * 2,
    });
  }

  // Sort by weight descending, take top 5
  reasons.sort((a, b) => b.weight - a.weight);
  return reasons.slice(0, 5).map((r) => r.text);
}

// ============================================================================
// Step 10b: Contradicting Reasons (Top 3 Concerns)
// ============================================================================
// Extract the strongest signals that contradict the prediction.

function computeContradictingReasons(
  features: FeatureVector,
  marketSelection: MarketSelection,
  confidence: ConfidenceProfile,
): string[] {
  const concerns: Array<{ text: string; weight: number }> = [];

  // ── High volatility ───────────────────────────────────────────────────
  if (features.volatility.volatilityScore > 0.5) {
    concerns.push({
      text: `High match volatility (${round4(features.volatility.volatilityScore)})`,
      weight: features.volatility.volatilityScore,
    });
  }

  // ── Match chaos ───────────────────────────────────────────────────────
  if (features.volatility.matchChaos > 0.5) {
    concerns.push({
      text: `Match chaos elevated (${round4(features.volatility.matchChaos)})`,
      weight: features.volatility.matchChaos * 0.8,
    });
  }

  // ── Thin data ─────────────────────────────────────────────────────────
  if (features.volatility.dataCompleteness < 0.5) {
    concerns.push({
      text: `Incomplete data (completeness=${round4(features.volatility.dataCompleteness)})`,
      weight: (1 - features.volatility.dataCompleteness) * 0.7,
    });
  }

  // ── Missing lineup ────────────────────────────────────────────────────
  if (!features.lineup.hasLineupData) {
    concerns.push({
      text: 'No lineup data available',
      weight: 0.5,
    });
  }

  // ── Low motivation ────────────────────────────────────────────────────
  const avgMotivation = (features.context.homeMotivationScore + features.context.awayMotivationScore) / 2;
  if (avgMotivation < 0.40) {
    concerns.push({
      text: `Low team motivation (avg=${round4(avgMotivation)})`,
      weight: (0.40 - avgMotivation) * 2,
    });
  }

  // ── Derby factor ──────────────────────────────────────────────────────
  if (features.context.isDerby) {
    concerns.push({
      text: 'Derby match — historically unpredictable',
      weight: features.context.derbyIntensity * 0.6,
    });
  }

  // ── Injury concerns ───────────────────────────────────────────────────
  if (features.injury.homeKeyMissingCount > 0) {
    concerns.push({
      text: `Home missing ${features.injury.homeKeyMissingCount} key player(s)`,
      weight: features.injury.homeKeyMissingCount * 0.3,
    });
  }
  if (features.injury.awayKeyMissingCount > 0) {
    concerns.push({
      text: `Away missing ${features.injury.awayKeyMissingCount} key player(s)`,
      weight: features.injury.awayKeyMissingCount * 0.3,
    });
  }

  // ── Travel fatigue ────────────────────────────────────────────────────
  if (features.context.travelImpact > 0.3) {
    concerns.push({
      text: `Away travel fatigue (impact=${round4(features.context.travelImpact)})`,
      weight: features.context.travelImpact * 0.4,
    });
  }

  // ── Form variance ─────────────────────────────────────────────────────
  const avgFormVar = (features.volatility.homeFormVariance + features.volatility.awayFormVariance) / 2;
  if (avgFormVar > 1.5) {
    concerns.push({
      text: `Inconsistent recent form (variance=${round4(avgFormVar)})`,
      weight: avgFormVar * 0.3,
    });
  }

  // ── Confidence downgrades ─────────────────────────────────────────────
  if (confidence.downgrades.length > 0) {
    concerns.push({
      text: `Confidence downgraded: ${confidence.downgrades[0]}`,
      weight: 0.6,
    });
  }

  // ── Abstention signal ─────────────────────────────────────────────────
  if (marketSelection.abstained) {
    concerns.push({
      text: `Market selector abstained: ${marketSelection.abstentionReason ?? 'unknown'}`,
      weight: 0.9,
    });
  }

  // Sort by weight descending, take top 3
  concerns.sort((a, b) => b.weight - a.weight);
  return concerns.slice(0, 3).map((c) => c.text);
}

// ============================================================================
// Step 10c: Tactical Matchup String
// ============================================================================

function buildTacticalMatchup(
  script: ScriptClassification,
  features: FeatureVector,
): string {
  const homeStyle = features.profile.homeStyle || 'balanced';
  const awayStyle = features.profile.awayStyle || 'balanced';
  const scriptName = script.primary.replace(/_/g, ' ');
  const clash = features.profile.styleClash > 0.6 ? 'strong clash' : 'minor clash';

  return `${scriptName} | ${homeStyle} vs ${awayStyle} (${clash})`;
}

// ============================================================================
// Step 10d: Safe Bet / Value Bet Flags
// ============================================================================

function isSafeBet(
  marketSelection: MarketSelection,
  confidence: ConfidenceProfile,
  features: FeatureVector,
): boolean {
  const bestPick = marketSelection.bestPick;
  if (!bestPick) return false;

  return (
    bestPick.riskClassification === 'SAFE' &&
    confidence.composite >= 70 &&
    features.volatility.volatilityScore < 0.40 &&
    bestPick.probability >= 0.65
  );
}

function isValueBet(
  marketSelection: MarketSelection,
  confidence: ConfidenceProfile,
): boolean {
  const bestPick = marketSelection.bestPick;
  if (!bestPick) return false;

  return (
    bestPick.edge > 0.10 &&
    confidence.value === 'high' &&
    (confidence.model === 'high' || confidence.model === 'medium')
  );
}

// ============================================================================
// Step 11: Store to DB
// ============================================================================

/**
 * Ensure the predictions_v2 table exists with the correct schema.
 * The canonical schema is defined in @/lib/migrate.ts.
 * If the table exists with a wrong schema (missing xg_home or prediction_id),
 * we drop it so the migration can recreate it correctly.
 */
let v2TableEnsured = false;
async function ensurePredictionsV2Table(): Promise<void> {
  if (v2TableEnsured) return;

  try {
    // Check if the table has the correct schema
    const cols = await client.execute({
      sql: "SELECT name FROM pragma_table_info('predictions_v2')",
      args: [],
    });
    const colNames = cols.rows.map(r => r.name as string);

    if (colNames.length > 0 && (!colNames.includes('xg_home') || !colNames.includes('prediction_id'))) {
      console.log('[prediction-engine] predictions_v2 has wrong schema — dropping for rebuild by migration...');
      await client.execute('DROP TABLE predictions_v2');
      // The migration will recreate it on next pipeline run.
      // For now, create it with the correct schema as a safety net:
      await client.execute(`
        CREATE TABLE predictions_v2 (
          prediction_id TEXT NOT NULL PRIMARY KEY,
          fixture_id INTEGER NOT NULL,
          home_team_id INTEGER NOT NULL,
          away_team_id INTEGER NOT NULL,
          league_id INTEGER NOT NULL,
          pick_type TEXT NOT NULL DEFAULT '',
          confidence REAL NOT NULL DEFAULT 0,
          tier TEXT NOT NULL DEFAULT 'medium',
          xg_home REAL NOT NULL DEFAULT 0,
          xg_away REAL NOT NULL DEFAULT 0,
          script TEXT NOT NULL DEFAULT '',
          calibrated_probs TEXT NOT NULL DEFAULT '{}',
          market_selection TEXT NOT NULL DEFAULT '{}',
          feature_vector TEXT NOT NULL DEFAULT '{}',
          confidence_profile TEXT NOT NULL DEFAULT '{}',
          key_reasons TEXT NOT NULL DEFAULT '[]',
          contradicting_reasons TEXT NOT NULL DEFAULT '[]',
          tactical_matchup TEXT NOT NULL DEFAULT '',
          safe_bet INTEGER NOT NULL DEFAULT 0,
          value_bet INTEGER NOT NULL DEFAULT 0,
          top_scorelines TEXT NOT NULL DEFAULT '[]',
          engine_version TEXT NOT NULL DEFAULT '',
          data_quality TEXT NOT NULL DEFAULT 'partial',
          generated_at TEXT NOT NULL,
          result TEXT DEFAULT 'pending',
          settled INTEGER NOT NULL DEFAULT 0,
          settled_at TEXT
        )
      `);
    } else if (colNames.length === 0) {
      // Table doesn't exist — create it
      await client.execute(`
        CREATE TABLE predictions_v2 (
          prediction_id TEXT NOT NULL PRIMARY KEY,
          fixture_id INTEGER NOT NULL,
          home_team_id INTEGER NOT NULL,
          away_team_id INTEGER NOT NULL,
          league_id INTEGER NOT NULL,
          pick_type TEXT NOT NULL DEFAULT '',
          confidence REAL NOT NULL DEFAULT 0,
          tier TEXT NOT NULL DEFAULT 'medium',
          xg_home REAL NOT NULL DEFAULT 0,
          xg_away REAL NOT NULL DEFAULT 0,
          script TEXT NOT NULL DEFAULT '',
          calibrated_probs TEXT NOT NULL DEFAULT '{}',
          market_selection TEXT NOT NULL DEFAULT '{}',
          feature_vector TEXT NOT NULL DEFAULT '{}',
          confidence_profile TEXT NOT NULL DEFAULT '{}',
          key_reasons TEXT NOT NULL DEFAULT '[]',
          contradicting_reasons TEXT NOT NULL DEFAULT '[]',
          tactical_matchup TEXT NOT NULL DEFAULT '',
          safe_bet INTEGER NOT NULL DEFAULT 0,
          value_bet INTEGER NOT NULL DEFAULT 0,
          top_scorelines TEXT NOT NULL DEFAULT '[]',
          engine_version TEXT NOT NULL DEFAULT '',
          data_quality TEXT NOT NULL DEFAULT 'partial',
          generated_at TEXT NOT NULL,
          result TEXT DEFAULT 'pending',
          settled INTEGER NOT NULL DEFAULT 0,
          settled_at TEXT
        )
      `);
    }
    v2TableEnsured = true;
  } catch {
    // Table may already exist with correct schema — that's fine
    v2TableEnsured = true;
  }
}

async function storePrediction(prediction: V2Prediction): Promise<void> {
  try {
    await ensurePredictionsV2Table();

    await client.execute({
      sql: `INSERT OR REPLACE INTO predictions_v2 (
              fixture_id, home_team_id, away_team_id, league_id,
              pick_type, confidence, tier,
              xg_home, xg_away, script,
              calibrated_probs, market_selection, feature_vector,
              confidence_profile, key_reasons, contradicting_reasons,
              tactical_matchup, safe_bet, value_bet,
              top_scorelines, engine_version, data_quality,
              prediction_id, generated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        prediction.fixtureId,
        prediction.homeTeamId,
        prediction.awayTeamId,
        prediction.leagueId,
        prediction.marketSelection.bestPick?.marketKey ?? '',
        prediction.confidence.composite,
        prediction.tier,
        prediction.xg.homeXg,
        prediction.xg.awayXg,
        prediction.script.primary,
        JSON.stringify(prediction.calibratedProbs),
        JSON.stringify(prediction.marketSelection),
        JSON.stringify(prediction.features),
        JSON.stringify(prediction.confidence),
        JSON.stringify(prediction.keyReasons),
        JSON.stringify(prediction.contradictingReasons),
        prediction.tacticalMatchup,
        prediction.safeBet ? 1 : 0,
        prediction.valueBet ? 1 : 0,
        JSON.stringify(prediction.topScorelines),
        prediction.engineVersion,
        prediction.dataQuality,
        prediction.predictionId,
        prediction.generatedAt,
      ],
    });
  } catch (error) {
    console.error(`[prediction-engine] Failed to store prediction for fixture ${prediction.fixtureId}:`, error);
  }
}

// ============================================================================
// MAIN: predictMatch — Full 11-Step Pipeline
// ============================================================================

/**
 * Generate a full V2 prediction for a single match.
 *
 * Pipeline (11 steps):
 *   1. Build Feature Vector
 *   2. Classify Match Script + Quick Abstention Check
 *   3. Estimate xG (10-layer pipeline)
 *   4. Run Monte Carlo (50K simulations)
 *   5. Calibrate Probabilities
 *   6. Select Markets (9-step pipeline)
 *   7. Build Confidence Profile
 *   8. Full Abstention Check
 *   9. Classify Tier
 *  10. Build Final Prediction (reasons, flags, scorelines)
 *  11. Store to DB
 *
 * @param fixtureId  The fixture ID to predict
 * @returns V2Prediction with all pipeline results
 */
export async function predictMatch(fixtureId: number): Promise<V2Prediction> {
  const predictionId = generatePredictionId(fixtureId);
  const generatedAt = new Date().toISOString();

  // ── Step 1: Build Feature Vector ────────────────────────────────────────
  const features: FeatureVector = await buildFeatureVector(fixtureId);
  const flatFeatures: FlatFeatureVector = flattenFeatureVector(features);

  // Fetch fixture metadata for team/league names
  let homeTeamId = 0;
  let awayTeamId = 0;
  let leagueId = 0;
  let homeTeamName = '';
  let awayTeamName = '';
  let leagueName = '';

  try {
    const fixtureRes = await client.execute({
      sql: `SELECT f.home_team_id, f.away_team_id, f.league_id,
                   ht.name as home_team_name, at.name as away_team_name, l.name as league_name
            FROM fixtures f
            LEFT JOIN teams ht ON ht.id = f.home_team_id
            LEFT JOIN teams at ON at.id = f.away_team_id
            LEFT JOIN leagues l ON l.id = f.league_id
            WHERE f.id = ?`,
      args: [fixtureId],
    });
    if (fixtureRes.rows.length > 0) {
      const r = fixtureRes.rows[0];
      homeTeamId = Number(r.home_team_id ?? 0);
      awayTeamId = Number(r.away_team_id ?? 0);
      leagueId = Number(r.league_id ?? 0);
      homeTeamName = String(r.home_team_name ?? 'Unknown');
      awayTeamName = String(r.away_team_name ?? 'Unknown');
      leagueName = String(r.league_name ?? 'Unknown');
    }
  } catch {
    // Continue with defaults
  }

  // ── Step 2: Classify Match Script ──────────────────────────────────────
  const script: ScriptClassification = classifyMatchScript(features);

  // Early abstention check
  const quickCheck = quickAbstentionCheck(features);
  if (quickCheck.shouldSkip) {
    // Build a minimal V2Prediction with abstention flag
    return buildAbstentionPrediction({
      fixtureId,
      homeTeamId,
      awayTeamId,
      leagueId,
      homeTeamName,
      awayTeamName,
      leagueName,
      features,
      flatFeatures,
      script,
      predictionId,
      generatedAt,
      abstentionReason: quickCheck.reason ?? 'Quick abstention triggered',
    });
  }

  // ── Step 3: Estimate xG (10-layer pipeline) ────────────────────────────
  const xg: XgEstimate = estimateExpectedGoals(features, script);

  // ── Step 4: Run Monte Carlo (50K simulations) ──────────────────────────
  const rawProbs: MonteCarloResult = runMonteCarlo(
    xg.homeXg,
    xg.awayXg,
    features.volatility.volatilityScore,
  );

  // ── Step 5: Calibrate Probabilities ────────────────────────────────────
  const calibratedProbs: CalibratedProbabilities = await calibrateProbabilities(
    rawProbs,
    script,
    features,
  );

  // ── Step 6: Select Markets (9-step pipeline) ───────────────────────────
  const marketSelection: MarketSelection = selectMarkets(
    calibratedProbs,
    features,
    script,
    rawProbs,
  );

  // ── Step 7: Build Confidence Profile ───────────────────────────────────
  const confidence: ConfidenceProfile = buildConfidenceProfile(
    marketSelection,
    features,
    xg,
  );

  // ── Step 8: Full Abstention Check ──────────────────────────────────────
  const partialPrediction: Partial<V2Prediction> = {
    fixtureId,
    homeTeamId,
    awayTeamId,
    leagueId,
    homeTeamName,
    awayTeamName,
    leagueName,
    features: flatFeatures,
    xg,
    script,
    rawProbs,
    calibratedProbs,
    marketSelection,
    confidence,
  };

  const abstentionResult = shouldAbstain(partialPrediction, features);
  if (abstentionResult.abstain) {
    // Override market selection to reflect abstention
    marketSelection.abstained = true;
    marketSelection.abstentionReason = abstentionResult.reason;
    marketSelection.bestPick = null;
  }

  // ── Step 9: Classify Tier ──────────────────────────────────────────────
  const tier = classifyTier(confidence, marketSelection);

  // ── Step 10: Build Final Prediction ────────────────────────────────────
  const keyReasons = computeKeyReasons(features, script, marketSelection, xg);
  const contradictingReasons = computeContradictingReasons(features, marketSelection, confidence);
  const tacticalMatchup = buildTacticalMatchup(script, features);
  const safeBet = isSafeBet(marketSelection, confidence, features);
  const valueBet = isValueBet(marketSelection, confidence);
  const topScorelines = rawProbs.topScores.slice(0, 10);

  const prediction: V2Prediction = {
    fixtureId,
    homeTeamId,
    awayTeamId,
    homeTeamName,
    awayTeamName,
    leagueId,
    leagueName,
    features: flatFeatures,
    xg,
    script,
    rawProbs,
    calibratedProbs,
    marketSelection,
    confidence,
    tier,
    tierLabel: tierLabel(tier, script),
    keyReasons,
    contradictingReasons,
    tacticalMatchup,
    safeBet,
    valueBet,
    topScorelines,
    engineVersion: ENGINE_VERSION,
    generatedAt,
    dataQuality: xg.dataQuality,
    enrichmentTier: features.volatility.enrichmentTier,
    predictionId,
  };

  // ── Step 11: Store to DB ───────────────────────────────────────────────
  await storePrediction(prediction);

  return prediction;
}

// ============================================================================
// Abstention Prediction Builder
// ============================================================================
// Builds a minimal V2Prediction when early abstention is triggered,
// avoiding expensive Monte Carlo and calibration steps.

function buildAbstentionPrediction(params: {
  fixtureId: number;
  homeTeamId: number;
  awayTeamId: number;
  leagueId: number;
  homeTeamName: string;
  awayTeamName: string;
  leagueName: string;
  features: FeatureVector;
  flatFeatures: FlatFeatureVector;
  script: ScriptClassification;
  predictionId: string;
  generatedAt: string;
  abstentionReason: string;
}): V2Prediction {
  const emptyMarketSelection: MarketSelection = {
    bestPick: null,
    allCandidates: [],
    abstained: true,
    abstentionReason: params.abstentionReason,
    layer2Override: false,
  };

  const confidence: ConfidenceProfile = {
    model: 'low',
    value: 'low',
    volatility: 'high',
    composite: 15,
    downgrades: [params.abstentionReason],
  };

  return {
    fixtureId: params.fixtureId,
    homeTeamId: params.homeTeamId,
    awayTeamId: params.awayTeamId,
    homeTeamName: params.homeTeamName,
    awayTeamName: params.awayTeamName,
    leagueId: params.leagueId,
    leagueName: params.leagueName,
    features: params.flatFeatures,
    xg: {
      homeXg: 0,
      awayXg: 0,
      totalXg: 0,
      layers: [],
      confidence: 0,
      dataQuality: 'thin',
    },
    script: params.script,
    rawProbs: {
      simulations: 0,
      homeWinProb: 0, drawProb: 0, awayWinProb: 0,
      over15: 0, over25: 0, over35: 0,
      under15: 0, under25: 0, under35: 0,
      bttsYes: 0, bttsNo: 0,
      homeOver05: 0, awayOver05: 0,
      homeOver15: 0, awayOver15: 0,
      scoreMatrix: [],
      mostLikelyScore: [0, 0],
      mostLikelyScoreProb: 0,
      topScores: [],
      homeGoalsDist: [],
      awayGoalsDist: [],
    },
    calibratedProbs: {
      homeWin: 0, draw: 0, awayWin: 0,
      over15: 0, over25: 0, over35: 0,
      bttsYes: 0, bttsNo: 0,
      scriptAdjustments: {},
      calibrationConfidence: 0,
    },
    marketSelection: emptyMarketSelection,
    confidence,
    tier: 'low',
    tierLabel: `Low — ${params.script.primary.replace(/_/g, ' ')}`,
    keyReasons: [],
    contradictingReasons: [params.abstentionReason],
    tacticalMatchup: `${params.script.primary.replace(/_/g, ' ')} | abstained`,
    safeBet: false,
    valueBet: false,
    topScorelines: [],
    engineVersion: ENGINE_VERSION,
    generatedAt: params.generatedAt,
    dataQuality: 'thin',
    enrichmentTier: 'thin',
    predictionId: params.predictionId,
  };
}

// ============================================================================
// predictUpcomingMatches — Batch Prediction
// ============================================================================

/**
 * Generate predictions for all upcoming matches.
 *
 * Queries fixtures with match_status 'not_started' or 'upcoming',
 * then calls predictMatch for each fixture, processing 5 at a time
 * to avoid overwhelming the database.
 *
 * @returns Array of V2Prediction objects for all upcoming matches
 */
export async function predictUpcomingMatches(): Promise<V2Prediction[]> {
  try {
    const result = await client.execute({
      sql: `SELECT id FROM fixtures
            WHERE status IN ('not_started', 'upcoming', 'notstarted', 'notstarted')
              AND event_date >= date('now', '-1 day')
            ORDER BY event_date ASC`,
      args: [],
    });

    const fixtureIds = result.rows.map((r) => Number(r.id));
    const predictions: V2Prediction[] = [];

    // Process in batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < fixtureIds.length; i += BATCH_SIZE) {
      const batch = fixtureIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((id) =>
          predictMatch(id).catch((err) => {
            console.error(`[prediction-engine] Failed to predict fixture ${id}:`, err);
            return null;
          }),
        ),
      );

      for (const pred of batchResults) {
        if (pred !== null) {
          predictions.push(pred);
        }
      }
    }

    console.log(`[prediction-engine] Predicted ${predictions.length}/${fixtureIds.length} upcoming matches`);
    return predictions;
  } catch (error) {
    console.error('[prediction-engine] Failed to predict upcoming matches:', error);
    return [];
  }
}

// ============================================================================
// getTopPicks — Best Predictions Ranked by Confidence
// ============================================================================

/**
 * Get the best predictions ranked by confidence.
 *
 * Queries predictions_v2 where tier is elite/playable/value,
 * ordered by confidence descending. Falls back to re-predicting
 * if no stored predictions exist.
 *
 * @param max  Maximum number of picks to return (default 10)
 * @returns Array of V2Prediction objects, best first
 */
export async function getTopPicks(max: number = 10): Promise<V2Prediction[]> {
  try {
    await ensurePredictionsV2Table();

    const result = await client.execute({
      sql: `SELECT prediction_id, fixture_id, home_team_id, away_team_id,
                   league_id, pick_type, confidence, tier, xg_home, xg_away,
                   script, calibrated_probs, market_selection, feature_vector,
                   confidence_profile, key_reasons, contradicting_reasons,
                   tactical_matchup, safe_bet, value_bet, top_scorelines,
                   engine_version, data_quality, generated_at
            FROM predictions_v2
            WHERE tier IN ('elite', 'playable', 'value')
              AND settled = 0
            ORDER BY confidence DESC
            LIMIT ?`,
      args: [max],
    });

    if (result.rows.length === 0) {
      return [];
    }

    // Reconstruct V2Prediction objects from DB rows
    const picks: V2Prediction[] = [];

    for (const row of result.rows) {
      try {
        const fixtureId = Number(row.fixture_id);
        const homeTeamId = Number(row.home_team_id);
        const awayTeamId = Number(row.away_team_id);

        // Fetch team/league names
        let homeTeamName = '';
        let awayTeamName = '';
        let leagueName = '';
        let leagueId = Number(row.league_id);

        try {
          const nameRes = await client.execute({
            sql: `SELECT ht.name as home_team_name, at.name as away_team_name, l.name as league_name
                  FROM fixtures f
                  LEFT JOIN teams ht ON ht.id = f.home_team_id
                  LEFT JOIN teams at ON at.id = f.away_team_id
                  LEFT JOIN leagues l ON l.id = f.league_id
                  WHERE f.id = ?`,
            args: [fixtureId],
          });
          if (nameRes.rows.length > 0) {
            homeTeamName = String(nameRes.rows[0].home_team_name ?? '');
            awayTeamName = String(nameRes.rows[0].away_team_name ?? '');
            leagueName = String(nameRes.rows[0].league_name ?? '');
          }
        } catch {
          // Continue with empty names
        }

        const tier = (row.tier as V2Prediction['tier']) || 'medium';
        const scriptPrimary = String(row.script ?? 'balanced_high_event');

        // Parse JSON fields with fallbacks
        const calibratedProbs = JSON.parse(String(row.calibrated_probs ?? '{}'));
        const marketSelection = JSON.parse(String(row.market_selection ?? '{}'));
        const featureVector = JSON.parse(String(row.feature_vector ?? '{}'));
        const confidenceProfile = JSON.parse(String(row.confidence_profile ?? '{}'));
        const keyReasons = JSON.parse(String(row.key_reasons ?? '[]'));
        const contradictingReasons = JSON.parse(String(row.contradicting_reasons ?? '[]'));
        const topScorelines = JSON.parse(String(row.top_scorelines ?? '[]'));

        picks.push({
          fixtureId,
          homeTeamId,
          awayTeamId,
          homeTeamName,
          awayTeamName,
          leagueId,
          leagueName,
          features: featureVector,
          xg: {
            homeXg: Number(row.xg_home ?? 0),
            awayXg: Number(row.xg_away ?? 0),
            totalXg: Number(row.xg_home ?? 0) + Number(row.xg_away ?? 0),
            layers: [],
            confidence: 0,
            dataQuality: (row.data_quality as XgEstimate['dataQuality']) ?? 'partial',
          },
          script: {
            primary: scriptPrimary as ScriptClassification['primary'],
            controlScore: 0,
            eventLevelScore: 0,
            volatilityScore: 0,
            scriptScores: {} as ScriptClassification['scriptScores'],
            confidence: 0,
          },
          rawProbs: {
            simulations: 0,
            homeWinProb: calibratedProbs.homeWin ?? 0,
            drawProb: calibratedProbs.draw ?? 0,
            awayWinProb: calibratedProbs.awayWin ?? 0,
            over15: calibratedProbs.over15 ?? 0,
            over25: calibratedProbs.over25 ?? 0,
            over35: calibratedProbs.over35 ?? 0,
            under15: 1 - (calibratedProbs.over15 ?? 0),
            under25: 1 - (calibratedProbs.over25 ?? 0),
            under35: 1 - (calibratedProbs.over35 ?? 0),
            bttsYes: calibratedProbs.bttsYes ?? 0,
            bttsNo: calibratedProbs.bttsNo ?? 0,
            homeOver05: 0, awayOver05: 0,
            homeOver15: 0, awayOver15: 0,
            scoreMatrix: [],
            mostLikelyScore: [0, 0],
            mostLikelyScoreProb: 0,
            topScores: topScorelines,
            homeGoalsDist: [],
            awayGoalsDist: [],
          },
          calibratedProbs,
          marketSelection,
          confidence: confidenceProfile,
          tier,
          tierLabel: `${tier.charAt(0).toUpperCase() + tier.slice(1)} — ${scriptPrimary.replace(/_/g, ' ')}`,
          keyReasons,
          contradictingReasons,
          tacticalMatchup: String(row.tactical_matchup ?? ''),
          safeBet: Number(row.safe_bet) === 1,
          valueBet: Number(row.value_bet) === 1,
          topScorelines,
          engineVersion: String(row.engine_version ?? ENGINE_VERSION),
          generatedAt: String(row.generated_at ?? new Date().toISOString()),
          dataQuality: (row.data_quality as V2Prediction['dataQuality']) ?? 'partial',
          enrichmentTier: 'partial',
          predictionId: String(row.prediction_id ?? ''),
        });
      } catch (parseError) {
        console.error(`[prediction-engine] Failed to parse prediction row:`, parseError);
      }
    }

    return picks;
  } catch (error) {
    console.error('[prediction-engine] Failed to get top picks:', error);
    return [];
  }
}

// ============================================================================
// settlePredictions — Settle Finished Matches
// ============================================================================

/**
 * Settle predictions for finished matches and update the learning loop.
 *
 * Delegates to settleAllPending from the learning-loop module,
 * which:
 *   1. Finds all unsettled predictions with finished fixtures
 *   2. Compares predictions against actual results
 *   3. Records Brier contributions and correctness
 *   4. Updates calibration bins
 *   5. Marks predictions as settled
 *
 * @returns Count of settled and failed settlements
 */
export async function settlePredictions(): Promise<{ settled: number; failed: number }> {
  try {
    const result = await settleAllPending();
    console.log(
      `[prediction-engine] Settlement complete: ${result.settled} settled, ${result.failed} failed`,
    );
    return result;
  } catch (error) {
    console.error('[prediction-engine] Failed to settle predictions:', error);
    return { settled: 0, failed: 0 };
  }
}
