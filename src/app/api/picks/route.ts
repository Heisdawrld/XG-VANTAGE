import { NextResponse } from 'next/server';
import { getTopPicks } from '@/engine/prediction-engine';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '10');

  try {
    // First try to get existing predictions from DB
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let picks = await db.prediction.findMany({
      where: {
        fixture: {
          eventDate: { gte: today, lt: tomorrow },
          status: 'notstarted',
        },
        confidence: { gte: 0.55 },
      },
      include: {
        fixture: {
          include: {
            homeTeam: true,
            awayTeam: true,
            odds: true,
          },
        },
      },
      orderBy: { confidence: 'desc' },
      take: limit,
    });

    // If no picks in DB, generate them
    if (picks.length === 0) {
      const generated = await getTopPicks(limit);
      // Re-fetch from DB after generation
      picks = await db.prediction.findMany({
        where: {
          fixture: {
            eventDate: { gte: today, lt: tomorrow },
            status: 'notstarted',
          },
          confidence: { gte: 0.55 },
        },
        include: {
          fixture: {
            include: {
              homeTeam: true,
              awayTeam: true,
              odds: true,
            },
          },
        },
        orderBy: { confidence: 'desc' },
        take: limit,
      });
    }

    return NextResponse.json({
      date: today.toISOString().split('T')[0],
      count: picks.length,
      picks: picks.map((p, i) => ({
        rank: i + 1,
        fixtureId: p.fixtureId,
        homeTeam: p.fixture.homeTeam.name,
        awayTeam: p.fixture.awayTeam.name,
        homeTeamId: p.fixture.homeTeamId,
        awayTeamId: p.fixture.awayTeamId,
        eventDate: p.fixture.eventDate,
        leagueId: p.fixture.leagueId,
        predictedResult: p.predictedResult,
        confidence: p.confidence,
        probHomeWin: p.probHomeWin,
        probDraw: p.probDraw,
        probAwayWin: p.probAwayWin,
        expectedHomeGoals: p.expectedHomeGoals,
        expectedAwayGoals: p.expectedAwayGoals,
        probOver25: p.probOver25,
        probBttsYes: p.probBttsYes,
        mostLikelyScore: p.mostLikelyScore,
        recommendedBet: p.recommendedBet,
        valueDetected: p.valueDetected,
        valueEdge: p.valueEdge,
        kellyStake: p.kellyStake,
        odds: p.fixture.odds ? {
          homeWin: p.fixture.odds.homeWin,
          draw: p.fixture.odds.draw,
          awayWin: p.fixture.odds.awayWin,
          over25: p.fixture.odds.over25Goals,
          bttsYes: p.fixture.odds.bttsYes,
        } : null,
      })),
    });
  } catch (error) {
    console.error('[API] Picks error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
