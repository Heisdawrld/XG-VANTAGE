// Team DNA Engine — Turso/libSQL version
// Computes team profiles from historical fixture data

import { client } from '@/lib/db-turso';

export async function computeTeamDNA(teamId: number): Promise<void> {
  console.log(`[DNA] Computing DNA for team ${teamId}...`);

  // Get recent fixtures for this team (finished only)
  const homeFixtures = await client.execute({
    sql: `SELECT f.home_score, f.away_score, f.event_date, s.home_expected_goals, s.away_expected_goals,
                 s.home_ball_possession, s.away_ball_possession, s.home_total_shots, s.away_total_shots,
                 s.home_shots_on_target, s.away_shots_on_target, s.home_corner_kicks, s.away_corner_kicks,
                 s.home_fouls, s.away_fouls, s.home_attacks, s.away_attacks, s.home_dangerous_attacks, s.away_dangerous_attacks
          FROM fixtures f
          LEFT JOIN fixture_stats s ON s.fixture_id = f.id
          WHERE f.home_team_id = ? AND f.status = 'finished' AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
          ORDER BY f.event_date DESC LIMIT 30`,
    args: [teamId],
  });

  const awayFixtures = await client.execute({
    sql: `SELECT f.home_score, f.away_score, f.event_date, s.home_expected_goals, s.away_expected_goals,
                 s.home_ball_possession, s.away_ball_possession, s.home_total_shots, s.away_total_shots,
                 s.home_shots_on_target, s.away_shots_on_target, s.home_corner_kicks, s.away_corner_kicks,
                 s.home_fouls, s.away_fouls, s.home_attacks, s.away_attacks, s.home_dangerous_attacks, s.away_dangerous_attacks
          FROM fixtures f
          LEFT JOIN fixture_stats s ON s.fixture_id = f.id
          WHERE f.away_team_id = ? AND f.status = 'finished' AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
          ORDER BY f.event_date DESC LIMIT 30`,
    args: [teamId],
  });

  if (homeFixtures.rows.length < 3 && awayFixtures.rows.length < 3) {
    console.log(`[DNA] Not enough data for team ${teamId}`);
    return;
  }

  // Compute home/away identity
  const homeDNA = computeSideIdentity(homeFixtures.rows, 'home');
  const awayDNA = computeSideIdentity(awayFixtures.rows, 'away');

  // Compute overall stats
  const allFixtures = [...homeFixtures.rows, ...awayFixtures.rows];
  const overallGoalsScored = homeDNA.avgGoalsScored * homeFixtures.rows.length + awayDNA.avgGoalsScored * awayFixtures.rows.length;
  const overallGoalsConceded = homeDNA.avgGoalsConceded * homeFixtures.rows.length + awayDNA.avgGoalsConceded * awayFixtures.rows.length;
  const total = Math.max(1, homeFixtures.rows.length + awayFixtures.rows.length);
  const avgGoalsScored = overallGoalsScored / total;
  const avgGoalsConceded = overallGoalsConceded / total;

  const avgXgFor = (homeDNA.avgXgScored * homeFixtures.rows.length + awayDNA.avgXgScored * awayFixtures.rows.length) / total;
  const avgXgAgainst = (homeDNA.avgXgConceded * homeFixtures.rows.length + awayDNA.avgXgConceded * awayFixtures.rows.length) / total;

  const overallPossession = (homeDNA.avgPossession * homeFixtures.rows.length + awayDNA.avgPossession * awayFixtures.rows.length) / total;

  const overallCleanSheet = (homeDNA.cleanSheetPct * homeFixtures.rows.length + awayDNA.cleanSheetPct * awayFixtures.rows.length) / total;
  const overallBtts = (homeDNA.bttsPct * homeFixtures.rows.length + awayDNA.bttsPct * awayFixtures.rows.length) / total;
  const overallOver25 = (homeDNA.over25Pct * homeFixtures.rows.length + awayDNA.over25Pct * awayFixtures.rows.length) / total;

  // Compute style
  const style = determineStyle(overallPossession, avgGoalsScored);

  // Compute form strings
  const homeForm = computeFormString(homeFixtures.rows, 'home');
  const awayForm = computeFormString(awayFixtures.rows, 'away');

  // Upsert team profile
  const existing = await client.execute({
    sql: 'SELECT id FROM team_profiles WHERE team_id = ? LIMIT 1',
    args: [teamId],
  });

  if (existing.rows.length > 0) {
    await client.execute({
      sql: `UPDATE team_profiles SET
        avg_goals_scored = ?, avg_goals_conceded = ?, avg_xg_for = ?, avg_xg_against = ?,
        possession = ?, clean_sheet_pct = ?, btts_pct = ?, over_25_pct = ?,
        home_avg_scored = ?, home_avg_conceded = ?, away_avg_scored = ?, away_avg_conceded = ?,
        style = ?, form = ?, home_form = ?, away_form = ?, updated_at = datetime('now')
        WHERE team_id = ?`,
      args: [
        avgGoalsScored, avgGoalsConceded, avgXgFor, avgXgAgainst,
        overallPossession, overallCleanSheet, overallBtts, overallOver25,
        homeDNA.avgGoalsScored, homeDNA.avgGoalsConceded, awayDNA.avgGoalsScored, awayDNA.avgGoalsConceded,
        style, homeForm, awayForm, teamId,
      ],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO team_profiles (
        team_id, avg_goals_scored, avg_goals_conceded, avg_xg_for, avg_xg_against,
        possession, clean_sheet_pct, btts_pct, over_25_pct,
        home_avg_scored, home_avg_conceded, away_avg_scored, away_avg_conceded,
        style, form, home_form, away_form
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        teamId, avgGoalsScored, avgGoalsConceded, avgXgFor, avgXgAgainst,
        overallPossession, overallCleanSheet, overallBtts, overallOver25,
        homeDNA.avgGoalsScored, homeDNA.avgGoalsConceded, awayDNA.avgGoalsScored, awayDNA.avgGoalsConceded,
        style, homeForm, awayForm,
      ],
    });
  }

  console.log(`[DNA] Updated DNA for team ${teamId}: Home(${homeDNA.avgGoalsScored.toFixed(2)}/${homeDNA.avgGoalsConceded.toFixed(2)}) Away(${awayDNA.avgGoalsScored.toFixed(2)}/${awayDNA.avgGoalsConceded.toFixed(2)})`);
}

