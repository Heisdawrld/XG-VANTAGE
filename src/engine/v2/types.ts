// ============================================================================
// xG-Vantage V2 Engine — Master Type Definitions
// ============================================================================

// --- Feature Vector Types ---

export interface FormFeatures {
  // Weighted scoring/conceding rates
  homeWeightedScored: number;
  homeWeightedConceded: number;
  awayWeightedScored: number;
  awayWeightedConceded: number;
  overallWeightedScored: number;
  overallWeightedConceded: number;
  // Streak & form points
  homeStreakScore: number; // -1 to 1
  awayStreakScore: number;
  formPointsHome: number; // 0-1
  formPointsAway: number;
  // xG averages
  homeXgAvg: number;
  awayXgAvg: number;
  homeXgConcededAvg: number;
  awayXgConcededAvg: number;
  // Win/draw/loss rates
  homeWinRate: number;
  homeDrawRate: number;
  homeLossRate: number;
  awayWinRate: number;
  awayDrawRate: number;
  awayLossRate: number;
  // BTTS & Over rates
  homeBttsRate: number;
  awayBttsRate: number;
  homeOver25Rate: number;
  awayOver25Rate: number;
  homeOver15Rate: number;
  awayOver15Rate: number;
  // Clean sheet
  homeCleanSheetRate: number;
  awayCleanSheetRate: number;
  // Match count (data quality)
  homeMatchCount: number;
  awayMatchCount: number;
}

export interface LastMatchMemory {
  homeAttackSignal: number; // -1 to 1
  homeDefenseSignal: number;
  homeVolatilitySignal: number;
  awayAttackSignal: number;
  awayDefenseSignal: number;
  awayVolatilitySignal: number;
}

export interface SplitFeatures {
  // Home-at-home stats
  homeAtHomeScored: number;
  homeAtHomeConceded: number;
  homeAtHomeXg: number;
  homeAtHomeWinRate: number;
  homeAtHomeBttsRate: number;
  homeAtHomeOver25: number;
  // Away-away stats
  awayAtAwayScored: number;
  awayAtAwayConceded: number;
  awayAtAwayXg: number;
  awayAtAwayWinRate: number;
  awayAtAwayBttsRate: number;
  awayAtAwayOver25: number;
}

export interface H2HFeatures {
  totalMatches: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  avgGoals: number;
  avgHomeGoals: number;
  avgAwayGoals: number;
  bttsRate: number;
  over25Rate: number;
  homeWinLast3: number;
  recencyWeight: number; // 0-1 based on data freshness
}

export interface TeamStrengthFeatures {
  homeBaseRating: number;
  homeAttackRating: number;
  homeDefenseRating: number;
  awayBaseRating: number;
  awayAttackRating: number;
  awayDefenseRating: number;
  strengthGap: number; // home - away base
  attackGap: number;
  defenseGap: number;
  leagueStrengthDiff: number;
}

export interface ContextFeatures {
  homeMotivation: MotivationType;
  awayMotivation: MotivationType;
  homeMotivationScore: number; // 0-1
  awayMotivationScore: number;
  homeRotationRisk: number; // 0-1
  awayRotationRisk: number;
  homeTablePosition: number;
  awayTablePosition: number;
  homePointsToSafety: number;
  awayPointsToSafety: number;
  isDerby: boolean;
  derbyIntensity: number; // 0-1
  travelDistance: number; // km estimate
  travelImpact: number; // 0-1
  restAdvantage: number; // home - away days rest, -5 to 5
  fixtureCongestion: number; // 0-1
  alignmentScore: number; // 0-1 how aligned both teams' motivation is
}

export type MotivationType =
  | 'title_race'
  | 'champions_league'
  | 'europa'
  | 'midtable'
  | 'relegation'
  | 'promoted'
  | 'friendly'
  | 'unknown';

export interface VolatilityFeatures {
  homeFormVariance: number; // variance of recent results
  awayFormVariance: number;
  homeUpsetRisk: number; // 0-1
  awayUpsetRisk: number;
  dataCompleteness: number; // 0-1
  matchChaos: number; // 0-1
  volatilityScore: number; // 0-1 composite
  enrichmentTier: 'rich' | 'good' | 'partial' | 'thin';
}

