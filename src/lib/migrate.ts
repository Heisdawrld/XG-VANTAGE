// Database Migration — Creates all tables in Turso
import { client } from './db-turso';

export async function migrate() {
  console.log('Running migrations...');

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
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

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
      btts_no REAL
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

  // Create indexes for common queries
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
  ];

  for (const sql of indexes) {
    await client.execute(sql);
  }

  // Safe ALTER TABLE migrations for existing databases
  const alterMigrations = [
    // fixture_stats: add new columns if they don't exist
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
  ];

  for (const migration of alterMigrations) {
    try {
      // Check if column exists
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

  console.log('Migrations complete!');
}

// Auto-run when executed directly
if (require.main === module) {
  migrate().catch(console.error);
}
