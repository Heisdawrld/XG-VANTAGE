import { NextResponse } from 'next/server';
import { predictMatch as predictMatchV2, predictUpcomingMatches as predictUpcomingV2 } from '@/engine/v2/prediction-engine';
import { client } from '@/lib/db-turso';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureId = searchParams.get('fixtureId');
  const bulk = searchParams.get('bulk');

  try {
    if (fixtureId) {
      // Try V2 prediction first
      try {
        const prediction = await predictMatchV2(parseInt(fixtureId));
        return NextResponse.json({ success: true, engine: 'v2', prediction });
      } catch (err) {
        console.error('[API] V2 prediction failed, falling back:', err);
      }

      // Fallback to V1 prediction from DB
      const v1Result = await client.execute({
        sql: `SELECT p.*, f.event_date, f.status as fixture_status,
                     ht.name as home_team_name, at.name as away_team_name
              FROM predictions p
              JOIN fixtures f ON p.fixture_id = f.id
              LEFT JOIN teams ht ON f.home_team_id = ht.id
              LEFT JOIN teams at ON f.away_team_id = at.id
              WHERE p.fixture_id = ?`,
        args: [parseInt(fixtureId)],
      });

      if (v1Result.rows.length > 0) {
        const p = v1Result.rows[0];
        return NextResponse.json({ success: true, engine: 'v1', prediction: {
          fixtureId: p.fixture_id,
          homeTeam: p.home_team_name,
          awayTeam: p.away_team_name,
          pickType: p.pick_type,
          pickLabel: p.pick_label,
          confidence: p.confidence,
          tier: p.tier,
          homeWinProb: p.home_win_prob,
          drawProb: p.draw_prob,
          awayWinProb: p.away_win_prob,
          over25Prob: p.over_25_prob,
          bttsYesProb: p.btts_yes_prob,
          homeXg: p.home_xg,
          awayXg: p.away_xg,
          edge: p.edge,
          result: p.result,
        }});
      }

      return NextResponse.json({ success: false, error: 'No prediction found' }, { status: 404 });
    }

    if (bulk === 'today') {
      const predictions = await predictUpcomingV2();
      return NextResponse.json({ success: true, engine: 'v2', count: predictions.length, predictions });
    }

    // Return existing V2 predictions for today, fallback to V1
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    // Try V2 predictions first (with safe fallback if table doesn't exist)
    let v2Result;
    try {
      v2Result = await client.execute({
        sql: `SELECT p2.*, f.event_date, f.status as fixture_status, f.home_team_id, f.away_team_id,
                     ht.name as home_team_name, at.name as away_team_name, l.name as league_name
              FROM predictions_v2 p2
              JOIN fixtures f ON p2.fixture_id = f.id
              LEFT JOIN teams ht ON f.home_team_id = ht.id
              LEFT JOIN teams at ON f.away_team_id = at.id
              LEFT JOIN leagues l ON f.league_id = l.id
              WHERE f.event_date >= ? AND f.event_date < ?
              ORDER BY p2.confidence DESC`,
        args: [today, tomorrow],
      });
    } catch {
      // predictions_v2 table doesn't exist yet
      v2Result = { rows: [] };
    }

    if (v2Result.rows.length > 0) {
      const predictions = v2Result.rows.map(p => ({
        fixtureId: p.fixture_id,
        homeTeam: p.home_team_name,
        awayTeam: p.away_team_name,
        leagueName: p.league_name,
        eventDate: p.event_date,
        pickType: p.pick_type,
        pickLabel: p.pick_type,
        confidence: p.confidence,
        tier: p.tier,
        script: p.script,
        homeXg: p.xg_home,
        awayXg: p.xg_away,
        safeBet: p.safe_bet === 1,
        valueBet: p.value_bet === 1,
        dataQuality: p.data_quality,
        engineVersion: p.engine_version,
        keyReasons: p.key_reasons ? JSON.parse(p.key_reasons as string) : [],
        calibratedProbs: p.calibrated_probs ? JSON.parse(p.calibrated_probs as string) : null,
        result: p.result,
      }));

      return NextResponse.json({
        engine: 'v2',
        count: predictions.length,
        predictions,
      });
    }

    // Fallback to V1 predictions
    const v1Result = await client.execute({
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

    const predictions = v1Result.rows.map(p => ({
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
      engine: 'v1',
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
    const { fixtureId, engine } = await request.json();
    if (!fixtureId) {
      return NextResponse.json({ error: 'fixtureId required' }, { status: 400 });
    }

    if (engine === 'v1') {
      // Use V1 engine explicitly
      const { predictMatch: predictV1 } = await import('@/engine/prediction-engine');
      const prediction = await predictV1(fixtureId);
      return NextResponse.json({ success: true, engine: 'v1', prediction });
    }

    // Default: V2 engine
    const prediction = await predictMatchV2(fixtureId);
    return NextResponse.json({ success: true, engine: 'v2', prediction });
  } catch (error) {
    console.error('[API] Prediction POST error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
