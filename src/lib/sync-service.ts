// xG-Vantage — Data Sync Service
// Syncs data from BSD API into our Prisma database
// Uses upsert to avoid duplicates, handles pagination, logs progress

import { bsdClient } from '@/lib/bsd-client';
import type {
  BSDFixture,
  BSDLeague,
  BSDIncident,
  BSDOdds,
  BSDLineup,
  BSDPlayerStat,
  BSDEventStats,
  BSDStanding,
  BSDStandingEntry,
  BSDManager,
  BSDSquadPlayer,
} from '@/lib/bsd-client';
import { db } from '@/lib/db';

// ============================================================================
// SYNC LEAGUES
// ============================================================================

export async function syncLeagues(): Promise<{ leagues: number; seasons: number }> {
  console.log('[Sync] Starting league sync...');
  let leagueCount = 0;
  let seasonCount = 0;

  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const response = await bsdClient.getLeagues({ is_active: true, limit, offset });
    console.log(`[Sync] Fetched ${response.results.length} leagues (offset: ${offset})`);

    for (const league of response.results) {
      await upsertLeague(league);
      leagueCount++;

      // Upsert seasons
      if (league.seasons && league.seasons.length > 0) {
        for (const season of league.seasons) {
          await db.season.upsert({
            where: { id: season.id },
            update: {
              name: season.name,
              year: parseInt(season.year, 10) || 0,
              startDate: season.start_date ? new Date(season.start_date) : null,
              endDate: season.end_date ? new Date(season.end_date) : null,
              isCurrent: season.is_current,
              leagueId: league.id,
            },
            create: {
              id: season.id,
              name: season.name,
              year: parseInt(season.year, 10) || 0,
              startDate: season.start_date ? new Date(season.start_date) : null,
              endDate: season.end_date ? new Date(season.end_date) : null,
              isCurrent: season.is_current,
              leagueId: league.id,
            },
          });
          seasonCount++;
        }
      }

      // Update league's currentSeasonId
      if (league.current_season) {
        await db.league.update({
          where: { id: league.id },
          data: { currentSeasonId: league.current_season.id },
        });
      }
    }

    if (response.next) {
      offset += limit;
    } else {
      hasMore = false;
    }
  }

  console.log(`[Sync] League sync complete: ${leagueCount} leagues, ${seasonCount} seasons`);
  return { leagues: leagueCount, seasons: seasonCount };
}

async function upsertLeague(league: BSDLeague): Promise<void> {
  await db.league.upsert({
    where: { id: league.id },
    update: {
      name: league.name,
      country: league.country?.name ?? '',
      isActive: league.is_active,
      isWomen: league.is_women,
    },
    create: {
      id: league.id,
      name: league.name,
      country: league.country?.name ?? '',
      isActive: league.is_active,
      isWomen: league.is_women,
    },
  });
}

// ============================================================================
// SYNC STANDINGS
// ============================================================================

export async function syncStandings(leagueId: number): Promise<{ standings: number }> {
  console.log(`[Sync] Starting standings sync for league ${leagueId}...`);
  let standingsCount = 0;

  const standingData = await bsdClient.getLeagueStandings(leagueId);

  for (const group of standingData.standings) {
    for (const entry of group.table) {
      // Ensure team exists first
      await db.team.upsert({
        where: { id: entry.team_id },
        update: { name: entry.team_name },
        create: { id: entry.team_id, name: entry.team_name },
      });

      await db.standing.upsert({
        where: {
          leagueId_seasonId_teamId: {
            leagueId: standingData.league_id,
            seasonId: standingData.season_id,
            teamId: entry.team_id,
          },
        },
        update: {
          position: entry.position,
          played: entry.played,
          won: entry.won,
          drawn: entry.drawn,
          lost: entry.lost,
          gf: entry.gf,
          ga: entry.ga,
          gd: entry.gd,
          pts: entry.pts,
          xgf: entry.xgf,
          xga: entry.xga,
          xgd: entry.xgd,
          xgGames: entry.xg_games,
          form: entry.form,
          isLive: entry.is_live,
        },
        create: {
          leagueId: standingData.league_id,
          seasonId: standingData.season_id,
          teamId: entry.team_id,
          position: entry.position,
          played: entry.played,
          won: entry.won,
          drawn: entry.drawn,
          lost: entry.lost,
          gf: entry.gf,
          ga: entry.ga,
          gd: entry.gd,
          pts: entry.pts,
          xgf: entry.xgf,
          xga: entry.xga,
          xgd: entry.xgd,
          xgGames: entry.xg_games,
          form: entry.form,
          isLive: entry.is_live,
        },
      });
      standingsCount++;
    }
  }

  console.log(`[Sync] Standings sync complete for league ${leagueId}: ${standingsCount} entries`);
  return { standings: standingsCount };
}