export interface MarketFeatures {
  impliedHomeWin: number;
  impliedDraw: number;
  impliedAwayWin: number;
  impliedOver25: number;
  impliedUnder25: number;
  impliedBttsYes: number;
  impliedBttsNo: number;
  hasOdds: boolean;
  oddsConfidence: number; // 0-1
  bookmakerMargin: number;
}

export interface BsdIntelligenceFeatures {
  homeXgTable: number | null;
  awayXgTable: number | null;
  homeManagerStyle: string | null;
  awayManagerStyle: string | null;
  homeManagerOverBias: number; // -1 to 1
  awayManagerOverBias: number;
  playerImpactGap: number; // home - away
  playerRatingGap: number;
  hasManagerData: boolean;
  hasPlayerData: boolean;
}

export interface InjuryFeatures {
  homeKeyMissingCount: number;
  awayKeyMissingCount: number;
  homeXgImpact: number; // estimated xG reduction
  awayXgImpact: number;
  homeSquadDepth: number; // 0-1
  awaySquadDepth: number;
}

export interface LineupFeatures {
  homePredictedStrength: number; // 0-1
  awayPredictedStrength: number;
  homeAttackerCount: number;
  awayAttackerCount: number;
  homeFormation: string | null;
  awayFormation: string | null;
  hasLineupData: boolean;
  lineupConfidence: number; // 0-1
}

export interface ProfileFeatures {
  homePossession: number;
  awayPossession: number;
  homeShotsPerGame: number;
  awayShotsPerGame: number;
  homeShotsOnTargetPerGame: number;
  awayShotsOnTargetPerGame: number;
  homeCornersPerGame: number;
  awayCornersPerGame: number;
  homeFoulsPerGame: number;
  awayFoulsPerGame: number;
  homeStyle: string;
  awayStyle: string;
  styleClash: number; // 0-1
}

export interface FeatureVector {
  form: FormFeatures;
  lastMatch: LastMatchMemory;
  split: SplitFeatures;
  h2h: H2HFeatures;
  strength: TeamStrengthFeatures;
  context: ContextFeatures;
  volatility: VolatilityFeatures;
  market: MarketFeatures;
  bsdIntel: BsdIntelligenceFeatures;
  injury: InjuryFeatures;
  lineup: LineupFeatures;
  profile: ProfileFeatures;
}

// --- Flattened Feature Vector (for model input) ---
export interface FlatFeatureVector {
  [key: string]: number;
}

// --- xG Estimate Types ---

export interface XgEstimate {
  homeXg: number;
  awayXg: number;
  totalXg: number;
  layers: XgLayerResult[];
  confidence: number; // 0-1
  dataQuality: 'rich' | 'good' | 'partial' | 'thin';
}

export interface XgLayerResult {
  layer: string;
  homeBefore: number;
  awayBefore: number;
  homeAfter: number;
  awayAfter: number;
  adjustment: string;
}

// --- Match Script Types ---

export type MatchScript =
  | 'dominant_home_pressure'
  | 'dominant_away_pressure'
  | 'open_end_to_end'
  | 'balanced_high_event'
  | 'tight_low_event'
  | 'chaotic_unreliable';

export interface ScriptClassification {
  primary: MatchScript;
  controlScore: number; // 0-1
  eventLevelScore: number; // 0-1
  volatilityScore: number; // 0-1
  scriptScores: Record<MatchScript, number>;
  confidence: number; // 0-1
}

// --- Monte Carlo Types ---

export interface SimulationResult {
  homeGoals: number;
  awayGoals: number;
}

export interface MonteCarloResult {
  simulations: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  over15: number;
  over25: number;
  over35: number;
  under15: number;
  under25: number;
  under35: number;
  bttsYes: number;
  bttsNo: number;
  homeOver05: number;
  awayOver05: number;
  homeOver15: number;
  awayOver15: number;
  scoreMatrix: number[][]; // 8x8
  mostLikelyScore: [number, number];
  mostLikelyScoreProb: number;
  topScores: Array<{ home: number; away: number; prob: number }>;
  homeGoalsDist: number[]; // P(home=0), P(home=1), ..., P(home=7)
  awayGoalsDist: number[]; // P(away=0), P(away=1), ..., P(away=7)
}

