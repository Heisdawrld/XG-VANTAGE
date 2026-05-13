// Data Sync Service — Pulls data from BSD API into our database

import { bsdClient } from '@/lib/bsd-client';
import { db } from '@/lib/db';

export async function syncLeagues(): Promise<number> {
  console.log('[Sync] Syncing leagues...');
  let synced = 0;
  let offset = 0;
  const limit = 200;

  while (true) {
    const data = await bsdClient.getLeagues({ limit, offset });
    for (const league of data.results) {
      await db.league.upsert({
        where: { id: league.id },
        create: {
          id: league.id,
          name: league.name,
          country: league.country,
          isWomen: league.is_women,
          isActive: league.is_active,
          currentSeasonId: league.current_season?.id,
        },
        update: {
          name: league.name,
          country: league.country,
          isWomen: league.is_women,
          isActive: league.is_active,
          currentSeasonId: league.current_season?.id,
        },
      });

      // Sync current season
      if (league.current_season) {
        await db.season.upsert({
          where: { id: league.current_season.id },
          create: {
            id: league.current_season.id,
            leagueId: league.id,
            name: league.current_season.name,
            year: league.current_season.year,
            startDate: league.current_season.start_date ? new Date(league.current_season.start_date) : null,
            endDate: league.current_season.end_date ? new Date(league.current_season.end_date) : null,
            isCurrent: league.current_season.is_current,
          },
          update: {
            name: league.current_season.name,
            isCurrent: league.current_season.is_current,
          },
        });
      }
      synced++;
    }
    if (!data.next || data.results.length < limit) break;
    offset += limit;
  }
  console.log(`[Sync] Synced ${synced} leagues`);
  return synced;
}

export async function syncStandings(leagueId: number): Promise<number> {
  console.log(`[Sync] Syncing standings for league ${leagueId}...`);
  try {
    const data = await bsdClient.getLeagueStandings(leagueId);
    let synced = 0;

    // Upsert season
    if (data.season) {
      await db.season.upsert({
        where: { id: data.season.id },
        create: {
          id: data.season.id,
          leagueId,
          name: data.season.name,
          year: parseInt(data.season.name.match(/\d{4}/)?.[0] || '2025'),
          isCurrent: true,
        },
        update: { name: data.season.name },
      });
    }

    for (const s of data.standings) {
      // Ensure team exists
      await db.team.upsert({
        where: { id: s.team_id },
        create: { id: s.team_id, name: s.team_name },
        update: { name: s.team_name },
      });

      await db.standing.upsert({
        where: {
          leagueId_seasonId_teamId: {
            leagueId,
            seasonId: data.season?.id ?? 0,
            teamId: s.team_id,
          },
        },
        create: {
          leagueId,
          seasonId: data.season?.id ?? 0,
          teamId: s.team_id,
          position: s.position,
          played: s.played,
          won: s.won,
          drawn: s.drawn,
          lost: s.lost,
          gf: s.gf,
          ga: s.ga,
          gd: s.gd,
          pts: s.pts,
          xgf: s.xgf,
          xga: s.xga,
          xgd: s.xgd,
          xgGames: s.xg_games,
          form: s.form,
          isLive: s.live,
        },
        update: {
          position: s.position,
          played: s.played,
          won: s.won,
          drawn: s.drawn,
          lost: s.lost,
          gf: s.gf,
          ga: s.ga,
          gd: s.gd,
          pts: s.pts,
          xgf: s.xgf,
          xga: s.xga,
          xgd: s.xgd,
          xgGames: s.xg_games,
          form: s.form,
          isLive: s.live,
        },
      });
      synced++;
    }
    console.log(`[Sync] Synced ${synced} standings for league ${leagueId}`);
    return synced;
  } catch (err) {
    console.error(`[Sync] Failed standings for league ${leagueId}:`, err);
    return 0;
  }
}

export async function syncFixtures(params: { dateFrom: string; dateTo: string; leagueId?: number }): Promise<number> {
  console.log(`[Sync] Syncing fixtures ${params.dateFrom} to ${params.dateTo}...`);
  let synced = 0;
  let offset = 0;
  const limit = 200;

  while (true) {
    const data = await bsdClient.getEvents({
      date_from: params.dateFrom,
      date_to: params.dateTo,
      league_id: params.leagueId,
      limit,
      offset,
    });

    for (const event of data.results) {
      await syncSingleFixture(event);
      synced++;
    }

    if (!data.next || data.results.length < limit) break;
    offset += limit;
  }
  console.log(`[Sync] Synced ${synced} fixtures`);
  return synced;
}