interface SideIdentity {
  avgGoalsScored: number;
  avgGoalsConceded: number;
  avgXgScored: number;
  avgXgConceded: number;
  avgPossession: number;
  avgShots: number;
  avgShotsOnTarget: number;
  winPct: number;
  drawPct: number;
  lossPct: number;
  cleanSheetPct: number;
  bttsPct: number;
  over25Pct: number;
}

function computeSideIdentity(fixtures: Array<Record<string, unknown>>, side: 'home' | 'away'): SideIdentity {
  if (fixtures.length === 0) {
    return { avgGoalsScored: 1.3, avgGoalsConceded: 1.1, avgXgScored: 1.2, avgXgConceded: 1.0, avgPossession: 50, avgShots: 12, avgShotsOnTarget: 4, winPct: 0.4, drawPct: 0.28, lossPct: 0.32, cleanSheetPct: 0.25, bttsPct: 0.5, over25Pct: 0.5 };
  }

  const isHome = side === 'home';
  let totalGoalsScored = 0, totalGoalsConceded = 0;
  let totalXgScored = 0, totalXgConceded = 0;
  let totalPossession = 0, totalShots = 0, totalShotsOnTarget = 0;
  let wins = 0, draws = 0, losses = 0, cleanSheets = 0, btts = 0, over25 = 0;
  let xgCount = 0;

  for (const f of fixtures) {
    const scored = isHome ? (f.home_score as number) : (f.away_score as number);
    const conceded = isHome ? (f.away_score as number) : (f.home_score as number);
    totalGoalsScored += scored;
    totalGoalsConceded += conceded;

    if (scored > conceded) wins++;
    else if (scored === conceded) draws++;
    else losses++;

    if (conceded === 0) cleanSheets++;
    if (scored > 0 && conceded > 0) btts++;
    if (scored + conceded > 2.5) over25++;

    const xgKey = isHome ? 'home_expected_goals' : 'away_expected_goals';
    const xgOppKey = isHome ? 'away_expected_goals' : 'home_expected_goals';
    const possKey = isHome ? 'home_ball_possession' : 'away_ball_possession';
    const shotsKey = isHome ? 'home_total_shots' : 'away_total_shots';
    const sotKey = isHome ? 'home_shots_on_target' : 'away_shots_on_target';

    if (f[xgKey] != null) {
      totalXgScored += (f[xgKey] as number);
      totalXgConceded += (f[xgOppKey] as number);
      xgCount++;
    }
    if (f[possKey] != null) totalPossession += (f[possKey] as number);
    if (f[shotsKey] != null) totalShots += (f[shotsKey] as number);
    if (f[sotKey] != null) totalShotsOnTarget += (f[sotKey] as number);
  }

  const n = fixtures.length;
  return {
    avgGoalsScored: totalGoalsScored / n,
    avgGoalsConceded: totalGoalsConceded / n,
    avgXgScored: xgCount > 0 ? totalXgScored / xgCount : 1.2,
    avgXgConceded: xgCount > 0 ? totalXgConceded / xgCount : 1.0,
    avgPossession: n > 0 ? totalPossession / n : 50,
    avgShots: n > 0 ? totalShots / n : 12,
    avgShotsOnTarget: n > 0 ? totalShotsOnTarget / n : 4,
    winPct: wins / n,
    drawPct: draws / n,
    lossPct: losses / n,
    cleanSheetPct: cleanSheets / n,
    bttsPct: btts / n,
    over25Pct: over25 / n,
  };
}

function determineStyle(possession: number, avgGoals: number): string {
  if (possession > 60 && avgGoals > 1.5) return 'attacking';
  if (possession > 55) return 'possession';
  if (avgGoals < 1.0) return 'defensive';
  if (avgGoals > 1.8) return 'high_press';
  return 'balanced';
}

function computeFormString(fixtures: Array<Record<string, unknown>>, side: 'home' | 'away'): string {
  const isHome = side === 'home';
  let form = '';
  for (const f of fixtures.slice(0, 5)) {
    const scored = isHome ? (f.home_score as number) : (f.away_score as number);
    const conceded = isHome ? (f.away_score as number) : (f.home_score as number);
    if (scored > conceded) form += 'W';
    else if (scored === conceded) form += 'D';
    else form += 'L';
  }
  return form || 'DDDDD';
}

/** Compute DNA for all teams that have enough data */
export async function computeAllTeamDNA(): Promise<number> {
  const teamsResult = await client.execute('SELECT id FROM teams');
  let computed = 0;
  for (const team of teamsResult.rows) {
    const teamId = team.id as number;
    const fixtureCount = await client.execute({
      sql: `SELECT COUNT(*) as cnt FROM fixtures WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'finished'`,
      args: [teamId, teamId],
    });
    if ((fixtureCount.rows[0].cnt as number) >= 5) {
      await computeTeamDNA(teamId);
      computed++;
    }
  }
  console.log(`[DNA] Computed DNA for ${computed} teams`);
  return computed;
}
