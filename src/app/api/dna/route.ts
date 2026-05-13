import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';
import { computeTeamDNA } from '@/engine/team-dna';

export async function POST(request: Request) {
  try {
    const { teamId } = await request.json().catch(() => ({}));

    if (teamId) {
      await computeTeamDNA(teamId);
      return NextResponse.json({ success: true, message: `DNA computed for team ${teamId}` });
    }

    // Compute DNA for all teams
    const teams = await client.execute('SELECT id FROM teams');
    let computed = 0;
    for (const team of teams.rows) {
      const fixtureCount = await client.execute({
        sql: 'SELECT COUNT(*) as cnt FROM fixtures WHERE (home_team_id = ? OR away_team_id = ?) AND status = \'finished\'',
        args: [team.id as number, team.id as number],
      });
      if ((fixtureCount.rows[0].cnt as number) >= 5) {
        await computeTeamDNA(team.id as number);
        computed++;
      }
    }

    return NextResponse.json({ success: true, computed, total: teams.rows.length });
  } catch (error) {
    console.error('[API] DNA error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await client.execute('SELECT * FROM team_profiles ORDER BY updated_at DESC LIMIT 50');
    return NextResponse.json({
      count: result.rows.length,
      profiles: result.rows,
    });
  } catch (error) {
    return NextResponse.json({ count: 0, profiles: [], error: String(error) }, { status: 500 });
  }
}