export async function syncSingleFixture(event: {
  id: number; league_id: number; season_id?: number;
  home_team_id: number; home_team: string; away_team_id: number; away_team: string;
  home_coach_id?: number; away_coach_id?: number; referee_id?: number; venue_id?: number;
  event_date: string; status: string; round_number?: number; round_name?: string;
  group_name?: string; period?: string; current_minute?: number;
  home_score?: number; away_score?: number; home_score_ht?: number; away_score_ht?: number;
  penalty_shootout?: string; extra_time_score?: string;
  is_local_derby: boolean; is_neutral_ground: boolean; travel_distance_km?: number;
  weather?: { code?: number; description?: string; wind_speed?: number; temperature_c?: number };
  pitch_condition?: number; attendance?: number; live_websocket: boolean;
}): Promise<void> {
  // Ensure teams exist (skip if IDs are null)
  if (event.home_team_id == null || event.away_team_id == null) return;

  await db.team.upsert({
    where: { id: event.home_team_id },
    create: { id: event.home_team_id, name: event.home_team },
    update: { name: event.home_team },
  });
  await db.team.upsert({
    where: { id: event.away_team_id },
    create: { id: event.away_team_id, name: event.away_team },
    update: { name: event.away_team },
  });

  // Upsert fixture
  await db.fixture.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      leagueId: event.league_id,
      seasonId: event.season_id,
      homeTeamId: event.home_team_id,
      awayTeamId: event.away_team_id,
      homeCoachId: event.home_coach_id,
      awayCoachId: event.away_coach_id,
      refereeId: event.referee_id,
      venueId: event.venue_id,
      eventDate: new Date(event.event_date),
      status: event.status,
      roundNumber: event.round_number,
      roundName: event.round_name ?? '',
      groupName: event.group_name,
      period: event.period,
      currentMinute: event.current_minute,
      homeScore: event.home_score,
      awayScore: event.away_score,
      homeScoreHt: event.home_score_ht,
      awayScoreHt: event.away_score_ht,
      penaltyShootout: typeof event.penalty_shootout === 'object' ? JSON.stringify(event.penalty_shootout) : (event.penalty_shootout ?? null),
      extraTimeScore: event.extra_time_score,
      isLocalDerby: event.is_local_derby,
      isNeutralGround: event.is_neutral_ground,
      travelDistanceKm: event.travel_distance_km,
      weatherCode: event.weather?.code,
      weatherDesc: event.weather?.description,
      windSpeed: event.weather?.wind_speed,
      temperatureC: event.weather?.temperature_c,
      pitchCondition: event.pitch_condition,
      attendance: event.attendance,
      liveWebsocket: event.live_websocket,
      lastSyncedAt: new Date(),
    },
    update: {
      status: event.status,
      period: event.period,
      currentMinute: event.current_minute,
      homeScore: event.home_score,
      awayScore: event.away_score,
      homeScoreHt: event.home_score_ht,
      awayScoreHt: event.away_score_ht,
      lastSyncedAt: new Date(),
    },
  });
}

