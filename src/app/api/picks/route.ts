import { NextResponse } from 'next/server';
import { getTopPicks } from '@/engine/prediction-engine';
import { client } from '@/lib/db-turso';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '10');

  try {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    // First try to get existing predictions from DB
    const result = await client.execute({
      sql: `SELECT p.*, f.event_date, f.home_team_id, f.away_team_id, f.league_id,
                   ht.name as home_team_name, at.name as away_team_name,
                   o.home_win, o.draw as odds_draw, o.away_win, o.over_25_goals, o.btts_yes
            FROM predictions p
            JOIN fixtures f ON p.fixture_id = f.id
            LEFT JOIN teams ht ON f.home_team_id = ht.id
            LEFT JOIN teams at ON f.away_team_id = at.id
            LEFT JOIN fixture_odds o ON o.fixture_id = f.id
            WHERE f.event_date >= ? AND f.event_date < ? AND f.status = 'notstarted'
              AND p.confidence >= 55
            ORDER BY p.confidence DESC LIMIT ?`,
      args: [today, tomorrow, limit],
    });

    let picks = result.rows.map((p, i) => ({
      rank: i + 1,
      fixtureId: p.fixture_id,
      homeTeam: p.home_team_name,
      awayTeam: p.away_team_name,
      homeTeamId: p.home_team_id,
      awayTeamId: p.away_team_id,
      eventDate: p.event_date,
      leagueId: p.league_id,
      pickType: p.pick_type,
      pickLabel: p.pick_label,
      confidence: p.confidence,
      tier: p.tier,
      verdict: p.verdict,
      homeWinProb: p.home_win_prob,
      drawProb: p.draw_prob,
      awayWinProb: p.away_win_prob,
      over25Prob: p.over_25_prob,
      bttsYesProb: p.btts_yes_prob,
      homeXg: p.home_xg,
      awayXg: p.away_xg,
      edge: p.edge,
      recommendedBet: p.pick_label,
      valueDetected: (p.edge as number) > 5,
      valueEdge: p.edge,
      odds: {
        homeWin: p.home_win,
        draw: p.odds_draw,
        awayWin: p.away_win,
        over25: p.over_25_goals,
        bttsYes: p.btts_yes,
      },
    }));

    // If no picks in DB, generate them
    if (picks.length === 0) {
      const generated = await getTopPicks(limit);
      // Re-fetch from DB after generation
      const result2 = await client.execute({
        sql: `SELECT p.*, f.event_date, f.home_team_id, f.away_team_id, f.league_id,
                     ht.name as home_team_name, at.name as away_team_name,
                     o.home_win, o.draw as odds_draw, o.away_win, o.over_25_goals, o.btts_yes
              FROM predictions p
              JOIN fixtures f ON p.fixture_id = f.id
              LEFT JOIN teams ht ON f.home_team_id = ht.id
              LEFT JOIN teams at ON f.away_team_id = at.id
              LEFT JOIN fixture_odds o ON o.fixture_id = f.id
              WHERE f.event_date >= ? AND f.event_date < ? AND f.status = 'notstarted'
                AND p.confidence >= 55
              ORDER BY p.confidence DESC LIMIT ?`,
        args: [today, tomorrow, limit],
      });

      picks = result2.rows.map((p, i) => ({
        rank: i + 1,
        fixtureId: p.fixture_id,
        homeTeam: p.home_team_name,
        awayTeam: p.away_team_name,
        homeTeamId: p.home_team_id,
        awayTeamId: p.away_team_id,
        eventDate: p.event_date,
        leagueId: p.league_id,
        pickType: p.pick_type,
        pickLabel: p.pick_label,
        confidence: p.confidence,
        tier: p.tier,
        verdict: p.verdict,
        homeWinProb: p.home_win_prob,
        drawProb: p.draw_prob,
        awayWinProb: p.away_win_prob,
        over25Prob: p.over_25_prob,
        bttsYesProb: p.btts_yes_prob,
        homeXg: p.home_xg,
        awayXg: p.away_xg,
        edge: p.edge,
        recommendedBet: p.pick_label,
        valueDetected: (p.edge as number) > 5,
        valueEdge: p.edge,
        odds: {
          homeWin: p.home_win,
          draw: p.odds_draw,
          awayWin: p.away_win,
          over25: p.over_25_goals,
          bttsYes: p.btts_yes,
        },
      }));
    }

    return NextResponse.json({
      date: today,
      count: picks.length,
      picks,
    });
  } catch (error) {
    console.error('[API] Picks error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
