// ============================================================================
// xG-Vantage V2 — Bayesian ELO (Glicko-2 Style) Rating System
// ============================================================================
// A Glicko-style rating system with uncertainty quantification.
// Each team carries a rating (μ), rating deviation (φ), and volatility (σ).
// The system knows HOW SURE it is about each team's rating.
// ============================================================================

import { client } from '@/lib/db-turso';
import { GLICKO_PARAMS } from './constants';
import type { GlickoRating } from './types';

// ---------------------------------------------------------------------------
// Constants (derived from GLICKO_PARAMS)
// ---------------------------------------------------------------------------
const {
  defaultRating,
  defaultDeviation,
  defaultVolatility,
  tau,
  convergenceTolerance,
  maxIterations,
  homeRatingChangeFactor,
  awayRatingChangeFactor,
  deviationDecay,
  maxDeviation,
  minDeviation,
} = GLICKO_PARAMS;

const HOME_ADVANTAGE = GLICKO_PARAMS.eloHomeAdv; // 65 ELO points
const Q = Math.LN10 / 400; // scaling constant ≈ 0.0057565
const Q_SQUARED = Q * Q;

// ---------------------------------------------------------------------------
// DB Table: team_glicko
// We create a dedicated table rather than extending team_elo, to keep the
// existing ELO system stable and avoid migration headaches.
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS team_glicko (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id       INTEGER NOT NULL,
    league_id     INTEGER NOT NULL DEFAULT 0,
    season_id     INTEGER NOT NULL DEFAULT 0,
    rating        REAL    NOT NULL DEFAULT ${defaultRating},
    deviation     REAL    NOT NULL DEFAULT ${defaultDeviation},
    volatility    REAL    NOT NULL DEFAULT ${defaultVolatility},
    home_rating   REAL    NOT NULL DEFAULT ${defaultRating},
    home_deviation REAL   NOT NULL DEFAULT ${defaultDeviation},
    away_rating   REAL    NOT NULL DEFAULT ${defaultRating},
    away_deviation REAL   NOT NULL DEFAULT ${defaultDeviation},
    match_count   INTEGER NOT NULL DEFAULT 0,
    last_match_date TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, league_id, season_id)
  )