// ============================================================================
// SYNC FIXTURES
// ============================================================================

interface SyncFixturesParams {
  leagueId?: number;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  fetchDetails?: boolean; // Whether to also fetch stats, incidents, odds, lineups, player stats
}

export async function syncFixtures(params: SyncFixturesParams = {}): Promise<{ fixtures: number; details: number }> {
  console.log(`[Sync] Starting fixture sync with params:`, params);
  let fixtureCount = 0;
  let detailCount = 0;

  let offset = 0;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    const response = await bsdClient.getEvents({
      league_id: params.leagueId,
      status: params.status,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      limit,
      offset,
    });
    console.log(`[Sync] Fetched ${response.results.length} fixtures (offset: ${offset})`);

    for (const fixture of response.results) {
      await upsertFixture(fixture);
      fixtureCount++;

      // For finished matches, fetch and store detailed data
      const shouldFetchDetails = params.fetchDetails !== false && (fixture.status === 'finished' || fixture.status === 'FT');
      if (shouldFetchDetails) {
        try {
          await syncFixtureDetails(fixture.id);
          detailCount++;
        } catch (error) {
          console.error(`[Sync] Error fetching details for fixture ${fixture.id}:`, error);
        }
      }
    }

    if (response.next) {
      offset += limit;
    } else {
      hasMore = false;
    }
  }

  console.log(`[Sync] Fixture sync complete: ${fixtureCount} fixtures, ${detailCount} with details`);
  return { fixtures: fixtureCount, details: detailCount };
}

async function upsertFixture(fixture: BSDFixture): Promise<void> {
  // Ensure teams exist
  await db.team.upsert({
    where: { id: fixture.home_team.id },
    update: { name: fixture.home_team.name, shortName: fixture.home_team.short_name ?? '', country: fixture.home_team.country?.name ?? '' },
    create: { id: fixture.home_team.id, name: fixture.home_team.name, shortName: fixture.home_team.short_name ?? '', country: fixture.home_team.country?.name ?? '' },
  });

  await db.team.upsert({
    where: { id: fixture.away_team.id },
    update: { name: fixture.away_team.name, shortName: fixture.away_team.short_name ?? '', country: fixture.away_team.country?.name ?? '' },
    create: { id: fixture.away_team.id, name: fixture.away_team.name, shortName: fixture.away_team.short_name ?? '', country: fixture.away_team.country?.name ?? '' },
  });

  await db.fixture.upsert({
    where: { id: fixture.id },
    update: {
      leagueId: fixture.league.id,
      seasonId: fixture.season?.id ?? null,
      homeTeamId: fixture.home_team.id,
      awayTeamId: fixture.away_team.id,
      homeCoachId: fixture.home_coach?.id ?? null,
      awayCoachId: fixture.away_coach?.id ?? null,
      refereeId: fixture.referee?.id ?? null,
      venueId: fixture.venue?.id ?? null,
      eventDate: new Date(fixture.event_date),
      status: fixture.status,
      roundNumber: fixture.round_number,
      roundName: fixture.round_name ?? '',
      groupName: fixture.group_name ?? null,
      period: fixture.period ?? null,
      currentMinute: fixture.current_minute ?? null,
      homeScore: fixture.home_score ?? null,
      awayScore: fixture.away_score ?? null,
      homeScoreHt: fixture.home_score_ht ?? null,
      awayScoreHt: fixture.away_score_ht ?? null,
      penaltyShootout: fixture.penalty_shootout ?? null,
      extraTimeScore: fixture.extra_time_score ?? null,
      isLocalDerby: fixture.is_local_derby,
      isNeutralGround: fixture.is_neutral_ground,
      weatherCode: fixture.weather_code ?? null,
      weatherDesc: fixture.weather_desc ?? null,
      windSpeed: fixture.wind_speed ?? null,
      temperatureC: fixture.temperature_c ?? null,
      pitchCondition: fixture.pitch_condition ?? null,
      attendance: fixture.attendance ?? null,
      liveWebsocket: fixture.live_websocket,
      lastSyncedAt: new Date(),
    },
    create: {
      id: fixture.id,
      leagueId: fixture.league.id,
      seasonId: fixture.season?.id ?? null,
      homeTeamId: fixture.home_team.id,
      awayTeamId: fixture.away_team.id,
      homeCoachId: fixture.home_coach?.id ?? null,
      awayCoachId: fixture.away_coach?.id ?? null,
      refereeId: fixture.referee?.id ?? null,
      venueId: fixture.venue?.id ?? null,
      eventDate: new Date(fixture.event_date),
      status: fixture.status,
      roundNumber: fixture.round_number,
      roundName: fixture.round_name ?? '',
      groupName: fixture.group_name ?? null,
      period: fixture.period ?? null,
      currentMinute: fixture.current_minute ?? null,
      homeScore: fixture.home_score ?? null,
      awayScore: fixture.away_score ?? null,
      homeScoreHt: fixture.home_score_ht ?? null,
      awayScoreHt: fixture.away_score_ht ?? null,
      penaltyShootout: fixture.penalty_shootout ?? null,
      extraTimeScore: fixture.extra_time_score ?? null,
      isLocalDerby: fixture.is_local_derby,
      isNeutralGround: fixture.is_neutral_ground,
      weatherCode: fixture.weather_code ?? null,
      weatherDesc: fixture.weather_desc ?? null,
      windSpeed: fixture.wind_speed ?? null,
      temperatureC: fixture.temperature_c ?? null,
      pitchCondition: fixture.pitch_condition ?? null,
      attendance: fixture.attendance ?? null,
      liveWebsocket: fixture.live_websocket,
      lastSyncedAt: new Date(),
    },
  });
}