export async function syncFixtureDetails(fixtureId: number): Promise<void> {
  console.log(`[Sync] Syncing details for fixture ${fixtureId}...`);

  try {
    // Sync stats
    const stats = await bsdClient.getEventStats(fixtureId);
    if (stats.stats?.home && stats.stats?.away) {
      const home = stats.stats.home as Record<string, unknown>;
      const away = stats.stats.away as Record<string, unknown>;
      await db.fixtureStats.upsert({
        where: { fixtureId },
        create: {
          fixtureId,
          homeTotalShots: (home.total_shots as number) ?? 0,
          homeShotsOnTarget: (home.shots_on_target as number) ?? 0,
          homeBallPossession: (home.ball_possession as number) ?? 50,
          homeExpectedGoals: (home.expected_goals as number) ?? (home.xg as Record<string, unknown>)?.actual as number ?? 0,
          homeCornerKicks: (home.corner_kicks as number) ?? 0,
          homeFouls: (home.fouls as number) ?? 0,
          homeYellowCards: (home.yellow_cards as number) ?? 0,
          homeRedCards: (home.red_cards as number) ?? 0,
          homeAttacks: (home.attack as number) ?? 0,
          homeDangerousAttacks: (home.dangerous_attack as number) ?? 0,
          awayTotalShots: (away.total_shots as number) ?? 0,
          awayShotsOnTarget: (away.shots_on_target as number) ?? 0,
          awayBallPossession: (away.ball_possession as number) ?? 50,
          awayExpectedGoals: (away.expected_goals as number) ?? (away.xg as Record<string, unknown>)?.actual as number ?? 0,
          awayCornerKicks: (away.corner_kicks as number) ?? 0,
          awayFouls: (away.fouls as number) ?? 0,
          awayYellowCards: (away.yellow_cards as number) ?? 0,
          awayRedCards: (away.red_cards as number) ?? 0,
          awayAttacks: (away.attack as number) ?? 0,
          awayDangerousAttacks: (away.dangerous_attack as number) ?? 0,
        },
        update: {
          homeTotalShots: (home.total_shots as number) ?? 0,
          homeShotsOnTarget: (home.shots_on_target as number) ?? 0,
          homeBallPossession: (home.ball_possession as number) ?? 50,
          homeExpectedGoals: (home.expected_goals as number) ?? 0,
          awayTotalShots: (away.total_shots as number) ?? 0,
          awayShotsOnTarget: (away.shots_on_target as number) ?? 0,
          awayBallPossession: (away.ball_possession as number) ?? 50,
          awayExpectedGoals: (away.expected_goals as number) ?? 0,
        },
      });
    }
  } catch { /* Stats might not be available */ }

  try {
    // Sync odds
    const odds = await bsdClient.getEventOdds(fixtureId);
    if (odds.odds) {
      await db.fixtureOdds.upsert({
        where: { fixtureId },
        create: {
          fixtureId,
          homeWin: odds.odds.home_win,
          draw: odds.odds.draw,
          awayWin: odds.odds.away_win,
          over15Goals: odds.odds.over_15_goals,
          over25Goals: odds.odds.over_25_goals,
          over35Goals: odds.odds.over_35_goals,
          under15Goals: odds.odds.under_15_goals,
          under25Goals: odds.odds.under_25_goals,
          under35Goals: odds.odds.under_35_goals,
          bttsYes: odds.odds.btts_yes,
          bttsNo: odds.odds.btts_no,
        },
        update: {
          homeWin: odds.odds.home_win,
          draw: odds.odds.draw,
          awayWin: odds.odds.away_win,
          over25Goals: odds.odds.over_25_goals,
          bttsYes: odds.odds.btts_yes,
        },
      });
    }
  } catch { /* Odds might not be available */ }

  try {
    // Sync lineups
    const lineups = await bsdClient.getEventLineups(fixtureId);
    await db.fixtureLineup.upsert({
      where: { fixtureId },
      create: {
        fixtureId,
        lineupStatus: lineups.lineup_status,
        homeFormation: lineups.lineups?.home?.formation ?? '',
        awayFormation: lineups.lineups?.away?.formation ?? '',
        homePlayers: JSON.stringify(lineups.lineups?.home?.players ?? []),
        awayPlayers: JSON.stringify(lineups.lineups?.away?.players ?? []),
        homeSubstitutes: JSON.stringify(lineups.lineups?.home?.substitutes ?? []),
        awaySubstitutes: JSON.stringify(lineups.lineups?.away?.substitutes ?? []),
        homeUnavailable: JSON.stringify(lineups.unavailable_players?.home ?? []),
        awayUnavailable: JSON.stringify(lineups.unavailable_players?.away ?? []),
        homeConfidence: lineups.lineups?.home?.confidence,
        awayConfidence: lineups.lineups?.away?.confidence,
        updatedAt: lineups.updated_at ? new Date(lineups.updated_at) : null,
      },
      update: {
        lineupStatus: lineups.lineup_status,
        homeFormation: lineups.lineups?.home?.formation ?? '',
        awayFormation: lineups.lineups?.away?.formation ?? '',
        homePlayers: JSON.stringify(lineups.lineups?.home?.players ?? []),
        awayPlayers: JSON.stringify(lineups.lineups?.away?.players ?? []),
        updatedAt: lineups.updated_at ? new Date(lineups.updated_at) : null,
      },
    });
  } catch { /* Lineups might not be available */ }

  try {
    // Sync incidents
    const incidents = await bsdClient.getEventIncidents(fixtureId);
    if (incidents.incidents?.length) {
      // Delete old and re-insert
      await db.fixtureIncident.deleteMany({ where: { fixtureId } });
      for (const inc of incidents.incidents) {
        await db.fixtureIncident.create({
          data: {
            fixtureId,
            type: inc.type,
            minute: inc.minute,
            addedTime: inc.added_time,
            player: inc.player,
            playerId: inc.player_id,
            playerIn: inc.player_in,
            playerInId: inc.player_in_id,
            playerOut: inc.player_out,
            playerOutId: inc.player_out_id,
            isHome: inc.is_home,
            cardType: inc.card_type,
            goalType: inc.goal_type,
            decision: inc.decision,
            confirmed: inc.confirmed,
            homeScore: inc.home_score,
            awayScore: inc.away_score,
          },
        });
      }
    }
  } catch { /* Incidents might not be available */ }

  try {
    // Sync metadata
    const meta = await bsdClient.getEventMetadata(fixtureId);
    await db.fixtureMetadata.upsert({
      where: { fixtureId },
      create: {
        fixtureId,
        funFacts: JSON.stringify(meta.funfacts ?? []),
        aiPreview: meta.ai_preview?.text ?? '',
        aiGeneratedAt: meta.ai_preview?.generated_at ? new Date(meta.ai_preview.generated_at) : null,
      },
      update: {
        funFacts: JSON.stringify(meta.funfacts ?? []),
        aiPreview: meta.ai_preview?.text ?? '',
      },
    });
  } catch { /* Metadata might not be available */ }
}

