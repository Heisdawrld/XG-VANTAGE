'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Star, BarChart3, MessageCircle } from 'lucide-react';
import { Navbar } from '@/components/layout/navbar';
import { BottomNav } from '@/components/layout/bottom-nav';
import { DateSelector } from '@/components/match/date-selector';
import { LeagueGroup } from '@/components/match/league-group';
import { TopPickCard } from '@/components/match/top-pick-card';
import { ConfidenceRing } from '@/components/shared/confidence-ring';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { api, type FixtureData, type PickData } from '@/lib/api-client';
import Link from 'next/link';

export default function HomePage() {
  const { user, initialize, isAuthenticated } = useAuthStore();
  const { activeDate, searchQuery, setSearchQuery } = useUIStore();
  const [fixtures, setFixtures] = useState<FixtureData[]>([]);
  const [grouped, setGrouped] = useState<Record<number, { leagueId: number; leagueName: string; fixtures: FixtureData[] }>>({});
  const [leagueMap, setLeagueMap] = useState<Record<number, string>>({});
  const [picks, setPicks] = useState<PickData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<'ALL' | 'LIVE' | 'FAV'>('ALL');
  const [showTopPick, setShowTopPick] = useState(true);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [fixturesData, picksData] = await Promise.all([
        api.getFixtures(activeDate),
        api.getPicks(5),
      ]);
      setFixtures(fixturesData.fixtures || []);
      setGrouped(fixturesData.grouped || {});
      setLeagueMap(fixturesData.leagueMap || {});
      setPicks(picksData.picks || []);
    } catch (err) {
      console.error('[Home] Data fetch error:', err);
    }
    setLoading(false);
  }, [activeDate]);

  useEffect(() => {
    const timer = setTimeout(() => { fetchData(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  const topPick = picks.length > 0 ? picks[0] : null;

  const filteredFixtures = fixtures.filter((f) => {
    if (filterMode === 'LIVE') return f.status === 'inprogress';
    if (filterMode === 'FAV') return f.prediction && f.prediction.confidence >= 0.7;
    return true;
  }).filter((f) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      f.homeTeam.name.toLowerCase().includes(q) ||
      f.awayTeam.name.toLowerCase().includes(q) ||
      (f.leagueName || '').toLowerCase().includes(q)
    );
  });

  const matchCount = filteredFixtures.length;

  // Re-group filtered fixtures
  const filteredGrouped: Record<number, { leagueId: number; leagueName: string; fixtures: FixtureData[] }> = {};
  for (const f of filteredFixtures) {
    if (!filteredGrouped[f.leagueId]) {
      filteredGrouped[f.leagueId] = {
        leagueId: f.leagueId,
        leagueName: f.leagueName || leagueMap[f.leagueId] || `League ${f.leagueId}`,
        fixtures: [],
      };
    }
    filteredGrouped[f.leagueId].fixtures.push(f);
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#060a0e]">
      <Navbar />

      <main className="flex-1 pb-24 max-w-2xl mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeDate}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {/* Greeting Section */}
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white font-[family-name:var(--font-space-grotesk)]">
                  Hey, {user?.username || 'there'}
                </h2>
                <p className="text-sm text-[#9ca3af]">
                  {matchCount} match{matchCount !== 1 ? 'es' : ''} today
                </p>
              </div>
              <Link
                href="/picks"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[rgba(16,231,116,0.1)] border border-[rgba(16,231,116,0.15)] text-sm font-semibold text-[#10e774] hover:bg-[rgba(16,231,116,0.15)] transition-colors"
              >
                <Star className="w-4 h-4" />
                Picks
              </Link>
            </div>

            {/* Top Pick Card */}
            {showTopPick && topPick && (
              <div className="px-4 mb-4">
                <TopPickCard
                  homeTeam={topPick.homeTeam}
                  awayTeam={topPick.awayTeam}
                  prediction={topPick.pickLabel || topPick.recommendedBet || 'Home Win'}
                  confidence={topPick.confidence * 100}
                  onClose={() => setShowTopPick(false)}
                />
              </div>
            )}

            {/* Date Selector */}
            <DateSelector />

            {/* Search & Filter */}
            <div className="px-4 py-3 space-y-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.25)]" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search teams or leagues..."
                  className="input-dark pl-10 text-sm"
                />
              </div>

              {/* Filter Pills */}
              <div className="flex gap-2">
                {(['ALL', 'LIVE', 'FAV'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setFilterMode(mode)}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      filterMode === mode
                        ? 'bg-[#10e774] text-[#060a0e]'
                        : 'bg-[rgba(255,255,255,0.04)] text-[#9ca3af] hover:bg-[rgba(255,255,255,0.08)]'
                    }`}
                  >
                    {mode === 'LIVE' && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
                    )}
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Loading State */}
            {loading && (
              <div className="px-4 py-8 space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="glass-card rounded-2xl p-4 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="h-5 w-16 bg-[rgba(255,255,255,0.06)] rounded" />
                      <div className="flex-1" />
                      <div className="h-5 w-8 bg-[rgba(255,255,255,0.06)] rounded" />
                      <div className="flex-1" />
                      <div className="h-5 w-16 bg-[rgba(255,255,255,0.06)] rounded" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* League Groups */}
            {!loading && (
              <div className="pb-4">
                {Object.keys(filteredGrouped).length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="text-[#9ca3af] text-sm">No matches found</p>
                    <p className="text-[rgba(255,255,255,0.2)] text-xs mt-1">Try a different date or filter</p>
                  </div>
                ) : (
                  Object.values(filteredGrouped).map((group) => (
                    <LeagueGroup
                      key={group.leagueId}
                      leagueId={group.leagueId}
                      leagueName={group.leagueName}
                      fixtures={group.fixtures}
                      defaultExpanded={Object.keys(filteredGrouped).length <= 3}
                    />
                  ))
                )}
              </div>
            )}

            {/* Bottom Action Buttons */}
            <div className="px-4 pb-8 grid grid-cols-2 gap-3">
              <Link
                href="/picks"
                className="glass-card glass-card-hover rounded-2xl p-4 flex items-center gap-3 transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-[rgba(16,231,116,0.1)] flex items-center justify-center group-hover:bg-[rgba(16,231,116,0.15)] transition-colors">
                  <Star className="w-5 h-5 text-[#10e774]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Today&apos;s Picks</p>
                  <p className="text-[10px] text-[#9ca3af]">Best predictions</p>
                </div>
              </Link>
              <Link
                href="/track-record"
                className="glass-card glass-card-hover rounded-2xl p-4 flex items-center gap-3 transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-[rgba(59,130,246,0.1)] flex items-center justify-center group-hover:bg-[rgba(59,130,246,0.15)] transition-colors">
                  <BarChart3 className="w-5 h-5 text-[#60a5fa]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Track Record</p>
                  <p className="text-[10px] text-[#9ca3af]">Win rate stats</p>
                </div>
              </Link>
            </div>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating Chat Button */}
      <Link
        href="/picks"
        className="fixed bottom-20 right-4 w-12 h-12 rounded-full gradient-green flex items-center justify-center glow-green z-40 hover:scale-105 transition-transform"
      >
        <MessageCircle className="w-5 h-5 text-[#060a0e]" />
      </Link>

      <BottomNav />
    </div>
  );
}