`;

/** Ensure the team_glicko table exists. Called lazily on first interaction. */
let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await client.execute(CREATE_TABLE_SQL);
    tableEnsured = true;
  } catch {
    // Table may already exist — that's fine
    tableEnsured = true;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Clamp a number between min and max. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Compute the Glicko g(φ) function: reduces impact of uncertain opponents. */
function gPhi(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * Q_SQUARED * phi * phi) / (Math.PI * Math.PI));
}

/** Compute the Glicko E(μ, μ_j, φ_j) expected score function. */
function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.pow(10, -gPhi(phiJ) * (mu - muJ) / 400));
}

/**
 * Compute new volatility using the Illinois algorithm (Glicko-2 Step 5).
 * This finds σ' such that the rating change is consistent with the
 * observed performance versus the expected volatility.
 */
function computeNewVolatility(
  sigma: number,
  phi: number,
  variance: number,
  delta: number,
): number {
  const phiSquared = phi * phi;
  const a = Math.log(sigma * sigma); // ln(σ²)

  // f(x) — the function we need to find the root of
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const dSquared = variance + phiSquared + ex;
    const h = phiSquared + ex;
    const right = (dSquared - delta * delta * h) / (2 * dSquared * dSquared);
    return (ex * (delta * delta - phiSquared - ex)) / (2 * dSquared * dSquared) + (x - a) / (tau * tau);
  };

  // Initial bounds
  let upper = f(a) < 0 ? a : a;
  let lower = a;
  if (f(a) < 0) {
    // Find upper bound
    let k = 1;
    while (f(a + k * tau) < 0) {
      k++;
    }
    upper = a + k * tau;
  } else {
    // Find lower bound
    let k = 1;
    while (f(a - k * tau) > 0) {
      k++;
    }
    lower = a - k * tau;
  }

  // Illinois algorithm (modified regula falsi)
  let fUpper = f(upper);
  let fLower = f(lower);
  let side = 0;

  for (let i = 0; i < maxIterations; i++) {
    const mid = (fLower * upper - fUpper * lower) / (fLower - fUpper);
    const fMid = f(mid);

    if (Math.abs(fMid) < convergenceTolerance) {
      return Math.exp(mid / 2); // σ' = e^(x/2)
    }

    if (fMid * fUpper > 0) {
      upper = mid;
      fUpper = fMid;
      if (side === -1) fLower /= 2;
      side = -1;
    } else if (fMid * fLower > 0) {
      lower = mid;
      fLower = fMid;
      if (side === 1) fUpper /= 2;
      side = 1;
    } else {
      // Exact root found (unlikely but possible)
      return Math.exp(mid / 2);
    }
  }

  // Convergence not reached — return best estimate
  const mid = (fLower * upper - fUpper * lower) / (fLower - fUpper);
  return Math.exp(mid / 2);
}

/**
 * Full Glicko-2 rating update for a single team given its match results
 * in the current rating period.
 *
 * @param mu     Current rating
 * @param phi    Current rating deviation
 * @param sigma  Current volatility
 * @param opponents  Array of opponent data for this rating period
 * @returns Updated { mu, phi, sigma }
 */
function glicko2Update(
  mu: number,
  phi: number,
  sigma: number,
  opponents: Array<{ muJ: number; phiJ: number; outcome: number }>,
): { mu: number; phi: number; sigma: number } {
  // Step 1: If no games played, just increase RD (handled separately)
  if (opponents.length === 0) {
    return { mu, phi: clamp(phi, minDeviation, maxDeviation), sigma };
  }

  // Step 2: Compute variance (v) and improvement (δ)
  let invVariance = 0;
  let deltaSum = 0;
  for (const opp of opponents) {
    const gVal = gPhi(opp.phiJ);
    const e = expectedScore(mu, opp.muJ, opp.phiJ);
    invVariance += gVal * gVal * e * (1 - e);
    deltaSum += gVal * (opp.outcome - e);
  }

  if (invVariance <= 0) {
    // Degenerate case — no meaningful update
    return { mu, phi: clamp(phi, minDeviation, maxDeviation), sigma };
  }

  const variance = 1 / invVariance;
  const delta = variance * deltaSum;

  // Step 3: Compute new volatility (σ')
  const newSigma = computeNewVolatility(sigma, phi, variance, delta);

  // Step 4: Update rating deviation
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / variance);

  // Step 5: Update rating
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    mu: newMu,
    phi: clamp(newPhi, minDeviation, maxDeviation),
    sigma: newSigma,
  };
}

/**
 * Apply deviation decay for days since last match.
 * RD increases over time when a team doesn't play, making us less certain.
 */
function applyDeviationDecay(phi: number, daysSinceLastMatch: number): number {
  if (daysSinceLastMatch <= 0) return phi;
  // RD increases by deviationDecay * sqrt(1 + days_since_last_match)
  const decayAmount = deviationDecay * Math.sqrt(1 + daysSinceLastMatch);
  return clamp(phi + decayAmount, minDeviation, maxDeviation);
}

/**
 * Convert a match result to Glicko outcomes.
 * Returns { homeOutcome, awayOutcome } where:
 *   1.0 = win, 0.5 = draw, 0.0 = loss
 */
function matchToOutcomes(
  homeGoals: number,
  awayGoals: number,
): { homeOutcome: number; awayOutcome: number } {
  if (homeGoals > awayGoals) return { homeOutcome: 1.0, awayOutcome: 0.0 };
  if (homeGoals < awayGoals) return { homeOutcome: 0.0, awayOutcome: 1.0 };
  return { homeOutcome: 0.5, awayOutcome: 0.5 };
}

/** Goal-difference multiplier: bigger wins → bigger rating changes. */
function goalDiffMultiplier(goalDiff: number): number {
  const absDiff = Math.abs(goalDiff);
  if (absDiff <= 1) return 1.0;
  if (absDiff === 2) return 1.3;
  return 1.5 + (absDiff - 3) * 0.1;
}

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface GlickoRow {
  team_id: number;
  league_id: number;
  season_id: number;
  rating: number;
  deviation: number;
  volatility: number;
  home_rating: number;
  home_deviation: number;
  away_rating: number;
  away_deviation: number;
  match_count: number;
  last_match_date: string | null;
}

/** Parse a DB row into a GlickoRow, applying defaults for missing values. */
function parseRow(row: Record<string, unknown>): GlickoRow {
  return {
    team_id: (row.team_id as number) ?? 0,
    league_id: (row.league_id as number) ?? 0,
    season_id: (row.season_id as number) ?? 0,
    rating: (row.rating as number) ?? defaultRating,
    deviation: (row.deviation as number) ?? defaultDeviation,
    volatility: (row.volatility as number) ?? defaultVolatility,
    home_rating: (row.home_rating as number) ?? defaultRating,
    home_deviation: (row.home_deviation as number) ?? defaultDeviation,
    away_rating: (row.away_rating as number) ?? defaultRating,
    away_deviation: (row.away_deviation as number) ?? defaultDeviation,
    match_count: (row.match_count as number) ?? 0,
    last_match_date: (row.last_match_date as string) ?? null,
  };
}

/** Convert a GlickoRow to the exported GlickoRating type. */
function rowToGlickoRating(row: GlickoRow): GlickoRating {
  return {
    rating: row.rating,
    deviation: row.deviation,
    volatility: row.volatility,
    homeRating: row.home_rating,
    homeDeviation: row.home_deviation,
    awayRating: row.away_rating,
    awayDeviation: row.away_deviation,
    matchCount: row.match_count,
    lastUpdated: row.last_match_date ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Fetch a GlickoRow from DB, applying deviation decay
// ---------------------------------------------------------------------------

async function fetchGlickoRow(
  teamId: number,
  leagueId: number = 0,
  seasonId: number = 0,
): Promise<GlickoRow | null> {
  await ensureTable();

  const result = await client.execute({
    sql: `SELECT team_id, league_id, season_id, rating, deviation, volatility,
                 home_rating, home_deviation, away_rating, away_deviation,
                 match_count, last_match_date
          FROM team_glicko
          WHERE team_id = ? AND league_id = ? AND season_id = ?`,
    args: [teamId, leagueId, seasonId],
  });

  if (result.rows.length === 0) return null;

  const row = parseRow(result.rows[0] as Record<string, unknown>);

  // Apply deviation decay if team hasn't played recently
  if (row.last_match_date) {
    const lastMatch = new Date(row.last_match_date);
    const now = new Date();
    const daysSince = Math.max(0, Math.floor((now.getTime() - lastMatch.getTime()) / (1000 * 60 * 60 * 24)));

    if (daysSince > 0) {
      row.deviation = applyDeviationDecay(row.deviation, daysSince);
      row.home_deviation = applyDeviationDecay(row.home_deviation, daysSince);
      row.away_deviation = applyDeviationDecay(row.away_deviation, daysSince);
    }
  }

  return row;
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Get the current Glicko rating for a team, including uncertainty measures.
 * If the team has no record, returns default values.
 *
 * Applies deviation decay based on time since last match.
 */
export async function getGlickoRating(
  teamId: number,
  leagueId: number = 0,
  seasonId: number = 0,
): Promise<GlickoRating> {
  const row = await fetchGlickoRow(teamId, leagueId, seasonId);

  if (!row) {
    return {
      rating: defaultRating,
      deviation: defaultDeviation,
      volatility: defaultVolatility,
      homeRating: defaultRating,
      homeDeviation: defaultDeviation,
      awayRating: defaultRating,
      awayDeviation: defaultDeviation,
      matchCount: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  return rowToGlickoRating(row);
}

/**
 * Initialize a Glicko rating record for a new team.
 * Does nothing if a record already exists for this team/league/season combo.
 */
export async function initializeGlickoRating(
  teamId: number,
  leagueId: number = 0,
  seasonId: number = 0,
): Promise<void> {
  await ensureTable();

  // Check if already exists
  const existing = await client.execute({
    sql: 'SELECT id FROM team_glicko WHERE team_id = ? AND league_id = ? AND season_id = ?',
    args: [teamId, leagueId, seasonId],
  });

  if (existing.rows.length > 0) return; // Already initialized

  await client.execute({
    sql: `INSERT INTO team_glicko
            (team_id, league_id, season_id, rating, deviation, volatility,
             home_rating, home_deviation, away_rating, away_deviation, match_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    args: [
      teamId, leagueId, seasonId,
      defaultRating, defaultDeviation, defaultVolatility,
      defaultRating, defaultDeviation,
      defaultRating, defaultDeviation,
    ],
  });
}

