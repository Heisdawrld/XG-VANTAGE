import { NextRequest, NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';

export async function GET() {
  try {
    // Get user's accas (for now, return all recent accas)
    const result = await client.execute({
      sql: 'SELECT * FROM accas ORDER BY created_at DESC LIMIT 20',
      args: [],
    });

    return NextResponse.json({
      count: result.rows.length,
      accas: result.rows.map(a => ({
        id: a.id,
        userId: a.user_id,
        date: a.date,
        pickIds: a.pick_ids ? JSON.parse(a.pick_ids as string) : [],
        totalOdds: a.total_odds,
        status: a.status,
        createdAt: a.created_at,
      })),
    });
  } catch (error) {
    console.error('[API] Acca GET error:', error);
    return NextResponse.json({ count: 0, accas: [], error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, pickIds, totalOdds, date } = await req.json();

    if (!pickIds || !Array.isArray(pickIds) || pickIds.length === 0) {
      return NextResponse.json({ error: 'pickIds array is required' }, { status: 400 });
    }

    const accaDate = date || new Date().toISOString().split('T')[0];

    const result = await client.execute({
      sql: `INSERT INTO accas (user_id, date, pick_ids, total_odds, status)
            VALUES (?, ?, ?, ?, 'pending')`,
      args: [userId || null, accaDate, JSON.stringify(pickIds), totalOdds || null],
    });

    return NextResponse.json({
      success: true,
      acca: {
        id: result.rowsAffected > 0 ? 'created' : null,
        userId,
        date: accaDate,
        pickIds,
        totalOdds,
        status: 'pending',
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[API] Acca POST error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
