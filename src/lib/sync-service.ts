// Data Sync Service — Pulls data from BSD API into Turso database

import { bsdClient } from '@/lib/bsd-client';
import { client } from '@/lib/db-turso';

export async function syncLeagues(): Promise<number> {
  console.log('[Sync] Syncing leagues...');
  let synced = 0;
  let offset = 0;
  const limit = 200;

  while (true) {
    const data = await bsdClient.getLeagues({ limit, offset });
    for (const league of data.results) {
      // Check if exists
      const existing = await client.execute({
        sql: 'SELECT id FROM leagues WHERE id = ?',
        args: [league.id],
      });

      if (existing.rows.length > 0) {
        await client.execute({
          sql: `UPDATE leagues SET name = ?, country = ?, is_active = ?, season_id = ?, season_name = ? WHERE id = ?`,
          args: [league.name, league.country, league.is_active ? 1 : 0, league.current_season?.id ?? null, league.current_season?.name ?? null, league.id],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO leagues (id, name, country, is_active, season_id, season_name) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [league.id, league.name, league.country, league.is_active ? 1 : 0, league.current_season?.id ?? null, league.current_season?.name ?? null],
        });
      }
      synced++;
    }
    if (!data.next || data.results.length < limit) break;
    offset += limit;
  }
  console.log(`[Sync] Synced ${synced} leagues`);
  return synced;
}

export async function syncStandings(leagueId: number): Promise<number> {
  console.log(`[Sync] Syncing standings for league ${leagueId}...`);
  try {
    const data = await bsdClient.getLeagueStandings(leagueId);
    let synced = 0;

    for (const s of data.standings) {
      // Ensure team exists
      const existingTeam = await client.execute({
        sql: 'SELECT id FROM teams WHERE id = ?',
        args: [s.team_id],
      });
      if (existingTeam.rows.length === 0) {
        await client.execute({
          sql: 'INSERT INTO teams (id, name) VALUES (?, ?)',
          args: [s.team_id, s.team_name],
        });
      } else {
        await client.execute({
          sql: 'UPDATE teams SET name = ? WHERE id = ?',
          args: [s.team_name, s.team_id],
        });
      }

      // Upsert standing
      const existingStanding = await client.execute({
        sql: 'SELECT id FROM standings WHERE league_id = ? AND season_id = ? AND team_id = ?',
        args: [leagueId, data.season?.id ?? 0, s.team_id],
      });

      if (existingStanding.rows.length > 0) {
        await client.execute({
          sql: `UPDATE standings SET position = ?, played = ?, won = ?, drawn = ?, lost = ?,
                gf = ?, ga = ?, gd = ?, pts = ?, xgf = ?, xga = ?, xgd = ?,
                xg_games = ?, form = ?, is_live = ?, team_name = ?
                WHERE league_id = ? AND season_id = ? AND team_id = ?`,
          args: [s.position, s.played, s.won, s.drawn, s.lost, s.gf, s.ga, s.gd, s.pts,
            s.xgf ?? null, s.xga ?? null, s.xgd ?? null, s.xg_games ?? null,
            s.form, s.live ? 1 : 0, s.team_name,
            leagueId, data.season?.id ?? 0, s.team_id],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO standings (league_id, season_id, team_id, team_name, position, played, won, drawn, lost, gf, ga, gd, pts, xgf, xga, xgd, xg_games, form, is_live)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [leagueId, data.season?.id ?? 0, s.team_id, s.team_name, s.position, s.played, s.won, s.drawn, s.lost, s.gf, s.ga, s.gd, s.pts,
            s.xgf ?? null, s.xga ?? null, s.xgd ?? null, s.xg_games ?? null, s.form, s.live ? 1 : 0],
        });
      }
      synced++;
    }
    console.log(`[Sync] Synced ${synced} standings for league ${leagueId}`);
    return synced;
  } catch (err) {
    console.error(`[Sync] Failed standings for league ${leagueId}:`, err);
    return 0;
  }
}

