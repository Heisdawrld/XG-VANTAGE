import { NextResponse } from 'next/server';
import { bsdClient } from '@/lib/bsd-client';
import { db } from '@/lib/db';

export async function GET() {
  try {
    // First try BSD API live events
    const liveData = await bsdClient.getLiveEvents();
    const enrichedEvents = [];

    for (const event of liveData.events) {
      // Get our prediction if exists
      const prediction = await db.prediction.findUnique({
        where: { fixtureId: event.id },
      });

      // Get lineup if exists
      const lineup = await db.fixtureLineup.findUnique({
        where: { fixtureId: event.id },
      });

      enrichedEvents.push({
        ...event,
        prediction: prediction ? {
          predictedResult: prediction.predictedResult,
          probHomeWin: prediction.probHomeWin,
          probDraw: prediction.probDraw,
          probAwayWin: prediction.probAwayWin,
          confidence: prediction.confidence,
        } : null,
        lineup: lineup ? {
          homeFormation: lineup.homeFormation,
          awayFormation: lineup.awayFormation,
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