/**
 * Update Glicko ratings after a match result.
 *
 * This applies the full Glicko-2 update algorithm for both teams:
 * 1. Apply deviation decay since last match
 * 2. Compute expected scores incorporating home advantage
 * 3. Update overall ratings via Glicko-2 algorithm
 * 4. Update home/away split ratings with change factors
 * 5. Persist to database
 */
export async function updateGlickoAfterMatch(
  homeTeamId: number,
  awayTeamId: number,
  homeGoals: number,
  awayGoals: number,
  leagueId: number = 0,
  seasonId: number = 0,
): Promise<void> {
  await ensureTable();

  // Ensure both teams have records
  await initializeGlickoRating(homeTeamId, leagueId, seasonId);
  await initializeGlickoRating(awayTeamId, leagueId, seasonId);

  // Fetch current ratings (with decay applied)
  const homeRow = await fetchGlickoRow(homeTeamId, leagueId, seasonId);
  const awayRow = await fetchGlickoRow(awayTeamId, leagueId, seasonId);

  if (!homeRow || !awayRow) {
    // This shouldn't happen after initialization, but guard anyway
    console.warn(`[Glicko] Failed to fetch rows for teams ${homeTeamId} / ${awayTeamId}`);
    return;
  }

  // Determine match outcomes
  const { homeOutcome, awayOutcome } = matchToOutcomes(homeGoals, awayGoals);

  // Goal-difference multiplier for bigger wins
  const goalDiff = Math.abs(homeGoals - awayGoals);
  const gdm = goalDiffMultiplier(goalDiff);

  // -----------------------------------------------------------------------
  // Overall rating update (Glicko-2 core algorithm)
  // -----------------------------------------------------------------------
  // Home team's update: opponent is the away team (with home advantage added)
  const homeOpponents = [{
    muJ: awayRow.rating + HOME_ADVANTAGE, // away team's rating + home advantage for home perspective
    phiJ: awayRow.deviation,
    outcome: homeOutcome,
  }];

  // Away team's update: opponent is the home team (with home advantage subtracted)
  const awayOpponents = [{
    muJ: homeRow.rating - HOME_ADVANTAGE, // home team's rating minus home advantage for away perspective
    phiJ: homeRow.deviation,
    outcome: awayOutcome,
  }];

  const homeUpdated = glicko2Update(
    homeRow.rating, homeRow.deviation, homeRow.volatility,
    homeOpponents,
  );

  const awayUpdated = glicko2Update(
    awayRow.rating, awayRow.deviation, awayRow.volatility,
    awayOpponents,
  );

  // Apply goal-difference multiplier to the rating change
  const homeRatingChange = homeUpdated.mu - homeRow.rating;
  const awayRatingChange = awayUpdated.mu - awayRow.rating;

  const homeFinalRating = homeRow.rating + homeRatingChange * gdm;
  const awayFinalRating = awayRow.rating + awayRatingChange * gdm;

  // -----------------------------------------------------------------------
  // Home/away split rating update
  // -----------------------------------------------------------------------
  // Home team plays at HOME → use home-specific ratings
  const homeHomeOpponents = [{
    muJ: awayRow.away_rating + HOME_ADVANTAGE,
    phiJ: awayRow.away_deviation,
    outcome: homeOutcome,
  }];

  const homeHomeUpdated = glicko2Update(
    homeRow.home_rating, homeRow.home_deviation, homeRow.volatility,
    homeHomeOpponents,
  );

  // Home team's away rating gets a small change (they played at home, so away is secondary)
  const homeAwayRatingChange = homeRatingChange * awayRatingChangeFactor;

  // Away team plays AWAY → use away-specific ratings
  const awayAwayOpponents = [{
    muJ: homeRow.home_rating - HOME_ADVANTAGE,
    phiJ: homeRow.home_deviation,
    outcome: awayOutcome,
  }];

  const awayAwayUpdated = glicko2Update(
    awayRow.away_rating, awayRow.away_deviation, awayRow.volatility,
    awayAwayOpponents,
  );

  // Away team's home rating gets a small change (they played away, so home is secondary)
  const awayHomeRatingChange = awayRatingChange * awayRatingChangeFactor;

  // Apply goal-diff multiplier to split changes too
  const homeHomeChange = (homeHomeUpdated.mu - homeRow.home_rating) * gdm;
  const homeHomeFinalRating = homeRow.home_rating + homeHomeChange;
  const homeHomeFinalDeviation = homeHomeUpdated.phi;

  const awayAwayChange = (awayAwayUpdated.mu - awayRow.away_rating) * gdm;
  const awayAwayFinalRating = awayRow.away_rating + awayAwayChange;
  const awayAwayFinalDeviation = awayAwayUpdated.phi;

  // Home team's away rating (small adjustment)
  const homeAwayFinalRating = homeRow.away_rating + homeAwayRatingChange * gdm;
  const homeAwayFinalDeviation = clamp(
    homeRow.away_deviation + (homeHomeUpdated.phi - homeRow.home_deviation) * awayRatingChangeFactor,
    minDeviation,
    maxDeviation,
  );

  // Away team's home rating (small adjustment)
  const awayHomeFinalRating = awayRow.home_rating + awayHomeRatingChange * gdm;
  const awayHomeFinalDeviation = clamp(
    awayRow.home_deviation + (awayAwayUpdated.phi - awayRow.away_deviation) * awayRatingChangeFactor,
    minDeviation,
    maxDeviation,
  );

  // -----------------------------------------------------------------------
  // Persist updates
  // -----------------------------------------------------------------------
  const now = new Date().toISOString();

  // Use the average volatility from overall + split updates
  const homeNewVolatility = homeUpdated.sigma;
  const awayNewVolatility = awayUpdated.sigma;

  await client.execute({
    sql: `UPDATE team_glicko
          SET rating = ?, deviation = ?, volatility = ?,
              home_rating = ?, home_deviation = ?,
              away_rating = ?, away_deviation = ?,
              match_count = match_count + 1,
              last_match_date = ?, updated_at = ?
          WHERE team_id = ? AND league_id = ? AND season_id = ?`,
    args: [
      homeFinalRating, homeUpdated.phi, homeNewVolatility,
      homeHomeFinalRating, homeHomeFinalDeviation,
      homeAwayFinalRating, homeAwayFinalDeviation,
      now, now,
      homeTeamId, leagueId, seasonId,
    ],
  });

  await client.execute({
    sql: `UPDATE team_glicko
          SET rating = ?, deviation = ?, volatility = ?,
              home_rating = ?, home_deviation = ?,
              away_rating = ?, away_deviation = ?,
              match_count = match_count + 1,
              last_match_date = ?, updated_at = ?
          WHERE team_id = ? AND league_id = ? AND season_id = ?`,
    args: [
      awayFinalRating, awayUpdated.phi, awayNewVolatility,
      awayHomeFinalRating, awayHomeFinalDeviation,
      awayAwayFinalRating, awayAwayFinalDeviation,
      now, now,
      awayTeamId, leagueId, seasonId,
    ],
  });
}