// --- Calibration Types ---

export interface CalibratedProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  over15: number;
  over25: number;
  over35: number;
  bttsYes: number;
  bttsNo: number;
  // Script micro-adjustments applied
  scriptAdjustments: Record<string, number>;
  // Calibration source
  calibrationConfidence: number; // 0-1
}

export interface CalibrationBin {
  lowerBound: number;
  upperBound: number;
  predictedCount: number;
  actualCount: number;
  actualRate: number;
}

export interface MarketCalibration {
  marketKey: string;
  bins: CalibrationBin[];
  totalSamples: number;
  brierScore: number;
  lastUpdated: string;
}

// --- Market Selection Types ---

export type MarketKey =
  | 'home_win'
  | 'draw'
  | 'away_win'
  | 'over_15'
  | 'over_25'
  | 'over_35'
  | 'under_15'
  | 'under_25'
  | 'under_35'
  | 'btts_yes'
  | 'btts_no'
  | 'double_chance_home'
  | 'double_chance_away'
  | 'double_chance_no_draw'
  | 'dnb_home'
  | 'dnb_away'
  | 'home_over_05'
  | 'away_over_05'
  | 'home_over_15'
  | 'away_over_15'
  | 'handicap_home_-1'
  | 'handicap_away_-1'
  | 'handicap_home_+1'
  | 'handicap_away_+1';

export interface MarketCandidate {
  marketKey: MarketKey;
  selection: string;
  probability: number;
  impliedProbability: number;
  edge: number;
  odds: number | null;
  tacticalFit: number; // 0-1
  predictability: number; // 0-1
  dataSupport: number; // 0-1
  historicalAccuracy: number; // 0-1
  leagueCalibration: number; // 0-1
  formMomentum: number; // 0-1
  finalScore: number; // 0-100 weighted
  riskClassification: 'SAFE' | 'MODERATE' | 'AGGRESSIVE';
  edgeLabel: 'STRONG EDGE' | 'PLAYABLE EDGE' | 'MODERATE EDGE' | 'LEAN' | 'NO EDGE';
  rejected: boolean;
  rejectionReason?: string;
}

export interface MarketSelection {
  bestPick: MarketCandidate | null;
  allCandidates: MarketCandidate[];
  abstained: boolean;
  abstentionReason?: string;
  layer2Override: boolean;
  layer2Details?: string;
}

// --- Confidence Profile Types ---

export type ModelConfidence = 'high' | 'medium' | 'lean' | 'low';
export type ValueConfidence = 'high' | 'medium' | 'low';
export type VolatilityLevel = 'low' | 'medium' | 'high';

export interface ConfidenceProfile {
  model: ModelConfidence;
  value: ValueConfidence;
  volatility: VolatilityLevel;
  composite: number; // 0-100
  downgrades: string[];
}

// --- Prediction Result Types ---

export interface V2Prediction {
  fixtureId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  leagueId: number;
  leagueName: string;

  // Feature vector (compressed)
  features: FlatFeatureVector;

  // xG
  xg: XgEstimate;

  // Script
  script: ScriptClassification;

  // Raw probabilities (from Monte Carlo)
  rawProbs: MonteCarloResult;

  // Calibrated probabilities
  calibratedProbs: CalibratedProbabilities;

  // Market selection
  marketSelection: MarketSelection;

  // Confidence
  confidence: ConfidenceProfile;

  // Pick classification
  tier: 'elite' | 'playable' | 'value' | 'medium' | 'low';
  tierLabel: string;

  // Key reasons (supporting + contradicting)
  keyReasons: string[];
  contradictingReasons: string[];

  // Tactical matchup summary
  tacticalMatchup: string;

  // Value detection
  safeBet: boolean;
  valueBet: boolean;

