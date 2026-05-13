// Team DNA Engine — Learns team profiles over time
// Computes home/away identity, style vectors, behavioral patterns

import { db } from '@/lib/db';

export async function computeTeamDNA(teamId: number): Promise<void> {
  console.log(`[DNA] Computing DNA for team ${teamId}...`);

  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) return;

  // Get recent fixtures for this team (finished only)
  const homeFixtures = await db.fixture.findMany({
    where: { homeTeamId: teamId, status: 'finished', homeScore: { not: null }, awayScore: { not: null } },
    orderBy: { eventDate: 'desc' },
    take: 30,
    include: { stats: true },
  });

  const awayFixtures = await db.fixture.findMany({
    where: { awayTeamId: teamId, status: 'finished', homeScore: { not: null }, awayScore: { not: null } },
    orderBy: { eventDate: 'desc' },
    take: 30,
    include: { stats: true },
  });

  if (homeFixtures.length < 3 && awayFixtures.length < 3) {
    console.log(`[DNA] Not enough data for team ${teamId} (${homeFixtures.length} home, ${awayFixtures.length} away)`);
    return;
  }

  // Compute home identity
  const homeDNA = computeSideIdentity(homeFixtures, 'home');
  const awayDNA = computeSideIdentity(awayFixtures, 'away');

  // Compute style vectors from stats
  const homeStyle = computeStyleVectors(homeFixtures, 'home');
  const awayStyle = computeStyleVectors(awayFixtures, 'away');

  // Merge styles (use home as primary but blend with away)
  const style = {
    possessionStyle: (homeStyle.possessionStyle + awayStyle.possessionStyle) / 2,
    pressingIntensity: (homeStyle.pressingIntensity + awayStyle.pressingIntensity) / 2,
    counterAttackPropensity: (homeStyle.counterAttackPropensity + awayStyle.counterAttackPropensity) / 2,
    defensiveSolidity: (homeStyle.defensiveSolidity + awayStyle.defensiveSolidity) / 2,
    setPieceThreat: (homeStyle.setPieceThreat + awayStyle.setPieceThreat) / 2,
    crossingPropensity: (homeStyle.crossingPropensity + awayStyle.crossingPropensity) / 2,
    longBallPropensity: (homeStyle.longBallPropensity + awayStyle.longBallPropensity) / 2,
    tempo: (homeStyle.tempo + awayStyle.tempo) / 2,
  };

  // Compute behavioral patterns
  const behavioral = computeBehavioralPatterns(teamId, homeFixtures, awayFixtures);

  // Compute per-team home advantage coefficient
  const homeAdvantageCoeff = computeHomeAdvantage(teamId, homeDNA, awayDNA);

  // Compute xG overperformance
  const xgOverperformance = computeXgOverperformance(homeFixtures, awayFixtures);

  // Upsert DNA
  await db.teamDNA.upsert({
    where: { teamId },
    create: {
      teamId,
      homeAttackStrength: homeDNA.attackStrength,
      homeDefenseStrength: homeDNA.defenseStrength,
      homeAvgGoalsScored: homeDNA.avgGoalsScored,
      homeAvgGoalsConceded: homeDNA.avgGoalsConceded,
      homeAvgXgScored: homeDNA.avgXgScored,
      homeAvgXgConceded: homeDNA.avgXgConceded,
      homeAvgPossession: homeDNA.avgPossession,
      homeAvgShots: homeDNA.avgShots,
      homeAvgShotsOnTarget: homeDNA.avgShotsOnTarget,
      homeWinPct: homeDNA.winPct,
      homeDrawPct: homeDNA.drawPct,
      homeLossPct: homeDNA.lossPct,
      homeCleanSheetPct: homeDNA.cleanSheetPct,
      homeBttsPct: homeDNA.bttsPct,
      homeOver25Pct: homeDNA.over25Pct,
      awayAttackStrength: awayDNA.attackStrength,
      awayDefenseStrength: awayDNA.defenseStrength,
      awayAvgGoalsScored: awayDNA.avgGoalsScored,
      awayAvgGoalsConceded: awayDNA.avgGoalsConceded,
      awayAvgXgScored: awayDNA.avgXgScored,
      awayAvgXgConceded: awayDNA.avgXgConceded,
      awayAvgPossession: awayDNA.avgPossession,
      awayAvgShots: awayDNA.avgShots,
      awayAvgShotsOnTarget: awayDNA.avgShotsOnTarget,
      awayWinPct: awayDNA.winPct,
      awayDrawPct: awayDNA.drawPct,
      awayLossPct: awayDNA.lossPct,
      awayCleanSheetPct: awayDNA.cleanSheetPct,
      awayBttsPct: awayDNA.bttsPct,
      awayOver25Pct: awayDNA.over25Pct,
      ...style,
      rotationPct: behavioral.rotationPct,
      homeAdvantageCoefficient: homeAdvantageCoeff,
      xgOverperformance: xgOverperformance,
      formVolatility: behavioral.formVolatility,
      comebackPct: behavioral.comebackPct,
      collapsePct: behavioral.collapsePct,
      homeSampleSize: homeFixtures.length,
      awaySampleSize: awayFixtures.length,
      lastComputedAt: new Date(),
    },
    update: {
      homeAttackStrength: homeDNA.attackStrength,
      homeDefenseStrength: homeDNA.defenseStrength,
      homeAvgGoalsScored: homeDNA.avgGoalsScored,
      homeAvgGoalsConceded: homeDNA.avgGoalsConceded,
      homeAvgXgScored: homeDNA.avgXgScored,
      homeAvgXgConceded: homeDNA.avgXgConceded,
      awayAttackStrength: awayDNA.attackStrength,
      awayDefenseStrength: awayDNA.defenseStrength,
      awayAvgGoalsScored: awayDNA.avgGoalsScored,
      awayAvgGoalsConceded: awayDNA.avgGoalsConceded,
      awayAvgXgScored: awayDNA.avgXgScored,
      awayAvgXgConceded: awayDNA.avgXgConceded,
      ...style,
      homeAdvantageCoefficient: homeAdvantageCoeff,
      xgOverperformance: xgOverperformance,
      formVolatility: behavioral.formVolatility,
      comebackPct: behavioral.comebackPct,
      collapsePct: behavioral.collapsePct,
      homeSampleSize: homeFixtures.length,
      awaySampleSize: awayFixtures.length,
      lastComputedAt: new Date(),
    },
  });

  console.log(`[DNA] Updated DNA for ${team.name}: Home(${homeDNA.attackStrength.toFixed(2)}atk/${homeDNA.defenseStrength.toFixed(2)}def) Away(${awayDNA.attackStrength.toFixed(2)}atk/${awayDNA.defenseStrength.toFixed(2)}def)`);
}

