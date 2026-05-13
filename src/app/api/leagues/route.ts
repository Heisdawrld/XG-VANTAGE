import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';

export async function GET() {
  try {
    // Get active leagues from database
    const result = await client.execute({
      sql: 'SELECT * FROM leagues WHERE is_active = 1 ORDER BY country, name',
      args: [],
    });

    return NextResponse.json({
      count: result.rows.length,
      leagues: result.rows.map(l => ({
        id: l.id,
        name: l.name,
        country: l.country,
        countryCode: l.country_code,
        logo: l.logo,
        flag: l.flag,
        isActive: l.is_active,
        seasonId: l.season_id,
        seasonName: l.season_name,
        bsdId: l.bsd_id,
      })),
    });
  } catch (error) {
    console.error('[API] Leagues error:', error);
    return NextResponse.json({ count: 0, leagues: [], error: String(error) }, { status: 500 });
  }
}