/**
 * Recalculate all Glicko ratings for a league from scratch.
 *
 * This resets all teams to defaults and replays every finished match
 * in chronological order. Useful for:
 * - Fixing corrupted ratings
 * - Adjusting system parameters and seeing the effect
 * - Season resets
 */
export async function recalcLeagueGlicko(
  leagueId: number,
  seasonId?: number,
): Promise<void> {
  await ensureTable();

  // Resolve season if not provided
  let sid = seasonId ?? 0;
  if (!seasonId) {
    const fixtureResult = await client.execute({
      sql: 'SELECT DISTINCT season_id FROM fixtures WHERE league_id = ? AND season_id IS NOT NULL LIMIT 1',
      args: [leagueId],
    });
    if (fixtureResult.rows.length === 0) return;
    sid = fixtureResult.rows[0].season_id as number;
  }

  // Fetch all finished matches in chronological order
  const fixtures = await client.execute({
    sql: `SELECT home_team_id, away_team_id, home_score, away_score, event_date
          FROM fixtures
          WHERE league_id = ? AND season_id = ? AND status = 'finished'
            AND home_score IS NOT NULL AND away_score IS NOT NULL
          ORDER BY event_date ASC`,
    args: [leagueId, sid],
  });

  if (fixtures.rows.length === 0) {
    console.log(`[Glicko] No finished matches found for league ${leagueId}`);
    return;
  }

  // Reset all team Glicko records for this league/season to defaults
  await client.execute({
    sql: `UPDATE team_glicko
          SET rating = ?, deviation = ?, volatility = ?,
              home_rating = ?, home_deviation = ?,
              away_rating = ?, away_deviation = ?,
              match_count = 0, last_match_date = NULL,
              updated_at = datetime('now')
          WHERE league_id = ? AND season_id = ?`,
    args: [
      defaultRating, defaultDeviation, defaultVolatility,
      defaultRating, defaultDeviation,
      defaultRating, defaultDeviation,
      leagueId, sid,
    ],
  });

  // Collect unique team IDs and ensure they all have records
  const teamIdSet = new Set<number>();
  for (const f of fixtures.rows) {
    teamIdSet.add(f.home_team_id as number);
    teamIdSet.add(f.away_team_id as number);
  }
  const teamIds = Array.from(teamIdSet);
  for (const tid of teamIds) {
    await initializeGlickoRating(tid, leagueId, sid);
  }

  // Replay all matches
  let processed = 0;
  let errors = 0;
  for (const f of fixtures.rows) {
    try {
      await updateGlickoAfterMatch(
        f.home_team_id as number,
        f.away_team_id as number,
        f.home_score as number,
        f.away_score as number,
        leagueId,
        sid,
      );
      processed++;
    } catch (err) {
      errors++;
      console.warn(`[Glicko] Error processing match ${f.home_team_id} vs ${f.away_team_id}:`, err);
    }
  }

  console.log(
    `[Glicko] Recalculated league ${leagueId}: ${processed} matches processed, ${errors} errors`,
  );
}

