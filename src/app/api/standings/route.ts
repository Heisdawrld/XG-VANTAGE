import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const leagueId = parseInt(searchParams.get('leagueId') || '0');

  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 });
  }

  try {
    const result = await client.execute({
      sql: 'SELECT * FROM standings WHERE league_id = ? ORDER BY position ASC',
      args: [leagueId],
    });

    const standings = result.rows.map(s => ({
      position: s.position,
      team: { id: s.team_id, name: s.team_name },
      teamId: s.team_id,
      teamName: s.team_name,
      played: s.played,
      won: s.won,
      drawn: s.drawn,
      lost: s.lost,
      gf: s.gf,
      ga: s.ga,
      gd: s.gd,
      pts: s.pts,
      xgf: s.xgf,
      xga: s.xga,
      xgd: s.xgd,
      form: s.form,
    }));

    return NextResponse.json({ standings });
  } catch (error) {
    console.error('[API] Standings error:', error);
    return NextResponse.json({ standings: [], error: String(error) }, { status: 500 });
  }
}
