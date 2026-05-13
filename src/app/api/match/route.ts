import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { bsdClient } from '@/lib/bsd-client';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureId = parseInt(searchParams.get('fixtureId') || '0');

  if (!fixtureId) {
    return NextResponse.json({ error: 'fixtureId required' }, { status: 400 });
  }

  // Get fixture with all related data
  const fixture = await db.fixture.findUnique({
    where: { id: fixtureId },
    include: {
      homeTeam: true,
      awayTeam: true,
      stats: true,
      incidents: { orderBy: { minute: 'asc' } },
      lineup: true,
      odds: true,
      metadata: true,
      prediction: true,
      playerStats: true,
    },
  });

  if (!fixture) {
    // Try fetching from BSD API directly
    try {
      const event = await bsdClient.getEvent(fixtureId);
      const [stats, incidents, odds, lineups, metadata] = await Promise.allSettled([
        bsdClient.getEventStats(fixtureId),
        bsdClient.getEventIncidents(fixtureId),
        bsdClient.getEventOdds(fixtureId),
        bsdClient.getEventLineups(fixtureId),
        bsdClient.getEventMetadata(fixtureId),
      ]);

      return NextResponse.json({
        source: 'api',
        fixture: event,
        stats: stats.status === 'fulfilled' ? stats.value : null,
        incidents: incidents.status === 'fulfilled' ? incidents.value : null,
        odds: odds.status === 'fulfilled' ? odds.value : null,
        lineups: lineups.status === 'fulfilled' ? lineups.value : null,
        metadata: metadata.status === 'fulfilled' ? metadata.value : null,
      });
    } catch (error) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }
  }

  return NextResponse.json({
    source: 'database',
    fixture,
  });
}
