'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, X } from 'lucide-react';
import Link from 'next/link';
import { PredictionTab } from '@/components/match-detail/prediction-tab';
import { StatsTab } from '@/components/match-detail/stats-tab';
import { PitchTab } from '@/components/match-detail/pitch-tab';
import { LineupsTab } from '@/components/match-detail/lineups-tab';
import { LeagueTab } from '@/components/match-detail/league-tab';
import { AIChatTab } from '@/components/match-detail/ai-chat-tab';
import { api } from '@/lib/api-client';

type TabId = 'prediction' | 'stats' | 'pitch' | 'lineups' | 'league' | 'chat';

export default function MatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const fixtureId = parseInt(params.id as string);
  const [matchData, setMatchData] = useState<Record<string, unknown> | null>(null);
  const [standings, setStandings] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('prediction');

  useEffect(() => {
    if (!fixtureId) return;
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      try {
        const data = await api.getMatch(fixtureId);
        if (!cancelled) {
          setMatchData(data.fixture || {});
          const leagueId = (data.fixture as Record<string, unknown>)?.leagueId as number;
          if (leagueId) {
            try {
              const sData = await api.getStandings(leagueId);
              if (!cancelled) setStandings((sData as Record<string, unknown>).standings as Array<Record<string, unknown>> || []);
            } catch {
              // silent
            }
          }
        }
      } catch {
        // silent
      }
      if (!cancelled) setLoading(false);
    };

    fetchData();
    return () => { cancelled = true; };
  }, [fixtureId]);

  const fixture = matchData || {};
  const prediction = (fixture.prediction || (fixture as Record<string, unknown>).prediction) as Record<string, unknown> | null;
  const stats = (fixture.stats || (fixture as Record<string, unknown>).stats) as Record<string, unknown> | null;
  const lineup = (fixture.lineup || (fixture as Record<string, unknown>).lineup) as Record<string, unknown> | null;
  const odds = (fixture.odds || (fixture as Record<string, unknown>).odds) as Record<string, unknown> | null;
  const metadata = (fixture.metadata || (fixture as Record<string, unknown>).metadata) as Record<string, unknown> | null;
  const homeTeam = fixture.homeTeam as Record<string, string> | undefined;
  const awayTeam = fixture.awayTeam as Record<string, string> | undefined;
  const isLive = (fixture.status as string) === 'inprogress';
  const isFinished = (fixture.status as string) === 'finished';

  const tabs: { id: TabId; label: string }[] = [
    { id: 'prediction', label: 'Prediction' },
    { id: 'stats', label: 'Stats' },
    { id: 'pitch', label: 'Pitch' },
    { id: 'lineups', label: 'Lineups' },
    { id: 'league', label: 'League' },
    { id: 'chat', label: 'AI Chat' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#060a0e]">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-card">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="flex-1">
            {/* Match Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-sm font-bold text-white truncate">{homeTeam?.name || 'Home'}</span>
              </div>
              <div className="px-3 flex-shrink-0 text-center">
                {isLive && (
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10e774] live-pulse" />
                    <span className="text-xs font-bold text-[#10e774]">
                      {(fixture.currentMinute as number) || 0}&apos;
                    </span>
                  </div>
                )}
                {!isLive && !isFinished && (
                  <span className="text-xs text-[#9ca3af]">
                    {fixture.eventDate ? new Date(fixture.eventDate as string).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}
                  </span>
                )}
                {isFinished && <span className="text-xs font-bold text-[#9ca3af]">FT</span>}
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                <span className="text-sm font-bold text-white truncate">{awayTeam?.name || 'Away'}</span>
              </div>
            </div>
            {/* Score */}
            {(isLive || isFinished) && (
              <div className="flex items-center justify-center gap-3 mt-1">
                <span className={`text-xl font-bold ${isLive ? 'text-[#10e774]' : 'text-white'}`}>
                  {(fixture.homeScore as number) ?? '-'}
                </span>
                <span className="text-xs text-[rgba(255,255,255,0.2)]">-</span>
                <span className={`text-xl font-bold ${isLive ? 'text-[#10e774]' : 'text-white'}`}>
                  {(fixture.awayScore as number) ?? '-'}
                </span>
              </div>
            )}
          </div>
          <Link href="/" className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors">
            <X className="w-5 h-5 text-white" />
          </Link>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-[rgba(255,255,255,0.04)] px-1 scroll-x">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-shrink-0 px-3 py-2.5 text-xs font-semibold transition-all relative ${
                activeTab === t.id ? 'text-[#10e774]' : 'text-[#9ca3af] hover:text-white'
              }`}
            >
              {t.label}
              {activeTab === t.id && (
                <motion.div
                  layoutId="matchDetailTab"
                  className="absolute bottom-0 left-1 right-1 h-0.5 bg-[#10e774] rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 pb-4">
        {loading ? (
          <div className="p-4 space-y-4">
            <div className="glass-card rounded-2xl p-6 animate-pulse">
              <div className="flex justify-center gap-8 mb-6">
                <div className="h-10 w-10 bg-[rgba(255,255,255,0.06)] rounded-full" />
                <div className="h-6 w-16 bg-[rgba(255,255,255,0.06)] rounded" />
                <div className="h-10 w-10 bg-[rgba(255,255,255,0.06)] rounded-full" />
              </div>
              <div className="h-5 bg-[rgba(255,255,255,0.06)] rounded w-2/3 mx-auto mb-3" />
              <div className="h-3 bg-[rgba(255,255,255,0.06)] rounded w-1/2 mx-auto" />
            </div>
            <div className="glass-card rounded-2xl p-4 animate-pulse space-y-3">
              <div className="h-4 bg-[rgba(255,255,255,0.06)] rounded w-1/3" />
              <div className="h-8 bg-[rgba(255,255,255,0.06)] rounded" />
              <div className="h-8 bg-[rgba(255,255,255,0.06)] rounded" />
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {activeTab === 'prediction' && (
              <motion.div key="prediction" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                <PredictionTab fixture={fixture} prediction={prediction} odds={odds} metadata={metadata} />
              </motion.div>
            )}
            {activeTab === 'stats' && (
              <motion.div key="stats" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                <StatsTab stats={stats} fixture={fixture} />
              </motion.div>
            )}
            {activeTab === 'pitch' && (
              <motion.div key="pitch" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                <PitchTab stats={stats} fixture={fixture} />
              </motion.div>
            )}
            {activeTab === 'lineups' && (
              <motion.div key="lineups" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                <LineupsTab lineup={lineup} fixture={fixture} />
              </motion.div>
            )}
            {activeTab === 'league' && (
              <motion.div key="league" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                <LeagueTab standings={standings} fixture={fixture} leagueName={fixture.leagueName as string} />
              </motion.div>
            )}
            {activeTab === 'chat' && (
              <motion.div key="chat" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                <AIChatTab fixture={fixture} />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}
