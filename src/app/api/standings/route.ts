import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const leagueId = parseInt(searchParams.get('leagueId') || '0');

  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 });
  }

  const standings = await db.standing.findMany({
    where: { leagueId },
    include: { team: true },
    orderBy: { position: 'asc' },
  });

  return NextResponse.json({ leagueId, standings });
}
