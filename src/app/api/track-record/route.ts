import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';

export async function GET() {
  try {
    // Get track record summary
    const result = await client.execute({
      sql: `SELECT pick_type,
                   SUM(total) as total,
                   SUM(won) as won,
                   SUM(lost) as lost,
                   SUM(void_count) as void_count,
                   AVG(win_rate) as avg_win_rate
            FROM track_record
            GROUP BY pick_type
            ORDER BY pick_type`,
      args: [],
    });

    // Also compute from actual predictions
    const overallResult = await client.execute({
      sql: `SELECT COUNT(*) as total,
                   SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
                   SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost,
                   SUM(CASE WHEN result = 'void' THEN 1 ELSE 0 END) as void_count
            FROM predictions WHERE result IN ('won', 'lost', 'void')`,
      args: [],
    });

    // Monthly breakdown
    const monthlyResult = await client.execute({
      sql: `SELECT strftime('%Y-%m', created_at) as month,
                   COUNT(*) as total,
                   SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
                   SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost
            FROM predictions WHERE result IN ('won', 'lost', 'void')
            GROUP BY strftime('%Y-%m', created_at)
            ORDER BY month DESC LIMIT 12`,
      args: [],
    });

    const overall = overallResult.rows.length > 0 ? overallResult.rows[0] : null;
    const totalPicks = (overall?.total as number) ?? 0;
    const wonPicks = (overall?.won as number) ?? 0;

    return NextResponse.json({
      overall: {
        total: totalPicks,
        won: wonPicks,
        lost: (overall?.lost as number) ?? 0,
        void: (overall?.void_count as number) ?? 0,
        winRate: totalPicks > 0 ? Math.round((wonPicks / totalPicks) * 1000) / 10 : 0,
      },
      byPickType: result.rows.map(r => ({
        pickType: r.pick_type,
        total: r.total,
        won: r.won,
        lost: r.lost,
        void: r.void_count,
        winRate: r.avg_win_rate,
      })),
      monthly: monthlyResult.rows.map(r => ({
        month: r.month,
        total: r.total,
        won: r.won,
        lost: r.lost,
        winRate: (r.total as number) > 0 ? Math.round(((r.won as number) / (r.total as number)) * 1000) / 10 : 0,
      })),
    });
  } catch (error) {
    console.error('[API] Track record error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
