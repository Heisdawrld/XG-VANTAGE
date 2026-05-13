import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';
import { bsdClient } from '@/lib/bsd-client';

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

    // Get team names
    const homeTeam = await client.execute({ sql: 'SELECT * FROM teams WHERE id = ?', args: [f.home_team_id as number] });
    const awayTeam = await client.execute({ sql: 'SELECT * FROM teams WHERE id = ?', args: [f.away_team_id as number] });

    // Get stats
    const statsResult = await client.execute({ sql: 'SELECT * FROM fixture_stats WHERE fixture_id = ?', args: [fixtureId] });

    // Get odds
    const oddsResult = await client.execute({ sql: 'SELECT * FROM fixture_odds WHERE fixture_id = ?', args: [fixtureId] });

    // Get lineup
    const lineupResult = await client.execute({ sql: 'SELECT * FROM fixture_lineups WHERE fixture_id = ?', args: [fixtureId] });

    // Get prediction
    const predResult = await client.execute({ sql: 'SELECT * FROM predictions WHERE fixture_id = ?', args: [fixtureId] });

    // Get standings for this league
    const standingsResult = f.league_id ? await client.execute({
      sql: 'SELECT * FROM standings WHERE league_id = ? ORDER BY position ASC',
      args: [f.league_id as number],
    }) : { rows: [] };

    const fixture = {
      id: f.id,
      leagueId: f.league_id,
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
      odds: oddsResult.rows.length > 0 ? oddsResult.rows[0] : null,
      lineup: lineupResult.rows.length > 0 ? lineupResult.rows[0] : null,
      prediction: predResult.rows.length > 0 ? predResult.rows[0] : null,
      standings: standingsResult.rows,
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
