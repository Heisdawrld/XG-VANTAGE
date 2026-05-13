// xG-Vantage — ELO Rating System
// Dynamic ELO with context weighting, home/away split ratings, goal difference multiplier
// Uses team-specific home advantage coefficients from TeamDNA

import { db } from '@/lib/db';
import { getTeamDNA } from './team-dna';

// ============================================================================
// CONSTANTS
// ============================================================================

const INITIAL_ELO = 1500;
const DEFAULT_K_FACTOR = 32;
const DEFAULT_HOME_ADVANTAGE_ELO = 65; // ELO points bonus for home team
const ELO_SPREAD = 400; // Standard ELO spread factor

// ============================================================================
// INITIALIZE ELO
// ============================================================================

export async function initializeElo(
  teamId: number,
  leagueId: number,
  seasonId: number,
): Promise<void> {
  // Check if ELO already exists for this team/league/season
  const existing = await db.teamELO.findUnique({
    where: {
      teamId_leagueId_seasonId: { teamId, leagueId, seasonId },
    },
  });

  if (existing) {
    console.log(`[ELO] Team ${teamId} already has ELO in league ${leagueId} season ${seasonId}`);
    return;
  }

  await db.teamELO.create({
    data: {
      teamId,
      leagueId,
      seasonId,
      eloRating: INITIAL_ELO,
      eloHomeRating: INITIAL_ELO,
      eloAwayRating: INITIAL_ELO,
      matchesPlayed: 0,
    },
  });

  console.log(`[ELO] Initialized ELO for team ${teamId} at ${INITIAL_ELO} in league ${leagueId} season ${seasonId}`);
}

// ============================================================================
// UPDATE ELO AFTER MATCH
// ============================================================================

export async function updateEloAfterMatch(
  homeTeamId: number,
  awayTeamId: number,
  homeGoals: number,
  awayGoals: number,
  leagueId: number,
  seasonId: number,
  contextWeight: number = 1.0, // 1.0 = normal, >1.0 = high-stakes, <1.0 = low-stakes
): Promise<{ homeEloChange: number; awayEloChange: number }> {
  // Get or create ELO records
  const homeElo = await getOrCreateElo(homeTeamId, leagueId, seasonId);
  const awayElo = await getOrCreateElo(awayTeamId, leagueId, seasonId);

  // Get team-specific home advantage
  const homeTeamDNA = await getTeamDNA(homeTeamId);
  const teamSpecificHomeAdv = homeTeamDNA?.homeAdvantageCoefficient ?? 0.2;
  // Convert to ELO points: base 65 * (team coefficient / generic 0.2)
  const homeAdvElo = DEFAULT_HOME_ADVANTAGE_ELO * (teamSpecificHomeAdv / 0.2);

  // Calculate expected scores using ELO formula
  const homeEloEffective = homeElo.eloRating + homeAdvElo;
  const awayEloEffective = awayElo.eloRating;

  const expectedHome = 1 / (1 + Math.pow(10, (awayEloEffective - homeEloEffective) / ELO_SPREAD));
  const expectedAway = 1 - expectedHome;

  // Actual result
  let actualHome: number;
  let actualAway: number;

  if (homeGoals > awayGoals) {
    actualHome = 1;
    actualAway = 0;
  } else if (homeGoals === awayGoals) {
    actualHome = 0.5;
    actualAway = 0.5;
  } else {
    actualHome = 0;
    actualAway = 1;
  }

  // Goal difference multiplier
  const goalDiff = Math.abs(homeGoals - awayGoals);
  const goalDiffMultiplier = calculateGoalDiffMultiplier(goalDiff);

  // Get K-factor from model weights (or use default)
  const kFactor = await getKFactor();

  // Calculate ELO changes
  const effectiveK = kFactor * goalDiffMultiplier * contextWeight;
  const homeEloChange = effectiveK * (actualHome - expectedHome);
  const awayEloChange = effectiveK * (actualAway - expectedAway);

  // Also calculate separate home/away ELO changes
  const homeEloHomeChange = effectiveK * (actualHome - expectedHome);
  const awayEloAwayChange = effectiveK * (actualAway - expectedAway);

  // Update ELO in database
  const newHomeElo = homeElo.eloRating + homeEloChange;
  const newAwayElo = awayElo.eloRating + awayEloChange;
  const newHomeHomeElo = homeElo.eloHomeRating + homeEloHomeChange;
  const newAwayAwayElo = awayElo.eloAwayRating + awayEloAwayChange;

  // Also update the away team's home ELO slightly (regression toward mean)
  // and the home team's away ELO slightly (regression toward mean)
  const regressionFactor = 0.15; // How much the "other" venue rating moves
  const newHomeAwayElo = homeElo.eloAwayRating + homeEloChange * regressionFactor;
  const newAwayHomeElo = awayElo.eloHomeRating + awayEloChange * regressionFactor;

  await db.teamELO.update({
    where: { id: homeElo.id },
    data: {
      eloRating: Math.round(newHomeElo * 100) / 100,
      eloHomeRating: Math.round(newHomeHomeElo * 100) / 100,
      eloAwayRating: Math.round(newHomeAwayElo * 100) / 100,
      matchesPlayed: homeElo.matchesPlayed + 1,
      lastMatchDate: new Date(),
    },
  });

  await db.teamELO.update({
    where: { id: awayElo.id },
    data: {
      eloRating: Math.round(newAwayElo * 100) / 100,
      eloHomeRating: Math.round(newAwayHomeElo * 100) / 100,
      eloAwayRating: Math.round(newAwayAwayElo * 100) / 100,
      matchesPlayed: awayElo.matchesPlayed + 1,
      lastMatchDate: new Date(),
    },
  });

  console.log(
    `[ELO] Updated: ${homeTeamId} ${homeElo.eloRating.toFixed(0)}→${newHomeElo.toFixed(0)} (${homeEloChange >= 0 ? '+' : ''}${homeEloChange.toFixed(1)}), ` +
    `${awayTeamId} ${awayElo.eloRating.toFixed(0)}→${newAwayElo.toFixed(0)} (${awayEloChange >= 0 ? '+' : ''}${awayEloChange.toFixed(1)})`,
  );

  return { homeEloChange, awayEloChange };
}

