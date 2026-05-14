import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';
import { bsdClient } from '@/lib/bsd-client';
import { syncFixtureDetails, syncH2H, syncTeamLast5 } from '@/lib/sync-service';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureId = parseInt(searchParams.get('fixtureId') || '0');

  if (!fixtureId) {
    return NextResponse.json({ error: 'fixtureId required' }, { status: 400 });
  }

  try {
    // Get fixture with all related data
    let fixtureResult = await client.execute({
      sql: 'SELECT * FROM fixtures WHERE id = ?',
      args: [fixtureId],
    });

    // If fixture not in DB, try fetching from BSD API directly
    if (fixtureResult.rows.length === 0) {
      try {
        const event = await bsdClient.getEvent(fixtureId);
        // Store the fixture first
        const { syncSingleFixture } = await import('@/lib/sync-service');
        await syncSingleFixture(event);

        // Re-query from DB
        fixtureResult = await client.execute({
          sql: 'SELECT * FROM fixtures WHERE id = ?',
          args: [fixtureId],
        });

        if (fixtureResult.rows.length === 0) {
          // Return BSD data directly if DB storage failed
          const [stats, odds, lineups, metadata] = await Promise.allSettled([
            bsdClient.getEventStats(fixtureId),
            bsdClient.getEventOdds(fixtureId),
            bsdClient.getEventLineups(fixtureId),
            bsdClient.getEventMetadata(fixtureId),
          ]);

          return NextResponse.json({
            source: 'api',
            fixture: {
              id: event.id,
              leagueId: event.league_id,
              seasonId: event.season_id,
              homeTeamId: event.home_team_id,
              awayTeamId: event.away_team_id,
              homeTeam: { id: event.home_team_id, name: event.home_team, shortName: null, logo: null },
              awayTeam: { id: event.away_team_id, name: event.away_team, shortName: null, logo: null },
              eventDate: event.event_date,
              status: event.status,
              period: event.period,
              currentMinute: event.current_minute,
              homeScore: event.home_score,
              awayScore: event.away_score,
              homeScoreHt: event.home_score_ht,
              awayScoreHt: event.away_score_ht,
              roundName: event.round_name,
              isLocalDerby: event.is_local_derby,
              travelDistanceKm: event.travel_distance_km,
              weatherCode: event.weather?.code,
              weatherDesc: event.weather?.description,
              temperature: event.weather?.temperature_c,
              windSpeed: event.weather?.wind_speed,
              stats: stats.status === 'fulfilled' ? stats.value?.stats : null,
              odds: odds.status === 'fulfilled' ? odds.value?.odds : null,
              lineup: lineups.status === 'fulfilled' ? lineups.value : null,
              metadata: metadata.status === 'fulfilled' ? metadata.value : null,
              h2h: { matches: [], summary: { totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0, homeGoals: 0, awayGoals: 0 } },
              homeLast5: [],
              awayLast5: [],
              homeProfile: null,
              awayProfile: null,
              homeElo: null,
              awayElo: null,
              prediction: null,
              standings: [],
            },
          });
        }
      } catch {
        return NextResponse.json({ error: 'Match not found' }, { status: 404 });
      }
    }

    const f = fixtureResult.rows[0];

    // Try to fetch live details from BSD API if we're missing odds/stats/lineups
    const hasOdds = await client.execute({ sql: 'SELECT id FROM fixture_odds WHERE fixture_id = ?', args: [fixtureId] });
    const hasStats = await client.execute({ sql: 'SELECT id FROM fixture_stats WHERE fixture_id = ?', args: [fixtureId] });

    if (hasOdds.rows.length === 0 || hasStats.rows.length === 0) {
      // Fetch details from BSD API in background (don't block the response)
      syncFixtureDetails(fixtureId).catch(() => { /* non-blocking */ });
    }

    // Get team names and logos
    const homeTeam = await client.execute({ sql: 'SELECT * FROM teams WHERE id = ?', args: [f.home_team_id as number] });
    const awayTeam = await client.execute({ sql: 'SELECT * FROM teams WHERE id = ?', args: [f.away_team_id as number] });

    // Get stats
    const statsResult = await client.execute({ sql: 'SELECT * FROM fixture_stats WHERE fixture_id = ?', args: [fixtureId] });

    // Get odds
    const oddsResult = await client.execute({ sql: 'SELECT * FROM fixture_odds WHERE fixture_id = ?', args: [fixtureId] });

    // Get lineup
    const lineupResult = await client.execute({ sql: 'SELECT * FROM fixture_lineups WHERE fixture_id = ?', args: [fixtureId] });

    // Get prediction with full data — try V2 first, then V1
    let predResult = await client.execute({ sql: 'SELECT * FROM predictions_v2 WHERE fixture_id = ?', args: [fixtureId] });
    const isV2Prediction = predResult.rows.length > 0;
    if (!isV2Prediction) {
      predResult = await client.execute({ sql: 'SELECT * FROM predictions WHERE fixture_id = ?', args: [fixtureId] });
    }

    // Get league name
    const leagueResult = f.league_id ? await client.execute({
      sql: 'SELECT name, country FROM leagues WHERE id = ?',
      args: [f.league_id as number],
    }) : { rows: [] };

    // Get standings for this league
    const standingsResult = f.league_id ? await client.execute({
      sql: 'SELECT * FROM standings WHERE league_id = ? ORDER BY position ASC',
      args: [f.league_id as number],
    }) : { rows: [] };

    const homeTeamId = f.home_team_id as number;
    const awayTeamId = f.away_team_id as number;

    // ========================================================================
    // H2H DATA — Fetch from DB, or on-the-fly from BSD API if empty
    // ========================================================================
    let h2hResult = await client.execute({
      sql: `SELECT f.id, f.event_date, f.home_team_id, f.away_team_id,
                   f.home_score, f.away_score, f.status, f.league_id, l.name as league_name
            FROM fixtures f
            LEFT JOIN leagues l ON f.league_id = l.id
            WHERE ((f.home_team_id = ? AND f.away_team_id = ?) OR (f.home_team_id = ? AND f.away_team_id = ?))
              AND f.status = 'finished' AND f.home_score IS NOT NULL
            ORDER BY f.event_date DESC LIMIT 10`,
      args: [homeTeamId, awayTeamId, awayTeamId, homeTeamId],
    });

    // If no H2H data in DB, try fetching from BSD API on-the-fly
    if (h2hResult.rows.length === 0) {
      console.log(`[Match] No H2H data in DB, fetching from BSD API for teams ${homeTeamId} vs ${awayTeamId}`);
      try {
        await syncH2H(homeTeamId, awayTeamId);
        // Re-query after sync
        h2hResult = await client.execute({
          sql: `SELECT f.id, f.event_date, f.home_team_id, f.away_team_id,
                       f.home_score, f.away_score, f.status, f.league_id, l.name as league_name
                FROM fixtures f
                LEFT JOIN leagues l ON f.league_id = l.id
                WHERE ((f.home_team_id = ? AND f.away_team_id = ?) OR (f.home_team_id = ? AND f.away_team_id = ?))
                  AND f.status = 'finished' AND f.home_score IS NOT NULL
                ORDER BY f.event_date DESC LIMIT 10`,
          args: [homeTeamId, awayTeamId, awayTeamId, homeTeamId],
        });
      } catch (err) {
        console.error(`[Match] H2H on-the-fly sync failed:`, err);
      }
    }

    // Get H2H summary stats
    let h2hHomeWins = 0, h2hDraws = 0, h2hAwayWins = 0, h2hHomeGoals = 0, h2hAwayGoals = 0;
    for (const h of h2hResult.rows) {
      const hs = h.home_score as number;
      const as_ = h.away_score as number;
      if (h.home_team_id === homeTeamId) {
        h2hHomeGoals += hs;
        h2hAwayGoals += as_;
        if (hs > as_) h2hHomeWins++;
        else if (hs === as_) h2hDraws++;
        else h2hAwayWins++;
      } else {
        h2hHomeGoals += as_;
        h2hAwayGoals += hs;
        if (as_ > hs) h2hHomeWins++;
        else if (as_ === hs) h2hDraws++;
        else h2hAwayWins++;
      }
    }

    // ========================================================================
    // LAST 5 MATCHES — Fetch from DB, or on-the-fly from BSD API if empty
    // ========================================================================
    let homeLast5 = await client.execute({
      sql: `SELECT f.id, f.event_date, f.home_team_id, f.away_team_id,
                   f.home_score, f.away_score, f.status, f.league_id, l.name as league_name,
                   ht.name as home_team_name, at.name as away_team_name
            FROM fixtures f
            LEFT JOIN leagues l ON f.league_id = l.id
            LEFT JOIN teams ht ON f.home_team_id = ht.id
            LEFT JOIN teams at ON f.away_team_id = at.id
            WHERE (f.home_team_id = ? OR f.away_team_id = ?)
              AND f.status = 'finished' AND f.home_score IS NOT NULL
              AND f.id != ?
            ORDER BY f.event_date DESC LIMIT 5`,
      args: [homeTeamId, homeTeamId, fixtureId],
    });

    let awayLast5 = await client.execute({
      sql: `SELECT f.id, f.event_date, f.home_team_id, f.away_team_id,
                   f.home_score, f.away_score, f.status, f.league_id, l.name as league_name,
                   ht.name as home_team_name, at.name as away_team_name
            FROM fixtures f
            LEFT JOIN leagues l ON f.league_id = l.id
            LEFT JOIN teams ht ON f.home_team_id = ht.id
            LEFT JOIN teams at ON f.away_team_id = at.id
            WHERE (f.home_team_id = ? OR f.away_team_id = ?)
              AND f.status = 'finished' AND f.home_score IS NOT NULL
              AND f.id != ?
            ORDER BY f.event_date DESC LIMIT 5`,
      args: [awayTeamId, awayTeamId, fixtureId],
    });

    // If last 5 data is empty, fetch from BSD API on-the-fly
    if (homeLast5.rows.length === 0) {
      console.log(`[Match] No last5 data in DB, fetching from BSD API for team ${homeTeamId}`);
      try {
        await syncTeamLast5(homeTeamId);
        homeLast5 = await client.execute({
          sql: `SELECT f.id, f.event_date, f.home_team_id, f.away_team_id,
                       f.home_score, f.away_score, f.status, f.league_id, l.name as league_name,
                       ht.name as home_team_name, at.name as away_team_name
                FROM fixtures f
                LEFT JOIN leagues l ON f.league_id = l.id
                LEFT JOIN teams ht ON f.home_team_id = ht.id
                LEFT JOIN teams at ON f.away_team_id = at.id
                WHERE (f.home_team_id = ? OR f.away_team_id = ?)
                  AND f.status = 'finished' AND f.home_score IS NOT NULL
                  AND f.id != ?
                ORDER BY f.event_date DESC LIMIT 5`,
          args: [homeTeamId, homeTeamId, fixtureId],
        });
      } catch (err) {
        console.error(`[Match] Last5 on-the-fly sync failed for home team:`, err);
      }
    }

    if (awayLast5.rows.length === 0) {
      console.log(`[Match] No last5 data in DB, fetching from BSD API for team ${awayTeamId}`);
      try {
        await syncTeamLast5(awayTeamId);
        awayLast5 = await client.execute({
          sql: `SELECT f.id, f.event_date, f.home_team_id, f.away_team_id,
                       f.home_score, f.away_score, f.status, f.league_id, l.name as league_name,
                       ht.name as home_team_name, at.name as away_team_name
                FROM fixtures f
                LEFT JOIN leagues l ON f.league_id = l.id
                LEFT JOIN teams ht ON f.home_team_id = ht.id
                LEFT JOIN teams at ON f.away_team_id = at.id
                WHERE (f.home_team_id = ? OR f.away_team_id = ?)
                  AND f.status = 'finished' AND f.home_score IS NOT NULL
                  AND f.id != ?
                ORDER BY f.event_date DESC LIMIT 5`,
          args: [awayTeamId, awayTeamId, fixtureId],
        });
      } catch (err) {
        console.error(`[Match] Last5 on-the-fly sync failed for away team:`, err);
      }
    }

    // Helper to format form result for a team
    function getFormResult(match: Record<string, unknown>, teamId: number): 'W' | 'D' | 'L' {
      const hs = match.home_score as number;
      const as_ = match.away_score as number;
      const isHome = match.home_team_id === teamId;
      const teamGoals = isHome ? hs : as_;
      const oppGoals = isHome ? as_ : hs;
      if (teamGoals > oppGoals) return 'W';
      if (teamGoals < oppGoals) return 'L';
      return 'D';
    }

    // Build prediction object with parsed JSON fields
    let prediction: Record<string, unknown> | null = null;
    if (predResult.rows.length > 0) {
      const p = predResult.rows[0];
      if (isV2Prediction) {
        // V2 prediction — much richer data
        const calibratedProbs = p.calibrated_probs ? JSON.parse(p.calibrated_probs as string) : {};
        const marketSelection = p.market_selection ? JSON.parse(p.market_selection as string) : {};
        const confidenceProfile = p.confidence_profile ? JSON.parse(p.confidence_profile as string) : {};
        const topScorelines = p.top_scorelines ? JSON.parse(p.top_scorelines as string) : [];
        const keyReasons = p.key_reasons ? JSON.parse(p.key_reasons as string) : [];
        const contradictingReasons = p.contradicting_reasons ? JSON.parse(p.contradicting_reasons as string) : [];

        prediction = {
          engineVersion: 'v2',
          pickType: p.pick_type,
          pickLabel: p.pick_label,
          confidence: p.confidence,
          tier: p.tier,
          edge: p.edge,
          script: p.script,
          homeXg: p.home_xg,
          awayXg: p.away_xg,
          safeBet: p.safe_bet === 1,
          valueBet: p.value_bet === 1,
          dataQuality: p.data_quality,
          enrichmentTier: p.enrichment_tier,
          tacticalMatchup: p.tactical_matchup,
          // Probability breakdown (calibrated)
          homeWinProb: calibratedProbs.homeWin ?? null,
          drawProb: calibratedProbs.draw ?? null,
          awayWinProb: calibratedProbs.awayWin ?? null,
          over25Prob: calibratedProbs.over25 ?? null,
          under25Prob: calibratedProbs.under25 ?? null,
          over15Prob: calibratedProbs.over15 ?? null,
          bttsYesProb: calibratedProbs.bttsYes ?? null,
          bttsNoProb: calibratedProbs.bttsNo ?? null,
          // Market selection
          bestPick: marketSelection.bestPick ?? null,
          allCandidates: marketSelection.allCandidates ?? [],
          abstained: marketSelection.abstained ?? false,
          abstentionReason: marketSelection.abstentionReason ?? null,
          layer2Override: marketSelection.layer2Override ?? false,
          // Confidence profile
          confidenceProfile: confidenceProfile,
          // Key reasons
          keyReasons: keyReasons,
          contradictingReasons: contradictingReasons,
          // Top scorelines
          topScorelines: topScorelines,
          // Value detection (legacy compat)
          probHomeWin: calibratedProbs.homeWin ?? null,
          probDraw: calibratedProbs.draw ?? null,
          probAwayWin: calibratedProbs.awayWin ?? null,
          valueDetected: (p.edge as number) > 5,
          valueEdge: p.edge,
          recommendedBet: p.pick_label,
          result: p.result,
        };
      } else {
        // V1 prediction — original format
        prediction = {
          engineVersion: 'v1',
          pickType: p.pick_type,
          pickLabel: p.pick_label,
          confidence: p.confidence,
          tier: p.tier,
          phantomScore: p.phantom_score,
          edge: p.edge,
          homeWinProb: p.home_win_prob,
          drawProb: p.draw_prob,
          awayWinProb: p.away_win_prob,
          over25Prob: p.over_25_prob,
          under25Prob: p.under_25_prob,
          bttsYesProb: p.btts_yes_prob,
          bttsNoProb: p.btts_no_prob,
          homeXg: p.home_xg,
          awayXg: p.away_xg,
          verdict: p.verdict,
          decisionStack: p.decision_stack ? JSON.parse(p.decision_stack as string) : null,
          keyReasons: p.key_reasons ? JSON.parse(p.key_reasons as string) : [],
          tacticalMatchup: p.tactical_matchup ? JSON.parse(p.tactical_matchup as string) : null,
          odds: p.odds_json ? JSON.parse(p.odds_json as string) : null,
          result: p.result,
          probHomeWin: p.home_win_prob,
          probDraw: p.draw_prob,
          probAwayWin: p.away_win_prob,
          valueDetected: (p.edge as number) > 5,
          valueEdge: p.edge,
          recommendedBet: p.pick_label,
        };
      }
    }

    // Build lineup object
    let lineup: Record<string, unknown> | null = null;
    if (lineupResult.rows.length > 0) {
      const l = lineupResult.rows[0];
      lineup = {
        lineupStatus: l.lineup_status,
        homeFormation: l.home_formation,
        awayFormation: l.away_formation,
        homePlayers: l.home_players ? JSON.parse(l.home_players as string) : [],
        awayPlayers: l.away_players ? JSON.parse(l.away_players as string) : [],
        homeSubstitutes: l.home_substitutes ? JSON.parse(l.home_substitutes as string) : [],
        awaySubstitutes: l.away_substitutes ? JSON.parse(l.away_substitutes as string) : [],
        homeUnavailable: l.home_unavailable ? JSON.parse(l.home_unavailable as string) : [],
        awayUnavailable: l.away_unavailable ? JSON.parse(l.away_unavailable as string) : [],
      };
    }

    // Build odds object
    let odds: Record<string, unknown> | null = null;
    if (oddsResult.rows.length > 0) {
      const o = oddsResult.rows[0];
      odds = {
        homeWin: o.home_win,
        draw: o.draw,
        awayWin: o.away_win,
        over15Goals: o.over_15_goals,
        over25Goals: o.over_25_goals,
        over35Goals: o.over_35_goals,
        under15Goals: o.under_15_goals,
        under25Goals: o.under_25_goals,
        under35Goals: o.under_35_goals,
        bttsYes: o.btts_yes,
        bttsNo: o.btts_no,
      };
    }

    // Build team profiles if available
    const homeProfileResult = await client.execute({
      sql: 'SELECT * FROM team_profiles WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1',
      args: [homeTeamId],
    });
    const awayProfileResult = await client.execute({
      sql: 'SELECT * FROM team_profiles WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1',
      args: [awayTeamId],
    });

    // Build ELO if available
    const homeEloResult = await client.execute({
      sql: 'SELECT * FROM team_elo WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1',
      args: [homeTeamId],
    });
    const awayEloResult = await client.execute({
      sql: 'SELECT * FROM team_elo WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1',
      args: [awayTeamId],
    });

    // Get V2 Glicko (Bayesian ELO) ratings if available
    const homeGlickoResult = await client.execute({
      sql: 'SELECT * FROM team_glicko WHERE team_id = ?',
      args: [homeTeamId],
    });
    const awayGlickoResult = await client.execute({
      sql: 'SELECT * FROM team_glicko WHERE team_id = ?',
      args: [awayTeamId],
    });

    // If no team profile and we have time, compute DNA on-the-fly
    if (homeProfileResult.rows.length === 0 || awayProfileResult.rows.length === 0) {
      try {
        const { computeTeamDNA } = await import('@/engine/team-dna');
        if (homeProfileResult.rows.length === 0) await computeTeamDNA(homeTeamId);
        if (awayProfileResult.rows.length === 0) await computeTeamDNA(awayTeamId);
      } catch { /* silent - not enough data yet */ }
    }

    // Re-fetch profiles after potential computation
    const homeProfileFinal = homeProfileResult.rows.length > 0 ? homeProfileResult : await client.execute({
      sql: 'SELECT * FROM team_profiles WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1',
      args: [homeTeamId],
    });
    const awayProfileFinal = awayProfileResult.rows.length > 0 ? awayProfileResult : await client.execute({
      sql: 'SELECT * FROM team_profiles WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1',
      args: [awayTeamId],
    });

    const homeTeamData = homeTeam.rows.length > 0 ? {
      id: homeTeam.rows[0].id,
      name: homeTeam.rows[0].name,
      shortName: homeTeam.rows[0].short_name,
      logo: homeTeam.rows[0].logo,
      country: homeTeam.rows[0].country,
    } : { id: homeTeamId, name: 'Unknown', shortName: null, logo: null, country: null };

    const awayTeamData = awayTeam.rows.length > 0 ? {
      id: awayTeam.rows[0].id,
      name: awayTeam.rows[0].name,
      shortName: awayTeam.rows[0].short_name,
      logo: awayTeam.rows[0].logo,
      country: awayTeam.rows[0].country,
    } : { id: awayTeamId, name: 'Unknown', shortName: null, logo: null, country: null };

    // Parse stats for the frontend
    let parsedStats: Record<string, unknown> | null = null;
    if (statsResult.rows.length > 0) {
      const s = statsResult.rows[0];
      parsedStats = {
        homeBallPossession: s.home_ball_possession,
        homeTotalShots: s.home_total_shots,
        homeShotsOnTarget: s.home_shots_on_target,
        homeExpectedGoals: s.home_expected_goals,
        homeCornerKicks: s.home_corner_kicks,
        homeFouls: s.home_fouls,
        homeYellowCards: s.home_yellow_cards,
        homeAttacks: s.home_attacks,
        homeDangerousAttacks: s.home_dangerous_attacks,
        homeBigChances: s.home_big_chances,
        homePasses: s.home_passes,
        homePassAccuracy: s.home_pass_accuracy,
        homeTackles: s.home_tackles,
        homeInterceptions: s.home_interceptions,
        awayBallPossession: s.away_ball_possession,
        awayTotalShots: s.away_total_shots,
        awayShotsOnTarget: s.away_shots_on_target,
        awayExpectedGoals: s.away_expected_goals,
        awayCornerKicks: s.away_corner_kicks,
        awayFouls: s.away_fouls,
        awayYellowCards: s.away_yellow_cards,
        awayAttacks: s.away_attacks,
        awayDangerousAttacks: s.away_dangerous_attacks,
        awayBigChances: s.away_big_chances,
        awayPasses: s.away_passes,
        awayPassAccuracy: s.away_pass_accuracy,
        awayTackles: s.away_tackles,
        awayInterceptions: s.away_interceptions,
      };
    }

    const fixture = {
      id: f.id,
      bsdId: f.bsd_id,
      leagueId: f.league_id,
      leagueName: leagueResult.rows.length > 0 ? leagueResult.rows[0].name : null,
      leagueCountry: leagueResult.rows.length > 0 ? leagueResult.rows[0].country : null,
      seasonId: f.season_id,
      homeTeamId: f.home_team_id,
      awayTeamId: f.away_team_id,
      eventDate: f.event_date,
      status: f.status,
      period: f.period,
      currentMinute: f.current_minute,
      homeScore: f.home_score,
      awayScore: f.away_score,
      homeScoreHt: f.home_score_ht,
      awayScoreHt: f.away_score_ht,
      roundName: f.round_name,
      isLocalDerby: (f.is_local_derby as number) === 1,
      travelDistanceKm: f.travel_distance_km,
      weatherCode: f.weather_code,
      weatherDesc: f.weather_desc,
      temperature: f.temperature,
      windSpeed: f.wind_speed,
      homeTeam: homeTeamData,
      awayTeam: awayTeamData,
      stats: parsedStats,
      odds,
      lineup,
      prediction,
      standings: standingsResult.rows.map(s => ({
        position: s.position,
        team: { id: s.team_id, name: s.team_name },
        teamId: s.team_id,
        teamName: s.team_name,
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
        form: s.form,
      })),
      // H2H data with summary
      h2h: {
        matches: h2hResult.rows.map(h => ({
          id: h.id,
          date: h.event_date,
          homeTeamId: h.home_team_id,
          awayTeamId: h.away_team_id,
          homeScore: h.home_score,
          awayScore: h.away_score,
          leagueName: h.league_name,
        })),
        summary: {
          totalMatches: h2hResult.rows.length,
          homeWins: h2hHomeWins,
          draws: h2hDraws,
          awayWins: h2hAwayWins,
          homeGoals: h2hHomeGoals,
          awayGoals: h2hAwayGoals,
        },
      },
      // Last 5 matches for each team
      homeLast5: homeLast5.rows.map(m => ({
        id: m.id,
        date: m.event_date,
        homeTeamId: m.home_team_id,
        awayTeamId: m.away_team_id,
        homeScore: m.home_score,
        awayScore: m.away_score,
        leagueName: m.league_name,
        homeTeamName: m.home_team_name,
        awayTeamName: m.away_team_name,
        result: getFormResult(m, homeTeamId),
      })),
      awayLast5: awayLast5.rows.map(m => ({
        id: m.id,
        date: m.event_date,
        homeTeamId: m.home_team_id,
        awayTeamId: m.away_team_id,
        homeScore: m.home_score,
        awayScore: m.away_score,
        leagueName: m.league_name,
        homeTeamName: m.home_team_name,
        awayTeamName: m.away_team_name,
        result: getFormResult(m, awayTeamId),
      })),
      // Team profiles
      homeProfile: homeProfileFinal.rows.length > 0 ? {
        style: homeProfileFinal.rows[0].style,
        form: homeProfileFinal.rows[0].form,
        homeForm: homeProfileFinal.rows[0].home_form,
        awayForm: homeProfileFinal.rows[0].away_form,
        avgGoalsScored: homeProfileFinal.rows[0].avg_goals_scored,
        avgGoalsConceded: homeProfileFinal.rows[0].avg_goals_conceded,
        possession: homeProfileFinal.rows[0].possession,
        cleanSheetPct: homeProfileFinal.rows[0].clean_sheet_pct,
        bttsPct: homeProfileFinal.rows[0].btts_pct,
        over25Pct: homeProfileFinal.rows[0].over_25_pct,
      } : null,
      awayProfile: awayProfileFinal.rows.length > 0 ? {
        style: awayProfileFinal.rows[0].style,
        form: awayProfileFinal.rows[0].form,
        homeForm: awayProfileFinal.rows[0].home_form,
        awayForm: awayProfileFinal.rows[0].away_form,
        avgGoalsScored: awayProfileFinal.rows[0].avg_goals_scored,
        avgGoalsConceded: awayProfileFinal.rows[0].avg_goals_conceded,
        possession: awayProfileFinal.rows[0].possession,
        cleanSheetPct: awayProfileFinal.rows[0].clean_sheet_pct,
        bttsPct: awayProfileFinal.rows[0].btts_pct,
        over25Pct: awayProfileFinal.rows[0].over_25_pct,
      } : null,
      // ELO ratings
      homeElo: homeEloResult.rows.length > 0 ? {
        overall: homeEloResult.rows[0].elo_rating,
        home: homeEloResult.rows[0].elo_home_rating,
        away: homeEloResult.rows[0].elo_away_rating,
      } : null,
      awayElo: awayEloResult.rows.length > 0 ? {
        overall: awayEloResult.rows[0].elo_rating,
        home: awayEloResult.rows[0].elo_home_rating,
        away: awayEloResult.rows[0].elo_away_rating,
      } : null,
      // V2 Glicko (Bayesian ELO) ratings with uncertainty
      homeGlicko: homeGlickoResult.rows.length > 0 ? {
        rating: homeGlickoResult.rows[0].rating,
        deviation: homeGlickoResult.rows[0].rating_deviation,
        volatility: homeGlickoResult.rows[0].volatility,
        homeRating: homeGlickoResult.rows[0].home_rating,
        awayRating: homeGlickoResult.rows[0].away_rating,
        matchesPlayed: homeGlickoResult.rows[0].matches_played,
      } : null,
      awayGlicko: awayGlickoResult.rows.length > 0 ? {
        rating: awayGlickoResult.rows[0].rating,
        deviation: awayGlickoResult.rows[0].rating_deviation,
        volatility: awayGlickoResult.rows[0].volatility,
        homeRating: awayGlickoResult.rows[0].home_rating,
        awayRating: awayGlickoResult.rows[0].away_rating,
        matchesPlayed: awayGlickoResult.rows[0].matches_played,
      } : null,
    };

    return NextResponse.json({
      source: 'database',
      fixture,
    });
  } catch (error) {
    console.error('[API] Match detail error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
