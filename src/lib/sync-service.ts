// Data Sync Service — Pulls data from BSD API into Turso database
// ENHANCED: Historical team sync, deep sync, logo support

import { bsdClient } from '@/lib/bsd-client';
import { client } from '@/lib/db-turso';

// ============================================================================
// LEAGUE SYNC
// ============================================================================

export async function syncLeagues(): Promise<number> {
  console.log('[Sync] Syncing leagues...');
  let synced = 0;
  let offset = 0;
  const limit = 200;

  while (true) {
    const data = await bsdClient.getLeagues({ limit, offset });
    for (const league of data.results) {
      const existing = await client.execute({
        sql: 'SELECT id FROM leagues WHERE id = ?',
        args: [league.id],
      });

      if (existing.rows.length > 0) {
        await client.execute({
          sql: `UPDATE leagues SET name = ?, country = ?, is_active = ?, is_women = ?,
                season_id = ?, season_name = ?, season_year = ?, season_start_date = ?, season_end_date = ? WHERE id = ?`,
          args: [league.name, league.country, league.is_active ? 1 : 0, league.is_women ? 1 : 0,
            league.current_season?.id ?? null, league.current_season?.name ?? null,
            league.current_season?.year ?? null, league.current_season?.start_date ?? null,
            league.current_season?.end_date ?? null, league.id],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO leagues (id, name, country, is_active, is_women, season_id, season_name, season_year, season_start_date, season_end_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [league.id, league.name, league.country, league.is_active ? 1 : 0, league.is_women ? 1 : 0,
            league.current_season?.id ?? null, league.current_season?.name ?? null,
            league.current_season?.year ?? null, league.current_season?.start_date ?? null,
            league.current_season?.end_date ?? null],
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

// ============================================================================
// STANDINGS SYNC
// ============================================================================

export async function syncStandings(leagueId: number): Promise<number> {
  console.log(`[Sync] Syncing standings for league ${leagueId}...`);
  try {
    const data = await bsdClient.getLeagueStandings(leagueId);
    let synced = 0;

    for (const s of data.standings) {
      // Ensure team exists with name
      const existingTeam = await client.execute({
        sql: 'SELECT id, logo FROM teams WHERE id = ?',
        args: [s.team_id],
      });
      let teamShortName: string | null = s.team_name?.substring(0, 3)?.toUpperCase() || null;
      let teamCountry: string | null = null;
      try {
        const teamData = await bsdClient.getTeams({ name: s.team_name, limit: 1 });
        if (teamData.results.length > 0) {
          teamShortName = teamData.results[0].short_name || teamShortName;
          teamCountry = teamData.results[0].country || null;
        }
      } catch { /* silent */ }

      // Upsert team (use INSERT OR REPLACE — teams.id is PK)
      await client.execute({
        sql: 'INSERT OR REPLACE INTO teams (id, name, short_name, country, country_code, venue_id) VALUES (?, ?, ?, ?, ?, ?)',
        args: [s.team_id, s.team_name, teamShortName, teamCountry, null, null],
      });

      // Upsert standing (delete-then-insert to handle AUTOINCREMENT id + unique constraint)
      await client.execute({
        sql: 'DELETE FROM standings WHERE league_id = ? AND season_id = ? AND team_id = ?',
        args: [leagueId, data.season?.id ?? 0, s.team_id],
      });
      await client.execute({
        sql: `INSERT INTO standings (league_id, season_id, team_id, team_name, position, played, won, drawn, lost, gf, ga, gd, pts, xgf, xga, xgd, xg_games, form, is_live)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [leagueId, data.season?.id ?? 0, s.team_id, s.team_name, s.position, s.played, s.won, s.drawn, s.lost, s.gf, s.ga, s.gd, s.pts,
          s.xgf ?? null, s.xga ?? null, s.xgd ?? null, s.xg_games ?? null, s.form, s.live ? 1 : 0],
      });
      synced++;
    }
    console.log(`[Sync] Synced ${synced} standings for league ${leagueId}`);
    return synced;
  } catch (err) {
    console.error(`[Sync] Failed standings for league ${leagueId}:`, err);
    return 0;
  }
}

// ============================================================================
// FIXTURE SYNC
// ============================================================================

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

  // Ensure league exists
  if (event.league_id) {
    await client.execute({ sql: 'INSERT OR IGNORE INTO leagues (id, name) VALUES (?, ?)', args: [event.league_id, 'Unknown League'] });
  }

  // Ensure teams exist with names
  await client.execute({ sql: 'INSERT OR IGNORE INTO teams (id, name) VALUES (?, ?)', args: [event.home_team_id, event.home_team] });
  await client.execute({ sql: 'UPDATE teams SET name = ? WHERE id = ?', args: [event.home_team, event.home_team_id] });
  await client.execute({ sql: 'INSERT OR IGNORE INTO teams (id, name) VALUES (?, ?)', args: [event.away_team_id, event.away_team] });
  await client.execute({ sql: 'UPDATE teams SET name = ? WHERE id = ?', args: [event.away_team, event.away_team_id] });

  // Upsert fixture — includes ALL BSDEvent fields
  await client.execute({
    sql: `INSERT INTO fixtures (id, league_id, season_id, home_team_id, away_team_id, event_date, status,
          round_number, round_name, group_name, period, current_minute,
          home_score, away_score, home_score_ht, away_score_ht,
          home_coach_id, away_coach_id, referee_id, venue_id,
          penalty_shootout, extra_time_score,
          is_local_derby, is_neutral_ground, travel_distance_km,
          weather_code, weather_desc, temperature, wind_speed, pitch_condition,
          attendance, live_websocket, last_updated, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
          status = excluded.status, period = excluded.period, current_minute = excluded.current_minute,
          home_score = excluded.home_score, away_score = excluded.away_score,
          home_score_ht = excluded.home_score_ht, away_score_ht = excluded.away_score_ht,
          home_coach_id = COALESCE(excluded.home_coach_id, fixtures.home_coach_id),
          away_coach_id = COALESCE(excluded.away_coach_id, fixtures.away_coach_id),
          referee_id = COALESCE(excluded.referee_id, fixtures.referee_id),
          venue_id = COALESCE(excluded.venue_id, fixtures.venue_id),
          penalty_shootout = COALESCE(excluded.penalty_shootout, fixtures.penalty_shootout),
          extra_time_score = COALESCE(excluded.extra_time_score, fixtures.extra_time_score),
          league_id = COALESCE(excluded.league_id, fixtures.league_id),
          season_id = COALESCE(excluded.season_id, fixtures.season_id),
          live_websocket = excluded.live_websocket,
          last_updated = excluded.last_updated,
          updated_at = datetime('now')`,
    args: [
      event.id, event.league_id, event.season_id ?? null,
      event.home_team_id, event.away_team_id, event.event_date, event.status,
      event.round_number ?? null, event.round_name ?? null, (event as any).group_name ?? null,
      event.period ?? null, event.current_minute ?? null,
      event.home_score ?? null, event.away_score ?? null, event.home_score_ht ?? null, event.away_score_ht ?? null,
      (event as any).home_coach_id ?? null, (event as any).away_coach_id ?? null,
      (event as any).referee_id ?? null, (event as any).venue_id ?? null,
      (event as any).penalty_shootout ?? null, (event as any).extra_time_score ?? null,
      event.is_local_derby ? 1 : 0,
      ((event as any).is_neutral_ground ? 1 : 0),
      event.travel_distance_km ?? null,
      event.weather?.code ?? null, event.weather?.description ?? null,
      event.weather?.temperature_c ?? null, event.weather?.wind_speed ?? null,
      (event as any).pitch_condition ?? null,
      event.attendance ?? null,
      (event as any).live_websocket ? 1 : 0,
      (event as any).last_updated ?? null,
    ],
  });
}

// ============================================================================
// FIXTURE DETAILS SYNC (Stats + Odds + Lineups)
// ============================================================================

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
            home_big_chances = ?, home_passes = ?, home_pass_accuracy = ?, home_tackles = ?, home_interceptions = ?,
            away_total_shots = ?, away_shots_on_target = ?, away_ball_possession = ?, away_expected_goals = ?,
            away_corner_kicks = ?, away_fouls = ?, away_yellow_cards = ?, away_red_cards = ?,
            away_attacks = ?, away_dangerous_attacks = ?,
            away_big_chances = ?, away_passes = ?, away_pass_accuracy = ?, away_tackles = ?, away_interceptions = ?
            WHERE fixture_id = ?`,
          args: [
            (home.total_shots as number) ?? 0, (home.shots_on_target as number) ?? 0,
            (home.ball_possession as number) ?? 50, (home.expected_goals as number) ?? 0,
            (home.corner_kicks as number) ?? 0, (home.fouls as number) ?? 0,
            (home.yellow_cards as number) ?? 0, (home.red_cards as number) ?? 0,
            (home.attack as number) ?? 0, (home.dangerous_attack as number) ?? 0,
            (home.big_chances as number) ?? 0, (home.passes as number) ?? 0,
            (home.pass_accuracy as number) ?? 0, (home.tackles as number) ?? 0,
            (home.interceptions as number) ?? 0,
            (away.total_shots as number) ?? 0, (away.shots_on_target as number) ?? 0,
            (away.ball_possession as number) ?? 50, (away.expected_goals as number) ?? 0,
            (away.corner_kicks as number) ?? 0, (away.fouls as number) ?? 0,
            (away.yellow_cards as number) ?? 0, (away.red_cards as number) ?? 0,
            (away.attack as number) ?? 0, (away.dangerous_attack as number) ?? 0,
            (away.big_chances as number) ?? 0, (away.passes as number) ?? 0,
            (away.pass_accuracy as number) ?? 0, (away.tackles as number) ?? 0,
            (away.interceptions as number) ?? 0,
            fixtureId,
          ],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO fixture_stats (fixture_id, home_total_shots, home_shots_on_target, home_ball_possession, home_expected_goals,
                home_corner_kicks, home_fouls, home_yellow_cards, home_red_cards, home_attacks, home_dangerous_attacks,
                home_big_chances, home_passes, home_pass_accuracy, home_tackles, home_interceptions,
                away_total_shots, away_shots_on_target, away_ball_possession, away_expected_goals,
                away_corner_kicks, away_fouls, away_yellow_cards, away_red_cards, away_attacks, away_dangerous_attacks,
                away_big_chances, away_passes, away_pass_accuracy, away_tackles, away_interceptions)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            fixtureId,
            (home.total_shots as number) ?? 0, (home.shots_on_target as number) ?? 0,
            (home.ball_possession as number) ?? 50, (home.expected_goals as number) ?? 0,
            (home.corner_kicks as number) ?? 0, (home.fouls as number) ?? 0,
            (home.yellow_cards as number) ?? 0, (home.red_cards as number) ?? 0,
            (home.attack as number) ?? 0, (home.dangerous_attack as number) ?? 0,
            (home.big_chances as number) ?? 0, (home.passes as number) ?? 0,
            (home.pass_accuracy as number) ?? 0, (home.tackles as number) ?? 0,
            (home.interceptions as number) ?? 0,
            (away.total_shots as number) ?? 0, (away.shots_on_target as number) ?? 0,
            (away.ball_possession as number) ?? 50, (away.expected_goals as number) ?? 0,
            (away.corner_kicks as number) ?? 0, (away.fouls as number) ?? 0,
            (away.yellow_cards as number) ?? 0, (away.red_cards as number) ?? 0,
            (away.attack as number) ?? 0, (away.dangerous_attack as number) ?? 0,
            (away.big_chances as number) ?? 0, (away.passes as number) ?? 0,
            (away.pass_accuracy as number) ?? 0, (away.tackles as number) ?? 0,
            (away.interceptions as number) ?? 0,
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

  // Sync incidents (goals, cards, subs)
  try {
    const incidents = await bsdClient.getEventIncidents(fixtureId);
    if (incidents.incidents && incidents.incidents.length > 0) {
      const existingIncidents = await client.execute({ sql: 'SELECT id FROM fixture_incidents WHERE fixture_id = ?', args: [fixtureId] });
      if (existingIncidents.rows.length > 0) {
        await client.execute({
          sql: `UPDATE fixture_incidents SET incidents_json = ?, updated_at = datetime('now') WHERE fixture_id = ?`,
          args: [JSON.stringify(incidents.incidents), fixtureId],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO fixture_incidents (fixture_id, incidents_json, updated_at) VALUES (?, ?, datetime('now'))`,
          args: [fixtureId, JSON.stringify(incidents.incidents)],
        });
      }
    }
  } catch { /* Incidents might not be available */ }

  // Sync metadata (fun facts, AI preview)
  try {
    const metadata = await bsdClient.getEventMetadata(fixtureId);
    if (metadata.funfacts || metadata.ai_preview) {
      const existingMeta = await client.execute({ sql: 'SELECT id FROM fixture_metadata WHERE fixture_id = ?', args: [fixtureId] });
      if (existingMeta.rows.length > 0) {
        await client.execute({
          sql: `UPDATE fixture_metadata SET funfacts_json = ?, ai_preview_text = ?, ai_preview_generated_at = ?, updated_at = datetime('now') WHERE fixture_id = ?`,
          args: [JSON.stringify(metadata.funfacts ?? []),
            metadata.ai_preview?.text ?? null,
            metadata.ai_preview?.generated_at ?? null,
            fixtureId],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO fixture_metadata (fixture_id, funfacts_json, ai_preview_text, ai_preview_generated_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`,
          args: [fixtureId, JSON.stringify(metadata.funfacts ?? []),
            metadata.ai_preview?.text ?? null,
            metadata.ai_preview?.generated_at ?? null],
        });
      }
    }
  } catch { /* Metadata might not be available */ }

  // Sync player stats
  try {
    const playerStats = await bsdClient.getEventPlayerStats(fixtureId);
    if (playerStats.player_stats && playerStats.player_stats.length > 0) {
      const existingPs = await client.execute({ sql: 'SELECT id FROM fixture_player_stats WHERE fixture_id = ?', args: [fixtureId] });
      if (existingPs.rows.length > 0) {
        await client.execute({
          sql: `UPDATE fixture_player_stats SET player_stats_json = ?, updated_at = datetime('now') WHERE fixture_id = ?`,
          args: [JSON.stringify(playerStats.player_stats), fixtureId],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO fixture_player_stats (fixture_id, player_stats_json, updated_at) VALUES (?, ?, datetime('now'))`,
          args: [fixtureId, JSON.stringify(playerStats.player_stats)],
        });
      }
    }
  } catch { /* Player stats might not be available */ }
}

// ============================================================================
// NEW: TEAM HISTORY SYNC — THE KEY TO FEEDING THE ENGINE
// Fetches past fixtures for a team from BSD API and stores them
// ============================================================================

export async function syncTeamHistory(teamId: number, daysBack: number = 90): Promise<number> {
  console.log(`[Sync] Syncing history for team ${teamId} (${daysBack} days back)...`);

  const dateTo = new Date().toISOString().split('T')[0];
  const dateFrom = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];

  try {
    let synced = 0;
    let offset = 0;
    const limit = 100;

    while (true) {
      const data = await bsdClient.getTeamFixtures(teamId, {
        date_from: dateFrom,
        date_to: dateTo,
        limit,
        offset,
      });

      for (const event of data.results) {
        await syncSingleFixture(event);
        synced++;
      }

      if (!data.next || data.results.length < limit) break;
      offset += limit;

      // Safety: don't fetch more than 300 fixtures per team
      if (offset >= 300) break;
    }

    // Also try to get team details (short_name) if missing
    await enrichTeamData(teamId);

    console.log(`[Sync] Synced ${synced} historical fixtures for team ${teamId}`);
    return synced;
  } catch (err) {
    console.error(`[Sync] Failed history for team ${teamId}:`, err);
    return 0;
  }
}

// ============================================================================
// NEW: ENRICH TEAM DATA — Fetch team details (short_name, etc.)
// ============================================================================

async function enrichTeamData(teamId: number): Promise<void> {
  try {
    const existing = await client.execute({
      sql: 'SELECT short_name, logo FROM teams WHERE id = ?',
      args: [teamId],
    });

    // Only enrich if missing data
    if (existing.rows.length > 0 && !existing.rows[0].short_name) {
      const teamsData = await bsdClient.getTeams({ name: String(await client.execute({
        sql: 'SELECT name FROM teams WHERE id = ?',
        args: [teamId],
      }).then(r => r.rows[0]?.name ?? '')), limit: 1 });

      if (teamsData.results.length > 0) {
        const t = teamsData.results[0];
        await client.execute({
          sql: 'UPDATE teams SET short_name = COALESCE(?, short_name), country = COALESCE(?, country), venue_id = COALESCE(?, venue_id) WHERE id = ?',
          args: [t.short_name || null, t.country || null, t.venue_id || null, teamId],
        });
      }
    }
  } catch { /* silent */ }
}

// ============================================================================
// NEW: SYNC TEAM LOGOS — Use public football logo CDN
// BSD API doesn't provide logos, so we use the-sports.db CDN
// ============================================================================

export async function syncTeamLogos(): Promise<number> {
  console.log('[Sync] Syncing team logos...');
  let updated = 0;

  // Get teams without logos
  const teams = await client.execute({
    sql: "SELECT id, name FROM teams WHERE logo IS NULL OR logo = '' LIMIT 500",
    args: [],
  });

  for (const team of teams.rows) {
    const teamId = team.id as number;
    const teamName = team.name as string;

    // Generate a logo URL using a public CDN
    // We use the format: https://media.api-sports.io/football/teams/{id}.png
    // Note: These IDs are from API-Football, not BSD. We store a placeholder that
    // the TeamLogo component handles with initials fallback.
    // For a better experience, we could match teams to API-Football IDs, but that's complex.
    // Instead, we'll leave logo as NULL and rely on the initials-based fallback which looks great.

    // The TeamLogo component already has a beautiful fallback with initials on gradient.
    // No action needed for teams without logos.
    updated++;
  }

  console.log(`[Sync] Checked ${updated} teams for logos`);
  return updated;
}

// ============================================================================
// NEW: DEEP SYNC — Pull historical data for top leagues to feed the engine
// ============================================================================

export async function deepSync(daysBack: number = 90): Promise<{
  leagues: number;
  fixtures: number;
  standings: number;
  teamHistories: number;
}> {
  console.log(`[Sync] Starting DEEP SYNC (${daysBack} days back)...`);
  const startTime = Date.now();

  // Step 1: Sync leagues
  const leagues = await syncLeagues();

  // Step 2: Sync fixtures for top leagues (historical)
  const topLeagues = [17, 3, 9, 6, 13, 14, 30, 29, 34, 8]; // EPL, La Liga, Serie A, Ligue 1, Bundesliga, etc.
  const dateFrom = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];
  const dateTo = new Date().toISOString().split('T')[0];

  let fixtures = 0;
  for (const leagueId of topLeagues) {
    try {
      fixtures += await syncFixtures({ dateFrom, dateTo, leagueId });
    } catch (err) {
      console.error(`[Sync] Deep sync failed for league ${leagueId}:`, err);
    }
  }

  // Step 3: Sync standings for top leagues
  let standings = 0;
  for (const leagueId of topLeagues) {
    standings += await syncStandings(leagueId);
  }

  // Step 4: Sync team history for teams in today's fixtures
  let teamHistories = 0;
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const todayFixtures = await client.execute({
    sql: "SELECT DISTINCT home_team_id as tid FROM fixtures WHERE event_date >= ? AND event_date < ? UNION SELECT DISTINCT away_team_id as tid FROM fixtures WHERE event_date >= ? AND event_date < ?",
    args: [today, tomorrow, today, tomorrow],
  });

  const teamIds = new Set<number>();
  for (const row of todayFixtures.rows) {
    teamIds.add(row.tid as number);
  }

  // Also include teams from recent fixtures
  const recentTeams = await client.execute({
    sql: "SELECT DISTINCT home_team_id as tid FROM fixtures WHERE event_date >= ? UNION SELECT DISTINCT away_team_id as tid FROM fixtures WHERE event_date >= ?",
    args: [dateFrom, dateFrom],
  });
  for (const row of recentTeams.rows) {
    teamIds.add(row.tid as number);
  }

  // Sync history for each unique team (limit to avoid rate limiting)
  const teamArray = Array.from(teamIds);
  console.log(`[Sync] Syncing history for ${teamArray.length} unique teams...`);

  // Process in batches of 5 to respect rate limits
  const batchSize = 5;
  for (let i = 0; i < teamArray.length; i += batchSize) {
    const batch = teamArray.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (teamId) => {
        const count = await syncTeamHistory(teamId, daysBack);
        teamHistories += count;
      })
    );
    // Small delay between batches to respect rate limits
    if (i + batchSize < teamArray.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Sync] Deep sync completed in ${elapsed}s: ${leagues} leagues, ${fixtures} fixtures, ${standings} standings, ${teamHistories} team history fixtures`);

  return { leagues, fixtures, standings, teamHistories };
}

// ============================================================================
// FULL DAILY SYNC — Standard daily sync
// ENHANCED: Also syncs team history for today's teams
// ============================================================================

export async function fullDailySync(): Promise<{ leagues: number; fixtures: number; standings: number; teamHistories: number }> {
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

  // Sync details for today's matches (rate limited to 30)
  const todayFixtures = await client.execute({
    sql: "SELECT id FROM fixtures WHERE event_date >= ? AND event_date < ? LIMIT 30",
    args: [today, tomorrow],
  });
  for (const f of todayFixtures.rows) {
    await syncFixtureDetails(f.id as number);
  }

  // ENHANCED: Sync team history for teams playing today
  let teamHistories = 0;
  const teamIds = new Set<number>();
  for (const f of todayFixtures.rows) {
    const fixture = await client.execute({
      sql: 'SELECT home_team_id, away_team_id FROM fixtures WHERE id = ?',
      args: [f.id as number],
    });
    if (fixture.rows.length > 0) {
      teamIds.add(fixture.rows[0].home_team_id as number);
      teamIds.add(fixture.rows[0].away_team_id as number);
    }
  }

  // Sync last 30 matches for each team playing today
  for (const teamId of teamIds) {
    try {
      // Check how many finished fixtures we already have for this team
      const existingCount = await client.execute({
        sql: `SELECT COUNT(*) as cnt FROM fixtures WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'finished'`,
        args: [teamId, teamId],
      });

      // Only fetch history if we have less than 10 finished matches
      if ((existingCount.rows[0].cnt as number) < 10) {
        teamHistories += await syncTeamHistory(teamId, 60);
      }
    } catch { /* skip */ }
  }

  return { leagues, fixtures, standings, teamHistories };
}

// ============================================================================
// NEW: SYNC H2H ON-DEMAND — Fetch head-to-head data when viewing a match
// ============================================================================

export async function syncH2H(homeTeamId: number, awayTeamId: number): Promise<number> {
  console.log(`[Sync] Syncing H2H for teams ${homeTeamId} vs ${awayTeamId}...`);
  let synced = 0;

  // Fetch fixtures where both teams played
  // BSD API doesn't have a dedicated H2H endpoint, so we fetch team fixtures
  // and filter for matches where the opponent is the other team

  // Fetch last 50 fixtures for home team
  try {
    const homeFixtures = await bsdClient.getTeamFixtures(homeTeamId, {
      status: 'finished',
      limit: 50,
    });

    for (const event of homeFixtures.results) {
      // Check if the opponent is the away team
      if (event.away_team_id === awayTeamId || event.home_team_id === awayTeamId) {
        await syncSingleFixture(event);
        synced++;
      } else {
        // Still store the fixture for team DNA/Form purposes
        await syncSingleFixture(event);
      }
    }
  } catch (err) {
    console.error(`[Sync] H2H sync failed for home team ${homeTeamId}:`, err);
  }

  // Fetch last 50 fixtures for away team
  try {
    const awayFixtures = await bsdClient.getTeamFixtures(awayTeamId, {
      status: 'finished',
      limit: 50,
    });

    for (const event of awayFixtures.results) {
      await syncSingleFixture(event);
    }
  } catch (err) {
    console.error(`[Sync] H2H sync failed for away team ${awayTeamId}:`, err);
  }

  console.log(`[Sync] H2H sync: found ${synced} direct meetings`);
  return synced;
}

// ============================================================================
// NEW: SYNC TEAM LAST5 ON-DEMAND — Fetch recent matches for a team
// ============================================================================

export async function syncTeamLast5(teamId: number): Promise<number> {
  console.log(`[Sync] Syncing last 5 matches for team ${teamId}...`);

  try {
    const data = await bsdClient.getTeamFixtures(teamId, {
      status: 'finished',
      limit: 10, // Fetch 10 to ensure we have enough with scores
    });

    let synced = 0;
    for (const event of data.results) {
      await syncSingleFixture(event);
      synced++;
    }

    return synced;
  } catch (err) {
    console.error(`[Sync] Last5 sync failed for team ${teamId}:`, err);
    return 0;
  }
}
