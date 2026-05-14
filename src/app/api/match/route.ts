import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';
import { bsdClient } from '@/lib/bsd-client';
import { syncFixtureDetails } from '@/lib/sync-service';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureId = parseInt(searchParams.get('fixtureId') || '0');

  if (!fixtureId) {
    return NextResponse.json({ error: 'fixtureId required' }, { status: 400 });
  }

  try {
    // Get fixture with all related data
    const fixtureResult = await client.execute({
      sql: 'SELECT * FROM fixtures WHERE id = ?',
      args: [fixtureId],
    });

    if (fixtureResult.rows.length === 0) {
      // Try fetching from BSD API directly
      try {
        const event = await bsdClient.getEvent(fixtureId);
        const [stats, odds, lineups, metadata] = await Promise.allSettled([
          bsdClient.getEventStats(fixtureId),
          bsdClient.getEventOdds(fixtureId),
          bsdClient.getEventLineups(fixtureId),
          bsdClient.getEventMetadata(fixtureId),
        ]);

        return NextResponse.json({
          source: 'api',
          fixture: event,
          stats: stats.status === 'fulfilled' ? stats.value : null,
          odds: odds.status === 'fulfilled' ? odds.value : null,
          lineups: lineups.status === 'fulfilled' ? lineups.value : null,
          metadata: metadata.status === 'fulfilled' ? metadata.value : null,
        });
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

    // Get prediction with full data
    const predResult = await client.execute({ sql: 'SELECT * FROM predictions WHERE fixture_id = ?', args: [fixtureId] });

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

    // Get H2H data (last 10 meetings between these two teams)
    const h2hResult = await client.execute({
      sql: `SELECT f.id, f.event_date, f.home_team_id, f.away_team_id,
                   f.home_score, f.away_score, f.status, f.league_id, l.name as league_name
            FROM fixtures f
            LEFT JOIN leagues l ON f.league_id = l.id
            WHERE ((f.home_team_id = ? AND f.away_team_id = ?) OR (f.home_team_id = ? AND f.away_team_id = ?))
              AND f.status = 'finished' AND f.home_score IS NOT NULL
            ORDER BY f.event_date DESC LIMIT 10`,
      args: [homeTeamId, awayTeamId, awayTeamId, homeTeamId],
    });

    // Get H2H summary stats
    let h2hHomeWins = 0, h2hDraws = 0, h2hAwayWins = 0, h2hHomeGoals = 0, h2hAwayGoals = 0;
    for (const h of h2hResult.rows) {
      const hs = h.home_score as number;
      const as_ = h.away_score as number;
      // Count from perspective of current home team
      if (h.home_team_id === homeTeamId) {
        h2hHomeGoals += hs;
        h2hAwayGoals += as_;
        if (hs > as_) h2hHomeWins++;
        else if (hs === as_) h2hDraws++;
        else h2hAwayWins++;
      } else {
        // They were away team in this match
        h2hHomeGoals += as_;
        h2hAwayGoals += hs;
        if (as_ > hs) h2hHomeWins++;
        else if (as_ === hs) h2hDraws++;
        else h2hAwayWins++;
      }
    }

    // Get last 5 matches for home team
    const homeLast5 = await client.execute({
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

    // Get last 5 matches for away team
    const awayLast5 = await client.execute({
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
    let prediction = null;
    if (predResult.rows.length > 0) {
      const p = predResult.rows[0];
      prediction = {
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

    // Build lineup object
    let lineup = null;
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
    let odds = null;
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
      stats: statsResult.rows.length > 0 ? statsResult.rows[0] : null,
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
      homeProfile: homeProfileResult.rows.length > 0 ? {
        style: homeProfileResult.rows[0].style,
        form: homeProfileResult.rows[0].form,
        homeForm: homeProfileResult.rows[0].home_form,
        awayForm: homeProfileResult.rows[0].away_form,
        avgGoalsScored: homeProfileResult.rows[0].avg_goals_scored,
        avgGoalsConceded: homeProfileResult.rows[0].avg_goals_conceded,
        possession: homeProfileResult.rows[0].possession,
        cleanSheetPct: homeProfileResult.rows[0].clean_sheet_pct,
        bttsPct: homeProfileResult.rows[0].btts_pct,
        over25Pct: homeProfileResult.rows[0].over_25_pct,
      } : null,
      awayProfile: awayProfileResult.rows.length > 0 ? {
        style: awayProfileResult.rows[0].style,
        form: awayProfileResult.rows[0].form,
        homeForm: awayProfileResult.rows[0].home_form,
        awayForm: awayProfileResult.rows[0].away_form,
        avgGoalsScored: awayProfileResult.rows[0].avg_goals_scored,
        avgGoalsConceded: awayProfileResult.rows[0].avg_goals_conceded,
        possession: awayProfileResult.rows[0].possession,
        cleanSheetPct: awayProfileResult.rows[0].clean_sheet_pct,
        bttsPct: awayProfileResult.rows[0].btts_pct,
        over25Pct: awayProfileResult.rows[0].over_25_pct,
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