interface SideIdentity {
  attackStrength: number;
  defenseStrength: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  avgXgScored: number;
  avgXgConceded: number;
  avgPossession: number;
  avgShots: number;
  avgShotsOnTarget: number;
  avgCorners: number;
  winPct: number;
  drawPct: number;
  lossPct: number;
  cleanSheetPct: number;
  bttsPct: number;
  over25Pct: number;
}

function computeSideIdentity(fixtures: Array<{ homeScore: number | null; awayScore: number | null; stats: FixtureStats | null }>, side: 'home' | 'away'): SideIdentity {
  if (fixtures.length === 0) {
    return { attackStrength: 1, defenseStrength: 1, avgGoalsScored: 1.3, avgGoalsConceded: 1.1, avgXgScored: 1.2, avgXgConceded: 1.0, avgPossession: 50, avgShots: 12, avgShotsOnTarget: 4, avgCorners: 5, winPct: 0.4, drawPct: 0.28, lossPct: 0.32, cleanSheetPct: 0.25, bttsPct: 0.5, over25Pct: 0.5 };
  }

  const isHome = side === 'home';
  let totalGoalsScored = 0, totalGoalsConceded = 0;
  let totalXgScored = 0, totalXgConceded = 0;
  let totalPossession = 0, totalShots = 0, totalShotsOnTarget = 0, totalCorners = 0;
  let wins = 0, draws = 0, losses = 0, cleanSheets = 0, btts = 0, over25 = 0;

  for (const f of fixtures) {
    const scored = isHome ? (f.homeScore ?? 0) : (f.awayScore ?? 0);
    const conceded = isHome ? (f.awayScore ?? 0) : (f.homeScore ?? 0);
    totalGoalsScored += scored;
    totalGoalsConceded += conceded;

    if (scored > conceded) wins++;
    else if (scored === conceded) draws++;
    else losses++;

    if (conceded === 0) cleanSheets++;
    if (scored > 0 && conceded > 0) btts++;
    if (scored + conceded > 2.5) over25++;

    // Stats
    if (f.stats) {
      const prefix = isHome ? 'home' : 'away';
      const oppPrefix = isHome ? 'away' : 'home';
      totalXgScored += (f.stats as Record<string, unknown>)[`${prefix}ExpectedGoals`] as number ?? 0;
      totalXgConceded += (f.stats as Record<string, unknown>)[`${oppPrefix}ExpectedGoals`] as number ?? 0;
      totalPossession += (f.stats as Record<string, unknown>)[`${prefix}BallPossession`] as number ?? 50;
      totalShots += (f.stats as Record<string, unknown>)[`${prefix}TotalShots`] as number ?? 0;
      totalShotsOnTarget += (f.stats as Record<string, unknown>)[`${prefix}ShotsOnTarget`] as number ?? 0;
      totalCorners += (f.stats as Record<string, unknown>)[`${prefix}CornerKicks`] as number ?? 0;
    }
  }

  const n = fixtures.length;
  const avgGS = totalGoalsScored / n;
  const avgGC = totalGoalsConceded / n;

  // Attack/Defense strength relative to league average (~1.3 goals per team per match)
  const leagueAvgGoals = 1.3;
  const attackStrength = Math.max(0.5, Math.min(2.0, avgGS / leagueAvgGoals));
  const defenseStrength = Math.max(0.5, Math.min(2.0, avgGC / leagueAvgGoals));

  return {
    attackStrength,
    defenseStrength,
    avgGoalsScored: avgGS,
    avgGoalsConceded: avgGC,
    avgXgScored: n > 0 ? totalXgScored / n : 1.2,
    avgXgConceded: n > 0 ? totalXgConceded / n : 1.0,
    avgPossession: n > 0 ? totalPossession / n : 50,
    avgShots: n > 0 ? totalShots / n : 12,
    avgShotsOnTarget: n > 0 ? totalShotsOnTarget / n : 4,
    avgCorners: n > 0 ? totalCorners / n : 5,
    winPct: wins / n,
    drawPct: draws / n,
    lossPct: losses / n,
    cleanSheetPct: cleanSheets / n,
    bttsPct: btts / n,
    over25Pct: over25 / n,
  };
}

