// ============================================================================
// xG-Vantage V2 Engine — Constants & Parameters
// ============================================================================

// --- Engine Version ---
export const ENGINE_VERSION = '3.0.0';

// --- League Averages ---
export const LEAGUE_AVG_GOALS = 1.35;
export const HOME_ADVANTAGE_FACTOR = 1.10;
export const HOME_ADVANTAGE_ELO = 65;

// --- Top Leagues with Prestige Scores ---
export const LEAGUE_PRESTIGE: Record<number, number> = {
  17: 1.00,  // Premier League
  3: 1.00,   // La Liga
  9: 0.95,   // Serie A
  6: 0.90,   // Ligue 1
  13: 0.95,  // Bundesliga
  14: 0.80,  // Liga Portugal
  30: 0.80,  // Eredivisie
  29: 0.75,  // Belgian Pro League
  34: 0.70,  // Scottish Premiership
  8: 0.85,   // Champions League
  7: 0.75,   // Europa League
  566: 0.65, // Conference League
  10: 0.55,  // Championship
  35: 0.55,  // MLS
  18: 0.50,  // League One
  19: 0.45,  // League Two
};

export const DEFAULT_LEAGUE_PRESTIGE = 0.40;

export function getLeaguePrestige(leagueId: number): number {
  return LEAGUE_PRESTIGE[leagueId] ?? DEFAULT_LEAGUE_PRESTIGE;
}

// --- Top League IDs ---
export const TOP_LEAGUE_IDS = [17, 3, 9, 6, 13, 14, 30, 29, 34, 8];

// --- Recency Weighting Bands ---
export const RECENCY_BANDS = {
  '14d': 1.50,
  '30d': 1.35,
  '60d': 1.20,
  '120d': 1.00,
  'older': 0.80,
} as const;

// --- Opponent Quality Weighting ---
export const OPPONENT_QUALITY = {
  top4: 1.25,
  top8: 1.12,
  mid: 1.00,
  bottom4: 0.90,
} as const;

// --- xG Model Parameters ---
export const XG_PARAMS = {
  leagueAvg: 1.35,
  homeAdvFactor: 1.10,
  // Thin data regression
  thinDataThreshold: 5,
  thinDataBlendBase: 0.50, // blend toward league avg at <3 matches
  thinDataBlendWeak: 0.75, // blend at 3-5 matches
  // Venue anchoring
  venueModelWeight: 0.65,
  venueDataWeight: 0.35,
  // Odds anchor
  oddsEngineWeight: 0.65,
  oddsImpliedWeight: 0.35,
  // Polymarket blend
  polymarketEngineWeight: 0.72,
  polymarketMarketWeight: 0.28,
  // xG caps
  perTeamMin: 0.20,
  perTeamMax: 2.50,
  totalMin: 0.80,
  totalMax: 4.50,
} as const;

// --- Script-Adjustment xG nudges ---
export const SCRIPT_XG_NUDGES: Record<string, { home: number; away: number }> = {
  dominant_home_pressure: { home: 0.15, away: -0.10 },
  dominant_away_pressure: { home: -0.10, away: 0.15 },
  open_end_to_end: { home: 0.25, away: 0.25 },
  balanced_high_event: { home: 0.10, away: 0.10 },
  tight_low_event: { home: -0.15, away: -0.15 },
  chaotic_unreliable: { home: 0.0, away: 0.0 },
};

// --- Manager Style Multipliers ---
export const MANAGER_STYLE_MULTIPLIERS: Record<string, { xgMultiplier: number; overBias: number }> = {
  conservative: { xgMultiplier: 0.85, overBias: -0.15 },
  pragmatic: { xgMultiplier: 0.92, overBias: -0.05 },
  balanced: { xgMultiplier: 1.00, overBias: 0.0 },
  attacking: { xgMultiplier: 1.05, overBias: 0.08 },
  gung_ho: { xgMultiplier: 1.12, overBias: 0.15 },
};

