import { NextRequest, NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';

export async function GET() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    // Auto-generate accas from today's top picks if none exist
    const existingAccas = await client.execute({
      sql: "SELECT id FROM accas WHERE date = ? LIMIT 1",
      args: [today],
    });

    if (existingAccas.rows.length === 0) {
      await autoGenerateAccas(today, tomorrow);
    }

    // Get today's accas with full pick details
    const result = await client.execute({
      sql: `SELECT * FROM accas WHERE date >= ? ORDER BY created_at DESC LIMIT 10`,
      args: [today],
    });

    const accas = [];
    for (const a of result.rows) {
      const pickIds = a.pick_ids ? JSON.parse(a.pick_ids as string) : [];
      const picks = [];

      for (const pid of pickIds) {
        const pickData = await client.execute({
          sql: `SELECT p.pick_type, p.pick_label, p.confidence, p.tier, p.verdict,
                       p.home_win_prob, p.draw_prob, p.away_win_prob,
                       f.event_date, f.home_team_id, f.away_team_id, f.league_id,
                       ht.name as home_team_name, at.name as away_team_name,
                       l.name as league_name,
                       o.home_win, o.draw as odds_draw, o.away_win
                FROM predictions p
                JOIN fixtures f ON p.fixture_id = f.id
                LEFT JOIN teams ht ON f.home_team_id = ht.id
                LEFT JOIN teams at ON f.away_team_id = at.id
                LEFT JOIN leagues l ON f.league_id = l.id
                LEFT JOIN fixture_odds o ON o.fixture_id = f.id
                WHERE p.id = ?`,
          args: [pid],
        });

        if (pickData.rows.length > 0) {
          const pr = pickData.rows[0];
          picks.push({
            predictionId: pid,
            homeTeam: pr.home_team_name || 'Home',
            awayTeam: pr.away_team_name || 'Away',
            leagueName: pr.league_name,
            pickLabel: pr.pick_label,
            confidence: pr.confidence,
            tier: pr.tier,
            verdict: pr.verdict,
            odds: pr.home_win ? {
              home: pr.home_win,
              draw: pr.odds_draw,
              away: pr.away_win,
            } : null,
          });
        }
      }

      accas.push({
        id: a.id,
        date: a.date,
        pickIds,
        picks,
        totalOdds: a.total_odds,
        status: a.status,
        createdAt: a.created_at,
      });
    }

    return NextResponse.json({
      count: accas.length,
      accas,
    });
  } catch (error) {
    console.error('[API] Acca GET error:', error);
    return NextResponse.json({ count: 0, accas: [], error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, pickIds, totalOdds, date } = await req.json();

    if (!pickIds || !Array.isArray(pickIds) || pickIds.length === 0) {
      return NextResponse.json({ error: 'pickIds array is required' }, { status: 400 });
    }

    const accaDate = date || new Date().toISOString().split('T')[0];

    await client.execute({
      sql: `INSERT INTO accas (user_id, date, pick_ids, total_odds, status)
            VALUES (?, ?, ?, ?, 'pending')`,
      args: [userId || null, accaDate, JSON.stringify(pickIds), totalOdds || null],
    });

    return NextResponse.json({
      success: true,
      acca: { date: accaDate, pickIds, totalOdds, status: 'pending' },
    }, { status: 201 });
  } catch (error) {
    console.error('[API] Acca POST error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// Auto-generate smart accas from today's predictions
async function autoGenerateAccas(today: string, tomorrow: string): Promise<void> {
  // Get top predictions sorted by confidence
  const predictions = await client.execute({
    sql: `SELECT p.id, p.pick_type, p.pick_label, p.confidence, p.tier,
                 p.home_win_prob, p.draw_prob, p.away_win_prob, p.over_25_prob, p.btts_yes_prob,
                 f.home_team_id, f.away_team_id, f.league_id,
                 o.home_win, o.draw as odds_draw, o.away_win, o.over_25_goals, o.btts_yes
          FROM predictions p
          JOIN fixtures f ON p.fixture_id = f.id
          LEFT JOIN fixture_odds o ON o.fixture_id = f.id
          WHERE f.event_date >= ? AND f.event_date < ? AND f.status = 'notstarted'
          ORDER BY p.confidence DESC LIMIT 30`,
    args: [today, tomorrow],
  });

  if (predictions.rows.length < 3) return;

  // Generate 2-3 fold acca from top picks
  // Acca 1: Top 3 picks (3-fold)
  const top3 = predictions.rows.slice(0, 3);
  const top3Ids = top3.map(r => r.id as number);
  const top3Odds = top3.reduce((acc, r) => {
    const pickOdds = getPickOdds(r);
    return acc * (pickOdds || 1.5);
  }, 1);

  await client.execute({
    sql: `INSERT INTO accas (user_id, date, pick_ids, total_odds, status) VALUES (?, ?, ?, ?, 'pending')`,
    args: [null, today, JSON.stringify(top3Ids), Math.round(top3Odds * 100) / 100],
  });

  // Acca 2: Top 5 picks (5-fold)
  if (predictions.rows.length >= 5) {
    const top5 = predictions.rows.slice(0, 5);
    const top5Ids = top5.map(r => r.id as number);
    const top5Odds = top5.reduce((acc, r) => {
      const pickOdds = getPickOdds(r);
      return acc * (pickOdds || 1.5);
    }, 1);

    await client.execute({
      sql: `INSERT INTO accas (user_id, date, pick_ids, total_odds, status) VALUES (?, ?, ?, ?, 'pending')`,
      args: [null, today, JSON.stringify(top5Ids), Math.round(top5Odds * 100) / 100],
    });
  }

  // Acca 3: Goals market picks (over/under/BTTS)
  const goalPicks = predictions.rows.filter(r =>
    ['over_25', 'under_25', 'btts_yes', 'btts_no'].includes(r.pick_type as string)
  ).slice(0, 4);

  if (goalPicks.length >= 2) {
    const goalIds = goalPicks.map(r => r.id as number);
    const goalOdds = goalPicks.reduce((acc, r) => {
      const pickOdds = getPickOdds(r);
      return acc * (pickOdds || 1.5);
    }, 1);

    await client.execute({
      sql: `INSERT INTO accas (user_id, date, pick_ids, total_odds, status) VALUES (?, ?, ?, ?, 'pending')`,
      args: [null, today, JSON.stringify(goalIds), Math.round(goalOdds * 100) / 100],
    });
  }

  console.log(`[Acca] Auto-generated accas for ${today}`);
}

function getPickOdds(row: Record<string, unknown>): number | null {
  const pickType = row.pick_type as string;
  switch (pickType) {
    case 'home_win': return row.home_win as number;
    case 'draw': return row.odds_draw as number;
    case 'away_win': return row.away_win as number;
    case 'over_25': return row.over_25_goals as number;
    case 'btts_yes': return row.btts_yes as number;
    default: return null;
  }
}
