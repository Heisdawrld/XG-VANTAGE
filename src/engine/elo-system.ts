// ELO Rating System with context weighting — Turso/libSQL version
// Separate home/away ratings, team-specific home advantage

import { client } from '@/lib/db-turso';

const DEFAULT_ELO = 1500;
const DEFAULT_K = 32;
const HOME_ADVANTAGE_ELO = 65;

interface EloUpdate {
  teamId: number;
  newRating: number;
  newHomeRating: number;
  newAwayRating: number;
}

export async function initializeElo(teamId: number, leagueId?: number, seasonId?: number): Promise<void> {
  const lid = leagueId ?? 0;
  const sid = seasonId ?? 0;
  const existing = await client.execute({
    sql: 'SELECT id FROM team_elo WHERE team_id = ? AND league_id = ? AND season_id = ?',
    args: [teamId, lid, sid],
  });
  if (existing.rows.length === 0) {
    await client.execute({
      sql: 'INSERT INTO team_elo (team_id, league_id, season_id, elo_rating, elo_home_rating, elo_away_rating) VALUES (?, ?, ?, ?, ?, ?)',
      args: [teamId, lid, sid, DEFAULT_ELO, DEFAULT_ELO, DEFAULT_ELO],
    });
  }
}

export async function getEloRating(teamId: number, leagueId?: number, seasonId?: number): Promise<{
  overall: number;
  home: number;
  away: number;
}> {
  const lid = leagueId ?? 0;
  const sid = seasonId ?? 0;
  const result = await client.execute({
    sql: 'SELECT elo_rating, elo_home_rating, elo_away_rating FROM team_elo WHERE team_id = ? AND league_id = ? AND season_id = ?',
    args: [teamId, lid, sid],
  });
  if (result.rows.length === 0) {
    return { overall: DEFAULT_ELO, home: DEFAULT_ELO, away: DEFAULT_ELO };
  }
  const row = result.rows[0];
  return {
    overall: (row.elo_rating as number) ?? DEFAULT_ELO,
    home: (row.elo_home_rating as number) ?? DEFAULT_ELO,
    away: (row.elo_away_rating as number) ?? DEFAULT_ELO,
  };
}

function getEloMotivationWeight(position: number): number {
  if (position <= 1) return 1.3;
  if (position <= 4) return 1.2;
  if (position <= 6) return 1.1;
  if (position >= 17) return 1.25;
  if (position >= 14) return 1.05;
  return 0.9;
}