// ============================================================================
// GOAL DIFFERENCE MULTIPLIER
// ============================================================================

function calculateGoalDiffMultiplier(goalDiff: number): number {
  // From FIFA's ELO implementation
  if (goalDiff === 0) return 1.0;
  if (goalDiff === 1) return 1.0;
  if (goalDiff === 2) return 1.5;
  // 3+ goals: diminishing returns
  return (11 + goalDiff) / 8;
}

// ============================================================================
// GET ELO RATING
// ============================================================================

export async function getEloRating(
  teamId: number,
  leagueId?: number,
  seasonId?: number,
): Promise<{ overall: number; home: number; away: number; matchesPlayed: number }> {
  // Try to find specific league/season ELO
  if (leagueId && seasonId) {
    const elo = await db.teamELO.findUnique({
      where: {
        teamId_leagueId_seasonId: { teamId, leagueId, seasonId },
      },
    });

    if (elo) {
      return {
        overall: elo.eloRating,
        home: elo.eloHomeRating,
        away: elo.eloAwayRating,
        matchesPlayed: elo.matchesPlayed,
      };
    }
  }

  // Fallback: get the most recent ELO record
  const latestElo = await db.teamELO.findFirst({
    where: { teamId },
    orderBy: { lastMatchDate: 'desc' },
  });

  if (latestElo) {
    return {
      overall: latestElo.eloRating,
      home: latestElo.eloHomeRating,
      away: latestElo.eloAwayRating,
      matchesPlayed: latestElo.matchesPlayed,
    };
  }

  // Default: initial ELO
  return {
    overall: INITIAL_ELO,
    home: INITIAL_ELO,
    away: INITIAL_ELO,
    matchesPlayed: 0,
  };
}

// ============================================================================
// GET ELO DIFFERENCE (with home advantage)
// ============================================================================

