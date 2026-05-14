import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '10');

  try {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    // Try V2 predictions first (much richer data)
    const v2Result = await client.execute({
      sql: `SELECT p2.*, f.event_date, f.home_team_id, f.away_team_id, f.league_id, f.status,
                   ht.name as home_team_name, ht.short_name as home_team_short_name, ht.logo as home_team_logo,
                   at.name as away_team_name, at.short_name as away_team_short_name, at.logo as away_team_logo,
                   l.name as league_name,
                   o.home_win, o.draw as odds_draw, o.away_win, o.over_25_goals, o.btts_yes
            FROM predictions_v2 p2
            JOIN fixtures f ON p2.fixture_id = f.id
            LEFT JOIN teams ht ON f.home_team_id = ht.id
            LEFT JOIN teams at ON f.away_team_id = at.id
            LEFT JOIN leagues l ON f.league_id = l.id
            LEFT JOIN fixture_odds o ON o.fixture_id = f.id
            WHERE f.event_date >= ? AND f.event_date < ?
              AND f.status IN ('notstarted', 'inprogress', 'not_started')
              AND p2.tier IN ('elite', 'playable', 'value', 'medium')
            ORDER BY p2.confidence DESC LIMIT ?`,
      args: [today, tomorrow, limit],
    });

    if (v2Result.rows.length > 0) {
      const picks = v2Result.rows.map((p, i) => {
        const calibratedProbs = p.calibrated_probs ? JSON.parse(p.calibrated_probs as string) : {};
        const marketSelection = p.market_selection ? JSON.parse(p.market_selection as string) : {};
        const confidenceProfile = p.confidence_profile ? JSON.parse(p.confidence_profile as string) : {};
        const keyReasons = p.key_reasons ? JSON.parse(p.key_reasons as string) : [];

        return {
          rank: i + 1,
          fixtureId: p.fixture_id as number,
          homeTeam: (p.home_team_name as string) || 'Home',
          awayTeam: (p.away_team_name as string) || 'Away',
          homeTeamId: p.home_team_id as number,
          awayTeamId: p.away_team_id as number,
          homeTeamShortName: p.home_team_short_name as string | null,
          awayTeamShortName: p.away_team_short_name as string | null,
          homeTeamLogo: p.home_team_logo as string | null,
          awayTeamLogo: p.away_team_logo as string | null,
          eventDate: p.event_date as string,
          leagueId: p.league_id as number,
          leagueName: p.league_name as string,
          // V2 engine fields
          pickType: p.pick_type as string,
          pickLabel: p.pick_label as string,
          confidence: p.confidence as number,
          tier: p.tier as string,
          script: p.script as string,
          homeXg: p.home_xg as number,
          awayXg: p.away_xg as number,
          edge: p.edge as number,
          safeBet: p.safe_bet === 1,
          valueBet: p.value_bet === 1,
          dataQuality: p.data_quality as string,
          engineVersion: p.engine_version as string,
          // Probability breakdown
          homeWinProb: calibratedProbs.homeWin ?? null,
          drawProb: calibratedProbs.draw ?? null,
          awayWinProb: calibratedProbs.awayWin ?? null,
          over25Prob: calibratedProbs.over25 ?? null,
          under25Prob: calibratedProbs.under25 ?? null,
          bttsYesProb: calibratedProbs.bttsYes ?? null,
          bttsNoProb: calibratedProbs.bttsNo ?? null,
          // Market selection details
          bestPick: marketSelection.bestPick ?? null,
          abstained: marketSelection.abstained ?? false,
          // Confidence profile
          confidenceProfile: confidenceProfile,
          // Key reasons
          keyReasons: keyReasons,
          // Value detection
          valueDetected: (p.edge as number) > 5,
          valueEdge: p.edge as number,
          recommendedBet: p.pick_label as string,
          // Odds from fixture_odds table
          odds: {
            homeWin: (p.home_win as number) ?? null,
            draw: (p.odds_draw as number) ?? null,
            awayWin: (p.away_win as number) ?? null,
            over25: (p.over_25_goals as number) ?? null,
            bttsYes: (p.btts_yes as number) ?? null,
          },
        };
      });

      return NextResponse.json({
        engine: 'v2',
        date: today,
        count: picks.length,
        picks,
      });
    }

    // Fallback to V1 predictions if no V2 data
    const v1Result = await client.execute({
      sql: `SELECT p.*, f.event_date, f.home_team_id, f.away_team_id, f.league_id, f.status,
                   ht.name as home_team_name, ht.short_name as home_team_short_name, ht.logo as home_team_logo,
                   at.name as away_team_name, at.short_name as away_team_short_name, at.logo as away_team_logo,
                   l.name as league_name,
                   o.home_win, o.draw as odds_draw, o.away_win, o.over_25_goals, o.btts_yes
            FROM predictions p
            JOIN fixtures f ON p.fixture_id = f.id
            LEFT JOIN teams ht ON f.home_team_id = ht.id
            LEFT JOIN teams at ON f.away_team_id = at.id
            LEFT JOIN leagues l ON f.league_id = l.id
            LEFT JOIN fixture_odds o ON o.fixture_id = f.id
            WHERE f.event_date >= ? AND f.event_date < ? AND f.status IN ('notstarted', 'inprogress')
            ORDER BY p.confidence DESC LIMIT ?`,
      args: [today, tomorrow, limit],
    });

    const picks = v1Result.rows.map((p, i) => ({
      rank: i + 1,
      fixtureId: p.fixture_id as number,
      homeTeam: (p.home_team_name as string) || 'Home',
      awayTeam: (p.away_team_name as string) || 'Away',
      homeTeamId: p.home_team_id as number,
      awayTeamId: p.away_team_id as number,
      homeTeamShortName: p.home_team_short_name as string | null,
      awayTeamShortName: p.away_team_short_name as string | null,
      homeTeamLogo: p.home_team_logo as string | null,
      awayTeamLogo: p.away_team_logo as string | null,
      eventDate: p.event_date as string,
      leagueId: p.league_id as number,
      leagueName: p.league_name as string,
      pickType: p.pick_type as string,
      pickLabel: p.pick_label as string,
      confidence: (p.confidence as number) / 100,
      tier: p.tier as string,
      verdict: p.verdict as string,
      homeWinProb: p.home_win_prob as number,
      drawProb: p.draw_prob as number,
      awayWinProb: p.away_win_prob as number,
      over25Prob: p.over_25_prob as number,
      bttsYesProb: p.btts_yes_prob as number,
      homeXg: p.home_xg as number,
      awayXg: p.away_xg as number,
      edge: p.edge as number,
      recommendedBet: p.pick_label as string,
      valueDetected: (p.edge as number) > 5,
      valueEdge: p.edge as number,
      odds: {
        homeWin: (p.home_win as number) ?? null,
        draw: (p.odds_draw as number) ?? null,
        awayWin: (p.away_win as number) ?? null,
        over25: (p.over_25_goals as number) ?? null,
        bttsYes: (p.btts_yes as number) ?? null,
      },
    }));

    return NextResponse.json({
      engine: 'v1',
      date: today,
      count: picks.length,
      picks,
    });
  } catch (error) {
    console.error('[API] Picks error:', error);
    return NextResponse.json({ date: new Date().toISOString().split('T')[0], count: 0, picks: [], error: String(error) }, { status: 500 });
  }
}