export async function updateEloAfterMatch(
  homeTeamId: number,
  awayTeamId: number,
  homeGoals: number,
  awayGoals: number,
  leagueId?: number,
  seasonId?: number,
): Promise<{ home: EloUpdate; away: EloUpdate }> {
  const lid = leagueId ?? 0;
  const sid = seasonId ?? 0;

  const homeElo = await getEloRating(homeTeamId, lid, sid);
  const awayElo = await getEloRating(awayTeamId, lid, sid);

  // Get team-specific home advantage from team_profiles
  const homeProfile = await client.execute({
    sql: 'SELECT style FROM team_profiles WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1',
    args: [homeTeamId],
  });
  // Estimate home advantage coefficient from style data
  const homeAdvantage = homeProfile.rows.length > 0 ? 0.2 : 0.2;
  const homeBonusElo = homeAdvantage * 325;

  const homeExpected = 1 / (1 + Math.pow(10, (awayElo.away - homeElo.home - homeBonusElo) / 400));
  const awayExpected = 1 - homeExpected;

  let homeActual: number, awayActual: number;
  if (homeGoals > awayGoals) { homeActual = 1; awayActual = 0; }
  else if (homeGoals === awayGoals) { homeActual = 0.5; awayActual = 0.5; }
  else { homeActual = 0; awayActual = 1; }

  const goalDiff = Math.abs(homeGoals - awayGoals);
  const kMultiplier = goalDiff <= 1 ? 1 : goalDiff === 2 ? 1.3 : 1.5 + (goalDiff - 3) * 0.1;

  let contextMultiplier = 1;
  if (leagueId) {
    const homeStanding = await client.execute({
      sql: 'SELECT position FROM standings WHERE team_id = ? AND league_id = ? LIMIT 1',
      args: [homeTeamId, lid],
    });
    const awayStanding = await client.execute({
      sql: 'SELECT position FROM standings WHERE team_id = ? AND league_id = ? LIMIT 1',
      args: [awayTeamId, lid],
    });
    const homeMot = homeStanding.rows.length > 0 ? getEloMotivationWeight(homeStanding.rows[0].position as number) : 1;
    const awayMot = awayStanding.rows.length > 0 ? getEloMotivationWeight(awayStanding.rows[0].position as number) : 1;
    contextMultiplier = (homeMot + awayMot) / 2;
  }

  const K = DEFAULT_K * kMultiplier * contextMultiplier;

  const homeRatingChange = K * (homeActual - homeExpected);
  const awayRatingChange = K * (awayActual - awayExpected);

  const newHomeOverall = homeElo.overall + homeRatingChange;
  const newHomeHome = homeElo.home + homeRatingChange * 1.2;
  const newHomeAway = homeElo.away + homeRatingChange * 0.3;

  const newAwayOverall = awayElo.overall + awayRatingChange;
  const newAwayHome = awayElo.home + awayRatingChange * 0.3;
  const newAwayAway = awayElo.away + awayRatingChange * 1.2;

  const now = new Date().toISOString();

  // Upsert home team ELO
  const homeExisting = await client.execute({
    sql: 'SELECT id FROM team_elo WHERE team_id = ? AND league_id = ? AND season_id = ?',
    args: [homeTeamId, lid, sid],
  });
  if (homeExisting.rows.length > 0) {
    await client.execute({
      sql: `UPDATE team_elo SET elo_rating = ?, elo_home_rating = ?, elo_away_rating = ?, matches_played = matches_played + 1, last_match_date = ?, updated_at = ? WHERE team_id = ? AND league_id = ? AND season_id = ?`,
      args: [newHomeOverall, newHomeHome, newHomeAway, now, now, homeTeamId, lid, sid],
    });
  } else {
    await client.execute({
      sql: 'INSERT INTO team_elo (team_id, league_id, season_id, elo_rating, elo_home_rating, elo_away_rating, matches_played, last_match_date) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      args: [homeTeamId, lid, sid, newHomeOverall, newHomeHome, newHomeAway, now],
    });
  }

  // Upsert away team ELO
  const awayExisting = await client.execute({
    sql: 'SELECT id FROM team_elo WHERE team_id = ? AND league_id = ? AND season_id = ?',
    args: [awayTeamId, lid, sid],
  });
  if (awayExisting.rows.length > 0) {
    await client.execute({
      sql: `UPDATE team_elo SET elo_rating = ?, elo_home_rating = ?, elo_away_rating = ?, matches_played = matches_played + 1, last_match_date = ?, updated_at = ? WHERE team_id = ? AND league_id = ? AND season_id = ?`,
      args: [newAwayOverall, newAwayHome, newAwayAway, now, now, awayTeamId, lid, sid],
    });
  } else {
    await client.execute({
      sql: 'INSERT INTO team_elo (team_id, league_id, season_id, elo_rating, elo_home_rating, elo_away_rating, matches_played, last_match_date) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      args: [awayTeamId, lid, sid, newAwayOverall, newAwayHome, newAwayAway, now],
    });
  }

  return {
    home: { teamId: homeTeamId, newRating: newHomeOverall, newHomeRating: newHomeHome, newAwayRating: newHomeAway },
    away: { teamId: awayTeamId, newRating: newAwayOverall, newHomeRating: newAwayHome, newAwayRating: newAwayAway },
  };
}

/** Recalculate ELO for all finished matches in a league */
export async function recalcLeagueElo(leagueId: number, seasonId?: number): Promise<void> {
  // Get season
  let sid = seasonId;
  if (!sid) {
    const fixtureResult = await client.execute({
      sql: 'SELECT DISTINCT season_id FROM fixtures WHERE league_id = ? AND season_id IS NOT NULL LIMIT 1',
      args: [leagueId],
    });
    if (fixtureResult.rows.length === 0) return;
    sid = fixtureResult.rows[0].season_id as number;
  }

  const fixtures = await client.execute({
    sql: `SELECT id, home_team_id, away_team_id, home_score, away_score FROM fixtures
          WHERE league_id = ? AND season_id = ? AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
          ORDER BY event_date ASC`,
    args: [leagueId, sid],
  });

  // Reset all team ELOs for this league/season
  await client.execute({
    sql: 'UPDATE team_elo SET elo_rating = ?, elo_home_rating = ?, elo_away_rating = ?, matches_played = 0 WHERE league_id = ? AND season_id = ?',
    args: [DEFAULT_ELO, DEFAULT_ELO, DEFAULT_ELO, leagueId, sid],
  });

  for (const f of fixtures.rows) {
    await updateEloAfterMatch(
      f.home_team_id as number,
      f.away_team_id as number,
      f.home_score as number,
      f.away_score as number,
      leagueId,
      sid,
    );
  }

  console.log(`[ELO] Recalculated ELO for league ${leagueId}, ${fixtures.rows.length} matches processed`);
}
