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

    // Get team names
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

    // Get H2H data
    const h2hResult = await client.execute({
      sql: `SELECT f.id, f.event_date, f.home_team_id, f.away_team_id,
                   f.home_score, f.away_score, f.status, l.name as league_name
            FROM fixtures f
            LEFT JOIN leagues l ON f.league_id = l.id
            WHERE ((f.home_team_id = ? AND f.away_team_id = ?) OR (f.home_team_id = ? AND f.away_team_id = ?))
              AND f.status = 'finished' AND f.home_score IS NOT NULL
            ORDER BY f.event_date DESC LIMIT 10`,
      args: [f.home_team_id, f.away_team_id, f.away_team_id, f.home_team_id],
    });

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

    const fixture = {
      id: f.id,
      bsdId: f.bsd_id,
      leagueId: f.league_id,
      leagueName: leagueResult.rows.length > 0 ? leagueResult.rows[0].name : null,
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
      homeTeam: homeTeam.rows.length > 0 ? { id: homeTeam.rows[0].id, name: homeTeam.rows[0].name, shortName: homeTeam.rows[0].short_name } : { id: f.home_team_id, name: 'Unknown' },
      awayTeam: awayTeam.rows.length > 0 ? { id: awayTeam.rows[0].id, name: awayTeam.rows[0].name, shortName: awayTeam.rows[0].short_name } : { id: f.away_team_id, name: 'Unknown' },
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
      h2h: h2hResult.rows.map(h => ({
        id: h.id,
        date: h.event_date,
        homeTeamId: h.home_team_id,
        awayTeamId: h.away_team_id,
        homeScore: h.home_score,
        awayScore: h.away_score,
        leagueName: h.league_name,
      })),
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
