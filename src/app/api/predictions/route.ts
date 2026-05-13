import { NextResponse } from 'next/server';
import { predictMatch, predictUpcomingMatches } from '@/engine/prediction-engine';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureId = searchParams.get('fixtureId');
  const bulk = searchParams.get('bulk');

  try {
    if (fixtureId) {
      // Predict single match
      const prediction = await predictMatch(parseInt(fixtureId));
      return NextResponse.json({ success: true, prediction });
    }

    if (bulk === 'today') {
      // Predict all upcoming today
      const predictions = await predictUpcomingMatches();
      return NextResponse.json({ success: true, count: predictions.length, predictions });
    }

    // Return existing predictions for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const predictions = await db.prediction.findMany({
      where: {
        fixture: {
          eventDate: { gte: today, lt: tomorrow },
          status: 'notstarted',
        },
      },
      include: {
        fixture: {
          include: {
            homeTeam: true,
            awayTeam: true,
          },
        },
      },
      orderBy: { confidence: 'desc' },
    });

    return NextResponse.json({
      count: predictions.length,
      predictions: predictions.map(p => ({
        fixtureId: p.fixtureId,
        homeTeam: p.fixture.homeTeam.name,
        awayTeam: p.fixture.awayTeam.name,
        eventDate: p.fixture.eventDate,
        probHomeWin: p.probHomeWin,
        probDraw: p.probDraw,
        probAwayWin: p.probAwayWin,
        predictedResult: p.predictedResult,
        expectedHomeGoals: p.expectedHomeGoals,
        expectedAwayGoals: p.expectedAwayGoals,
        probOver25: p.probOver25,
        probBttsYes: p.probBttsYes,
        mostLikelyScore: p.mostLikelyScore,
        confidence: p.confidence,
        valueDetected: p.valueDetected,
        recommendedBet: p.recommendedBet,
        kellyStake: p.kellyStake,
      })),
    });
  } catch (error) {
    console.error('[API] Predictions error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