export async function syncManagers(): Promise<number> {
  console.log('[Sync] Syncing managers...');
  let synced = 0;
  let offset = 0;
  const limit = 200;

  while (true) {
    const data = await bsdClient.getManagers({ limit, offset });
    for (const m of data.results) {
      await db.manager.upsert({
        where: { id: m.id },
        create: {
          id: m.id,
          name: m.name,
          shortName: m.short_name,
          country: m.country,
          tacticalProfile: m.tactical_profile || 'balanced',
          preferredFormation: m.preferred_formation || '',
          currentTeamId: m.current_team_id,
          matchesTotal: m.matches_total ?? 0,
          wins: m.wins ?? 0,
          draws: m.draws ?? 0,
          losses: m.losses ?? 0,
          winPct: m.win_pct ?? 0,
          avgGoalsScored: m.avg_goals_scored ?? 0,
          avgGoalsConceded: m.avg_goals_conceded ?? 0,
          avgPossession: m.avg_possession ?? 50,
          cleanSheetPct: m.clean_sheet_pct ?? 0,
          bttsPct: m.btts_pct ?? 0,
          over25Pct: m.over_25_pct ?? 0,
          teamStyle: m.team_style ?? '',
          statsUpdatedAt: new Date(),
        },
        update: {
          tacticalProfile: m.tactical_profile ?? 'balanced',
          preferredFormation: m.preferred_formation ?? '',
          currentTeamId: m.current_team_id,
          matchesTotal: m.matches_total ?? 0,
          wins: m.wins ?? 0,
          draws: m.draws ?? 0,
          losses: m.losses ?? 0,
          winPct: m.win_pct ?? 0,
          avgGoalsScored: m.avg_goals_scored ?? 0,
          avgGoalsConceded: m.avg_goals_conceded ?? 0,
          avgPossession: m.avg_possession ?? 50,
          cleanSheetPct: m.clean_sheet_pct ?? 0,
          bttsPct: m.btts_pct ?? 0,
          over25Pct: m.over_25_pct ?? 0,
          teamStyle: m.team_style ?? '',
        },
      });
      synced++;
    }
    if (!data.next || data.results.length < limit) break;
    offset += limit;
  }
  console.log(`[Sync] Synced ${synced} managers`);
  return synced;
}

/** Full daily sync — run this on a schedule */
export async function fullDailySync(): Promise<{ leagues: number; fixtures: number; standings: number }> {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Sync leagues
  const leagues = await syncLeagues();

  // Sync fixtures (yesterday through tomorrow for live + recent results + upcoming)
  const fixtures = await syncFixtures({ dateFrom: yesterday, dateTo: tomorrow });

  // Sync standings for top leagues
  const topLeagues = [17, 3, 9, 6, 13, 14, 30, 29, 34, 8]; // EPL, La Liga, Serie A, Ligue 1, etc.
  let standings = 0;
  for (const lid of topLeagues) {
    standings += await syncStandings(lid);
  }

  // Sync managers
  await syncManagers();

  // Sync details for today's finished matches
  const finishedToday = await db.fixture.findMany({
    where: { status: 'finished', eventDate: { gte: new Date(yesterday) } },
    take: 50,
  });
  for (const f of finishedToday) {
    await syncFixtureDetails(f.id);
  }

  return { leagues, fixtures, standings };
}