export async function syncFixtures(params: { dateFrom: string; dateTo: string; leagueId?: number }): Promise<number> {
  console.log(`[Sync] Syncing fixtures ${params.dateFrom} to ${params.dateTo}...`);
  let synced = 0;
  let offset = 0;
  const limit = 200;

  while (true) {
    const data = await bsdClient.getEvents({
      date_from: params.dateFrom,
      date_to: params.dateTo,
      league_id: params.leagueId,
      limit,
      offset,
    });

    for (const event of data.results) {
      await syncSingleFixture(event);
      synced++;
    }

    if (!data.next || data.results.length < limit) break;
    offset += limit;
  }
  console.log(`[Sync] Synced ${synced} fixtures`);
  return synced;
}

export async function syncSingleFixture(event: {
  id: number; league_id: number; season_id?: number;
  home_team_id: number; home_team: string; away_team_id: number; away_team: string;
  event_date: string; status: string; round_number?: number; round_name?: string;
  period?: string; current_minute?: number;
  home_score?: number; away_score?: number; home_score_ht?: number; away_score_ht?: number;
  is_local_derby: boolean; travel_distance_km?: number;
  weather?: { code?: number; description?: string; wind_speed?: number; temperature_c?: number };
  attendance?: number;
}): Promise<void> {
  if (event.home_team_id == null || event.away_team_id == null) return;

  // Ensure league exists (INSERT OR IGNORE for concurrency safety)
  if (event.league_id) {
    await client.execute({ sql: 'INSERT OR IGNORE INTO leagues (id, name) VALUES (?, ?)', args: [event.league_id, 'Unknown League'] });
  }

  // Ensure teams exist (INSERT OR REPLACE for upsert safety)
  await client.execute({ sql: 'INSERT OR REPLACE INTO teams (id, name) VALUES (?, ?)', args: [event.home_team_id, event.home_team] });
  await client.execute({ sql: 'INSERT OR REPLACE INTO teams (id, name) VALUES (?, ?)', args: [event.away_team_id, event.away_team] });

  // Upsert fixture
  await client.execute({
    sql: `INSERT INTO fixtures (id, league_id, season_id, home_team_id, away_team_id, event_date, status,
          round_number, round_name, period, current_minute, home_score, away_score, home_score_ht, away_score_ht,
          is_local_derby, travel_distance_km, weather_code, weather_desc, temperature, wind_speed, attendance, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
          status = excluded.status, period = excluded.period, current_minute = excluded.current_minute,
          home_score = excluded.home_score, away_score = excluded.away_score,
          home_score_ht = excluded.home_score_ht, away_score_ht = excluded.away_score_ht,
          updated_at = datetime('now')`,
    args: [
      event.id, event.league_id, event.season_id ?? null,
      event.home_team_id, event.away_team_id, event.event_date, event.status,
      event.round_number ?? null, event.round_name ?? null, event.period ?? null, event.current_minute ?? null,
      event.home_score ?? null, event.away_score ?? null, event.home_score_ht ?? null, event.away_score_ht ?? null,
      event.is_local_derby ? 1 : 0, event.travel_distance_km ?? null,
      event.weather?.code ?? null, event.weather?.description ?? null,
      event.weather?.temperature_c ?? null, event.weather?.wind_speed ?? null,
      event.attendance ?? null,
    ],
  });
}

