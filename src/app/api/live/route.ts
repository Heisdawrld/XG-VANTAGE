import { NextResponse } from 'next/server';
import { bsdClient } from '@/lib/bsd-client';
import { client } from '@/lib/db-turso';

export async function GET() {
  try {
    const liveData = await bsdClient.getLiveEvents();
    const enrichedEvents: Array<Record<string, unknown>> = [];

    for (const event of liveData.events) {
      // Get our prediction if exists
      const predResult = await client.execute({
        sql: 'SELECT pick_type, pick_label, confidence, tier, home_win_prob, draw_prob, away_win_prob, verdict FROM predictions WHERE fixture_id = ?',
        args: [event.id],
      });

      // Get lineup if exists
      const lineupResult = await client.execute({
        sql: 'SELECT home_formation, away_formation FROM fixture_lineups WHERE fixture_id = ?',
        args: [event.id],
      });

      enrichedEvents.push({
        ...event,
        prediction: predResult.rows.length > 0 ? {
          pickType: predResult.rows[0].pick_type,
          pickLabel: predResult.rows[0].pick_label,
          confidence: predResult.rows[0].confidence,
          tier: predResult.rows[0].tier,
          probHomeWin: predResult.rows[0].home_win_prob,
          probDraw: predResult.rows[0].draw_prob,
          probAwayWin: predResult.rows[0].away_win_prob,
        } : null,
        lineup: lineupResult.rows.length > 0 ? {
          homeFormation: lineupResult.rows[0].home_formation,
          awayFormation: lineupResult.rows[0].away_formation,
        } : null,
      });
    }

    return NextResponse.json({
      count: enrichedEvents.length,
      events: enrichedEvents,
    });
  } catch (error) {
    console.error('[API] Live error:', error);
    return NextResponse.json({ count: 0, events: [] });
  }
}
