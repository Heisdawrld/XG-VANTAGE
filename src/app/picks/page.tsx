'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Flame, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BottomNav } from '@/components/layout/bottom-nav';
import { PickCard } from '@/components/picks/pick-card';
import { useUIStore } from '@/stores/ui-store';
import { api, type PickData } from '@/lib/api-client';

export default function PicksPage() {
  const router = useRouter();
  const { pickFilter, setPickFilter } = useUIStore();
  const [picks, setPicks] = useState<PickData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPicks = async () => {
      setLoading(true);
      try {
        const data = await api.getPicks(20);
        setPicks(data.picks || []);
      } catch {
        // silent
      }
      setLoading(false);
    };
    fetchPicks();
  }, []);

  const filteredPicks = picks.filter((p) => {
    if (pickFilter === 'ALL') return true;
    if (pickFilter === 'SAFE') return (p.confidence || 0) >= 0.75;
    if (pickFilter === 'VALUE') return p.valueDetected;
    if (pickFilter === 'ELITE') return p.tier?.toUpperCase() === 'ELITE';
    return true;
  });

  const avgConfidence = picks.length > 0
    ? picks.reduce((sum, p) => sum + p.confidence, 0) / picks.length * 100
    : 0;

  const handleSelectMatch = (fixtureId: number) => {
    router.push(`/match/${fixtureId}`);
  };

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
              <Flame className="w-5 h-5 text-[#10e774]" />
              Today&apos;s Picks
            </h1>
            <p className="text-xs text-[#9ca3af]">
              {picks.length} picks ranked by composite score
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-24 max-w-2xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Stats Row */}
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-full bg-[rgba(16,231,116,0.1)] border border-[rgba(16,231,116,0.15)]">
              <span className="text-xs font-bold text-[#10e774]">{avgConfidence.toFixed(0)}% avg</span>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-[rgba(255,255,255,0.04)]">
              <span className="text-xs text-[#9ca3af]">150W · 65L</span>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="px-4 pb-3">
            <div className="flex gap-2">
              {(['ALL', 'SAFE', 'VALUE', 'ELITE'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setPickFilter(f)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    pickFilter === f
                      ? 'bg-[#10e774] text-[#060a0e]'
                      : 'bg-[rgba(255,255,255,0.04)] text-[#9ca3af] hover:bg-[rgba(255,255,255,0.08)]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="px-4 py-8 space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="glass-card rounded-2xl p-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[rgba(255,255,255,0.06)] rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-[rgba(255,255,255,0.06)] rounded w-2/3" />
                      <div className="h-3 bg-[rgba(255,255,255,0.06)] rounded w-1/3" />
                    </div>
                    <div className="w-12 h-12 bg-[rgba(255,255,255,0.06)] rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Picks */}
          {!loading && (
            <div className="px-4 space-y-3 pb-4">
              {filteredPicks.length === 0 ? (
                <div className="py-16 text-center">
                  <Trophy className="w-10 h-10 text-[rgba(255,255,255,0.1)] mx-auto mb-3" />
                  <p className="text-[#9ca3af] text-sm">No picks available for this filter</p>
                </div>
              ) : (
                filteredPicks.map((pick) => (
                  <PickCard key={pick.fixtureId} pick={pick} onSelect={handleSelectMatch} />
                ))
              )}
            </div>
          )}

          {/* Disclaimer */}
          <div className="px-4 pb-8">
            <p className="text-[10px] text-[rgba(255,255,255,0.2)] text-center">
              Only picks above quality threshold. Always gamble responsibly.
            </p>
          </div>
        </motion.div>
      </main>

      <BottomNav />
    </div>
  );
}
