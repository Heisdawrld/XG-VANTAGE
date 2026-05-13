import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get('leagueId');
  const status = searchParams.get('status');
  const date = searchParams.get('date');

  const where: Record<string, unknown> = {};
  if (leagueId) where.leagueId = parseInt(leagueId);
  if (status) where.status = status;
  if (date) {
    const d = new Date(date);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    where.eventDate = { gte: d, lt: next };
  }

  // Default: today's fixtures
  if (!date && !status) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    where.eventDate = { gte: today, lt: tomorrow };
  }

  const fixtures = await db.fixture.findMany({
    where,
    include: {
      homeTeam: true,
      awayTeam: true,
      league: true,
      odds: true,
      prediction: true,
      lineup: true,
    },
    orderBy: { eventDate: 'asc' },
    take: 100,
  });

  // Group by league
  const grouped = new Map<number, {
    leagueId: number;
    leagueName: string;
    fixtures: typeof fixtures;
  }>();

  for (const f of fixtures) {
    const key = f.leagueId;
    if (!grouped.has(key)) {
      grouped.set(key, {
        leagueId: f.leagueId,
        leagueName: '', // We'll enrich this
        fixtures: [],
      });
    }
    grouped.get(key)!.fixtures.push(f);
  }

  // Enrich with league names
  const leagues = await db.league.findMany({
    where: { id: { in: Array.from(grouped.keys()) } },
  });
  for (const league of leagues) {
    const group = grouped.get(league.id);
    if (group) group.leagueName = league.name;
  }

  // Build league name map for frontend
  const leagueMap: Record<number, string> = {};
  for (const league of leagues) {
    leagueMap[league.id] = league.name;
  }

  return NextResponse.json({
    count: fixtures.length,
    grouped: Object.fromEntries(grouped),
    leagueMap,
    fixtures,
  });
}