export async function getEloDiff(
  homeTeamId: number,
  awayTeamId: number,
  leagueId?: number,
  seasonId?: number,
): Promise<{
  rawDiff: number;
  adjustedDiff: number;
  homeAdvantageElo: number;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
}> {
  const homeElo = await getEloRating(homeTeamId, leagueId, seasonId);
  const awayElo = await getEloRating(awayTeamId, leagueId, seasonId);

  // Use home team's HOME ELO and away team's AWAY ELO
  const homeEloValue = homeElo.home;
  const awayEloValue = awayElo.away;

  // Team-specific home advantage
  const homeTeamDNA = await getTeamDNA(homeTeamId);
  const teamSpecificHomeAdv = homeTeamDNA?.homeAdvantageCoefficient ?? 0.2;
  const homeAdvantageElo = DEFAULT_HOME_ADVANTAGE_ELO * (teamSpecificHomeAdv / 0.2);

  const rawDiff = homeEloValue - awayEloValue;
  const adjustedDiff = rawDiff + homeAdvantageElo;

  // Calculate probabilities using ELO formula
  const homeWinProbability = 1 / (1 + Math.pow(10, -adjustedDiff / ELO_SPREAD));

  // Draw probability estimation: use a Gaussian around equal ELO
  // Maximum draw probability is ~0.28 at ELO diff = 0, decreasing with larger gaps
  const drawProbability = 0.28 * Math.exp(-Math.pow(adjustedDiff / 400, 2) / 2);
  const awayWinProbability = 1 - homeWinProbability - drawProbability;

  // Normalize to ensure probabilities sum to 1
  const total = homeWinProbability + drawProbability + Math.max(0, awayWinProbability);
  const normalizedHome = homeWinProbability / total;
  const normalizedDraw = drawProbability / total;
  const normalizedAway = Math.max(0, awayWinProbability) / total;

  return {
    rawDiff,
    adjustedDiff,
    homeAdvantageElo,
    homeWinProbability: normalizedHome,
    drawProbability: normalizedDraw,
    awayWinProbability: normalizedAway,
  };
}

// ============================================================================
// HELPER: GET OR CREATE ELO
// ============================================================================

async function getOrCreateElo(
  teamId: number,
  leagueId: number,
  seasonId: number,
): Promise<{ id: string; eloRating: number; eloHomeRating: number; eloAwayRating: number; matchesPlayed: number }> {
  let elo = await db.teamELO.findUnique({
    where: {
      teamId_leagueId_seasonId: { teamId, leagueId, seasonId },
    },
  });

  if (!elo) {
    // Try to find any existing ELO for this team to use as seed
    const existingElo = await db.teamELO.findFirst({
      where: { teamId },
      orderBy: { lastMatchDate: 'desc' },
    });

    const seedRating = existingElo?.eloRating ?? INITIAL_ELO;
    const seedHome = existingElo?.eloHomeRating ?? INITIAL_ELO;
    const seedAway = existingElo?.eloAwayRating ?? INITIAL_ELO;

    elo = await db.teamELO.create({
      data: {
        teamId,
        leagueId,
        seasonId,
        eloRating: seedRating,
        eloHomeRating: seedHome,
        eloAwayRating: seedAway,
        matchesPlayed: 0,
      },
    });
  }

  return {
    id: elo.id,
    eloRating: elo.eloRating,
    eloHomeRating: elo.eloHomeRating,
    eloAwayRating: elo.eloAwayRating,
    matchesPlayed: elo.matchesPlayed,
  };
}

// ============================================================================
// HELPER: GET K-FACTOR FROM MODEL WEIGHTS
// ============================================================================

async function getKFactor(): Promise<number> {
  const weights = await db.modelWeights.findFirst({
    where: { isActive: true },
  });

  return weights?.eloKFactor ?? DEFAULT_K_FACTOR;
}

// ============================================================================
// BULK ELO UPDATE FOR FINISHED FIXTURES
// ============================================================================

export async function updateEloForFinishedFixtures(leagueId: number, seasonId: number): Promise<number> {
  console.log(`[ELO] Updating ELO for finished fixtures in league ${leagueId} season ${seasonId}...`);

  // Find finished fixtures that don't have TeamForm entries yet
  // (indicating they haven't been processed for ELO)
  const fixtures = await db.fixture.findMany({
    where: {
      leagueId,
      seasonId,
      status: { in: ['finished', 'FT'] },
      homeScore: { not: null },
      awayScore: { not: null },
    },
    include: {
      homeTeam: { include: { formHistory: { take: 1 } } },
    },
    orderBy: { eventDate: 'asc' },
  });

  let updated = 0;

  for (const fixture of fixtures) {
    // Check if we already have form history for this fixture (our ELO processing marker)
    const existingForm = await db.teamForm.findFirst({
      where: { fixtureId: fixture.id },
    });

    if (existingForm) continue; // Already processed

    // Determine context weight
    let contextWeight = 1.0;
    if (fixture.roundName?.toLowerCase().includes('final')) {
      contextWeight = 1.5;
    } else if (fixture.roundName?.toLowerCase().includes('semi')) {
      contextWeight = 1.3;
    }

    await updateEloAfterMatch(
      fixture.homeTeamId,
      fixture.awayTeamId,
      fixture.homeScore!,
      fixture.awayScore!,
      leagueId,
      seasonId,
      contextWeight,
    );

    updated++;
  }

  console.log(`[ELO] Updated ELO for ${updated} fixtures`);
  return updated;
}