// --- Dixon-Coles Parameters ---
export const DIXON_COLES = {
  rho: -0.10, // correlation factor (ScorePhantom uses -0.10, V1 used -0.13)
  matrixSize: 8, // 0-7 goals each side
};

// --- Monte Carlo Parameters ---
export const MC_PARAMS = {
  defaultSims: 50000,
  fastSims: 10000, // for batch processing
  minSims: 5000,
  copulaCorrelation: 0.12, // slight positive correlation between team goals
  chaosCorrelation: 0.35, // higher correlation in chaotic matches
};

// --- Calibration Parameters ---
export const CALIBRATION = {
  blendEngine: 0.70,
  blendPolymarket: 0.30, // for 1X2
  blendEngineBtts: 0.60,
  blendPolymarketBtts: 0.40,
  // Isotonic regression
  minBins: 5,
  binWidth: 0.10,
  minSamplesForCalibration: 50,
  // Script micro-adjustments (max ±0.04)
  scriptAdjustments: {
    dominant_home_pressure: { homeWin: 0.03, awayWin: -0.02, bttsNo: 0.02, over25: -0.01 },
    dominant_away_pressure: { awayWin: 0.03, homeWin: -0.02, bttsNo: 0.02, over25: -0.01 },
    open_end_to_end: { bttsYes: 0.04, over25: 0.03, over15: 0.02 },
    balanced_high_event: { bttsYes: 0.02, over25: 0.02 },
    tight_low_event: { bttsNo: 0.04, under25: 0.03, over25: -0.03 },
    chaotic_unreliable: { homeWin: -0.02, awayWin: -0.02, draw: 0.03 }, // regression to 50/50
  } as const,
  // Over 1.5 dampening (structural overconfidence correction)
  over15Dampen: 0.97,
};

// --- Market Probability Floors ---
export const MARKET_FLOORS: Record<string, number> = {
  home_win: 0.62,
  away_win: 0.62,
  draw: 0.55,
  over_15: 0.58,
  over_25: 0.60,
  over_35: 0.55,
  under_15: 0.60,
  under_25: 0.58,
  under_35: 0.68,
  btts_yes: 0.68,
  btts_no: 0.72,
  double_chance_home: 0.72,
  double_chance_away: 0.72,
  double_chance_no_draw: 0.72,
  dnb_home: 0.65,
  dnb_away: 0.65,
};

// --- Market Scoring Weights ---
export const MARKET_SCORING = {
  modelConfidence: 0.30,
  marketEdge: 0.20,
  tacticalFit: 0.15,
  predictability: 0.15,
  dataSupport: 0.10,
  historicalAccuracy: 0.05,
  leagueCalibration: 0.05,
  formMomentum: 0.05,
} as const;

// --- Script-Market Fit Matrix ---
export const SCRIPT_MARKET_FIT: Record<string, Record<string, number>> = {
  dominant_home_pressure: {
    home_win: 0.92, dnb_home: 0.85, double_chance_home: 0.80,
    under_35: 0.70, btts_no: 0.65, over_25: 0.45, away_win: 0.15,
  },
  dominant_away_pressure: {
    away_win: 0.92, dnb_away: 0.85, double_chance_away: 0.80,
    under_35: 0.70, btts_no: 0.65, over_25: 0.45, home_win: 0.15,
  },
  open_end_to_end: {
    over_25: 0.90, btts_yes: 0.88, over_15: 0.85,
    over_35: 0.65, home_over_05: 0.80, away_over_05: 0.80,
  },
  balanced_high_event: {
    over_25: 0.70, btts_yes: 0.72, over_15: 0.80,
    double_chance_no_draw: 0.65,
  },
  tight_low_event: {
    under_25: 0.88, under_35: 0.85, btts_no: 0.82,
    draw: 0.70, under_15: 0.75,
  },
  chaotic_unreliable: {
    // Low fit for everything — this script triggers abstention
    over_25: 0.30, btts_yes: 0.30, home_win: 0.35, away_win: 0.35,
  },
};