/**
 * Get a qualitative assessment of how confident we are about a team's rating.
 *
 * Based on the rating deviation (RD):
 *   - Low RD = we've seen many matches = high certainty
 *   - High RD = few matches or long inactivity = low certainty
 *
 * @returns certainty level and the raw deviation value
 */
export async function getRatingUncertainty(
  teamId: number,
  leagueId: number = 0,
  seasonId: number = 0,
): Promise<{ certainty: 'high' | 'medium' | 'low'; deviation: number }> {
  const rating = await getGlickoRating(teamId, leagueId, seasonId);

  // Certainty thresholds based on RD
  // After 10+ matches, RD typically drops to 50-80 (high certainty)
  // New teams start at RD=350 (low certainty)
  // Medium is in between
  let certainty: 'high' | 'medium' | 'low';

  if (rating.deviation <= 80) {
    certainty = 'high';
  } else if (rating.deviation <= 200) {
    certainty = 'medium';
  } else {
    certainty = 'low';
  }

  return { certainty, deviation: rating.deviation };
}

/**
 * Compute expected outcome probabilities from two Glicko ratings.
 *
 * Uses the Glicko expected score formula that accounts for both teams'
 * rating deviations (uncertainties). More uncertain ratings push
 * probabilities toward 50/50.
 *
 * The draw probability is estimated from the closeness of expected scores
 * and the combined uncertainty — when teams are close in rating and
 * uncertainty is high, draws become more likely.
 *
 * @param homeRating  Home team's Glicko rating
 * @param awayRating  Away team's Glicko rating
 * @returns Probabilities for home win, draw, and away win (sum ≈ 1.0)
 */
