// Cron Pipeline V2: Sync → Enrich → Predict → Settle
// Called by external cron (Render cron job / cron-job.org) or manually via POST /api/cron
// This is the HEART of xG-Vantage — the engine that keeps everything running

import { NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';
import { fullDailySync, syncFixtures, deepSync } from '@/lib/sync-service';
import { computeAllTeamDNA } from '@/engine/team-dna';
import { predictMatch as predictMatchV2, predictUpcomingMatches as predictUpcomingV2, getTopPicks as getTopPicksV2, settlePredictions as settleV2 } from '@/engine/v2/prediction-engine';
import { recalcLeagueElo, updateEloAfterMatch } from '@/engine/elo-system';
import { initializeLeagueGlicko, recalcLeagueGlicko } from '@/engine/v2/bayesian-elo';
import { adjustModelWeights, getModelPerformance } from '@/engine/v2/learning-loop';

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
      // FULL PIPELINE V2: Sync → Enrich → Predict → Settle → Learn
      // ============================================================
      case 'full': {
        // Step 1: Run migrations (ensure tables exist — including V2 tables)
        logs.push('[Pipeline V2] Step 1: Ensuring DB schema...');
        try {
          const { migrate } = await import('@/lib/migrate');
          await migrate();
          logs.push('[Pipeline V2] Schema OK (V2 tables created)');
        } catch (err) {
          logs.push(`[Pipeline V2] Migration warning: ${err}`);
        }

        // Step 2: Sync data from BSD API → Turso (now includes team history!)
        logs.push('[Pipeline V2] Step 2: Syncing data from BSD API...');
        const syncResult = await fullDailySync();
        logs.push(`[Pipeline V2] Synced: ${syncResult.leagues} leagues, ${syncResult.fixtures} fixtures, ${syncResult.standings} standings, ${syncResult.teamHistories} team history fixtures`);

        // Step 3: Enrich — Compute team DNA from stored fixtures
        logs.push('[Pipeline V2] Step 3: Computing team DNA...');
        const dnaCount = await computeAllTeamDNA();
        logs.push(`[Pipeline V2] Computed DNA for ${dnaCount} teams`);

        // Step 4: Enrich — Recalculate ELO for top leagues (V1 ELO for backward compat)
        logs.push('[Pipeline V2] Step 4: Recalculating ELO...');
        const topLeagues = [17, 3, 9, 6, 13, 14, 30, 29, 34, 8];
        for (const leagueId of topLeagues) {
          try {
            await recalcLeagueElo(leagueId);
          } catch (err) {
            logs.push(`[Pipeline V2] ELO calc failed for league ${leagueId}: ${err}`);
          }
        }
        logs.push('[Pipeline V2] ELO recalculated for top leagues');

        // Step 4b: Initialize Glicko ratings for teams in top leagues (V2 Bayesian ELO)
        logs.push('[Pipeline V2] Step 4b: Initializing Glicko (Bayesian ELO)...');
        for (const leagueId of topLeagues) {
          try {
            await initializeLeagueGlicko(leagueId);
            await recalcLeagueGlicko(leagueId);
          } catch (err) {
            logs.push(`[Pipeline V2] Glicko init failed for league ${leagueId}: ${err}`);
          }
        }
        logs.push('[Pipeline V2] Glicko ratings initialized for top leagues');

        // Step 5: Predict upcoming matches using V2 engine
        logs.push('[Pipeline V2] Step 5: Running V2 predictions (10-layer xG + 50K MC + 9-step market)...');
        const predictions = await predictUpcomingV2();
        const eliteCount = predictions.filter(p => p.tier === 'elite').length;
        const playableCount = predictions.filter(p => p.tier === 'playable').length;
        const abstainedCount = predictions.filter(p => p.marketSelection.abstained).length;
        logs.push(`[Pipeline V2] Generated ${predictions.length} predictions: ${eliteCount} elite, ${playableCount} playable, ${abstainedCount} abstained`);

        // Step 6: Generate top picks from V2 predictions
        logs.push('[Pipeline V2] Step 6: Generating V2 picks...');
        const picks = await getTopPicksV2(10);
        const today = new Date().toISOString().split('T')[0];
        for (let i = 0; i < picks.length; i++) {
          const pick = picks[i];
          try {
            // Store in both old picks table (for frontend compat) and new predictions_v2
            await client.execute({
              sql: `INSERT OR REPLACE INTO picks (prediction_id, fixture_id, rank, date, category)
                    VALUES ((SELECT id FROM predictions WHERE fixture_id = ?), ?, ?, ?, ?)`,
              args: [pick.fixtureId, pick.fixtureId, i + 1, today, pick.tier],
            });
          } catch (err) {
            logs.push(`[Pipeline V2] Pick storage warning: ${err}`);
          }
        }
        logs.push(`[Pipeline V2] Stored ${picks.length} top picks`);

        // Step 7: Settle past predictions (V2 learning loop)
        logs.push('[Pipeline V2] Step 7: Settling predictions via V2 learning loop...');
        const settled = await settleV2();
        logs.push(`[Pipeline V2] Settled ${settled.settled} predictions`);

        // Step 7b: Update ELO for newly settled matches
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

        // Step 8: Adjust model weights via learning loop
        logs.push('[Pipeline V2] Step 8: Adjusting model weights via learning loop...');
        try {
          await adjustModelWeights();
          const perf = await getModelPerformance();
          logs.push(`[Pipeline V2] Model accuracy: ${(perf.overallAccuracy * 100).toFixed(1)}%, Brier: ${perf.overallBrier.toFixed(4)}, Total settled: ${perf.totalSettled}`);
        } catch (err) {
          logs.push(`[Pipeline V2] Weight adjustment warning: ${err}`);
        }

        // Step 9: Update track record
        logs.push('[Pipeline V2] Step 9: Updating track record...');
        try {
          await updateTrackRecord();
          logs.push('[Pipeline V2] Track record updated');
        } catch (err) {
          logs.push(`[Pipeline V2] Track record warning: ${err}`);
        }

        result = {
          sync: syncResult,
          dnaComputed: dnaCount,
          predictionsGenerated: predictions.length,
          elitePicks: eliteCount,
          playablePicks: playableCount,
          abstained: abstainedCount,
          picksGenerated: picks.length,
          predictionsSettled: settled.settled,
          eloUpdates: settledFixtures.rows.length,
        };
        break;
      }

      // ============================================================
      // DEEP SYNC: Pull historical data for top leagues
      // ============================================================
      case 'deep-sync': {
        const daysBack = body.daysBack || 60;
        logs.push(`[Pipeline V2] Deep sync: pulling ${daysBack} days of history...`);

        const deepResult = await deepSync(daysBack);
        result = { deepSync: deepResult };
        logs.push(`Deep sync: ${deepResult.leagues} leagues, ${deepResult.fixtures} fixtures, ${deepResult.standings} standings, ${deepResult.teamHistories} team histories`);

        // Also compute DNA and ELO after deep sync
        logs.push('[Pipeline V2] Computing DNA after deep sync...');
        const dnaCount = await computeAllTeamDNA();
        logs.push(`[Pipeline V2] Computed DNA for ${dnaCount} teams`);

        const topLeagues = [17, 3, 9, 6, 13, 14, 30, 29, 34, 8];
        for (const leagueId of topLeagues) {
          try { await recalcLeagueElo(leagueId); } catch { /* skip */ }
          try { await recalcLeagueGlicko(leagueId); } catch { /* skip */ }
        }
        logs.push('[Pipeline V2] ELO + Glicko recalculated for top leagues');

        result = { ...deepResult, dnaComputed: dnaCount };
        break;
      }

      // ============================================================
      // SYNC ONLY: Just pull data from BSD API
      // ============================================================
      case 'sync': {
        const syncResult = await fullDailySync();
        result = { sync: syncResult };
        logs.push(`Synced: ${syncResult.leagues} leagues, ${syncResult.fixtures} fixtures, ${syncResult.standings} standings, ${syncResult.teamHistories} team histories`);
        break;
      }

      // ============================================================
      // ENRICH ONLY: Compute DNA + ELO + Glicko from existing data
      // ============================================================
      case 'enrich': {
        const dnaCount = await computeAllTeamDNA();
        const topLeagues = [17, 3, 9, 6, 13, 14, 30, 29, 34, 8];
        for (const leagueId of topLeagues) {
          try { await recalcLeagueElo(leagueId); } catch { /* skip */ }
          try { await recalcLeagueGlicko(leagueId); } catch { /* skip */ }
        }
        result = { dnaComputed: dnaCount };
        logs.push(`Enriched: DNA for ${dnaCount} teams, ELO + Glicko for top leagues`);
        break;
      }

      // ============================================================
      // PREDICT ONLY: Generate V2 predictions from stored data
      // ============================================================
      case 'predict': {
        const predictions = await predictUpcomingV2();
        const picks = await getTopPicksV2(10);
        const eliteCount = predictions.filter(p => p.tier === 'elite').length;
        const playableCount = predictions.filter(p => p.tier === 'playable').length;
        const abstainedCount = predictions.filter(p => p.marketSelection.abstained).length;
        result = { predictionsGenerated: predictions.length, elitePicks: eliteCount, playablePicks: playableCount, abstained: abstainedCount, picksGenerated: picks.length };
        logs.push(`Predicted V2: ${predictions.length} matches (${eliteCount} elite, ${playableCount} playable, ${abstainedCount} abstained), ${picks.length} top picks`);
        break;
      }

      // ============================================================
      // SETTLE ONLY: Check finished matches and settle predictions
      // ============================================================
      case 'settle': {
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        await syncFixtures({ dateFrom: yesterday, dateTo: today });
        const settled = await settleV2();
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
        // Adjust weights
        try { await adjustModelWeights(); } catch { /* skip */ }
        result = { predictionsSettled: settled.settled, eloUpdates: settledFixtures.rows.length };
        logs.push(`Settled: ${settled.settled} predictions, ${settledFixtures.rows.length} ELO updates`);
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

      // ============================================================
      // SINGLE PREDICT: Generate V2 prediction for a single match
      // ============================================================
      case 'predict-single': {
        const fixtureId = body.fixtureId;
        if (!fixtureId) {
          return NextResponse.json({ error: 'fixtureId required for predict-single' }, { status: 400 });
        }
        logs.push(`[Pipeline V2] Predicting single match: fixture ${fixtureId}`);
        const prediction = await predictMatchV2(fixtureId);
        result = { prediction };
        logs.push(`[Pipeline V2] Prediction: tier=${prediction.tier}, confidence=${prediction.confidence.composite}, script=${prediction.script.primary}`);
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown action. Use: full, sync, deep-sync, enrich, predict, predict-single, settle, live' }, { status: 400 });
    }

    const elapsed = Date.now() - startTime;
    logs.push(`[Pipeline V2] Completed in ${(elapsed / 1000).toFixed(1)}s`);

    return NextResponse.json({
      success: true,
      action,
      engineVersion: 'v3',
      elapsed_ms: elapsed,
      result,
      logs,
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    logs.push(`[Pipeline V2] ERROR after ${(elapsed / 1000).toFixed(1)}s: ${error}`);
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
    const predictionV2Count = await client.execute('SELECT COUNT(*) as cnt FROM predictions_v2');
    const teamCount = await client.execute('SELECT COUNT(*) as cnt FROM teams');
    const teamProfileCount = await client.execute('SELECT COUNT(*) as cnt FROM team_profiles');
    const eloCount = await client.execute('SELECT COUNT(*) as cnt FROM team_elo');
    const glickoCount = await client.execute('SELECT COUNT(*) as cnt FROM team_glicko');
    const finishedCount = await client.execute("SELECT COUNT(*) as cnt FROM fixtures WHERE status = 'finished'");
    const feedbackCount = await client.execute('SELECT COUNT(*) as cnt FROM prediction_feedback');
    const calibrationCount = await client.execute('SELECT COUNT(*) as cnt FROM calibration_bins');

    let modelPerformance: Awaited<ReturnType<typeof getModelPerformance>> | null = null;
    try {
      modelPerformance = await getModelPerformance();
    } catch { /* not enough data yet */ }

    return NextResponse.json({
      status: 'healthy',
      engine: 'v3',
      timestamp: new Date().toISOString(),
      database: {
        leagues: leagueCount.rows[0].cnt,
        fixtures: fixtureCount.rows[0].cnt,
        finishedFixtures: finishedCount.rows[0].cnt,
        predictionsV1: predictionCount.rows[0].cnt,
        predictionsV2: predictionV2Count.rows[0].cnt,
        teams: teamCount.rows[0].cnt,
        teamProfiles: teamProfileCount.rows[0].cnt,
        teamElo: eloCount.rows[0].cnt,
        teamGlicko: glickoCount.rows[0].cnt,
        feedbackEntries: feedbackCount.rows[0].cnt,
        calibrationBins: calibrationCount.rows[0].cnt,
      },
      modelPerformance: modelPerformance ? {
        accuracy: `${(modelPerformance.overallAccuracy * 100).toFixed(1)}%`,
        brierScore: modelPerformance.overallBrier.toFixed(4),
        totalSettled: modelPerformance.totalSettled,
        calibrationDrift: modelPerformance.calibrationDrift.toFixed(4),
      } : null,
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

  // Update from V1 predictions (backward compat)
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

  // Also update from V2 predictions
  const v2Results = await client.execute({
    sql: `SELECT tier, COUNT(*) as total,
          SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
          SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost
          FROM predictions_v2 WHERE result IN ('won', 'lost')
          GROUP BY tier`,
    args: [],
  });

  for (const row of v2Results.rows) {
    const pickType = `v2_${row.tier}` as string;
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