// --- Value Trap Filter ---
export const VALUE_TRAP_EDGE = 0.35; // reject edge > 35%

// --- Risk Classification Thresholds ---
export const RISK_THRESHOLDS = {
  SAFE: { minProb: 0.74, orMinProb: 0.65, stableRequired: true, maxChaos: 0.35 },
  MODERATE: { minProb: 0.58 },
  AGGRESSIVE: { minProb: 0.0 }, // below MODERATE
};

// --- Edge Labels ---
export const EDGE_LABELS = {
  STRONG: 0.15,
  PLAYABLE: 0.10,
  MODERATE: 0.06,
  LEAN: 0.03,
};

// --- Predictability Gate ---
export const PREDICTABILITY_GATE = {
  minDataCompleteness: 0.30, // below this, match is rejected
  maxChaos: 0.80, // above this, match is rejected
  minMatchCount: 3, // minimum matches for both teams
};

// --- Separation Check ---
export const SEPARATION = {
  withOdds: 0.010,
  withoutOdds: 0.008,
};

// --- Tier Classification ---
export const TIER_THRESHOLDS = {
  elite: 0.80,
  playable: 0.70,
  value: { minConf: 0.55, minEdge: 0.10 },
  medium: 0.60,
  low: 0.0,
};

// --- Glicko/ELO Parameters ---
export const GLICKO_PARAMS = {
  defaultRating: 1500,
  defaultDeviation: 350, // high uncertainty for new teams
  defaultVolatility: 0.06,
  tau: 0.5, // system constant controlling volatility change
  convergenceTolerance: 0.000001,
  maxIterations: 1000,
  // ELO-specific
  eloK: 32,
  eloHomeAdv: 65,
  homeRatingChangeFactor: 1.2,
  awayRatingChangeFactor: 0.3,
  // Deviation decay per period (rating period = 1 day)
  deviationDecay: 1.2, // max increase per period without playing
  maxDeviation: 350,
  minDeviation: 30,
};

// --- Bayesian Priors ---
export const BAYESIAN_PRIORS = {
  // Prior for home win probability (league-average)
  homeWinPrior: { alpha: 12, beta: 13 }, // ~48% prior
  drawPrior: { alpha: 8, beta: 22 },      // ~27% prior
  awayWinPrior: { alpha: 10, beta: 16 },   // ~38% prior
  over25Prior: { alpha: 11, beta: 14 },    // ~44% prior
  bttsYesPrior: { alpha: 10, beta: 12 },   // ~45% prior
};

// --- Learning Loop Parameters ---
export const LEARNING_PARAMS = {
  learningRate: 0.02,
  minSettledForRetrain: 100,
  retrainIntervalDays: 7,
  calibrationDriftThreshold: 0.05, // retrain if drift exceeds this
  weightDecay: 0.995, // slight decay toward equal weights
  brierDecay: 0.95, // older Brier scores weighted less
};

// --- Context Parameters ---
export const CONTEXT_PARAMS = {
  restOptimal: { min: 3, max: 7 },
  fatigueThreshold: 2, // days
  fatigueScore: 0.20,
  rustThreshold: 10, // days
  rustScore: 0.15,
  travelDistanceThreshold: 500, // km
  travelImpactFar: 0.08,
  travelImpactVeryFar: 0.15,
  derbyIntensityMap: {
    same_city: 1.0,
    same_region: 0.7,
    historical: 0.5,
  },
  weatherImpact: {
    thunderstorm: 0.30,
    snow: 0.25,
    heavy_rain: 0.15,
    strong_wind: 0.15, // >50km/h
    extreme_heat: 0.10,
    extreme_cold: 0.10,
  },
  motivationScores: {
    title_race: 1.0,
    champions_league: 0.85,
    europa: 0.70,
    midtable: 0.40,
    relegation: 0.90,
    promoted: 0.50,
    friendly: 0.20,
    unknown: 0.40,
  },
};

