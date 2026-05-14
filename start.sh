#!/bin/sh
# Render Start Script — runs migrations then starts Next.js
echo "=== xG-Vantage Production Start ==="
echo "[Startup] PORT=${PORT:-10000}"
echo "[Startup] TURSO_DATABASE_URL set: $([ -n "$TURSO_DATABASE_URL" ] && echo YES || echo NO)"
echo "[Startup] TURSO_AUTH_TOKEN set: $([ -n "$TURSO_AUTH_TOKEN" ] && echo YES || echo NO)"

# Step 1: Run database migrations (best-effort, don't block startup)
echo "[Startup] Running database migrations..."
if [ -n "$TURSO_DATABASE_URL" ] && [ -n "$TURSO_AUTH_TOKEN" ]; then
  node -e "
const { createClient } = require('@libsql/client');
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  const tables = [
    'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, password_hash TEXT, display_name TEXT, avatar_url TEXT, plan TEXT DEFAULT \"free\", plan_expires_at TEXT, referral_code TEXT UNIQUE, referred_by TEXT, created_at TEXT DEFAULT (datetime(\"now\")), updated_at TEXT DEFAULT (datetime(\"now\")))',
    'CREATE TABLE IF NOT EXISTS leagues (id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT, country_code TEXT, logo TEXT, flag TEXT, is_active INTEGER DEFAULT 1, season_id INTEGER, season_name TEXT, bsd_id INTEGER)',
    'CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL, short_name TEXT, country TEXT, logo TEXT, bsd_id INTEGER UNIQUE)',
    'CREATE TABLE IF NOT EXISTS team_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER REFERENCES teams(id), season_id INTEGER, league_id INTEGER REFERENCES leagues(id), avg_goals_scored REAL, avg_goals_conceded REAL, avg_xg_for REAL, avg_xg_against REAL, possession REAL, clean_sheet_pct REAL, btts_pct REAL, over_25_pct REAL, home_avg_scored REAL, home_avg_conceded REAL, away_avg_scored REAL, away_avg_conceded REAL, style TEXT, tactical_profile TEXT, preferred_formation TEXT, press_intensity TEXT, def_line TEXT, form TEXT, home_form TEXT, away_form TEXT, updated_at TEXT DEFAULT (datetime(\"now\")))',
    'CREATE TABLE IF NOT EXISTS fixtures (id INTEGER PRIMARY KEY, bsd_id INTEGER UNIQUE, league_id INTEGER REFERENCES leagues(id), season_id INTEGER, home_team_id INTEGER REFERENCES teams(id), away_team_id INTEGER REFERENCES teams(id), event_date TEXT, status TEXT DEFAULT \"notstarted\", current_minute INTEGER, period TEXT, home_score INTEGER, away_score INTEGER, home_score_ht INTEGER, away_score_ht INTEGER, round_number INTEGER, round_name TEXT, is_local_derby INTEGER DEFAULT 0, travel_distance_km REAL, weather_code INTEGER, weather_desc TEXT, temperature REAL, wind_speed REAL, attendance INTEGER, updated_at TEXT DEFAULT (datetime(\"now\")))',
    'CREATE TABLE IF NOT EXISTS predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER REFERENCES fixtures(id), pick_type TEXT NOT NULL, pick_label TEXT NOT NULL, confidence REAL NOT NULL, tier TEXT, phantom_score REAL, edge REAL, home_win_prob REAL, draw_prob REAL, away_win_prob REAL, over_25_prob REAL, under_25_prob REAL, btts_yes_prob REAL, btts_no_prob REAL, home_xg REAL, away_xg REAL, verdict TEXT, decision_stack TEXT, key_reasons TEXT, tactical_matchup TEXT, odds_json TEXT, result TEXT DEFAULT \"pending\", settled_at TEXT, created_at TEXT DEFAULT (datetime(\"now\")))',
    'CREATE TABLE IF NOT EXISTS picks (id INTEGER PRIMARY KEY AUTOINCREMENT, prediction_id INTEGER REFERENCES predictions(id), fixture_id INTEGER REFERENCES fixtures(id), rank INTEGER, date TEXT, category TEXT, created_at TEXT DEFAULT (datetime(\"now\")))',
    'CREATE TABLE IF NOT EXISTS accas (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES users(id), date TEXT, pick_ids TEXT, total_odds REAL, status TEXT DEFAULT \"pending\", created_at TEXT DEFAULT (datetime(\"now\")))',
    'CREATE TABLE IF NOT EXISTS track_record (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, pick_type TEXT, total INTEGER, won INTEGER, lost INTEGER, void_count INTEGER, win_rate REAL, month TEXT)',
    'CREATE TABLE IF NOT EXISTS user_favorites (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES users(id), league_id INTEGER, team_id INTEGER, type TEXT)',
    'CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES users(id), title TEXT, message TEXT, type TEXT, read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\"now\")))',
    'CREATE TABLE IF NOT EXISTS fixture_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER REFERENCES fixtures(id) UNIQUE, home_total_shots INTEGER DEFAULT 0, home_shots_on_target INTEGER DEFAULT 0, home_ball_possession REAL DEFAULT 50, home_expected_goals REAL DEFAULT 0, home_corner_kicks INTEGER DEFAULT 0, home_fouls INTEGER DEFAULT 0, home_yellow_cards INTEGER DEFAULT 0, home_red_cards INTEGER DEFAULT 0, home_attacks INTEGER DEFAULT 0, home_dangerous_attacks INTEGER DEFAULT 0, away_total_shots INTEGER DEFAULT 0, away_shots_on_target INTEGER DEFAULT 0, away_ball_possession REAL DEFAULT 50, away_expected_goals REAL DEFAULT 0, away_corner_kicks INTEGER DEFAULT 0, away_fouls INTEGER DEFAULT 0, away_yellow_cards INTEGER DEFAULT 0, away_red_cards INTEGER DEFAULT 0, away_attacks INTEGER DEFAULT 0, away_dangerous_attacks INTEGER DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS fixture_odds (id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER REFERENCES fixtures(id) UNIQUE, home_win REAL, draw REAL, away_win REAL, over_15_goals REAL, over_25_goals REAL, over_35_goals REAL, under_15_goals REAL, under_25_goals REAL, under_35_goals REAL, btts_yes REAL, btts_no REAL)',
    'CREATE TABLE IF NOT EXISTS fixture_lineups (id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER REFERENCES fixtures(id) UNIQUE, lineup_status TEXT, home_formation TEXT, away_formation TEXT, home_players TEXT, away_players TEXT, home_substitutes TEXT, away_substitutes TEXT, home_unavailable TEXT, away_unavailable TEXT, home_confidence REAL, away_confidence REAL, updated_at TEXT)',
    'CREATE TABLE IF NOT EXISTS standings (id INTEGER PRIMARY KEY AUTOINCREMENT, league_id INTEGER, season_id INTEGER, team_id INTEGER, team_name TEXT, position INTEGER, played INTEGER, won INTEGER, drawn INTEGER, lost INTEGER, gf INTEGER, ga INTEGER, gd INTEGER, pts INTEGER, xgf REAL, xga REAL, xgd REAL, xg_games INTEGER, form TEXT, is_live INTEGER DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS model_weights (id INTEGER PRIMARY KEY AUTOINCREMENT, model_version TEXT, poisson_weight REAL DEFAULT 0.35, elo_weight REAL DEFAULT 0.25, form_weight REAL DEFAULT 0.20, style_matchup_weight REAL DEFAULT 0.10, context_weight REAL DEFAULT 0.10, is_active INTEGER DEFAULT 1, total_predictions INTEGER DEFAULT 0, correct_results INTEGER DEFAULT 0, result_accuracy REAL DEFAULT 0, avg_calibration_error REAL DEFAULT 0, value_edge_threshold REAL DEFAULT 0.05, updated_at TEXT DEFAULT (datetime(\"now\")))',
    'CREATE TABLE IF NOT EXISTS team_elo (id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER, league_id INTEGER, season_id INTEGER, elo_rating REAL DEFAULT 1500, elo_home_rating REAL DEFAULT 1500, elo_away_rating REAL DEFAULT 1500, matches_played INTEGER DEFAULT 0, last_match_date TEXT, updated_at TEXT DEFAULT (datetime(\"now\")))',
  ];

  for (const sql of tables) {
    try { await client.execute(sql); } catch (e) { console.log('Table exists (skipped):', sql.split(' ')[5]); }
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_fixtures_date ON fixtures(event_date)',
    'CREATE INDEX IF NOT EXISTS idx_fixtures_status ON fixtures(status)',
    'CREATE INDEX IF NOT EXISTS idx_fixtures_league ON fixtures(league_id)',
    'CREATE INDEX IF NOT EXISTS idx_predictions_fixture ON predictions(fixture_id)',
    'CREATE INDEX IF NOT EXISTS idx_picks_date ON picks(date)',
    'CREATE INDEX IF NOT EXISTS idx_standings_league_season ON standings(league_id, season_id)',
    'CREATE INDEX IF NOT EXISTS idx_team_elo_team ON team_elo(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_team_profiles_team ON team_profiles(team_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_standings_unique ON standings(league_id, season_id, team_id)',
  ];
  for (const sql of indexes) {
    try { await client.execute(sql); } catch (e) { /* skip */ }
  }

  const mw = await client.execute('SELECT id FROM model_weights WHERE is_active = 1 LIMIT 1');
  if (mw.rows.length === 0) {
    await client.execute(\"INSERT INTO model_weights (model_version, is_active) VALUES ('v1', 1)\");
    console.log('Seeded default model weights');
  }

  console.log('Migrations complete!');
}
migrate().catch(e => { console.error('Migration error (non-fatal):', e.message || e); });
" 2>&1 || echo "[Startup] Migration skipped (non-fatal)"
else
  echo "[Startup] WARNING: Database env vars not set, skipping migrations"
fi

echo "[Startup] Starting Next.js standalone server..."
echo "[Startup] HOSTNAME=0.0.0.0 PORT=${PORT:-10000}"

# CRITICAL: Set HOSTNAME so Next.js standalone listens on all interfaces
export HOSTNAME=0.0.0.0
exec node .next/standalone/server.js