export function getExpectedOutcome(
  homeRating: GlickoRating,
  awayRating: GlickoRating,
): { homeWin: number; draw: number; awayWin: number } {
  // Effective ratings with home advantage
  const homeEffectiveMu = homeRating.rating + HOME_ADVANTAGE;
  const awayEffectiveMu = awayRating.rating;

  // Combined uncertainty term: sqrt(1 + 3q²(φ_home² + φ_away²)/π²)
  const combinedUncertainty = Math.sqrt(
    1 + (3 * Q_SQUARED * (homeRating.deviation * homeRating.deviation + awayRating.deviation * awayRating.deviation)) / (Math.PI * Math.PI),
  );

  // Expected score for home team (Glicko formula with uncertainty)
  const exponent = -(homeEffectiveMu - awayEffectiveMu) / (400 * combinedUncertainty);
  const eHome = 1 / (1 + Math.pow(10, exponent));

  // Expected score for away team
  const eAway = 1 - eHome;

  // Draw probability estimation
  // The draw probability depends on how close the expected scores are to 0.5
  // and on the combined uncertainty. More uncertainty → higher draw chance.
  //
  // Method: Use the proximity of E_home to 0.5 as a base draw rate,
  // then scale by the combined uncertainty (wider distributions overlap more).
  const ratingGap = Math.abs(homeEffectiveMu - awayEffectiveMu);
  const combinedDeviation = Math.sqrt(
    homeRating.deviation * homeRating.deviation + awayRating.deviation * awayRating.deviation,
  );

  // Base draw rate from rating gap (smaller gap → more draws)
  // Empirically: ~26-28% draw rate when teams are equal, decreasing with gap
  const baseDrawRate = 0.27 * Math.exp(-ratingGap / 400);

  // Uncertainty adjustment: more uncertain → draw probability shifts up
  // because the distributions overlap more
  const uncertaintyFactor = 1 + (combinedDeviation / 500) * 0.3;

  // Match count adjustment: with more data, we can be more precise about draws
  const totalMatches = homeRating.matchCount + awayRating.matchCount;
  const dataAdjustment = totalMatches < 6 ? 1.1 : totalMatches < 12 ? 1.0 : 0.95;

  let drawProb = clamp(baseDrawRate * uncertaintyFactor * dataAdjustment, 0.05, 0.40);

  // Distribute remaining probability proportionally
  const remainingProb = 1 - drawProb;
  const homeWinProb = remainingProb * eHome;
  const awayWinProb = remainingProb * eAway;

  // Normalize to ensure sum = 1.0
  const total = homeWinProb + drawProb + awayWinProb;

  return {
    homeWin: Math.round((homeWinProb / total) * 10000) / 10000,
    draw: Math.round((drawProb / total) * 10000) / 10000,
    awayWin: Math.round((awayWinProb / total) * 10000) / 10000,
  };
}