export async function syncFixtureDetails(fixtureId: number): Promise<void> {
  console.log(`[Sync] Syncing details for fixture ${fixtureId}...`);

  // Sync stats
  try {
    const stats = await bsdClient.getEventStats(fixtureId);
    if (stats.stats?.home && stats.stats?.away) {
      const home = stats.stats.home as Record<string, unknown>;
      const away = stats.stats.away as Record<string, unknown>;

      const existingStats = await client.execute({ sql: 'SELECT id FROM fixture_stats WHERE fixture_id = ?', args: [fixtureId] });
      if (existingStats.rows.length > 0) {
        await client.execute({
          sql: `UPDATE fixture_stats SET
            home_total_shots = ?, home_shots_on_target = ?, home_ball_possession = ?, home_expected_goals = ?,
            home_corner_kicks = ?, home_fouls = ?, home_yellow_cards = ?, home_red_cards = ?,
            home_attacks = ?, home_dangerous_attacks = ?,
            away_total_shots = ?, away_shots_on_target = ?, away_ball_possession = ?, away_expected_goals = ?,
            away_corner_kicks = ?, away_fouls = ?, away_yellow_cards = ?, away_red_cards = ?,
            away_attacks = ?, away_dangerous_attacks = ?
            WHERE fixture_id = ?`,
          args: [
            (home.total_shots as number) ?? 0, (home.shots_on_target as number) ?? 0,
            (home.ball_possession as number) ?? 50, (home.expected_goals as number) ?? 0,
            (home.corner_kicks as number) ?? 0, (home.fouls as number) ?? 0,
            (home.yellow_cards as number) ?? 0, (home.red_cards as number) ?? 0,
            (home.attack as number) ?? 0, (home.dangerous_attack as number) ?? 0,
            (away.total_shots as number) ?? 0, (away.shots_on_target as number) ?? 0,
            (away.ball_possession as number) ?? 50, (away.expected_goals as number) ?? 0,
            (away.corner_kicks as number) ?? 0, (away.fouls as number) ?? 0,
            (away.yellow_cards as number) ?? 0, (away.red_cards as number) ?? 0,
            (away.attack as number) ?? 0, (away.dangerous_attack as number) ?? 0,
            fixtureId,
          ],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO fixture_stats (fixture_id, home_total_shots, home_shots_on_target, home_ball_possession, home_expected_goals,
                home_corner_kicks, home_fouls, home_yellow_cards, home_red_cards, home_attacks, home_dangerous_attacks,
                away_total_shots, away_shots_on_target, away_ball_possession, away_expected_goals,
                away_corner_kicks, away_fouls, away_yellow_cards, away_red_cards, away_attacks, away_dangerous_attacks)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            fixtureId,
            (home.total_shots as number) ?? 0, (home.shots_on_target as number) ?? 0,
            (home.ball_possession as number) ?? 50, (home.expected_goals as number) ?? 0,
            (home.corner_kicks as number) ?? 0, (home.fouls as number) ?? 0,
            (home.yellow_cards as number) ?? 0, (home.red_cards as number) ?? 0,
            (home.attack as number) ?? 0, (home.dangerous_attack as number) ?? 0,
            (away.total_shots as number) ?? 0, (away.shots_on_target as number) ?? 0,
            (away.ball_possession as number) ?? 50, (away.expected_goals as number) ?? 0,
            (away.corner_kicks as number) ?? 0, (away.fouls as number) ?? 0,
            (away.yellow_cards as number) ?? 0, (away.red_cards as number) ?? 0,
            (away.attack as number) ?? 0, (away.dangerous_attack as number) ?? 0,
          ],
        });
      }
    }
  } catch { /* Stats might not be available */ }

  // Sync odds
  try {
    const odds = await bsdClient.getEventOdds(fixtureId);
    if (odds.odds) {
      const existingOdds = await client.execute({ sql: 'SELECT id FROM fixture_odds WHERE fixture_id = ?', args: [fixtureId] });
      if (existingOdds.rows.length > 0) {
        await client.execute({
          sql: `UPDATE fixture_odds SET home_win = ?, draw = ?, away_win = ?,
                over_15_goals = ?, over_25_goals = ?, over_35_goals = ?,
                under_15_goals = ?, under_25_goals = ?, under_35_goals = ?,
                btts_yes = ?, btts_no = ? WHERE fixture_id = ?`,
          args: [odds.odds.home_win ?? null, odds.odds.draw ?? null, odds.odds.away_win ?? null,
            odds.odds.over_15_goals ?? null, odds.odds.over_25_goals ?? null, odds.odds.over_35_goals ?? null,
            odds.odds.under_15_goals ?? null, odds.odds.under_25_goals ?? null, odds.odds.under_35_goals ?? null,
            odds.odds.btts_yes ?? null, odds.odds.btts_no ?? null, fixtureId],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO fixture_odds (fixture_id, home_win, draw, away_win, over_15_goals, over_25_goals, over_35_goals,
                under_15_goals, under_25_goals, under_35_goals, btts_yes, btts_no)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [fixtureId, odds.odds.home_win ?? null, odds.odds.draw ?? null, odds.odds.away_win ?? null,
            odds.odds.over_15_goals ?? null, odds.odds.over_25_goals ?? null, odds.odds.over_35_goals ?? null,
            odds.odds.under_15_goals ?? null, odds.odds.under_25_goals ?? null, odds.odds.under_35_goals ?? null,
            odds.odds.btts_yes ?? null, odds.odds.btts_no ?? null],
        });
      }
    }
  } catch { /* Odds might not be available */ }

  // Sync lineups
  try {
    const lineups = await bsdClient.getEventLineups(fixtureId);
    const existingLineup = await client.execute({ sql: 'SELECT id FROM fixture_lineups WHERE fixture_id = ?', args: [fixtureId] });

    if (existingLineup.rows.length > 0) {
      await client.execute({
        sql: `UPDATE fixture_lineups SET lineup_status = ?, home_formation = ?, away_formation = ?,
              home_players = ?, away_players = ?, home_substitutes = ?, away_substitutes = ?,
              home_unavailable = ?, away_unavailable = ?, updated_at = datetime('now')
              WHERE fixture_id = ?`,
        args: [lineups.lineup_status,
          lineups.lineups?.home?.formation ?? '', lineups.lineups?.away?.formation ?? '',
          JSON.stringify(lineups.lineups?.home?.players ?? []),
          JSON.stringify(lineups.lineups?.away?.players ?? []),
          JSON.stringify(lineups.lineups?.home?.substitutes ?? []),
          JSON.stringify(lineups.lineups?.away?.substitutes ?? []),
          JSON.stringify(lineups.unavailable_players?.home ?? []),
          JSON.stringify(lineups.unavailable_players?.away ?? []),
          fixtureId],
      });
    } else {
      await client.execute({
        sql: `INSERT INTO fixture_lineups (fixture_id, lineup_status, home_formation, away_formation,
              home_players, away_players, home_substitutes, away_substitutes, home_unavailable, away_unavailable, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [fixtureId, lineups.lineup_status,
          lineups.lineups?.home?.formation ?? '', lineups.lineups?.away?.formation ?? '',
          JSON.stringify(lineups.lineups?.home?.players ?? []),
          JSON.stringify(lineups.lineups?.away?.players ?? []),
          JSON.stringify(lineups.lineups?.home?.substitutes ?? []),
          JSON.stringify(lineups.lineups?.away?.substitutes ?? []),
          JSON.stringify(lineups.unavailable_players?.home ?? []),
          JSON.stringify(lineups.unavailable_players?.away ?? [])],
      });
    }
  } catch { /* Lineups might not be available */ }
}

/** Full daily sync — run this on a schedule */
export async function fullDailySync(): Promise<{ leagues: number; fixtures: number; standings: number }> {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Sync leagues
  const leagues = await syncLeagues();

  // Sync fixtures (yesterday through tomorrow)
  const fixtures = await syncFixtures({ dateFrom: yesterday, dateTo: tomorrow });

  // Sync standings for top leagues
  const topLeagues = [17, 3, 9, 6, 13, 14, 30, 29, 34, 8];
  let standings = 0;
  for (const lid of topLeagues) {
    standings += await syncStandings(lid);
  }

  // Sync details for today's matches
  const todayFixtures = await client.execute({
    sql: "SELECT id FROM fixtures WHERE event_date >= ? AND event_date < ? LIMIT 50",
    args: [today, tomorrow],
  });
  for (const f of todayFixtures.rows) {
    await syncFixtureDetails(f.id as number);
  }

  return { leagues, fixtures, standings };
}