async function syncFixtureDetails(fixtureId: number): Promise<void> {
  // Fetch all detail endpoints in parallel
  const [statsResult, incidentsResult, oddsResult, lineupsResult, playerStatsResult] = await Promise.allSettled([
    bsdClient.getEventStats(fixtureId),
    bsdClient.getEventIncidents(fixtureId),
    bsdClient.getEventOdds(fixtureId),
    bsdClient.getEventLineups(fixtureId),
    bsdClient.getEventPlayerStats(fixtureId),
  ]);

  // Upsert stats
  if (statsResult.status === 'fulfilled' && statsResult.value) {
    await upsertFixtureStats(fixtureId, statsResult.value);
  }

  // Upsert incidents
  if (incidentsResult.status === 'fulfilled' && incidentsResult.value) {
    await upsertFixtureIncidents(fixtureId, incidentsResult.value);
  }

  // Upsert odds
  if (oddsResult.status === 'fulfilled' && oddsResult.value) {
    await upsertFixtureOdds(fixtureId, oddsResult.value);
  }

  // Upsert lineups
  if (lineupsResult.status === 'fulfilled' && lineupsResult.value) {
    await upsertFixtureLineup(fixtureId, lineupsResult.value);
  }

  // Upsert player stats
  if (playerStatsResult.status === 'fulfilled' && playerStatsResult.value) {
    await upsertPlayerStats(fixtureId, playerStatsResult.value);
  }
}

