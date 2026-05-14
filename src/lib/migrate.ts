// Database Migration — Creates all tables in Turso
// V3 Schema: Aligned with V2 engine code — every column the engine references exists
import { client } from './db-turso';

export async function migrate() {
  console.log('Running migrations...');

  // ========================================================================
  // PRE-MIGRATION: Drop tables with wrong schemas so CREATE TABLE IF NOT EXISTS
  // will recreate them with the correct schema.
  // This MUST run before the CREATE TABLE statements below.
  // ========================================================================

  // Check predictions_v2 — if it has fixture_id as PK instead of prediction_id, or
  // is missing xg_home/xg_away columns, drop it so it gets recreated properly.
  try {
    const v2Cols = await client.execute({
      sql: "SELECT name FROM pragma_table_info('predictions_v2')",
      args: [],
    });
    const colNames = v2Cols.rows.map(r => r.name as string);
    if (colNames.length > 0 && (!colNames.includes('xg_home') || !colNames.includes('prediction_id'))) {
      console.log('[Migration] predictions_v2 has wrong schema — dropping for rebuild...');
      await client.execute('DROP TABLE predictions_v2');
    }
  } catch {
    // Table doesn't exist yet — that's fine, it will be created below
  }

  // Check team_glicko — if it has matches_played instead of match_count, drop it
  try {
    const glickoCols = await client.execute({
      sql: "SELECT name FROM pragma_table_info('team_glicko')",
      args: [],
    });
    const glickoColNames = glickoCols.rows.map(r => r.name as string);
    if (glickoColNames.length > 0 && !glickoColNames.includes('match_count')) {
      console.log('[Migration] team_glicko has wrong schema — dropping for rebuild...');
      await client.execute('DROP TABLE team_glicko');
    }
  } catch {
    // Table doesn't exist yet
  }

  // Check brier_scores — if missing last_updated, drop it
  try {
    const brierCols = await client.execute({
      sql: "SELECT name FROM pragma_table_info('brier_scores')",
      args: [],
    });
    const brierColNames = brierCols.rows.map(r => r.name as string);
    if (brierColNames.length > 0 && !brierColNames.includes('last_updated')) {
      console.log('[Migration] brier_scores has wrong schema — dropping for rebuild...');
      await client.execute('DROP TABLE brier_scores');
    }
  } catch {
    // Table doesn't exist yet
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
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS leagues (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT,
      country_code TEXT,
      logo TEXT,
      flag TEXT,
      is_active INTEGER DEFAULT 1,
      season_id INTEGER,
      season_name TEXT,
      bsd_id INTEGER
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT,
      country TEXT,
      logo TEXT,
      bsd_id INTEGER UNIQUE
    );
  `);

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
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS fixtures (
      id INTEGER PRIMARY KEY,
      bsd_id INTEGER UNIQUE,
      league_id INTEGER REFERENCES leagues(id),
      season_id INTEGER,
      home_team_id INTEGER REFERENCES teams(id),
      away_team_id INTEGER REFERENCES teams(id),
      event_date TEXT,
      status TEXT DEFAULT 'notstarted',
      current_minute INTEGER,
      period TEXT,
      home_score INTEGER,
      away_score INTEGER,
      home_score_ht INTEGER,
      away_score_ht INTEGER,
      round_number INTEGER,
      round_name TEXT,
      is_local_derby INTEGER DEFAULT 0,
      travel_distance_km REAL,
      weather_code INTEGER,
      weather_desc TEXT,
      temperature REAL,
      wind_speed REAL,
      attendance INTEGER,
      venue_name TEXT,
      venue_city TEXT,
      referee_name TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
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
    );
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
    );
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
    );
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
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      league_id INTEGER,
      team_id INTEGER,
      type TEXT
    );
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
    );
  `);

  // ========================================================================
  // DETAILED DATA TABLES
  // ========================================================================

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
      away_interceptions INTEGER DEFAULT 0
    );
  `);

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
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

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
      updated_at TEXT
    );
  `);

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
    );
  `);

  // ========================================================================
  // V1 MODEL WEIGHTS TABLE (backward compat for /api/health)
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
    );
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
    );
  `);

  // ========================================================================
  // V2 ENGINE TABLES — Aligned with engine-v2 code
  // ========================================================================

  // predictions_v2: The V2 engine's primary prediction store.
  // NOTE: The V2 engine has its own ensurePredictionsV2Table() that may create
  // a different schema. We use the V2 engine's schema as the source of truth.
  // The columns here match what prediction-engine.ts INSERTs and SELECTs.
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
    );
  `);

  // team_glicko: Bayesian ELO ratings using Glicko-2 algorithm.
  // Column names match bayesian-elo.ts CREATE_TABLE_SQL.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS team_glicko (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      league_id INTEGER NOT NULL DEFAULT 0,
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // prediction_feedback: Stores per-fixture settlement results.
  // Schema matches learning-loop.ts ensureFeedbackTable().
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
    );
  `);

  // calibration_bins: Per-market isotonic calibration bins.
  // Schema matches calibration.ts ensureCalibrationTable().
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
    );
  `);

  // brier_scores: Per-market Brier score tracking.
  // Schema matches learning-loop.ts ensureBrierTable().
  await client.execute(`
    CREATE TABLE IF NOT EXISTS brier_scores (
      market_key TEXT NOT NULL PRIMARY KEY,
      total_brier REAL NOT NULL DEFAULT 0.0,
      count INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    );
  `);

  // v2_model_weights: V2 engine's model weight store.
  // Schema matches learning-loop.ts ensureModelWeightsTable().
  await client.execute(`
    CREATE TABLE IF NOT EXISTS v2_model_weights (
      model_name TEXT NOT NULL PRIMARY KEY,
      weight REAL NOT NULL,
      last_adjusted TEXT NOT NULL,
      adjustment_reason TEXT NOT NULL DEFAULT ''
    );
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
    'CREATE INDEX IF NOT EXISTS idx_predictions_fixture ON predictions(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_tier ON predictions(tier)',
    'CREATE INDEX IF NOT EXISTS idx_picks_date ON picks(date)',
    'CREATE INDEX IF NOT EXISTS idx_standings_league_season ON standings(league_id, season_id)',
    'CREATE INDEX IF NOT EXISTS idx_team_elo_team ON team_elo(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_team_profiles_team ON team_profiles(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_teams_bsd_id ON teams(bsd_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixtures_bsd_id ON fixtures(bsd_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_standings_unique ON standings(league_id, season_id, team_id)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_v2_fixture ON predictions_v2(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_v2_tier ON predictions_v2(tier)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_v2_confidence ON predictions_v2(confidence DESC)',
    'CREATE INDEX IF NOT EXISTS idx_team_glicko_team ON team_glicko(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_prediction_feedback_fixture ON prediction_feedback(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_calibration_bins_market ON calibration_bins(market_key)',
    'CREATE INDEX IF NOT EXISTS idx_brier_scores_market ON brier_scores(market_key)',
  ];

  for (const sql of indexes) {
    await client.execute(sql);
  }

  // ========================================================================
  // SAFE ALTER TABLE MIGRATIONS FOR EXISTING DATABASES
  // ========================================================================
  // These add missing columns to tables that were created with older schemas.

  const alterMigrations = [
    // fixture_stats: add new columns
    { table: 'fixture_stats', column: 'home_big_chances', sql: "ALTER TABLE fixture_stats ADD COLUMN home_big_chances INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_passes', sql: "ALTER TABLE fixture_stats ADD COLUMN home_passes INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_pass_accuracy', sql: "ALTER TABLE fixture_stats ADD COLUMN home_pass_accuracy REAL DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_tackles', sql: "ALTER TABLE fixture_stats ADD COLUMN home_tackles INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'home_interceptions', sql: "ALTER TABLE fixture_stats ADD COLUMN home_interceptions INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_big_chances', sql: "ALTER TABLE fixture_stats ADD COLUMN away_big_chances INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_passes', sql: "ALTER TABLE fixture_stats ADD COLUMN away_passes INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_pass_accuracy', sql: "ALTER TABLE fixture_stats ADD COLUMN away_pass_accuracy REAL DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_tackles', sql: "ALTER TABLE fixture_stats ADD COLUMN away_tackles INTEGER DEFAULT 0" },
    { table: 'fixture_stats', column: 'away_interceptions', sql: "ALTER TABLE fixture_stats ADD COLUMN away_interceptions INTEGER DEFAULT 0" },

    // fixtures: add venue/referee columns
    { table: 'fixtures', column: 'venue_name', sql: "ALTER TABLE fixtures ADD COLUMN venue_name TEXT" },
    { table: 'fixtures', column: 'venue_city', sql: "ALTER TABLE fixtures ADD COLUMN venue_city TEXT" },
    { table: 'fixtures', column: 'referee_name', sql: "ALTER TABLE fixtures ADD COLUMN referee_name TEXT" },

    // fixture_odds: add extended odds columns
    { table: 'fixture_odds', column: 'handicap_home_minus1', sql: "ALTER TABLE fixture_odds ADD COLUMN handicap_home_minus1 REAL" },
    { table: 'fixture_odds', column: 'handicap_away_minus1', sql: "ALTER TABLE fixture_odds ADD COLUMN handicap_away_minus1 REAL" },
    { table: 'fixture_odds', column: 'double_chance_home_draw', sql: "ALTER TABLE fixture_odds ADD COLUMN double_chance_home_draw REAL" },
    { table: 'fixture_odds', column: 'double_chance_away_draw', sql: "ALTER TABLE fixture_odds ADD COLUMN double_chance_away_draw REAL" },
    { table: 'fixture_odds', column: 'double_chance_home_away', sql: "ALTER TABLE fixture_odds ADD COLUMN double_chance_home_away REAL" },
    { table: 'fixture_odds', column: 'updated_at', sql: "ALTER TABLE fixture_odds ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))" },

    // predictions_v2: add result/settled_at columns for existing DBs
    { table: 'predictions_v2', column: 'result', sql: "ALTER TABLE predictions_v2 ADD COLUMN result TEXT DEFAULT 'pending'" },
    { table: 'predictions_v2', column: 'settled_at', sql: "ALTER TABLE predictions_v2 ADD COLUMN settled_at TEXT" },

    // brier_scores: ensure last_updated column exists
    { table: 'brier_scores', column: 'last_updated', sql: "ALTER TABLE brier_scores ADD COLUMN last_updated TEXT NOT NULL DEFAULT ''" },
  ];

  for (const migration of alterMigrations) {
    try {
      const colCheck = await client.execute({
        sql: "SELECT name FROM pragma_table_info(?) WHERE name = ?",
        args: [migration.table, migration.column],
      });
      if (colCheck.rows.length === 0) {
        await client.execute(migration.sql);
        console.log(`[Migration] Added column ${migration.column} to ${migration.table}`);
      }
    } catch {
      // Column might already exist or table might not exist yet — safe to ignore
    }
  }

  // ========================================================================
  // V2 TABLE REPAIR: Drop and recreate predictions_v2 if schema is wrong
  // ========================================================================
  // The old migration created predictions_v2 with fixture_id as PK and without
  // xg_home/xg_away columns. We need to check and fix this.

  try {
    const v2Cols = await client.execute({
      sql: "SELECT name FROM pragma_table_info('predictions_v2')",
      args: [],
    });
    const colNames = v2Cols.rows.map(r => r.name as string);
    const needsRebuild = !colNames.includes('xg_home') || !colNames.includes('prediction_id');

    if (needsRebuild) {
      console.log('[Migration] predictions_v2 schema is outdated — rebuilding...');
      // Save any existing data
      await client.execute('DROP TABLE IF EXISTS predictions_v2_backup');
      await client.execute('CREATE TABLE predictions_v2_backup AS SELECT * FROM predictions_v2');
      await client.execute('DROP TABLE predictions_v2');

      // Recreate with correct schema
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
        );
      `);

      // Recreate indexes
      await client.execute('CREATE INDEX IF NOT EXISTS idx_predictions_v2_fixture ON predictions_v2(fixture_id)');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_predictions_v2_tier ON predictions_v2(tier)');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_predictions_v2_confidence ON predictions_v2(confidence DESC)');

      console.log('[Migration] predictions_v2 rebuilt with correct schema');
    }
  } catch (err) {
    console.log('[Migration] predictions_v2 rebuild check skipped:', err);
  }

  // Similar repair for team_glicko — ensure match_count column exists (not matches_played)
  try {
    const glickoCols = await client.execute({
      sql: "SELECT name FROM pragma_table_info('team_glicko')",
      args: [],
    });
    const glickoColNames = glickoCols.rows.map(r => r.name as string);
    const needsGlickoFix = !glickoColNames.includes('match_count');

    if (needsGlickoFix) {
      console.log('[Migration] team_glicko schema is outdated — rebuilding...');
      await client.execute('DROP TABLE IF EXISTS team_glicko_backup');
      await client.execute('CREATE TABLE team_glicko_backup AS SELECT * FROM team_glicko');
      await client.execute('DROP TABLE team_glicko');

      await client.execute(`
        CREATE TABLE team_glicko (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team_id INTEGER NOT NULL,
          league_id INTEGER NOT NULL DEFAULT 0,
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
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      await client.execute('CREATE INDEX IF NOT EXISTS idx_team_glicko_team ON team_glicko(team_id)');
      console.log('[Migration] team_glicko rebuilt with correct schema');
    }
  } catch (err) {
    console.log('[Migration] team_glicko rebuild check skipped:', err);
  }

  // Repair brier_scores — ensure last_updated column exists
  try {
    const brierCols = await client.execute({
      sql: "SELECT name FROM pragma_table_info('brier_scores')",
      args: [],
    });
    const brierColNames = brierCols.rows.map(r => r.name as string);

    if (!brierColNames.includes('last_updated')) {
      console.log('[Migration] brier_scores missing last_updated — rebuilding...');
      await client.execute('DROP TABLE IF EXISTS brier_scores');
      await client.execute(`
        CREATE TABLE brier_scores (
          market_key TEXT NOT NULL PRIMARY KEY,
          total_brier REAL NOT NULL DEFAULT 0.0,
          count INTEGER NOT NULL DEFAULT 0,
          last_updated TEXT NOT NULL
        );
      `);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_brier_scores_market ON brier_scores(market_key)');
      console.log('[Migration] brier_scores rebuilt with correct schema');
    }
  } catch (err) {
    console.log('[Migration] brier_scores rebuild check skipped:', err);
  }

  // Create v2_model_weights table if it doesn't exist
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS v2_model_weights (
        model_name TEXT NOT NULL PRIMARY KEY,
        weight REAL NOT NULL,
        last_adjusted TEXT NOT NULL,
        adjustment_reason TEXT NOT NULL DEFAULT ''
      );
    `);
  } catch {
    // Already exists
  }

  console.log('Migrations complete!');
}

// Auto-run when executed directly
if (require.main === module) {
  migrate().catch(console.error);
}