// --- Form Momentum Detection ---
export const MOMENTUM_PARAMS = {
  // Exponential moving average parameters
  emaShort: 3,  // last 3 matches
  emaLong: 8,   // last 8 matches
  emaAlpha: 0.3, // smoothing factor
  // Regime detection
  hotStreakWins: 3, // consecutive wins
  coldStreakLosses: 3, // consecutive losses
  hotBoost: 0.10,
  coldPenalty: 0.10,
};

// --- Enrichment Tiers ---
export const ENRICHMENT_TIERS = {
  rich: { minFeatures: 0.85, minMatches: 10 },
  good: { minFeatures: 0.65, minMatches: 6 },
  partial: { minFeatures: 0.40, minMatches: 3 },
  thin: { minFeatures: 0.0, minMatches: 0 },
} as const;

// --- Model Weight Defaults ---
export const DEFAULT_MODEL_WEIGHTS = {
  bayesian_elo: 0.25,
  poisson_xg: 0.35,
  form_momentum: 0.15,
  style_matchup: 0.10,
  context_model: 0.10,
  gradient_boost: 0.05, // placeholder for future ML model
};

// --- Prediction Cache ---
export const CACHE_TTL = {
  prediction: 6 * 60 * 60 * 1000, // 6 hours
  teamProfile: 24 * 60 * 60 * 1000, // 24 hours
  elo: 12 * 60 * 60 * 1000, // 12 hours
  calibration: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// --- ACCA Parameters ---
export const ACCA_PARAMS = {
  SAFE: {
    minPicks: 3,
    maxPicks: 4,
    minProb: 0.60,
    riskAllowed: ['SAFE'],
    maxPerLeague: 1,
    maxSameScript: 2,
    maxUnderPicks: 2,
    requireAttacking: true,
  },
  VALUE: {
    minPicks: 3,
    maxPicks: 5,
    minProb: 0.57,
    riskAllowed: ['SAFE', 'MODERATE'],
    maxPerLeague: 2,
    maxSameScript: 2,
    maxUnderPicks: 2,
    requireAttacking: true,
  },
  scoring: {
    probability: 0.36,
    dataQuality: 0.16,
    volatility: 0.16,
    histAccuracy: 0.22,
    prestige: 0.10,
  },
};

// --- Weather Code Mapping (WMO) ---
export const WEATHER_CODES: Record<number, { description: string; impact: number }> = {
  0: { description: 'Clear', impact: 0 },
  1: { description: 'Mainly clear', impact: 0 },
  2: { description: 'Partly cloudy', impact: 0 },
  3: { description: 'Overcast', impact: 0 },
  45: { description: 'Fog', impact: 0.05 },
  48: { description: 'Rime fog', impact: 0.05 },
  51: { description: 'Light drizzle', impact: 0.05 },
  53: { description: 'Moderate drizzle', impact: 0.10 },
  55: { description: 'Dense drizzle', impact: 0.15 },
  61: { description: 'Slight rain', impact: 0.10 },
  63: { description: 'Moderate rain', impact: 0.15 },
  65: { description: 'Heavy rain', impact: 0.20 },
  71: { description: 'Slight snow', impact: 0.15 },
  73: { description: 'Moderate snow', impact: 0.20 },
  75: { description: 'Heavy snow', impact: 0.25 },
  77: { description: 'Snow grains', impact: 0.20 },
  80: { description: 'Slight showers', impact: 0.10 },
  81: { description: 'Moderate showers', impact: 0.15 },
  82: { description: 'Violent showers', impact: 0.25 },
  85: { description: 'Slight snow showers', impact: 0.15 },
  86: { description: 'Heavy snow showers', impact: 0.25 },
  95: { description: 'Thunderstorm', impact: 0.30 },
  96: { description: 'Thunderstorm with hail', impact: 0.30 },
  99: { description: 'Severe thunderstorm', impact: 0.35 },
};
