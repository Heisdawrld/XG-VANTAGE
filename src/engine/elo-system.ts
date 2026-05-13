// ELO Rating System with context weighting
// Separate home/away ratings, team-specific home advantage

import { db } from '@/lib/db';

const DEFAULT_ELO = 1500;
const DEFAULT_K = 32;
const HOME_ADVANTAGE_ELO = 65; // Base home advantage in ELO points

interface EloUpdate {
  teamId: number;
  newRating: number;
  newHomeRating: number;
  newAwayRating: number;
}

export async function initializeElo(teamId: number, leagueId?: number, seasonId?: number): Promise<void> {
  const existing = await db.teamELO.findFirst({
    where: { teamId, leagueId: leagueId ?? null, seasonId: seasonId ?? null },
  });
  if (!existing) {
    await db.teamELO.create({
      data: {
        teamId,
        leagueId,
        seasonId,
        eloRating: DEFAULT_ELO,
        eloHomeRating: DEFAULT_ELO,
        eloAwayRating: DEFAULT_ELO,
      },
    });
  }
}

export async function getEloRating(teamId: number, leagueId?: number, seasonId?: number): Promise<{
  overall: number;
  home: number;
  away: number;
}> {
  const elo = await db.teamELO.findFirst({
    where: { teamId, leagueId: leagueId ?? null, seasonId: seasonId ?? null },
  });
  return {
    overall: elo?.eloRating ?? DEFAULT_ELO,
    home: elo?.eloHomeRating ?? DEFAULT_ELO,
    away: elo?.eloAwayRating ?? DEFAULT_ELO,
  };
}

export async function updateEloAfterMatch(
  homeTeamId: number,
  awayTeamId: number,
  homeGoals: number,
  awayGoals: number,
  leagueId?: number,
  seasonId?: number
): Promise<{ home: EloUpdate; away: EloUpdate }> {
  // Get current ratings
  const homeElo = await getEloRating(homeTeamId, leagueId, seasonId);
  const awayElo = await getEloRating(awayTeamId, leagueId, seasonId);

  // Get team-specific home advantage
  const homeDna = await db.teamDNA.findUnique({ where: { teamId: homeTeamId } });
  const homeAdvantage = homeDna?.homeAdvantageCoefficient ?? 0.2;
  const homeBonusElo = homeAdvantage * 325; // Scale: 0.2 * 325 = 65 ELO points (standard)

  // Calculate expected scores
  const homeExpected = 1 / (1 + Math.pow(10, (awayElo.away - homeElo.home - homeBonusElo) / 400));
  const awayExpected = 1 - homeExpected;

  // Determine actual result
  let homeActual: number, awayActual: number;
  if (homeGoals > awayGoals) {
    homeActual = 1;
    awayActual = 0;
  } else if (homeGoals === awayGoals) {
    homeActual = 0.5;
    awayActual = 0.5;
  } else {
    homeActual = 0;
    awayActual = 1;
  }

  // Goal difference multiplier
  const goalDiff = Math.abs(homeGoals - awayGoals);
  const kMultiplier = goalDiff <= 1 ? 1 : goalDiff === 2 ? 1.3 : 1.5 + (goalDiff - 3) * 0.1;

  // Context weighting: check motivation level
  let contextMultiplier = 1;
  if (leagueId) {
    const homeStanding = await db.standing.findFirst({
      where: { teamId: homeTeamId, leagueId },
    });
    const awayStanding = await db.standing.findFirst({
      where: { teamId: awayTeamId, leagueId },
    });
    // Title deciders and relegation battles count more
    const homeMotivation = homeStanding ? getEloMotivationWeight(homeStanding.position) : 1;
    const awayMotivation = awayStanding ? getEloMotivationWeight(awayStanding.position) : 1;
    contextMultiplier = (homeMotivation + awayMotivation) / 2;
  }

  const K = DEFAULT_K * kMultiplier * contextMultiplier;

  // Calculate new overall ratings
  const homeRatingChange = K * (homeActual - homeExpected);
  const awayRatingChange = K * (awayActual - awayExpected);

  const newHomeOverall = homeElo.overall + homeRatingChange;
  const newHomeHome = homeElo.home + homeRatingChange * 1.2; // Home rating changes more for home matches
  const newHomeAway = homeElo.away + homeRatingChange * 0.3; // Away rating barely affected by home match

  const newAwayOverall = awayElo.overall + awayRatingChange;
  const newAwayHome = awayElo.home + awayRatingChange * 0.3;
  const newAwayAway = awayElo.away + awayRatingChange * 1.2;

  // Upsert to database
  await db.teamELO.upsert({
    where: { teamId_leagueId_seasonId: { teamId: homeTeamId, leagueId: leagueId ?? 0, seasonId: seasonId ?? 0 } },
    create: {
      teamId: homeTeamId,
      leagueId,
      seasonId,
      eloRating: newHomeOverall,
      eloHomeRating: newHomeHome,
      eloAwayRating: newHomeAway,
      matchesPlayed: 1,
      lastMatchDate: new Date(),
    },
    update: {
      eloRating: newHomeOverall,
      eloHomeRating: newHomeHome,
      eloAwayRating: newHomeAway,
      matchesPlayed: { increment: 1 },
      lastMatchDate: new Date(),
    },
  });

  await db.teamELO.upsert({
    where: { teamId_leagueId_seasonId: { teamId: awayTeamId, leagueId: leagueId ?? 0, seasonId: seasonId ?? 0 } },
    create: {
      teamId: awayTeamId,
      leagueId,
      seasonId,
      eloRating: newAwayOverall,
      eloHomeRating: newAwayHome,
      eloAwayRating: newAwayAway,
      matchesPlayed: 1,
      lastMatchDate: new Date(),
    },
    update: {
      eloRating: newAwayOverall,
      eloHomeRating: newAwayHome,
      eloAwayRating: newAwayAway,
      matchesPlayed: { increment: 1 },
      lastMatchDate: new Date(),
    },
  });

  return {
    home: {
      teamId: homeTeamId,
      newRating: newHomeOverall,
      newHomeRating: newHomeHome,
      newAwayRating: newHomeAway,
    },
    away: {
      teamId: awayTeamId,
      newRating: newAwayOverall,
      newHomeRating: newAwayHome,
      newAwayRating: newAwayAway,
    },
  };
}

