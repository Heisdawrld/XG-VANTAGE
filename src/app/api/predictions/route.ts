import { NextResponse } from 'next/server';
import { predictMatch, predictUpcomingMatches } from '@/engine/prediction-engine';
import { client } from '@/lib/db-turso';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureId = searchParams.get('fixtureId');
  const bulk = searchParams.get('bulk');

  try {
    if (fixtureId) {
      const prediction = await predictMatch(parseInt(fixtureId));
      return NextResponse.json({ success: true, prediction });
    }

    if (bulk === 'today') {
      const predictions = await predictUpcomingMatches();
      return NextResponse.json({ success: true, count: predictions.length, predictions });
    }

    // Return existing predictions for today
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const result = await client.execute({
      sql: `SELECT p.*, f.event_date, f.status as fixture_status, f.home_team_id, f.away_team_id,
                   ht.name as home_team_name, at.name as away_team_name
            FROM predictions p
            JOIN fixtures f ON p.fixture_id = f.id
            LEFT JOIN teams ht ON f.home_team_id = ht.id
            LEFT JOIN teams at ON f.away_team_id = at.id
            WHERE f.event_date >= ? AND f.event_date < ?
            ORDER BY p.confidence DESC`,
      args: [today, tomorrow],
    });

    const predictions = result.rows.map(p => ({
      fixtureId: p.fixture_id,
      homeTeam: p.home_team_name,
      awayTeam: p.away_team_name,
      eventDate: p.event_date,
      pickType: p.pick_type,
      pickLabel: p.pick_label,
      homeWinProb: p.home_win_prob,
      drawProb: p.draw_prob,
      awayWinProb: p.away_win_prob,
      over25Prob: p.over_25_prob,
      bttsYesProb: p.btts_yes_prob,
      confidence: p.confidence,
      tier: p.tier,
      verdict: p.verdict,
      homeXg: p.home_xg,
      awayXg: p.away_xg,
      edge: p.edge,
      result: p.result,
    }));

    return NextResponse.json({
      count: predictions.length,
      predictions,
    });
  } catch (error) {
    console.error('[API] Predictions error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { fixtureId } = await request.json();
    if (!fixtureId) {
      return NextResponse.json({ error: 'fixtureId required' }, { status: 400 });
    }
    const prediction = await predictMatch(fixtureId);
    return NextResponse.json({ success: true, prediction });
  } catch (error) {
    console.error('[API] Prediction POST error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
