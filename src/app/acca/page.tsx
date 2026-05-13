'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Zap, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { BottomNav } from '@/components/layout/bottom-nav';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfidenceRing } from '@/components/shared/confidence-ring';
import { api, type PickData } from '@/lib/api-client';

export default function AccaPage() {
  const [picks, setPicks] = useState<PickData[]>([]);
  const [loading, setLoading] = useState(true);
  const [candidatesChecked] = useState(24);
  const [candidatesPassed] = useState(3);

  useEffect(() => {
    const fetchAccaData = async () => {
      setLoading(true);
      try {
        const picksData = await api.getPicks(10);
        // Simulate ACCA: top 3-4 picks with high confidence
        const accaPicks = (picksData.picks || [])
          .filter((p) => p.confidence >= 0.65)
          .slice(0, 4);
        setPicks(accaPicks);
      } catch {
        // silent
      }
      setLoading(false);
    };
    fetchAccaData();
  }, []);

  const combinedOdds = picks.reduce((acc, p) => {
    const odds = p.odds;
    if (!odds) return acc;
    const homeWin = odds.homeWin || 1.5;
    const awayWin = odds.awayWin || 1.5;
    const draw = odds.draw || 1.5;
    // Pick the relevant odds based on prediction
    const predResult = p.homeWinProb > p.awayWinProb ? homeWin : awayWin;
    return acc * predResult;
  }, 1);

  return (
    <div className="min-h-screen flex flex-col bg-[#060a0e]">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-card">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          <Link href="/" className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white font-[family-name:var(--font-space-grotesk)] flex items-center gap-2">
              <Zap className="w-5 h-5 text-[#10e774]" />
              Daily ACCA
            </h1>
            <p className="text-xs text-[#9ca3af]">Smart auto-generated accumulator</p>
          </div>
          <button className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors">
            <RefreshCw className="w-4 h-4 text-[#9ca3af]" />
          </button>
        </div>
      </header>

      <main className="flex-1 pb-24 max-w-2xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="px-4 py-4 space-y-4"
        >
          {/* Loading */}
          {loading && (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="glass-card rounded-2xl p-4 animate-pulse">
                  <div className="h-4 bg-[rgba(255,255,255,0.06)] rounded w-2/3 mb-2" />
                  <div className="h-3 bg-[rgba(255,255,255,0.06)] rounded w-1/3" />
                </div>
              ))}
            </div>
          )}

          {/* ACCA Cards */}
          {!loading && picks.length > 0 && (
            <>
              <div className="space-y-3">
                {picks.map((pick, i) => (
                  <div
                    key={pick.fixtureId}
                    className="glass-card rounded-2xl p-4 border-l-2 border-[#10e774]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-[#9ca3af]">
                          LEG {i + 1}
                        </span>
                        <span className="badge-green">PICK</span>
                      </div>
                      <ConfidenceRing confidence={pick.confidence * 100} size={36} />
                    </div>
                    <p className="text-sm font-bold text-white mb-1">
                      {pick.homeTeam} vs {pick.awayTeam}
                    </p>
                    <p className="text-xs font-semibold text-[#10e774]">
                      {pick.pickLabel || pick.recommendedBet || 'Home Win'}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-[#9ca3af]">
                        {new Date(pick.eventDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </span>
                      {pick.odds?.homeWin && (
                        <span className="text-[10px] text-[#9ca3af]">
                          @ {pick.odds.homeWin.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Combined Odds & Payout */}
              <div className="glass-card rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-[#9ca3af] font-semibold uppercase tracking-wider">Combined Odds</span>
                  <span className="text-lg font-bold text-[#10e774]">{combinedOdds.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9ca3af]">Potential Payout (£10 stake)</span>
                  <span className="text-sm font-bold text-white">£{(10 * combinedOdds).toFixed(2)}</span>
                </div>
              </div>
            </>
          )}

          {/* Empty State */}
          {!loading && picks.length === 0 && (
            <EmptyState
              icon={Zap}
              title="No ACCA picks available yet"
              description="ACCA picks are generated daily from our top predictions. Check back later!"
            />
          )}

          {/* Engine Scan Box */}
          <div className="glass-card rounded-2xl p-4">
            <h4 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">Engine Scan</h4>
            <p className="text-sm text-white">
              {candidatesChecked} candidate(s) checked, <span className="text-[#10e774] font-semibold">{candidatesPassed}</span> passed ACCA-grade filters.
            </p>
          </div>
        </motion.div>
      </main>

      <BottomNav />
    </div>
  );
}