  // Correct score probabilities
  topScorelines: Array<{ home: number; away: number; prob: number }>;

  // Engine metadata
  engineVersion: string;
  generatedAt: string;
  dataQuality: 'rich' | 'good' | 'partial' | 'thin';
  enrichmentTier: 'rich' | 'good' | 'partial' | 'thin';
  predictionId: string;
}

// --- ELO Types ---

export interface GlickoRating {
  rating: number;
  deviation: number; // RD — uncertainty measure
  volatility: number; // sigma — expected fluctuation
  homeRating: number;
  homeDeviation: number;
  awayRating: number;
  awayDeviation: number;
  matchCount: number;
  lastUpdated: string;
}

// --- Learning Loop Types ---

export interface LearningFeedback {
  fixtureId: number;
  wasCorrect: boolean;
  pickType: string;
  confidence: number;
  actualResult: string;
  predictedProb: number;
  marketKey: string;
  brierContribution: number;
}

export interface ModelPerformance {
  overallAccuracy: number;
  overallBrier: number;
  byMarket: Record<string, { accuracy: number; brier: number; count: number }>;
  byTier: Record<string, { accuracy: number; count: number }>;
  byLeague: Record<string, { accuracy: number; count: number }>;
  calibrationDrift: number; // how much calibration has drifted
  lastRetrained: string;
  totalSettled: number;
}

// --- ACCA Types ---

export interface AccaPick {
  fixtureId: number;
  homeTeamName: string;
  awayTeamName: string;
  marketKey: MarketKey;
  selection: string;
  probability: number;
  odds: number | null;
  riskLevel: 'SAFE' | 'MODERATE';
  confidence: number;
  leagueName: string;
  leaguePrestige: number;
  scriptType: MatchScript;
}

export interface AccaResult {
  mode: 'SAFE' | 'VALUE';
  picks: AccaPick[];
  combinedProbability: number;
  combinedOdds: number | null;
  quality: number; // 0-100
  diversityScore: number; // 0-1
  refused: boolean;
  refusalReason?: string;
}

// --- DB Row Types ---

export interface FixtureRow {
  id: number;
  league_id: number;
  home_team_id: number;
  away_team_id: number;
  home_team_name: string;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
  match_date: string;
  match_status: string;
  bsd_id: number;
  round: string | null;
  weather_code: number | null;
  weather_temp: number | null;
  weather_wind: number | null;
}

export interface TeamProfileRow {
  team_id: number;
  style: string;
  avg_goals_scored: number;
  avg_goals_conceded: number;
  avg_xg: number;
  avg_possession: number;
  avg_shots: number;
  avg_shots_on_target: number;
  avg_corners: number;
  avg_fouls: number;
  home_win_rate: number;
  home_draw_rate: number;
  home_loss_rate: number;
  away_win_rate: number;
  away_draw_rate: number;
  away_loss_rate: number;
  home_btts_rate: number;
  away_btts_rate: number;
  home_over25_rate: number;
  away_over25_rate: number;
  home_clean_sheet_rate: number;
  away_clean_sheet_rate: number;
  form_home: string;
  form_away: string;
  form_overall: string;
}

export interface EloRow {
  team_id: number;
  elo_rating: number;
  elo_home_rating: number;
  elo_away_rating: number;
}

export interface StatsRow {
  fixture_id: number;
  home_possession: number | null;
  away_possession: number | null;
  home_shots: number | null;
  away_shots: number | null;
  home_shots_on_target: number | null;
  away_shots_on_target: number | null;
  home_xg: number | null;
  away_xg: number | null;
  home_corners: number | null;
  away_corners: number | null;
  home_fouls: number | null;
  away_fouls: number | null;
  home_passes: number | null;
  away_passes: number | null;
}

export interface OddsRow {
  fixture_id: number;
  home_win: number | null;
  draw: number | null;
  away_win: number | null;
  over_25: number | null;
  under_25: number | null;
  btts_yes: number | null;
  btts_no: number | null;
}

export interface StandingRow {
  league_id: number;
  team_id: number;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  goals_for: number;
  goals_against: number;
}