// ---------------------------------------------------------------------------
// Utility: Batch initialization for a league
// ---------------------------------------------------------------------------

/**
 * Initialize Glicko ratings for all teams in a league that don't have records yet.
 * Useful when setting up a new league for the first time.
 */
export async function initializeLeagueGlicko(
  leagueId: number,
  seasonId: number = 0,
): Promise<number> {
  await ensureTable();

  // Get all distinct team IDs from fixtures for this league
  const result = await client.execute({
    sql: `SELECT DISTINCT team_id FROM (
            SELECT home_team_id AS team_id FROM fixtures WHERE league_id = ? AND season_id = ?
            UNION
            SELECT away_team_id AS team_id FROM fixtures WHERE league_id = ? AND season_id = ?
          )`,
    args: [leagueId, seasonId, leagueId, seasonId],
  });

  let initialized = 0;
  for (const row of result.rows) {
    const teamId = row.team_id as number;
    const existing = await client.execute({
      sql: 'SELECT id FROM team_glicko WHERE team_id = ? AND league_id = ? AND season_id = ?',
      args: [teamId, leagueId, seasonId],
    });

    if (existing.rows.length === 0) {
      await initializeGlickoRating(teamId, leagueId, seasonId);
      initialized++;
    }
  }

  return initialized;
}

