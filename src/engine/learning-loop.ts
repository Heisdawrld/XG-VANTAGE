// Self-Learning Loop — Validates predictions and adjusts model weights

import { db } from '@/lib/db';

export async function validatePrediction(fixtureId: number): Promise<{
  resultCorrect: boolean;
  homeGoalsError: number;
  awayGoalsError: number;
} | null> {
  const fixture = await db.fixture.findUnique({
    where: { id: fixtureId },
    include: { prediction: true },
  });

  if (!fixture || !fixture.prediction || fixture.status !== 'finished') return null;
  if (fixture.homeScore === null || fixture.awayScore === null) return null;

  const pred = fixture.prediction;
  const actualResult = fixture.homeScore > fixture.awayScore ? 'H' : fixture.homeScore === fixture.awayScore ? 'D' : 'A';
  const resultCorrect = pred.predictedResult === actualResult;

  const homeGoalsError = Math.abs(pred.expectedHomeGoals - fixture.homeScore);
  const awayGoalsError = Math.abs(pred.expectedAwayGoals - fixture.awayScore);

  const actualOver25 = (fixture.homeScore + fixture.awayScore) > 2.5;
  const actualBtts = fixture.homeScore > 0 && fixture.awayScore > 0;

  // Calibration error: how far was our probability from reality
  const probCalibrationError = actualResult === 'H'
    ? Math.abs(1 - pred.probHomeWin)
    : actualResult === 'D'
    ? Math.abs(1 - pred.probDraw)
    : Math.abs(1 - pred.probAwayWin);

  // Store outcome
  await db.predictionOutcome.upsert({
    where: { predictionId: pred.id },
    create: {
      predictionId: pred.id,
      fixtureId,
      actualHomeScore: fixture.homeScore,
      actualAwayScore: fixture.awayScore,
      actualResult,
      actualOver25,
      actualBtts,
      resultCorrect,
      scoreExact: `${fixture.homeScore}-${fixture.awayScore}` === pred.mostLikelyScore,
      homeGoalsError,
      awayGoalsError,
      probCalibrationError,
    },
    update: {
      actualHomeScore: fixture.homeScore,
      actualAwayScore: fixture.awayScore,
      actualResult,
      actualOver25,
      actualBtts,
      resultCorrect,
      homeGoalsError,
      awayGoalsError,
      probCalibrationError,
    },
  });

  console.log(`[Learning] Fixture ${fixtureId}: Predicted ${pred.predictedResult}, Actual ${actualResult}, Correct: ${resultCorrect}`);
  return { resultCorrect, homeGoalsError, awayGoalsError };
}

export async function updateModelWeights(): Promise<void> {
  console.log('[Learning] Updating model weights...');

  // Get recent outcomes
  const outcomes = await db.predictionOutcome.findMany({
    take: 500,
    orderBy: { createdAt: 'desc' },
  });

  if (outcomes.length < 20) {
    console.log('[Learning] Not enough outcomes to adjust weights');
    return;
  }

  const totalPredictions = outcomes.length;
  const correctResults = outcomes.filter(o => o.resultCorrect).length;
  const resultAccuracy = correctResults / totalPredictions;

  // Average calibration error
  const avgCalibError = outcomes.reduce((sum, o) => sum + (o.probCalibrationError ?? 0), 0) / totalPredictions;

  // Get current weights
  const currentWeights = await db.modelWeights.findFirst({ where: { isActive: true } });
  if (!currentWeights) {
    // Create default weights
    await db.modelWeights.create({
      data: {
        modelVersion: 'v1.0',
        poissonWeight: 0.35,
        eloWeight: 0.25,
        formWeight: 0.20,
        styleMatchupWeight: 0.10,
        contextWeight: 0.10,
        totalPredictions,
        correctResults,
        resultAccuracy,
        avgCalibrationError,
      },
    });
    return;
  }

  // Simple weight adjustment logic:
  // If overall accuracy is improving, keep weights.
  // If declining, nudge weights toward the model that would have been more correct.
  // For now, implement a simple accuracy-based adjustment

  const learningRate = 0.02; // How fast we adjust
  let newPoisson = currentWeights.poissonWeight;
  let newElo = currentWeights.eloWeight;
  let newForm = currentWeights.formWeight;
  let newStyle = currentWeights.styleMatchupWeight;
  let newContext = currentWeights.contextWeight;

  // If accuracy is above 55%, the system is working — small adjustments only
  // If below, make bigger adjustments
  if (resultAccuracy < 0.45) {
    // Poor accuracy: try shifting weight from Poisson toward ELO and Context
    newPoisson -= learningRate * 2;
    newElo += learningRate;
    newContext += learningRate;
  } else if (resultAccuracy > 0.60) {
    // Good accuracy: reinforce current weights, small boost to best performer
    newPoisson += learningRate * 0.5;
  }

  // Normalize weights to sum to 1
  const total = newPoisson + newElo + newForm + newStyle + newContext;
  newPoisson /= total;
  newElo /= total;
  newForm /= total;
  newStyle /= total;
  newContext /= total;

  // Create new version
  await db.modelWeights.update({
    where: { id: currentWeights.id },
    data: {
      poissonWeight: newPoisson,
      eloWeight: newElo,
      formWeight: newForm,
      styleMatchupWeight: newStyle,
      contextWeight: newContext,
      totalPredictions,
      correctResults,
      resultAccuracy,
      avgCalibrationError,
    },
  });

  console.log(`[Learning] Updated weights: Poisson=${newPoisson.toFixed(3)} ELO=${newElo.toFixed(3)} Form=${newForm.toFixed(3)} Style=${newStyle.toFixed(3)} Context=${newContext.toFixed(3)} Accuracy=${(resultAccuracy * 100).toFixed(1)}%`);
}

/** Validate all unvalidated finished matches */
export async function validateAllPending(): Promise<number> {
  const predictions = await db.prediction.findMany({
    where: { outcome: null },
    include: { fixture: true },
  });

  let validated = 0;
  for (const pred of predictions) {
    if (pred.fixture?.status === 'finished' && pred.fixture.homeScore !== null) {
      await validatePrediction(pred.fixtureId);
      validated++;
    }
  }

  if (validated > 0) {
    await updateModelWeights();
  }

  console.log(`[Learning] Validated ${validated} pending predictions`);
  return validated;
}
