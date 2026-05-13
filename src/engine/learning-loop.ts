// Self-Learning Loop — Turso/libSQL version
// Validates predictions and adjusts model weights

import { client } from '@/lib/db-turso';

export async function validatePrediction(fixtureId: number): Promise<{
  resultCorrect: boolean;
  homeGoalsError: number;
  awayGoalsError: number;
} | null> {
  const fixtureResult = await client.execute({
    sql: 'SELECT * FROM fixtures WHERE id = ?',
    args: [fixtureId],
  });
  if (fixtureResult.rows.length === 0) return null;

  const fixture = fixtureResult.rows[0];
  if (fixture.status !== 'finished' || fixture.home_score == null || fixture.away_score == null) return null;

  const predResult = await client.execute({
    sql: 'SELECT * FROM predictions WHERE fixture_id = ?',
    args: [fixtureId],
  });
  if (predResult.rows.length === 0) return null;

  const pred = predResult.rows[0];
  const homeScore = fixture.home_score as number;
  const awayScore = fixture.away_score as number;

  // Determine actual result
  const actualResult = homeScore > awayScore ? 'H' : homeScore === awayScore ? 'D' : 'A';

  // Check if the pick was correct
  const pickType = pred.pick_type as string;
  const totalGoals = homeScore + awayScore;
  let pickWon = false;
  switch (pickType) {
    case 'home_win': pickWon = homeScore > awayScore; break;
    case 'away_win': pickWon = awayScore > homeScore; break;
    case 'draw': pickWon = homeScore === awayScore; break;
    case 'over_25': pickWon = totalGoals > 2.5; break;
    case 'under_25': pickWon = totalGoals < 2.5; break;
    case 'btts_yes': pickWon = homeScore > 0 && awayScore > 0; break;
    case 'btts_no': pickWon = !(homeScore > 0 && awayScore > 0); break;
  }

  // Update prediction result
  await client.execute({
    sql: `UPDATE predictions SET result = ?, settled_at = datetime('now') WHERE fixture_id = ?`,
    args: [pickWon ? 'won' : 'lost', fixtureId],
  });

  const homeGoalsError = Math.abs((pred.home_xg as number) - homeScore);
  const awayGoalsError = Math.abs((pred.away_xg as number) - awayScore);

  console.log(`[Learning] Fixture ${fixtureId}: Pick ${pickType}, Won: ${pickWon}`);
  return { resultCorrect: pickWon, homeGoalsError, awayGoalsError };
}

export async function updateModelWeights(): Promise<void> {
  console.log('[Learning] Updating model weights...');

  // Get recent predictions with results
  const results = await client.execute({
    sql: `SELECT result FROM predictions WHERE result IN ('won', 'lost') ORDER BY created_at DESC LIMIT 500`,
    args: [],
  });

  if (results.rows.length < 20) {
    console.log('[Learning] Not enough outcomes to adjust weights');
    return;
  }

  const total = results.rows.length;
  const won = results.rows.filter(r => r.result === 'won').length;
  const resultAccuracy = won / total;

  // Get current weights
  const currentWeights = await client.execute({
    sql: 'SELECT * FROM model_weights WHERE is_active = 1 LIMIT 1',
    args: [],
  });

  if (currentWeights.rows.length === 0) {
    await client.execute({
      sql: `INSERT INTO model_weights (model_version, poisson_weight, elo_weight, form_weight, style_matchup_weight, context_weight, is_active, total_predictions, correct_results, result_accuracy)
            VALUES ('v1.0', 0.35, 0.25, 0.20, 0.10, 0.10, 1, ?, ?, ?)`,
      args: [total, won, resultAccuracy],
    });
    return;
  }

  const cw = currentWeights.rows[0];
  const learningRate = 0.02;

  let newPoisson = (cw.poisson_weight as number);
  let newElo = (cw.elo_weight as number);
  let newForm = (cw.form_weight as number);
  let newStyle = (cw.style_matchup_weight as number);
  let newContext = (cw.context_weight as number);

  if (resultAccuracy < 0.45) {
    newPoisson -= learningRate * 2;
    newElo += learningRate;
    newContext += learningRate;
  } else if (resultAccuracy > 0.60) {
    newPoisson += learningRate * 0.5;
  }

  // Normalize
  const sum = newPoisson + newElo + newForm + newStyle + newContext;
  newPoisson /= sum;
  newElo /= sum;
  newForm /= sum;
  newStyle /= sum;
  newContext /= sum;

  await client.execute({
    sql: `UPDATE model_weights SET
      poisson_weight = ?, elo_weight = ?, form_weight = ?, style_matchup_weight = ?, context_weight = ?,
      total_predictions = ?, correct_results = ?, result_accuracy = ?, updated_at = datetime('now')
      WHERE id = ?`,
    args: [newPoisson, newElo, newForm, newStyle, newContext, total, won, resultAccuracy, cw.id as number],
  });

  console.log(`[Learning] Updated weights: P=${newPoisson.toFixed(3)} E=${newElo.toFixed(3)} F=${newForm.toFixed(3)} S=${newStyle.toFixed(3)} C=${newContext.toFixed(3)} Acc=${(resultAccuracy * 100).toFixed(1)}%`);
}

/** Validate all pending finished matches */
export async function validateAllPending(): Promise<number> {
  const pending = await client.execute({
    sql: `SELECT p.fixture_id FROM predictions p JOIN fixtures f ON p.fixture_id = f.id
          WHERE p.result = 'pending' AND f.status = 'finished' AND f.home_score IS NOT NULL`,
    args: [],
  });

  let validated = 0;
  for (const row of pending.rows) {
    const result = await validatePrediction(row.fixture_id as number);
    if (result) validated++;
  }

  if (validated > 0) await updateModelWeights();

  console.log(`[Learning] Validated ${validated} pending predictions`);
  return validated;
}
