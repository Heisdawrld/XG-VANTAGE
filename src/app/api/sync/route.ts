import { NextResponse } from 'next/server';
import { fullDailySync, syncFixtures, syncStandings, syncFixtureDetails } from '@/lib/sync-service';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'daily';

    let result;
    switch (action) {
      case 'full':
        result = await fullDailySync();
        break;
      case 'fixtures':
        result = await syncFixtures({
          dateFrom: body.dateFrom || new Date().toISOString().split('T')[0],
          dateTo: body.dateTo || new Date(Date.now() + 86400000).toISOString().split('T')[0],
          leagueId: body.leagueId,
        });
        break;
      case 'standings':
        result = await syncStandings(body.leagueId || 17);
        break;
      case 'details':
        await syncFixtureDetails(body.fixtureId);
        result = { ok: true };
        break;
      default:
        result = await fullDailySync();
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[API] Sync error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