async function upsertFixtureStats(fixtureId: number, stats: BSDEventStats): Promise<void> {
  await db.fixtureStats.upsert({
    where: { fixtureId },
    update: {
      homeTotalShots: stats.home.total_shots,
      homeShotsOnTarget: stats.home.shots_on_target,
      homeShotsOffTarget: stats.home.shots_off_target,
      homeBlockedShots: stats.home.blocked_shots,
      homeShotsInsideBox: stats.home.shots_inside_box,
      homeShotsOutsideBox: stats.home.shots_outside_box,
      homeBigChances: stats.home.big_chances,
      homeBigChancesScored: stats.home.big_chances_scored,
      homeBigChancesMissed: stats.home.big_chances_missed,
      homeHitWoodwork: stats.home.hit_woodwork,
      homeCornerKicks: stats.home.corner_kicks,
      homeOffsides: stats.home.offsides,
      homeBallPossession: stats.home.ball_possession,
      homePassAccuracy: stats.home.pass_accuracy,
      homePasses: stats.home.passes,
      homeAccuratePasses: stats.home.accurate_passes,
      homeTotalTackles: stats.home.total_tackles,
      homeInterceptions: stats.home.interceptions,
      homeClearances: stats.home.clearances,
      homeDribblesSuccess: stats.home.dribbles_success,
      homeDribblesTotal: stats.home.dribbles_total,
      homeAerialDuelsWon: stats.home.aerial_duels_won,
      homeAerialDuelsTotal: stats.home.aerial_duels_total,
      homeFouls: stats.home.fouls,
      homeYellowCards: stats.home.yellow_cards,
      homeRedCards: stats.home.red_cards,
      homeAttacks: stats.home.attacks,
      homeDangerousAttacks: stats.home.dangerous_attacks,
      homeExpectedGoals: stats.home.expected_goals,
      homeGoalsPrevented: stats.home.goals_prevented,
      awayTotalShots: stats.away.total_shots,
      awayShotsOnTarget: stats.away.shots_on_target,
      awayShotsOffTarget: stats.away.shots_off_target,
      awayBlockedShots: stats.away.blocked_shots,
      awayShotsInsideBox: stats.away.shots_inside_box,
      awayShotsOutsideBox: stats.away.shots_outside_box,
      awayBigChances: stats.away.big_chances,
      awayBigChancesScored: stats.away.big_chances_scored,
      awayBigChancesMissed: stats.away.big_chances_missed,
      awayHitWoodwork: stats.away.hit_woodwork,
      awayCornerKicks: stats.away.corner_kicks,
      awayOffsides: stats.away.offsides,
      awayBallPossession: stats.away.ball_possession,
      awayPassAccuracy: stats.away.pass_accuracy,
      awayPasses: stats.away.passes,
      awayAccuratePasses: stats.away.accurate_passes,
      awayTotalTackles: stats.away.total_tackles,
      awayInterceptions: stats.away.interceptions,
      awayClearances: stats.away.clearances,
      awayDribblesSuccess: stats.away.dribbles_success,
      awayDribblesTotal: stats.away.dribbles_total,
      awayAerialDuelsWon: stats.away.aerial_duels_won,
      awayAerialDuelsTotal: stats.away.aerial_duels_total,
      awayFouls: stats.away.fouls,
      awayYellowCards: stats.away.yellow_cards,
      awayRedCards: stats.away.red_cards,
      awayAttacks: stats.away.attacks,
      awayDangerousAttacks: stats.away.dangerous_attacks,
      awayExpectedGoals: stats.away.expected_goals,
      awayGoalsPrevented: stats.away.goals_prevented,
    },
    create: {
      fixtureId,
      homeTotalShots: stats.home.total_shots,
      homeShotsOnTarget: stats.home.shots_on_target,
      homeShotsOffTarget: stats.home.shots_off_target,
      homeBlockedShots: stats.home.blocked_shots,
      homeShotsInsideBox: stats.home.shots_inside_box,
      homeShotsOutsideBox: stats.home.shots_outside_box,
      homeBigChances: stats.home.big_chances,
      homeBigChancesScored: stats.home.big_chances_scored,
      homeBigChancesMissed: stats.home.big_chances_missed,
      homeHitWoodwork: stats.home.hit_woodwork,
      homeCornerKicks: stats.home.corner_kicks,
      homeOffsides: stats.home.offsides,
      homeBallPossession: stats.home.ball_possession,
      homePassAccuracy: stats.home.pass_accuracy,
      homePasses: stats.home.passes,
      homeAccuratePasses: stats.home.accurate_passes,
      homeTotalTackles: stats.home.total_tackles,
      homeInterceptions: stats.home.interceptions,
      homeClearances: stats.home.clearances,
      homeDribblesSuccess: stats.home.dribbles_success,
      homeDribblesTotal: stats.home.dribbles_total,
      homeAerialDuelsWon: stats.home.aerial_duels_won,
      homeAerialDuelsTotal: stats.home.aerial_duels_total,
      homeFouls: stats.home.fouls,
      homeYellowCards: stats.home.yellow_cards,
      homeRedCards: stats.home.red_cards,
      homeAttacks: stats.home.attacks,
      homeDangerousAttacks: stats.home.dangerous_attacks,
      homeExpectedGoals: stats.home.expected_goals,
      homeGoalsPrevented: stats.home.goals_prevented,
      awayTotalShots: stats.away.total_shots,
      awayShotsOnTarget: stats.away.shots_on_target,
      awayShotsOffTarget: stats.away.shots_off_target,
      awayBlockedShots: stats.away.blocked_shots,
      awayShotsInsideBox: stats.away.shots_inside_box,
      awayShotsOutsideBox: stats.away.shots_outside_box,
      awayBigChances: stats.away.big_chances,
      awayBigChancesScored: stats.away.big_chances_scored,
      awayBigChancesMissed: stats.away.big_chances_missed,
      awayHitWoodwork: stats.away.hit_woodwork,
      awayCornerKicks: stats.away.corner_kicks,
      awayOffsides: stats.away.offsides,
      awayBallPossession: stats.away.ball_possession,
      awayPassAccuracy: stats.away.pass_accuracy,
      awayPasses: stats.away.passes,
      awayAccuratePasses: stats.away.accurate_passes,
      awayTotalTackles: stats.away.total_tackles,
      awayInterceptions: stats.away.interceptions,
      awayClearances: stats.away.clearances,
      awayDribblesSuccess: stats.away.dribbles_success,
      awayDribblesTotal: stats.away.dribbles_total,
      awayAerialDuelsWon: stats.away.aerial_duels_won,
      awayAerialDuelsTotal: stats.away.aerial_duels_total,
      awayFouls: stats.away.fouls,
      awayYellowCards: stats.away.yellow_cards,
      awayRedCards: stats.away.red_cards,
      awayAttacks: stats.away.attacks,
      awayDangerousAttacks: stats.away.dangerous_attacks,
      awayExpectedGoals: stats.away.expected_goals,
      awayGoalsPrevented: stats.away.goals_prevented,
    },
  });
}

