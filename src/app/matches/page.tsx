'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { Navbar } from '@/components/layout/navbar';
import { BottomNav } from '@/components/layout/bottom-nav';
import { DateSelector } from '@/components/match/date-selector';
import { LeagueGroup } from '@/components/match/league-group';
import { useUIStore } from '@/stores/ui-store';
import { api, type FixtureData } from '@/lib/api-client';

export default function MatchesPage() {
  const { activeDate, searchQuery, setSearchQuery } = useUIStore();
  const [fixtures, setFixtures] = useState<FixtureData[]>([]);
  const [leagueMap, setLeagueMap] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getFixtures(activeDate);
      setFixtures(data.fixtures || []);
      setLeagueMap(data.leagueMap || {});
    } catch {
      // silent
    }
    setLoading(false);
  }, [activeDate]);

  useEffect(() => {
    const timer = setTimeout(() => { fetchData(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  const filteredFixtures = fixtures.filter((f) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      f.homeTeam.name.toLowerCase().includes(q) ||
      f.awayTeam.name.toLowerCase().includes(q) ||
      (f.leagueName || '').toLowerCase().includes(q)
    );
  });

  const grouped: Record<number, { leagueId: number; leagueName: string; fixtures: FixtureData[] }> = {};
  for (const f of filteredFixtures) {
    if (!grouped[f.leagueId]) {
      grouped[f.leagueId] = {
        leagueId: f.leagueId,
        leagueName: f.leagueName || leagueMap[f.leagueId] || `League ${f.leagueId}`,
        fixtures: [],
      };
    }
    grouped[f.leagueId].fixtures.push(f);
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#060a0e]">
      <Navbar />

      <main className="flex-1 pb-24 max-w-2xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Title */}
          <div className="px-4 pt-4 pb-2">
            <h1 className="text-2xl font-bold text-white font-[family-name:var(--font-space-grotesk)]">
              Matches
            </h1>
          </div>

          {/* Date Selector */}
          <DateSelector />

          {/* Search */}
          <div className="px-4 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.25)]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search teams or leagues..."
                className="input-dark pl-10 text-sm"
              />
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="px-4 py-8 space-y-4">
              {[1, 2, 3, 4].map((i) => (
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

          {/* Matches */}
          {!loading && (
            <div className="pb-4">
              {Object.keys(grouped).length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-[#9ca3af] text-sm">No matches found</p>
                </div>
              ) : (
                Object.values(grouped).map((group) => (
                  <LeagueGroup
                    key={group.leagueId}
                    leagueId={group.leagueId}
                    leagueName={group.leagueName}
                    fixtures={group.fixtures}
                    defaultExpanded
                  />
                ))
              )}
            </div>
          )}
        </motion.div>
      </main>

      <BottomNav />
    </div>
  );
}