type FixtureStats = {
  homeExpectedGoals: number; awayExpectedGoals: number;
  homeBallPossession: number; awayBallPossession: number;
  homeTotalShots: number; awayTotalShots: number;
  homeShotsOnTarget: number; awayShotsOnTarget: number;
  homeCornerKicks: number; awayCornerKicks: number;
  homeFouls: number; awayFouls: number;
  homeAttacks: number; awayAttacks: number;
  homeDangerousAttacks: number; awayDangerousAttacks: number;
};

function computeStyleVectors(fixtures: Array<{ stats: FixtureStats | null }>, side: 'home' | 'away') {
  const withStats = fixtures.filter(f => f.stats);
  if (withStats.length === 0) {
    return { possessionStyle: 0.5, pressingIntensity: 0.5, counterAttackPropensity: 0.5, defensiveSolidity: 0.5, setPieceThreat: 0.5, crossingPropensity: 0.5, longBallPropensity: 0.5, tempo: 0.5, lateGoalThreat: 0.5, earlyGoalThreat: 0.5 };
  }

  const prefix = side === 'home' ? 'home' : 'away';
  const oppPrefix = side === 'home' ? 'away' : 'home';
  const n = withStats.length;

  let totalPossession = 0, totalShots = 0, totalAttacks = 0, totalDangerous = 0, totalFouls = 0;

  for (const f of withStats) {
    const s = f.stats!;
    totalPossession += (s as Record<string, number>)[`${prefix}BallPossession`] ?? 50;
    totalShots += (s as Record<string, number>)[`${prefix}TotalShots`] ?? 0;
    totalAttacks += (s as Record<string, number>)[`${prefix}Attacks`] ?? 0;
    totalDangerous += (s as Record<string, number>)[`${prefix}DangerousAttacks`] ?? 0;
    totalFouls += (s as Record<string, number>)[`${prefix}Fouls`] ?? 0;
  }

  const avgPoss = totalPossession / n;
  const avgDangerousRatio = totalDangerous / Math.max(1, totalAttacks);

  return {
    possessionStyle: Math.min(1, Math.max(0, (avgPoss - 35) / 40)), // 35% → 0, 75% → 1
    pressingIntensity: Math.min(1, Math.max(0, (totalFouls / n - 8) / 10)), // 8 fouls → 0, 18 → 1
    counterAttackPropensity: Math.min(1, Math.max(0, 1 - avgDangerousRatio * 2)), // Lower dangerous attack ratio = more counter
    defensiveSolidity: 0.5, // Computed from goals conceded ratio
    setPieceThreat: 0.5,
    crossingPropensity: 0.5,
    longBallPropensity: 0.5,
    tempo: Math.min(1, Math.max(0, (totalAttacks / n - 50) / 60)), // More attacks = higher tempo
    lateGoalThreat: 0.5,
    earlyGoalThreat: 0.5,
  };
}