async function upsertFixtureIncidents(fixtureId: number, incidents: BSDIncident[]): Promise<void> {
  // Delete existing incidents and re-insert (simpler than trying to deduplicate by ID)
  await db.fixtureIncident.deleteMany({ where: { fixtureId } });

  if (incidents.length === 0) return;

  await db.fixtureIncident.createMany({
    data: incidents.map((inc) => ({
      fixtureId,
      type: inc.type,
      minute: inc.minute,
      addedTime: inc.added_time ?? null,
      player: inc.player ?? null,
      playerId: inc.player_id ?? null,
      playerIn: inc.player_in ?? null,
      playerInId: inc.player_in_id ?? null,
      playerOut: inc.player_out ?? null,
      playerOutId: inc.player_out_id ?? null,
      isHome: inc.is_home ?? null,
      cardType: inc.card_type ?? null,
      goalType: inc.goal_type ?? null,
      decision: inc.decision ?? null,
      confirmed: inc.confirmed ?? null,
      homeScore: inc.home_score ?? null,
      awayScore: inc.away_score ?? null,
    })),
  });
}

async function upsertFixtureOdds(fixtureId: number, oddsData: BSDOdds): Promise<void> {
  // Extract key odds from the markets
  let homeWin: number | null = null;
  let draw: number | null = null;
  let awayWin: number | null = null;
  let over15: number | null = null;
  let over25: number | null = null;
  let over35: number | null = null;
  let under15: number | null = null;
  let under25: number | null = null;
  let under35: number | null = null;
  let bttsYes: number | null = null;
  let bttsNo: number | null = null;

  for (const market of oddsData.markets) {
    // Match result (1X2)
    if (market.key === '1x2' || market.name?.toLowerCase().includes('match result')) {
      for (const outcome of market.outcomes) {
        const name = outcome.name.toLowerCase();
        if (name === '1' || name === 'home' || name.includes('home win')) {
          homeWin = outcome.odds;
        } else if (name === 'x' || name === 'draw') {
          draw = outcome.odds;
        } else if (name === '2' || name === 'away' || name.includes('away win')) {
          awayWin = outcome.odds;
        }
      }
    }

    // Over/Under
    if (market.key?.includes('over_under') || market.name?.toLowerCase().includes('over/under')) {
      for (const outcome of market.outcomes) {
        const name = outcome.name.toLowerCase();
        if (name.includes('over 1.5') || name === 'o1.5') over15 = outcome.odds;
        if (name.includes('over 2.5') || name === 'o2.5') over25 = outcome.odds;
        if (name.includes('over 3.5') || name === 'o3.5') over35 = outcome.odds;
        if (name.includes('under 1.5') || name === 'u1.5') under15 = outcome.odds;
        if (name.includes('under 2.5') || name === 'u2.5') under25 = outcome.odds;
        if (name.includes('under 3.5') || name === 'u3.5') under35 = outcome.odds;
      }
    }

    // BTTS
    if (market.key?.includes('btts') || market.name?.toLowerCase().includes('both teams to score')) {
      for (const outcome of market.outcomes) {
        const name = outcome.name.toLowerCase();
        if (name === 'yes' || name.includes('yes')) bttsYes = outcome.odds;
        if (name === 'no' || name.includes('no')) bttsNo = outcome.odds;
      }
    }
  }

  await db.fixtureOdds.upsert({
    where: { fixtureId },
    update: {
      homeWin,
      draw,
      awayWin,
      over15Goals: over15,
      over25Goals: over25,
      over35Goals: over35,
      under15Goals: under15,
      under25Goals: under25,
      under35Goals: under35,
      bttsYes,
      bttsNo,
      observedAt: new Date(),
    },
    create: {
      fixtureId,
      homeWin,
      draw,
      awayWin,
      over15Goals: over15,
      over25Goals: over25,
      over35Goals: over35,
      under15Goals: under15,
      under25Goals: under25,
      under35Goals: under35,
      bttsYes,
      bttsNo,
      observedAt: new Date(),
    },
  });
}

