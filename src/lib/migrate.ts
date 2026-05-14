// Database Migration — Single Source of Truth for ALL table schemas
// V4 Schema: Aligned with V2 engine code, BSD API types, and frontend queries
// EVERY column the engine references, the API syncs, or the frontend queries MUST exist here.
import { client } from './db-turso';

export async function migrate() {
  console.log('[Migration V4] Running comprehensive migrations...');

  // ========================================================================
  // PRE-MIGRATION: Drop tables with wrong schemas so CREATE TABLE IF NOT EXISTS
  // will recreate them with the correct schema.
  // ========================================================================

  const tablesToValidate = [
    {
      table: 'predictions_v2',
      requiredCols: ['prediction_id', 'xg_home', 'xg_away', 'settled'],
      reason: 'predictions_v2 must have prediction_id PK and xg_home/xg_away columns',
    },
    {
      table: 'team_glicko',
      requiredCols: ['season_id', 'match_count', 'home_deviation', 'away_deviation'],
      reason: 'team_glicko must have season_id, match_count, and home/away deviation columns',
    },
    {
      table: 'brier_scores',
      requiredCols: ['market_key', 'total_brier', 'count', 'last_updated'],
      reason: 'brier_scores must have all required columns',
    },
    {
      table: 'v2_model_weights',
      requiredCols: ['model_name', 'weight', 'last_adjusted', 'adjustment_reason'],
      reason: 'v2_model_weights must have last_adjusted and adjustment_reason columns',
    },
    {
      table: 'prediction_feedback',
      requiredCols: ['fixture_id', 'was_correct', 'market_key', 'brier_contribution'],
      reason: 'prediction_feedback must have correct schema',
    },
    {
      table: 'calibration_bins',
      requiredCols: ['market_key', 'bin_lower', 'bin_upper', 'actual_rate', 'last_updated'],
      reason: 'calibration_bins must have all required columns',
    },
  ];

  for (const { table, requiredCols, reason } of tablesToValidate) {
    try {
      const cols = await client.execute({
        sql: "SELECT name FROM pragma_table_info(?)",
        args: [table],
      });
      const colNames = cols.rows.map(r => r.name as string);
      if (colNames.length > 0) {
        const missing = requiredCols.filter(c => !colNames.includes(c));
        if (missing.length > 0) {
          console.log(`[Migration V4] ${table} missing columns [${missing.join(', ')}] — dropping for rebuild. Reason: ${reason}`);
          await client.execute(`DROP TABLE IF EXISTS ${table}`);
        }
      }
    } catch {
      // Table doesn't exist yet — that's fine, it will be created below
    }
  }

  // ========================================================================
  // CORE TABLES
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      display_name TEXT,
      avatar_url TEXT,
      plan TEXT DEFAULT 'free',
      plan_expires_at TEXT,
      referral_code TEXT UNIQUE,
      referred_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // leagues: Covers all BSDLeague fields from bsd-client.ts
  await client.execute(`
    CREATE TABLE IF NOT EXISTS leagues (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT,
      country_code TEXT,
      logo TEXT,
      flag TEXT,
      is_active INTEGER DEFAULT 1,
      is_women INTEGER DEFAULT 0,
      season_id INTEGER,
      season_name TEXT,
      season_year INTEGER,
      season_start_date TEXT,
      season_end_date TEXT,
      bsd_id INTEGER
    )
  `);

  // teams: Covers all BSD team fields + logo support
  await client.execute(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT,
      country TEXT,
      country_code TEXT,
      logo TEXT,
      venue_id INTEGER,
      bsd_id INTEGER UNIQUE
    )
  `);

  // team_profiles: Enriched team DNA computed by engine
  await client.execute(`
    CREATE TABLE IF NOT EXISTS team_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER REFERENCES teams(id),
      season_id INTEGER,
      league_id INTEGER REFERENCES leagues(id),
      avg_goals_scored REAL,
      avg_goals_conceded REAL,
      avg_xg_for REAL,
      avg_xg_against REAL,
      possession REAL,
      clean_sheet_pct REAL,
      btts_pct REAL,
      over_25_pct REAL,
      home_avg_scored REAL,
      home_avg_conceded REAL,
      away_avg_scored REAL,
      away_avg_conceded REAL,
      style TEXT,
      tactical_profile TEXT,
      preferred_formation TEXT,
      press_intensity TEXT,
      def_line TEXT,
      form TEXT,
      home_form TEXT,
      away_form TEXT,
      home_win_rate REAL,
      home_draw_rate REAL,
      home_loss_rate REAL,
      away_win_rate REAL,
      away_draw_rate REAL,
      away_loss_rate REAL,
      home_btts_rate REAL,
      home_over25_rate REAL,
      away_btts_rate REAL,
      away_over25_rate REAL,
      home_clean_sheet_rate REAL,
      away_clean_sheet_rate REAL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // fixtures: Covers ALL BSDEvent fields from bsd-client.ts + venue/referee
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fixtures (
      id INTEGER PRIMARY KEY,
      bsd_id INTEGER UNIQUE,
      league_id INTEGER REFERENCES leagues(id),
      season_id INTEGER,
      home_team_id INTEGER REFERENCES teams(id),
      away_team_id INTEGER REFERENCES teams(id),
      home_coach_id INTEGER,
      away_coach_id INTEGER,
      referee_id INTEGER,
      venue_id INTEGER,
      event_date TEXT,
      status TEXT DEFAULT 'notstarted',
      current_minute INTEGER,
      period TEXT,
      home_score INTEGER,
      away_score INTEGER,
      home_score_ht INTEGER,
      away_score_ht INTEGER,
      penalty_shootout TEXT,
      extra_time_score TEXT,
      round_number INTEGER,
      round_name TEXT,
      group_name TEXT,
      is_local_derby INTEGER DEFAULT 0,
      is_neutral_ground INTEGER DEFAULT 0,
      travel_distance_km REAL,
      weather_code INTEGER,
      weather_desc TEXT,
      temperature REAL,
      wind_speed REAL,
      pitch_condition INTEGER,
      attendance INTEGER,
      venue_name TEXT,
      venue_city TEXT,
      referee_name TEXT,
      live_websocket INTEGER DEFAULT 0,
      last_updated TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ========================================================================
  // V1 PREDICTIONS TABLE (backward compat for frontend)
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER REFERENCES fixtures(id),
      pick_type TEXT NOT NULL,
      pick_label TEXT NOT NULL,
      confidence REAL NOT NULL,
      tier TEXT,
      phantom_score REAL,
      edge REAL,
      home_win_prob REAL,
      draw_prob REAL,
      away_win_prob REAL,
      over_25_prob REAL,
      under_25_prob REAL,
      btts_yes_prob REAL,
      btts_no_prob REAL,
      home_xg REAL,
      away_xg REAL,
      verdict TEXT,
      decision_stack TEXT,
      key_reasons TEXT,
      tactical_matchup TEXT,
      odds_json TEXT,
      result TEXT DEFAULT 'pending',
      settled_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prediction_id INTEGER REFERENCES predictions(id),
      fixture_id INTEGER REFERENCES fixtures(id),
      rank INTEGER,
      date TEXT,
      category TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS accas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      date TEXT,
      pick_ids TEXT,
      total_odds REAL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS track_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      pick_type TEXT,
      total INTEGER,
      won INTEGER,
      lost INTEGER,
      void_count INTEGER,
      win_rate REAL,
      month TEXT
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      league_id INTEGER,
      team_id INTEGER,
      type TEXT
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      title TEXT,
      message TEXT,
      type TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ========================================================================
  // DETAILED DATA TABLES — Aligned with BSD API + sync-service.ts
  // ========================================================================

  // fixture_stats: Covers ALL fields from BSDStats (bsd-client.ts) + sync-service.ts
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fixture_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER REFERENCES fixtures(id) UNIQUE,
      home_total_shots INTEGER DEFAULT 0,
      home_shots_on_target INTEGER DEFAULT 0,
      home_ball_possession REAL DEFAULT 50,
      home_expected_goals REAL DEFAULT 0,
      home_corner_kicks INTEGER DEFAULT 0,
      home_fouls INTEGER DEFAULT 0,
      home_yellow_cards INTEGER DEFAULT 0,
      home_red_cards INTEGER DEFAULT 0,
      home_attacks INTEGER DEFAULT 0,
      home_dangerous_attacks INTEGER DEFAULT 0,
      home_big_chances INTEGER DEFAULT 0,
      home_passes INTEGER DEFAULT 0,
      home_pass_accuracy REAL DEFAULT 0,
      home_tackles INTEGER DEFAULT 0,
      home_interceptions INTEGER DEFAULT 0,
      home_saves INTEGER DEFAULT 0,
      home_hit_woodwork INTEGER DEFAULT 0,
      home_offsides INTEGER DEFAULT 0,
      away_total_shots INTEGER DEFAULT 0,
      away_shots_on_target INTEGER DEFAULT 0,
      away_ball_possession REAL DEFAULT 50,
      away_expected_goals REAL DEFAULT 0,
      away_corner_kicks INTEGER DEFAULT 0,
      away_fouls INTEGER DEFAULT 0,
      away_yellow_cards INTEGER DEFAULT 0,
      away_red_cards INTEGER DEFAULT 0,
      away_attacks INTEGER DEFAULT 0,
      away_dangerous_attacks INTEGER DEFAULT 0,
      away_big_chances INTEGER DEFAULT 0,
      away_passes INTEGER DEFAULT 0,
      away_pass_accuracy REAL DEFAULT 0,
      away_tackles INTEGER DEFAULT 0,
      away_interceptions INTEGER DEFAULT 0,
      away_saves INTEGER DEFAULT 0,
      away_hit_woodwork INTEGER DEFAULT 0,
      away_offsides INTEGER DEFAULT 0
    )
  `);

  // fixture_odds: Covers ALL fields from BSDOdds (bsd-client.ts) + extended markets
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fixture_odds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER REFERENCES fixtures(id) UNIQUE,
      home_win REAL,
      draw REAL,
      away_win REAL,
      over_15_goals REAL,
      over_25_goals REAL,
      over_35_goals REAL,
      under_15_goals REAL,
      under_25_goals REAL,
      under_35_goals REAL,
      btts_yes REAL,
      btts_no REAL,
      handicap_home_minus1 REAL,
      handicap_away_minus1 REAL,
      double_chance_home_draw REAL,
      double_chance_away_draw REAL,
      double_chance_home_away REAL,
      dnb_home REAL,
      dnb_away REAL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // fixture_lineups: Covers ALL fields from BSDLineup (bsd-client.ts)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fixture_lineups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER REFERENCES fixtures(id) UNIQUE,
      lineup_status TEXT,
      home_formation TEXT,
      away_formation TEXT,
      home_players TEXT,
      away_players TEXT,
      home_substitutes TEXT,
      away_substitutes TEXT,
      home_unavailable TEXT,
      away_unavailable TEXT,
      home_confidence REAL,
      away_confidence REAL,
      home_team_id INTEGER,
      away_team_id INTEGER,
      updated_at TEXT
    )
  `);

  // fixture_incidents: NEW — stores match events (goals, cards, subs) from BSDIncident
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fixture_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER REFERENCES fixtures(id) UNIQUE,
      incidents_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // fixture_metadata: NEW — stores fun facts and AI preview from BSDMetadata
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fixture_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER REFERENCES fixtures(id) UNIQUE,
      funfacts_json TEXT DEFAULT '[]',
      ai_preview_text TEXT,
      ai_preview_generated_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // fixture_player_stats: NEW — stores per-player stats from BSDPlayerStat
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fixture_player_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER REFERENCES fixtures(id) UNIQUE,
      player_stats_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // standings: Covers ALL BSDStanding fields + sync-service.ts columns
  await client.execute(`
    CREATE TABLE IF NOT EXISTS standings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER,
      season_id INTEGER,
      team_id INTEGER,
      team_name TEXT,
      position INTEGER,
      played INTEGER,
      won INTEGER,
      drawn INTEGER,
      lost INTEGER,
      gf INTEGER,
      ga INTEGER,
      gd INTEGER,
      pts INTEGER,
      xgf REAL,
      xga REAL,
      xgd REAL,
      xg_games INTEGER,
      form TEXT,
      is_live INTEGER DEFAULT 0
    )
  `);

  // managers: NEW — stores manager data from BSDManager for tactical analysis
  await client.execute(`
    CREATE TABLE IF NOT EXISTS managers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT,
      country TEXT,
      tactical_profile TEXT,
      preferred_formation TEXT,
      current_team_id INTEGER,
      matches_total INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      win_pct REAL DEFAULT 0,
      avg_goals_scored REAL DEFAULT 0,
      avg_goals_conceded REAL DEFAULT 0,
      avg_possession REAL DEFAULT 50,
      clean_sheet_pct REAL DEFAULT 0,
      btts_pct REAL DEFAULT 0,
      over_25_pct REAL DEFAULT 0,
      team_style TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // team_squads: NEW — stores player squad data from BSDTeamSquad
  await client.execute(`
    CREATE TABLE IF NOT EXISTS team_squads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER REFERENCES teams(id),
      players_json TEXT NOT NULL DEFAULT '[]',
      count INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ========================================================================
  // V1 MODEL WEIGHTS TABLE (backward compat)
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS model_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_version TEXT,
      poisson_weight REAL DEFAULT 0.35,
      elo_weight REAL DEFAULT 0.25,
      form_weight REAL DEFAULT 0.20,
      style_matchup_weight REAL DEFAULT 0.10,
      context_weight REAL DEFAULT 0.10,
      is_active INTEGER DEFAULT 1,
      total_predictions INTEGER DEFAULT 0,
      correct_results INTEGER DEFAULT 0,
      result_accuracy REAL DEFAULT 0,
      avg_calibration_error REAL DEFAULT 0,
      value_edge_threshold REAL DEFAULT 0.05,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS team_elo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER,
      league_id INTEGER,
      season_id INTEGER,
      elo_rating REAL DEFAULT 1500,
      elo_home_rating REAL DEFAULT 1500,
      elo_away_rating REAL DEFAULT 1500,
      matches_played INTEGER DEFAULT 0,
      last_match_date TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ========================================================================
  // V2 ENGINE TABLES — Single source of truth, aligned with ALL engine code
  // predictions_v2: Exact match of prediction-engine.ts INSERT columns
  // team_glicko: Exact match of bayesian-elo.ts CREATE_TABLE_SQL (WITH season_id!)
  // prediction_feedback: Exact match of learning-loop.ts schema
  // calibration_bins: Exact match of calibration.ts schema
  // brier_scores: Exact match of learning-loop.ts schema
  // v2_model_weights: Exact match of learning-loop.ts schema (WITH last_adjusted!)
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS predictions_v2 (
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

  // team_glicko: MUST have season_id — bayesian-elo.ts uses (team_id, league_id, season_id) unique constraint
  await client.execute(`
    CREATE TABLE IF NOT EXISTS team_glicko (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      league_id INTEGER NOT NULL DEFAULT 0,
      season_id INTEGER NOT NULL DEFAULT 0,
      rating REAL NOT NULL DEFAULT 1500,
      deviation REAL NOT NULL DEFAULT 350,
      volatility REAL NOT NULL DEFAULT 0.06,
      home_rating REAL NOT NULL DEFAULT 1500,
      home_deviation REAL NOT NULL DEFAULT 350,
      away_rating REAL NOT NULL DEFAULT 1500,
      away_deviation REAL NOT NULL DEFAULT 350,
      match_count INTEGER NOT NULL DEFAULT 0,
      last_match_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(team_id, league_id, season_id)
    )
  `);

  // prediction_feedback: Exact match of learning-loop.ts schema
  await client.execute(`
    CREATE TABLE IF NOT EXISTS prediction_feedback (
      fixture_id INTEGER NOT NULL PRIMARY KEY,
      was_correct INTEGER NOT NULL,
      pick_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      actual_result TEXT NOT NULL,
      predicted_prob REAL NOT NULL,
      market_key TEXT NOT NULL,
      brier_contribution REAL NOT NULL,
      settled_at TEXT NOT NULL
    )
  `);

  // calibration_bins: Exact match of calibration.ts schema
  await client.execute(`
    CREATE TABLE IF NOT EXISTS calibration_bins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_key TEXT NOT NULL,
      bin_lower REAL NOT NULL,
      bin_upper REAL NOT NULL,
      predicted_count INTEGER DEFAULT 0,
      actual_count INTEGER DEFAULT 0,
      actual_rate REAL DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now'))
    )
  `);

  // brier_scores: Exact match of learning-loop.ts schema
  await client.execute(`
    CREATE TABLE IF NOT EXISTS brier_scores (
      market_key TEXT NOT NULL PRIMARY KEY,
      total_brier REAL NOT NULL DEFAULT 0.0,
      count INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    )
  `);

  // v2_model_weights: Exact match of learning-loop.ts schema (has last_adjusted!)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS v2_model_weights (
      model_name TEXT NOT NULL PRIMARY KEY,
      weight REAL NOT NULL,
      last_adjusted TEXT NOT NULL,
      adjustment_reason TEXT NOT NULL DEFAULT ''
    )
  `);

  // ========================================================================
  // INDEXES
  // ========================================================================

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_fixtures_date ON fixtures(event_date)',
    'CREATE INDEX IF NOT EXISTS idx_fixtures_status ON fixtures(status)',
    'CREATE INDEX IF NOT EXISTS idx_fixtures_league ON fixtures(league_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixtures_home_team ON fixtures(home_team_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixtures_away_team ON fixtures(away_team_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixtures_bsd_id ON fixtures(bsd_id)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_fixture ON predictions(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_tier ON predictions(tier)',
    'CREATE INDEX IF NOT EXISTS idx_picks_date ON picks(date)',
    'CREATE INDEX IF NOT EXISTS idx_standings_league_season ON standings(league_id, season_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_standings_unique ON standings(league_id, season_id, team_id)',
    'CREATE INDEX IF NOT EXISTS idx_team_elo_team ON team_elo(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_team_profiles_team ON team_profiles(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_teams_bsd_id ON teams(bsd_id)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_v2_fixture ON predictions_v2(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_v2_tier ON predictions_v2(tier)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_v2_confidence ON predictions_v2(confidence DESC)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_v2_league ON predictions_v2(league_id)',
    'CREATE INDEX IF NOT EXISTS idx_team_glicko_team ON team_glicko(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_team_glicko_league ON team_glicko(league_id)',
    'CREATE INDEX IF NOT EXISTS idx_prediction_feedback_fixture ON prediction_feedback(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_calibration_bins_market ON calibration_bins(market_key)',
    'CREATE INDEX IF NOT EXISTS idx_brier_scores_market ON brier_scores(market_key)',
    'CREATE INDEX IF NOT EXISTS idx_managers_team ON managers(current_team_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixture_stats_fixture ON fixture_stats(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixture_odds_fixture ON fixture_odds(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixture_lineups_fixture ON fixture_lineups(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixture_incidents_fixture ON fixture_incidents(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_managers_tactical ON managers(tactical_profile)',
  ];

  for (const sql of indexes) {
    try {
      await client.execute(sql);
    } catch {
      // Index may already exist — safe to ignore
    }
  }

  // ========================================================================
  // SAFE ALTER TABLE MIGRATIONS FOR EXISTING DATABASES
  // ========================================================================
  // These add missing columns to tables that were created with older schemas.
  // Each ALTER is guarded by a column-existence check.

  const alterMigrations: Array<{ table: string; column: string; sql: string }> = [
    // fixture_stats: add newer columns for existing DBs
    { table: 'fixture_stats', column: 'home_big_chances', sql: "ALTER TABLE fixture_stats ADD COLUMN home_big_chances INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_passes', sql: "ALTER TABLE fixture_stats ADD COLUMN home_passes INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_pass_accuracy', sql: "ALTER TABLE fixture_stats ADD COLUMN home_pass_accuracy REAL DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_tackles', sql: "ALTER TABLE fixture_stats ADD COLUMN home_tackles INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_interceptions', sql: "ALTER TABLE fixture_stats ADD COLUMN home_interceptions INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_saves', sql: "ALTER TABLE fixture_stats ADD COLUMN home_saves INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_hit_woodwork', sql: "ALTER TABLE fixture_stats ADD COLUMN home_hit_woodwork INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_offsides', sql: "ALTER TABLE fixture_stats ADD COLUMN home_offsides INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_big_chances', sql: "ALTER TABLE fixture_stats ADD COLUMN away_big_chances INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_passes', sql: "ALTER TABLE fixture_stats ADD COLUMN away_passes INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_pass_accuracy', sql: "ALTER TABLE fixture_stats ADD COLUMN away_pass_accuracy REAL DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_tackles', sql: "ALTER TABLE fixture_stats ADD COLUMN away_tackles INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_interceptions', sql: "ALTER TABLE fixture_stats ADD COLUMN away_interceptions INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_saves', sql: "ALTER TABLE fixture_stats ADD COLUMN away_saves INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_hit_woodwork', sql: "ALTER TABLE fixture_stats ADD COLUMN away_hit_woodwork INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_offsides', sql: "ALTER TABLE fixture_stats ADD COLUMN away_offsides INTEGER DEFAULT 0" },

    // fixtures: add venue/referee/BSD fields
    { table: 'fixtures', column: 'venue_name', sql: "ALTER TABLE fixtures ADD COLUMN venue_name TEXT" },
    { table: 'fixtures', column: 'venue_city', sql: "ALTER TABLE fixtures ADD COLUMN venue_city TEXT" },
    { table: 'fixtures', column: 'referee_name', sql: "ALTER TABLE fixtures ADD COLUMN referee_name TEXT" },
    { table: 'fixtures', column: 'home_coach_id', sql: "ALTER TABLE fixtures ADD COLUMN home_coach_id INTEGER" },
    { table: 'fixtures', column: 'away_coach_id', sql: "ALTER TABLE fixtures ADD COLUMN away_coach_id INTEGER" },
    { table: 'fixtures', column: 'referee_id', sql: "ALTER TABLE fixtures ADD COLUMN referee_id INTEGER" },
    { table: 'fixtures', column: 'venue_id', sql: "ALTER TABLE fixtures ADD COLUMN venue_id INTEGER" },
    { table: 'fixtures', column: 'penalty_shootout', sql: "ALTER TABLE fixtures ADD COLUMN penalty_shootout TEXT" },
    { table: 'fixtures', column: 'extra_time_score', sql: "ALTER TABLE fixtures ADD COLUMN extra_time_score TEXT" },
    { table: 'fixtures', column: 'group_name', sql: "ALTER TABLE fixtures ADD COLUMN group_name TEXT" },
    { table: 'fixtures', column: 'is_neutral_ground', sql: "ALTER TABLE fixtures ADD COLUMN is_neutral_ground INTEGER DEFAULT 0" },
    { table: 'fixtures', column: 'pitch_condition', sql: "ALTER TABLE fixtures ADD COLUMN pitch_condition INTEGER" },
    { table: 'fixtures', column: 'live_websocket', sql: "ALTER TABLE fixtures ADD COLUMN live_websocket INTEGER DEFAULT 0" },
    { table: 'fixtures', column: 'last_updated', sql: "ALTER TABLE fixtures ADD COLUMN last_updated TEXT" },

    // fixture_odds: add extended odds columns
    { table: 'fixture_odds', column: 'handicap_home_minus1', sql: "ALTER TABLE fixture_odds ADD COLUMN handicap_home_minus1 REAL" },
    { table: 'fixture_odds', column: 'handicap_away_minus1', sql: "ALTER TABLE fixture_odds ADD COLUMN handicap_away_minus1 REAL" },
    { table: 'fixture_odds', column: 'double_chance_home_draw', sql: "ALTER TABLE fixture_odds ADD COLUMN double_chance_home_draw REAL" },
    { table: 'fixture_odds', column: 'double_chance_away_draw', sql: "ALTER TABLE fixture_odds ADD COLUMN double_chance_away_draw REAL" },
    { table: 'fixture_odds', column: 'double_chance_home_away', sql: "ALTER TABLE fixture_odds ADD COLUMN double_chance_home_away REAL" },
    { table: 'fixture_odds', column: 'dnb_home', sql: "ALTER TABLE fixture_odds ADD COLUMN dnb_home REAL" },
    { table: 'fixture_odds', column: 'dnb_away', sql: "ALTER TABLE fixture_odds ADD COLUMN dnb_away REAL" },
    { table: 'fixture_odds', column: 'updated_at', sql: "ALTER TABLE fixture_odds ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))" },

    // fixture_lineups: add missing columns
    { table: 'fixture_lineups', column: 'home_team_id', sql: "ALTER TABLE fixture_lineups ADD COLUMN home_team_id INTEGER" },
    { table: 'fixture_lineups', column: 'away_team_id', sql: "ALTER TABLE fixture_lineups ADD COLUMN away_team_id INTEGER" },

    // predictions_v2: add result/settled_at for existing DBs
    { table: 'predictions_v2', column: 'result', sql: "ALTER TABLE predictions_v2 ADD COLUMN result TEXT DEFAULT 'pending'" },
    { table: 'predictions_v2', column: 'settled_at', sql: "ALTER TABLE predictions_v2 ADD COLUMN settled_at TEXT" },

    // teams: add missing columns
    { table: 'teams', column: 'country_code', sql: "ALTER TABLE teams ADD COLUMN country_code TEXT" },
    { table: 'teams', column: 'venue_id', sql: "ALTER TABLE teams ADD COLUMN venue_id INTEGER" },

    // leagues: add missing columns
    { table: 'leagues', column: 'is_women', sql: "ALTER TABLE leagues ADD COLUMN is_women INTEGER DEFAULT 0" },
    { table: 'leagues', column: 'season_year', sql: "ALTER TABLE leagues ADD COLUMN season_year INTEGER" },
    { table: 'leagues', column: 'season_start_date', sql: "ALTER TABLE leagues ADD COLUMN season_start_date TEXT" },
    { table: 'leagues', column: 'season_end_date', sql: "ALTER TABLE leagues ADD COLUMN season_end_date TEXT" },

    // team_profiles: add missing columns
    { table: 'team_profiles', column: 'home_win_rate', sql: "ALTER TABLE team_profiles ADD COLUMN home_win_rate REAL" },
    { table: 'team_profiles', column: 'home_draw_rate', sql: "ALTER TABLE team_profiles ADD COLUMN home_draw_rate REAL" },
    { table: 'team_profiles', column: 'home_loss_rate', sql: "ALTER TABLE team_profiles ADD COLUMN home_loss_rate REAL" },
    { table: 'team_profiles', column: 'away_win_rate', sql: "ALTER TABLE team_profiles ADD COLUMN away_win_rate REAL" },
    { table: 'team_profiles', column: 'away_draw_rate', sql: "ALTER TABLE team_profiles ADD COLUMN away_draw_rate REAL" },
    { table: 'team_profiles', column: 'away_loss_rate', sql: "ALTER TABLE team_profiles ADD COLUMN away_loss_rate REAL" },
    { table: 'team_profiles', column: 'home_btts_rate', sql: "ALTER TABLE team_profiles ADD COLUMN home_btts_rate REAL" },
    { table: 'team_profiles', column: 'home_over25_rate', sql: "ALTER TABLE team_profiles ADD COLUMN home_over25_rate REAL" },
    { table: 'team_profiles', column: 'away_btts_rate', sql: "ALTER TABLE team_profiles ADD COLUMN away_btts_rate REAL" },
    { table: 'team_profiles', column: 'away_over25_rate', sql: "ALTER TABLE team_profiles ADD COLUMN away_over25_rate REAL" },
    { table: 'team_profiles', column: 'home_clean_sheet_rate', sql: "ALTER TABLE team_profiles ADD COLUMN home_clean_sheet_rate REAL" },
    { table: 'team_profiles', column: 'away_clean_sheet_rate', sql: "ALTER TABLE team_profiles ADD COLUMN away_clean_sheet_rate REAL" },

    // brier_scores: ensure last_updated column exists
    { table: 'brier_scores', column: 'last_updated', sql: "ALTER TABLE brier_scores ADD COLUMN last_updated TEXT NOT NULL DEFAULT ''" },

    // team_glicko: add season_id for existing DBs (CRITICAL — was missing!)
    { table: 'team_glicko', column: 'season_id', sql: "ALTER TABLE team_glicko ADD COLUMN season_id INTEGER NOT NULL DEFAULT 0" },
  ];

  for (const migration of alterMigrations) {
    try {
      const colCheck = await client.execute({
        sql: "SELECT name FROM pragma_table_info(?) WHERE name = ?",
        args: [migration.table, migration.column],
      });
      if (colCheck.rows.length === 0) {
        await client.execute(migration.sql);
        console.log(`[Migration V4] Added column ${migration.column} to ${migration.table}`);
      }
    } catch {
      // Column might already exist or table might not exist yet — safe to ignore
    }
  }

  // ========================================================================
  // UNIQUE INDEX REPAIR: Ensure team_glicko has the UNIQUE constraint
  // ========================================================================
  // SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we can't add a UNIQUE
  // constraint to an existing team_glicko table. If the table was rebuilt
  // by the pre-migration check, it will have it. If it was created via ALTER
  // TABLE (adding season_id), it won't. We create a unique index as a workaround.
  try {
    await client.execute(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_team_glicko_unique ON team_glicko(team_id, league_id, season_id)'
    );
  } catch {
    // May fail if duplicate rows exist — that's OK, the table still works
  }

  console.log('[Migration V4] All migrations complete!');
}

// Auto-run when executed directly
if (typeof require !== 'undefined' && require.main === module) {
  migrate().catch(console.error);
}