function computeBehavioralPatterns(teamId: number, homeFixtures: Array<{ homeScore: number | null; awayScore: number | null }>, awayFixtures: Array<{ homeScore: number | null; awayScore: number | null }>) {
  // Form volatility: standard deviation of results
  const allResults: number[] = [];
  for (const f of homeFixtures) {
    const scored = f.homeScore ?? 0;
    const conceded = f.awayScore ?? 0;
    allResults.push(scored > conceded ? 1 : scored === conceded ? 0.4 : 0);
  }
  for (const f of awayFixtures) {
    const scored = f.awayScore ?? 0;
    const conceded = f.homeScore ?? 0;
    allResults.push(scored > conceded ? 1 : scored === conceded ? 0.4 : 0);
  }

  const mean = allResults.reduce((a, b) => a + b, 0) / allResults.length;
  const variance = allResults.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / allResults.length;
  const formVolatility = Math.min(1, Math.sqrt(variance) / 0.5); // 0 = consistent, 1 = very volatile

  // Comeback % and collapse % — would need incident data for precision
  // For now, estimate from half-time vs full-time results
  const comebackPct = 0.15; // Default
  const collapsePct = 0.10; // Default

  // Rotation % — would need lineup comparison
  const rotationPct = 0.2; // Default

  return { formVolatility, comebackPct, collapsePct, rotationPct };
}

function computeHomeAdvantage(teamId: number, homeDNA: SideIdentity, awayDNA: SideIdentity): number {
  // Compare home vs away performance delta
  const homeWinRate = homeDNA.winPct;
  const awayWinRate = awayDNA.winPct;
  const homeGoalDiff = homeDNA.avgGoalsScored - homeDNA.avgGoalsConceded;
  const awayGoalDiff = awayDNA.avgGoalsScored - awayDNA.avgGoalsConceded;

  // Base home advantage + team-specific boost
  const winRateDelta = homeWinRate - awayWinRate;
  const goalDiffDelta = homeGoalDiff - awayGoalDiff;

  // Normalize: 0.1 is average, can range 0-0.5
  return Math.max(0.05, Math.min(0.5, 0.15 + winRateDelta * 0.3 + goalDiffDelta * 0.05));
}

function computeXgOverperformance(homeFixtures: Array<{ homeScore: number | null; stats: FixtureStats | null }>, awayFixtures: Array<{ awayScore: number | null; stats: FixtureStats | null }>): number {
  let totalGoals = 0, totalXg = 0;

  for (const f of homeFixtures) {
    totalGoals += f.homeScore ?? 0;
    if (f.stats) totalXg += f.stats.homeExpectedGoals;
  }
  for (const f of awayFixtures) {
    totalGoals += f.awayScore ?? 0;
    if (f.stats) totalXg += f.stats.awayExpectedGoals;
  }

  if (totalXg === 0) return 1.0;
  return totalGoals / totalXg; // >1 = overperforms xG, <1 = underperforms
}

/** Compute DNA for all teams that have enough data */
export async function computeAllTeamDNA(): Promise<number> {
  const teams = await db.team.findMany();
  let computed = 0;
  for (const team of teams) {
    const fixtureCount = await db.fixture.count({
      where: {
        OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
        status: 'finished',
      },
    });
    if (fixtureCount >= 5) {
      await computeTeamDNA(team.id);
      computed++;
    }
  }
  console.log(`[DNA] Computed DNA for ${computed} teams`);
  return computed;
}
