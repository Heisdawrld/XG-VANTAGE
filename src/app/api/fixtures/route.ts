import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get('leagueId');
  const status = searchParams.get('status');
  const date = searchParams.get('date');

  try {
    // Build date range
    let dateFrom: string;
    let dateTo: string;

    if (date) {
      const d = new Date(date + 'T00:00:00Z');
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      dateFrom = d.toISOString().split('T')[0];
      dateTo = next.toISOString().split('T')[0];
    } else {
      // Default: today and tomorrow (to catch timezone differences)
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 2); // 2 day window to catch all timezones
      dateFrom = today.toISOString().split('T')[0];
      dateTo = tomorrow.toISOString().split('T')[0];
    }

    // Build WHERE conditions
    const conditions: string[] = ['f.event_date >= ?', 'f.event_date < ?'];
    const args: (string | number)[] = [dateFrom, dateTo];

    if (leagueId) {
      conditions.push('f.league_id = ?');
      args.push(parseInt(leagueId));
    }
    if (status) {
      conditions.push('f.status = ?');
      args.push(status);
    }

    // Single query with LEFT JOINs
    const result = await client.execute({
      sql: `SELECT f.*, ht.name as home_team_name, at.name as away_team_name, l.name as league_name,
             p.pick_type, p.pick_label, p.confidence as pred_confidence, p.tier, p.verdict,
             p.home_win_prob, p.draw_prob, p.away_win_prob, p.over_25_prob, p.under_25_prob,
             p.btts_yes_prob, p.btts_no_prob, p.home_xg, p.away_xg, p.phantom_score, p.edge,
             o.home_win as odds_home, o.draw as odds_draw, o.away_win as odds_away,
             o.over_25_goals as odds_over25, o.under_25_goals as odds_under25, o.btts_yes as odds_btts_yes, o.btts_no as odds_btts_no,
             fl.home_formation, fl.away_formation
            FROM fixtures f
            LEFT JOIN teams ht ON f.home_team_id = ht.id
            LEFT JOIN teams at ON f.away_team_id = at.id
            LEFT JOIN leagues l ON f.league_id = l.id
            LEFT JOIN predictions p ON f.id = p.fixture_id
            LEFT JOIN fixture_odds o ON f.id = o.fixture_id
            LEFT JOIN fixture_lineups fl ON f.id = fl.fixture_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY f.event_date ASC
            LIMIT 200`,
      args,
    });

    const fixtures = result.rows.map(row => ({
      id: row.id,
      bsdId: row.bsd_id,
      leagueId: row.league_id,
      seasonId: row.season_id,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeTeam: { id: row.home_team_id, name: row.home_team_name },
      awayTeam: { id: row.away_team_id, name: row.away_team_name },
      leagueName: row.league_name,
      eventDate: row.event_date,
      status: row.status,
      currentMinute: row.current_minute,
      period: row.period,
      homeScore: row.home_score,
      awayScore: row.away_score,
      homeScoreHt: row.home_score_ht,
      awayScoreHt: row.away_score_ht,
      roundName: row.round_name,
      isLocalDerby: Number(row.is_local_derby) === 1,
      travelDistanceKm: row.travel_distance_km,
      prediction: row.pick_type ? {
        pickType: row.pick_type,
        pickLabel: row.pick_label,
        predictedResult: Number(row.home_win_prob) > Number(row.away_win_prob) ? 'H' : (Number(row.draw_prob) > Number(row.home_win_prob) ? 'D' : 'A'),
        probHomeWin: Number(row.home_win_prob),
        probDraw: Number(row.draw_prob),
        probAwayWin: Number(row.away_win_prob),
        over25Prob: row.over_25_prob ? Number(row.over_25_prob) : undefined,
        under25Prob: row.under_25_prob ? Number(row.under_25_prob) : undefined,
        bttsYesProb: row.btts_yes_prob ? Number(row.btts_yes_prob) : undefined,
        bttsNoProb: row.btts_no_prob ? Number(row.btts_no_prob) : undefined,
        homeXg: row.home_xg ? Number(row.home_xg) : undefined,
        awayXg: row.away_xg ? Number(row.away_xg) : undefined,
        confidence: Number(row.pred_confidence),
        tier: row.tier,
        verdict: row.verdict,
        phantomScore: row.phantom_score ? Number(row.phantom_score) : undefined,
        edge: row.edge ? Number(row.edge) : undefined,
      } : null,
      odds: row.odds_home ? {
        homeWin: Number(row.odds_home),
        draw: Number(row.odds_draw),
        awayWin: Number(row.odds_away),
        over25: row.odds_over25 ? Number(row.odds_over25) : null,
        under25: row.odds_under25 ? Number(row.odds_under25) : null,
        bttsYes: row.odds_btts_yes ? Number(row.odds_btts_yes) : null,
        bttsNo: row.odds_btts_no ? Number(row.odds_btts_no) : null,
      } : null,
      lineup: row.home_formation ? {
        homeFormation: row.home_formation,
        awayFormation: row.away_formation,
      } : null,
    }));

    // Group by league
    const leagueMap: Record<number, string> = {};
    const grouped: Record<number, { leagueId: number; leagueName: string; fixtures: typeof fixtures }> = {};

    for (const f of fixtures) {
      if (!leagueMap[f.leagueId as number]) leagueMap[f.leagueId as number] = f.leagueName || `League ${f.leagueId}`;
      const lid = f.leagueId as number;
      if (!grouped[lid]) {
        grouped[lid] = { leagueId: lid, leagueName: f.leagueName || '', fixtures: [] };
      }
      grouped[lid].fixtures.push(f);
    }

    return NextResponse.json({ count: fixtures.length, grouped, leagueMap, fixtures });
  } catch (error) {
    console.error('[API] Fixtures error:', error);
    return NextResponse.json({ count: 0, fixtures: [], grouped: {}, leagueMap: {}, error: String(error) }, { status: 500 });
  }
}
