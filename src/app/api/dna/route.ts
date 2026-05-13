import { NextResponse } from 'next/server';
import { computeTeamDNA, computeAllTeamDNA } from '@/engine/team-dna';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const teamId = body.teamId;

    if (teamId) {
      await computeTeamDNA(teamId);
      return NextResponse.json({ success: true, message: `DNA computed for team ${teamId}` });
    }

    const computed = await computeAllTeamDNA();
    return NextResponse.json({ success: true, computed });
  } catch (error) {
    console.error('[API] DNA error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