// ---------------------------------------------------------------------------
// Utility: Get league-wide rating snapshot
// ---------------------------------------------------------------------------

/**
 * Get Glicko ratings for all teams in a league, sorted by rating descending.
 * Useful for debugging, league tables, and UI display.
 */
export async function getLeagueGlickoSnapshot(
  leagueId: number,
  seasonId: number = 0,
  limit: number = 50,
): Promise<Array<GlickoRating & { teamId: number }>> {
  await ensureTable();

  const result = await client.execute({
    sql: `SELECT g.team_id, g.rating, g.deviation, g.volatility,
                 g.home_rating, g.home_deviation,
                 g.away_rating, g.away_deviation,
                 g.match_count, g.last_match_date,
                 t.name AS team_name
          FROM team_glicko g
          LEFT JOIN teams t ON t.id = g.team_id
          WHERE g.league_id = ? AND g.season_id = ?
          ORDER BY g.rating DESC
          LIMIT ?`,
    args: [leagueId, seasonId, limit],
  });

  return result.rows.map((row) => {
    const parsed = parseRow(row as Record<string, unknown>);
    const rating = rowToGlickoRating(parsed);
    return { ...rating, teamId: parsed.team_id };
  });
}

// ---------------------------------------------------------------------------
// Utility: Head-to-head expected outcome (convenience wrapper)
// ---------------------------------------------------------------------------

/**
 * Get expected outcome for two teams by their IDs, fetching their ratings
 * from the database automatically. Convenience wrapper around
 * getExpectedOutcome().
 */
export async function getMatchOutcome(
  homeTeamId: number,
  awayTeamId: number,
  leagueId: number = 0,
  seasonId: number = 0,
): Promise<{
  homeWin: number;
  draw: number;
  awayWin: number;
  homeCertainty: 'high' | 'medium' | 'low';
  awayCertainty: 'high' | 'medium' | 'low';
}> {
  const [homeRating, awayRating] = await Promise.all([
    getGlickoRating(homeTeamId, leagueId, seasonId),
    getGlickoRating(awayTeamId, leagueId, seasonId),
  ]);

  const outcome = getExpectedOutcome(homeRating, awayRating);

  const homeCertainty = homeRating.deviation <= 80 ? 'high' as const
    : homeRating.deviation <= 200 ? 'medium' as const
    : 'low' as const;

  const awayCertainty = awayRating.deviation <= 80 ? 'high' as const
    : awayRating.deviation <= 200 ? 'medium' as const
    : 'low' as const;

  return {
    ...outcome,
    homeCertainty,
    awayCertainty,
  };
}
