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

    // Single query with LEFT JOINs — V2 predictions preferred, V1 fallback
    const result = await client.execute({
      sql: `SELECT f.*, ht.name as home_team_name, ht.short_name as home_team_short_name, ht.logo as home_team_logo,
             at.name as away_team_name, at.short_name as away_team_short_name, at.logo as away_team_logo, l.name as league_name,
             p2.pick_type as v2_pick_type, p2.confidence as v2_confidence, p2.tier as v2_tier,
             p2.xg_home as v2_xg_home, p2.xg_away as v2_xg_away, p2.script as v2_script,
             p2.calibrated_probs as v2_calibrated_probs, p2.market_selection as v2_market_selection,
             p2.safe_bet as v2_safe_bet, p2.value_bet as v2_value_bet,
             p.pick_type as v1_pick_type, p.pick_label, p.confidence as pred_confidence, p.tier as v1_tier, p.verdict,
             p.home_win_prob, p.draw_prob, p.away_win_prob, p.over_25_prob, p.under_25_prob,
             p.btts_yes_prob, p.btts_no_prob, p.home_xg, p.away_xg, p.phantom_score, p.edge,
             o.home_win as odds_home, o.draw as odds_draw, o.away_win as odds_away,
             o.over_25_goals as odds_over25, o.under_25_goals as odds_under25, o.btts_yes as odds_btts_yes, o.btts_no as odds_btts_no,
             fl.home_formation, fl.away_formation
            FROM fixtures f
            LEFT JOIN teams ht ON f.home_team_id = ht.id
            LEFT JOIN teams at ON f.away_team_id = at.id
            LEFT JOIN leagues l ON f.league_id = l.id
            LEFT JOIN predictions_v2 p2 ON f.id = p2.fixture_id
            LEFT JOIN predictions p ON f.id = p.fixture_id
            LEFT JOIN fixture_odds o ON f.id = o.fixture_id
            LEFT JOIN fixture_lineups fl ON f.id = fl.fixture_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY f.event_date ASC
            LIMIT 200`,
      args,
    });

    const fixtures = result.rows.map(row => {
      // V2 prediction takes priority
      const hasV2 = row.v2_pick_type != null && String(row.v2_pick_type) !== '';
      let prediction = null;

      if (hasV2) {
        const calibratedProbs = row.v2_calibrated_probs ? JSON.parse(String(row.v2_calibrated_probs)) : {};
        const marketSelection = row.v2_market_selection ? JSON.parse(String(row.v2_market_selection)) : {};
        const bestPick = marketSelection.bestPick ?? null;
        prediction = {
          pickType: String(row.v2_pick_type),
          pickLabel: bestPick?.selection ?? String(row.v2_pick_type),
          predictedResult: (calibratedProbs.homeWin ?? 0) > (calibratedProbs.awayWin ?? 0) ? 'H' : ((calibratedProbs.draw ?? 0) > (calibratedProbs.homeWin ?? 0) ? 'D' : 'A'),
          probHomeWin: calibratedProbs.homeWin ?? null,
          probDraw: calibratedProbs.draw ?? null,
          probAwayWin: calibratedProbs.awayWin ?? null,
          over25Prob: calibratedProbs.over25 ?? null,
          under25Prob: calibratedProbs.under25 ?? null,
          bttsYesProb: calibratedProbs.bttsYes ?? null,
          bttsNoProb: calibratedProbs.bttsNo ?? null,
          homeXg: Number(row.v2_xg_home ?? 0),
          awayXg: Number(row.v2_xg_away ?? 0),
          confidence: Number(row.v2_confidence) / 100,
          tier: String(row.v2_tier ?? 'medium'),
          script: String(row.v2_script ?? ''),
          safeBet: Number(row.v2_safe_bet) === 1,
          valueBet: Number(row.v2_value_bet) === 1,
          engineVersion: 'v2',
        };
      } else if (row.v1_pick_type) {
        prediction = {
          pickType: row.v1_pick_type,
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
          confidence: Number(row.pred_confidence) / 100,
          tier: row.v1_tier,
          verdict: row.verdict,
          phantomScore: row.phantom_score ? Number(row.phantom_score) : undefined,
          edge: row.edge ? Number(row.edge) : undefined,
          engineVersion: 'v1',
        };
      }

      return {
        id: row.id,
        bsdId: row.bsd_id,
        leagueId: row.league_id,
        seasonId: row.season_id,
        homeTeamId: row.home_team_id,
        awayTeamId: row.away_team_id,
        homeTeam: { id: row.home_team_id, name: row.home_team_name, shortName: row.home_team_short_name, logo: row.home_team_logo },
        awayTeam: { id: row.away_team_id, name: row.away_team_name, shortName: row.away_team_short_name, logo: row.away_team_logo },
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
        prediction,
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
    };
    });

    // Group by league
    const leagueMap: Record<number, string> = {};
    const grouped: Record<number, { leagueId: number; leagueName: string; fixtures: typeof fixtures }> = {};

    for (const f of fixtures) {
      const lid = Number(f.leagueId);
      if (!leagueMap[lid]) leagueMap[lid] = (f.leagueName as string) || `League ${lid}`;
      if (!grouped[lid]) {
        grouped[lid] = { leagueId: lid, leagueName: (f.leagueName as string) || '', fixtures: [] };
      }
      grouped[lid].fixtures.push(f);
    }

    return NextResponse.json({ count: fixtures.length, grouped, leagueMap, fixtures });
  } catch (error) {
    console.error('[API] Fixtures error:', error);
    return NextResponse.json({ count: 0, fixtures: [], grouped: {}, leagueMap: {}, error: String(error) }, { status: 500 });
  }
}
