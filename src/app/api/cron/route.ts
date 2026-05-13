// Cron Pipeline: Sync → Enrich → Predict → Settle
// Called by external cron (Render cron job / cron-job.org) or manually via POST /api/cron
// This is the HEART of xG-Vantage — the engine that keeps everything running

import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';
import { fullDailySync, syncFixtures } from '@/lib/sync-service';
import { computeAllTeamDNA } from '@/engine/team-dna';
import { predictUpcomingMatches, getTopPicks, settlePredictions } from '@/engine/prediction-engine';
import { recalcLeagueElo, updateEloAfterMatch } from '@/engine/elo-system';

export async function POST(request: Request) {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'full';
    const secret = body.secret;

    // Verify cron secret if set
    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let result: Record<string, unknown> = {};

    switch (action) {
      // ============================================================
      // FULL PIPELINE: Sync → Enrich → Predict → Settle
      // ============================================================
      case 'full': {
        // Step 1: Run migrations (ensure tables exist)
        logs.push('[Pipeline] Step 1: Ensuring DB schema...');
        try {
          const { migrate } = await import('@/lib/migrate');
          await migrate();
          logs.push('[Pipeline] Schema OK');
        } catch (err) {
          logs.push(`[Pipeline] Migration warning: ${err}`);
        }

        // Step 2: Sync data from BSD API → Turso
        logs.push('[Pipeline] Step 2: Syncing data from BSD API...');
        const syncResult = await fullDailySync();
        logs.push(`[Pipeline] Synced: ${syncResult.leagues} leagues, ${syncResult.fixtures} fixtures, ${syncResult.standings} standings`);

        // Step 3: Enrich — Compute team DNA from stored fixtures
        logs.push('[Pipeline] Step 3: Computing team DNA...');
        const dnaCount = await computeAllTeamDNA();
        logs.push(`[Pipeline] Computed DNA for ${dnaCount} teams`);

        // Step 4: Enrich — Recalculate ELO for top leagues
        logs.push('[Pipeline] Step 4: Recalculating ELO...');
        const topLeagues = [17, 3, 9, 6, 13, 14, 30, 29, 34, 8];
        for (const leagueId of topLeagues) {
          try {
            await recalcLeagueElo(leagueId);
          } catch (err) {
            logs.push(`[Pipeline] ELO calc failed for league ${leagueId}: ${err}`);
          }
        }
        logs.push('[Pipeline] ELO recalculated for top leagues');

        // Step 5: Predict upcoming matches
        logs.push('[Pipeline] Step 5: Running predictions...');
        const predictions = await predictUpcomingMatches();
        logs.push(`[Pipeline] Generated ${predictions.length} predictions`);

        // Step 6: Generate top picks
        logs.push('[Pipeline] Step 6: Generating picks...');
        const picks = await getTopPicks(10);
        const today = new Date().toISOString().split('T')[0];
        for (let i = 0; i < picks.length; i++) {
          const pick = picks[i];
          try {
            const predResult = await client.execute({
              sql: 'SELECT id FROM predictions WHERE fixture_id = ?',
              args: [pick.fixtureId],
            });
            if (predResult.rows.length > 0) {
              await client.execute({
                sql: `INSERT OR REPLACE INTO picks (prediction_id, fixture_id, rank, date, category)
                      VALUES (?, ?, ?, ?, ?)`,
                args: [predResult.rows[0].id, pick.fixtureId, i + 1, today, pick.tier],
              });
            }
          } catch (err) {
            logs.push(`[Pipeline] Pick storage warning: ${err}`);
          }
        }
        logs.push(`[Pipeline] Stored ${picks.length} top picks`);

        // Step 7: Settle past predictions
        logs.push('[Pipeline] Step 7: Settling predictions...');
        const settled = await settlePredictions();
        logs.push(`[Pipeline] Settled ${settled} predictions`);

        // Step 8: Update track record
        logs.push('[Pipeline] Step 8: Updating track record...');
        try {
          await updateTrackRecord();
          logs.push('[Pipeline] Track record updated');
        } catch (err) {
          logs.push(`[Pipeline] Track record warning: ${err}`);
        }

        result = {
          sync: syncResult,
          dnaComputed: dnaCount,
          predictionsGenerated: predictions.length,
          picksGenerated: picks.length,
          predictionsSettled: settled,
        };
        break;
      }

      // ============================================================
      // SYNC ONLY: Just pull data from BSD API
      // ============================================================
      case 'sync': {
        const syncResult = await fullDailySync();
        result = { sync: syncResult };
        logs.push(`Synced: ${syncResult.leagues} leagues, ${syncResult.fixtures} fixtures, ${syncResult.standings} standings`);
        break;
      }

      // ============================================================
      // ENRICH ONLY: Compute DNA + ELO from existing data
      // ============================================================
      case 'enrich': {
        const dnaCount = await computeAllTeamDNA();
        const topLeagues = [17, 3, 9, 6, 13, 14, 30, 29, 34, 8];
        for (const leagueId of topLeagues) {
          try { await recalcLeagueElo(leagueId); } catch { /* skip */ }
        }
        result = { dnaComputed: dnaCount };
        logs.push(`Enriched: DNA for ${dnaCount} teams, ELO for top leagues`);
        break;
      }

      // ============================================================
      // PREDICT ONLY: Generate predictions from stored data
      // ============================================================
      case 'predict': {
        const predictions = await predictUpcomingMatches();
        const picks = await getTopPicks(10);
        result = { predictionsGenerated: predictions.length, picksGenerated: picks.length };
        logs.push(`Predicted: ${predictions.length} matches, ${picks.length} top picks`);
        break;
      }

      // ============================================================
      // SETTLE ONLY: Check finished matches and settle predictions
      // ============================================================
      case 'settle': {
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        await syncFixtures({ dateFrom: yesterday, dateTo: today });
        const settled = await settlePredictions();
        // Update ELO for settled matches
        const settledFixtures = await client.execute({
          sql: `SELECT f.id, f.home_team_id, f.away_team_id, f.home_score, f.away_score, f.league_id
                FROM fixtures f WHERE f.status = 'finished' AND f.updated_at > datetime('now', '-2 hours')`,
          args: [],
        });
        for (const f of settledFixtures.rows) {
          try {
            await updateEloAfterMatch(
              f.home_team_id as number,
              f.away_team_id as number,
              f.home_score as number,
              f.away_score as number,
              f.league_id as number,
            );
          } catch { /* skip */ }
        }
        result = { predictionsSettled: settled, eloUpdates: settledFixtures.rows.length };
        logs.push(`Settled: ${settled} predictions, ${settledFixtures.rows.length} ELO updates`);
        break;
      }

      // ============================================================
      // LIVE UPDATE: Quick sync for in-progress matches
      // ============================================================
      case 'live': {
        const { bsdClient } = await import('@/lib/bsd-client');
        const liveData = await bsdClient.getLiveEvents();
        let liveSynced = 0;
        for (const event of liveData.events) {
          try {
            await client.execute({
              sql: `UPDATE fixtures SET status = ?, current_minute = ?, period = ?,
                    home_score = ?, away_score = ?, updated_at = datetime('now')
                    WHERE id = ?`,
              args: [event.status, event.current_minute ?? null, event.period ?? null,
                     event.home_score, event.away_score, event.id],
            });
            liveSynced++;
          } catch { /* skip */ }
        }
        result = { liveMatchesUpdated: liveSynced };
        logs.push(`Live: Updated ${liveSynced} in-progress matches`);
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown action. Use: full, sync, enrich, predict, settle, live' }, { status: 400 });
    }

    const elapsed = Date.now() - startTime;
    logs.push(`[Pipeline] Completed in ${(elapsed / 1000).toFixed(1)}s`);

    return NextResponse.json({
      success: true,
      action,
      elapsed_ms: elapsed,
      result,
      logs,
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    logs.push(`[Pipeline] ERROR after ${(elapsed / 1000).toFixed(1)}s: ${error}`);
    return NextResponse.json({
      success: false,
      error: String(error),
      elapsed_ms: elapsed,
      logs,
    }, { status: 500 });
  }
}

// Also allow GET for simple health check
export async function GET() {
  try {
    const leagueCount = await client.execute('SELECT COUNT(*) as cnt FROM leagues');
    const fixtureCount = await client.execute('SELECT COUNT(*) as cnt FROM fixtures');
    const predictionCount = await client.execute('SELECT COUNT(*) as cnt FROM predictions');
    const teamCount = await client.execute('SELECT COUNT(*) as cnt FROM teams');

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        leagues: leagueCount.rows[0].cnt,
        fixtures: fixtureCount.rows[0].cnt,
        predictions: predictionCount.rows[0].cnt,
        teams: teamCount.rows[0].cnt,
      },
    });
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      error: String(error),
    }, { status: 503 });
  }
}

// ============================================================================
// TRACK RECORD UPDATE
// ============================================================================

async function updateTrackRecord(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const month = today.substring(0, 7);

  const results = await client.execute({
    sql: `SELECT pick_type, COUNT(*) as total,
          SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
          SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost
          FROM predictions WHERE result IN ('won', 'lost')
          GROUP BY pick_type`,
    args: [],
  });

  for (const row of results.rows) {
    const pickType = row.pick_type as string;
    const total = row.total as number;
    const won = row.won as number;
    const lost = row.lost as number;
    const winRate = total > 0 ? won / total : 0;

    const existing = await client.execute({
      sql: 'SELECT id FROM track_record WHERE pick_type = ? AND month = ?',
      args: [pickType, month],
    });

    if (existing.rows.length > 0) {
      await client.execute({
        sql: `UPDATE track_record SET total = ?, won = ?, lost = ?, win_rate = ?, date = ? WHERE pick_type = ? AND month = ?`,
        args: [total, won, lost, winRate, today, pickType, month],
      });
    } else {
      await client.execute({
        sql: `INSERT INTO track_record (date, pick_type, total, won, lost, void_count, win_rate, month)
              VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        args: [today, pickType, total, won, lost, winRate, month],
      });
    }
  }
}