function getEloMotivationWeight(position: number): number {
  if (position <= 1) return 1.3;   // Title race
  if (position <= 4) return 1.2;   // Champions League
  if (position <= 6) return 1.1;   // Europa
  if (position >= 17) return 1.25; // Relegation
  if (position >= 14) return 1.05; // Near danger
  return 0.9; // Mid-table comfort
}

/** Recalculate ELO for all finished matches in a league */
export async function recalcLeagueElo(leagueId: number, seasonId?: number): Promise<void> {
  const season = seasonId ?? (await db.season.findFirst({ where: { leagueId, isCurrent: true } }))?.id;
  if (!season) return;

  const fixtures = await db.fixture.findMany({
    where: {
      leagueId,
      seasonId: season,
      status: 'finished',
      homeScore: { not: null },
      awayScore: { not: null },
    },
    orderBy: { eventDate: 'asc' },
  });

  // Reset all team ELOs
  const teamIds = new Set<number>();
  fixtures.forEach(f => { teamIds.add(f.homeTeamId); teamIds.add(f.awayTeamId); });
  for (const tid of teamIds) {
    await db.teamELO.upsert({
      where: { teamId_leagueId_seasonId: { teamId: tid, leagueId, seasonId: season } },
      create: { teamId: tid, leagueId, seasonId: season, eloRating: DEFAULT_ELO, eloHomeRating: DEFAULT_ELO, eloAwayRating: DEFAULT_ELO },
      update: { eloRating: DEFAULT_ELO, eloHomeRating: DEFAULT_ELO, eloAwayRating: DEFAULT_ELO, matchesPlayed: 0 },
    });
  }

  // Process matches chronologically
  for (const f of fixtures) {
    if (f.homeScore !== null && f.awayScore !== null) {
      await updateEloAfterMatch(f.homeTeamId, f.awayTeamId, f.homeScore, f.awayScore, leagueId, season);
    }
  }

  console.log(`[ELO] Recalculated ELO for league ${leagueId}, ${fixtures.length} matches processed`);
}