async function upsertFixtureLineup(fixtureId: number, lineup: BSDLineup): Promise<void> {
  await db.fixtureLineup.upsert({
    where: { fixtureId },
    update: {
      lineupStatus: lineup.lineup_status,
      homeFormation: lineup.home.formation ?? '',
      awayFormation: lineup.away.formation ?? '',
      homePlayers: JSON.stringify(lineup.home.players ?? []),
      awayPlayers: JSON.stringify(lineup.away.players ?? []),
      homeSubstitutes: JSON.stringify(lineup.home.substitutes ?? []),
      awaySubstitutes: JSON.stringify(lineup.away.substitutes ?? []),
      homeUnavailable: JSON.stringify(lineup.home.unavailable ?? []),
      awayUnavailable: JSON.stringify(lineup.away.unavailable ?? []),
      homeConfidence: lineup.home.confidence ?? null,
      awayConfidence: lineup.away.confidence ?? null,
      updatedAt: new Date(),
    },
    create: {
      fixtureId,
      lineupStatus: lineup.lineup_status,
      homeFormation: lineup.home.formation ?? '',
      awayFormation: lineup.away.formation ?? '',
      homePlayers: JSON.stringify(lineup.home.players ?? []),
      awayPlayers: JSON.stringify(lineup.away.players ?? []),
      homeSubstitutes: JSON.stringify(lineup.home.substitutes ?? []),
      awaySubstitutes: JSON.stringify(lineup.away.substitutes ?? []),
      homeUnavailable: JSON.stringify(lineup.home.unavailable ?? []),
      awayUnavailable: JSON.stringify(lineup.away.unavailable ?? []),
      homeConfidence: lineup.home.confidence ?? null,
      awayConfidence: lineup.away.confidence ?? null,
    },
  });
}

async function upsertPlayerStats(fixtureId: number, playerStats: BSDPlayerStat[]): Promise<void> {
  // Delete existing and re-insert
  await db.playerMatchStat.deleteMany({ where: { fixtureId } });

  if (playerStats.length === 0) return;

  // Upsert players first
  for (const ps of playerStats) {
    await db.player.upsert({
      where: { id: ps.player_id },
      update: { name: ps.name, position: ps.position },
      create: { id: ps.player_id, name: ps.name, position: ps.position },
    }).catch(() => {
      // Ignore errors if player already exists with different data
    });
  }

  await db.playerMatchStat.createMany({
    data: playerStats.map((ps) => ({
      fixtureId,
      playerId: ps.player_id,
      teamId: ps.team_id,
      minutesPlayed: ps.minutes_played,
      rating: ps.rating,
      goals: ps.goals,
      goalAssist: ps.goal_assist,
      expectedGoals: ps.expected_goals,
      expectedAssists: ps.expected_assists,
      totalShots: ps.total_shots,
      shotsOnTarget: ps.shots_on_target,
      totalPass: ps.total_pass,
      accuratePass: ps.accurate_pass,
      keyPass: ps.key_pass,
      totalTackle: ps.total_tackle,
      interception: ps.interception,
      yellowCard: ps.yellow_card,
      redCard: ps.red_card,
      saves: ps.saves,
    })),
  });
}

// ============================================================================
// SYNC TEAM FIXTURES (for building Team DNA)
// ============================================================================

export async function syncTeamFixtures(teamId: number): Promise<{ fixtures: number }> {
  console.log(`[Sync] Starting team fixtures sync for team ${teamId}...`);
  let fixtureCount = 0;

  // Fetch recent fixtures — last 6 months
  const dateTo = new Date().toISOString().split('T')[0];
  const dateFrom = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let offset = 0;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    const response = await bsdClient.getTeamFixtures(teamId, {
      date_from: dateFrom,
      date_to: dateTo,
      limit,
      offset,
    });

    for (const fixture of response.results) {
      await upsertFixture(fixture);
      fixtureCount++;

      // Fetch details for finished matches
      if (fixture.status === 'finished' || fixture.status === 'FT') {
        try {
          await syncFixtureDetails(fixture.id);
        } catch (error) {
          console.error(`[Sync] Error fetching details for team fixture ${fixture.id}:`, error);
        }
      }
    }

    if (response.next) {
      offset += limit;
    } else {
      hasMore = false;
    }
  }

  console.log(`[Sync] Team fixtures sync complete for team ${teamId}: ${fixtureCount} fixtures`);
  return { fixtures: fixtureCount };
}

// ============================================================================
// SYNC MANAGERS
// ============================================================================

export async function syncManagers(params?: { leagueId?: number }): Promise<{ managers: number }> {
  console.log(`[Sync] Starting manager sync...`);
  let managerCount = 0;

  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const response = await bsdClient.getManagers({
      league_id: params?.leagueId,
      limit,
      offset,
    });
    console.log(`[Sync] Fetched ${response.results.length} managers (offset: ${offset})`);

    for (const manager of response.results) {
      await upsertManager(manager);
      managerCount++;
    }

    if (response.next) {
      offset += limit;
    } else {
      hasMore = false;
    }
  }

  console.log(`[Sync] Manager sync complete: ${managerCount} managers`);
  return { managers: managerCount };
}

async function upsertManager(manager: BSDManager): Promise<void> {
  await db.manager.upsert({
    where: { id: manager.id },
    update: {
      name: manager.name,
      shortName: manager.short_name ?? '',
      country: manager.country?.name ?? '',
      tacticalProfile: manager.tactical_profile ?? 'balanced',
      preferredFormation: manager.preferred_formation ?? '',
      currentTeamId: manager.current_team?.id ?? null,
      matchesTotal: manager.matches_total,
      wins: manager.wins,
      draws: manager.draws,
      losses: manager.losses,
      winPct: manager.win_pct,
      avgGoalsScored: manager.avg_goals_scored,
      avgGoalsConceded: manager.avg_goals_conceded,
      avgPossession: manager.avg_possession,
      cleanSheetPct: manager.clean_sheet_pct,
      bttsPct: manager.btts_pct,
      over25Pct: manager.over25_pct,
      teamStyle: manager.team_style ?? '',
      statsUpdatedAt: new Date(),
    },
    create: {
      id: manager.id,
      name: manager.name,
      shortName: manager.short_name ?? '',
      country: manager.country?.name ?? '',
      tacticalProfile: manager.tactical_profile ?? 'balanced',
      preferredFormation: manager.preferred_formation ?? '',
      currentTeamId: manager.current_team?.id ?? null,
      matchesTotal: manager.matches_total,
      wins: manager.wins,
      draws: manager.draws,
      losses: manager.losses,
      winPct: manager.win_pct,
      avgGoalsScored: manager.avg_goals_scored,
      avgGoalsConceded: manager.avg_goals_conceded,
      avgPossession: manager.avg_possession,
      cleanSheetPct: manager.clean_sheet_pct,
      bttsPct: manager.btts_pct,
      over25Pct: manager.over25_pct,
      teamStyle: manager.team_style ?? '',
    },
  });
}
