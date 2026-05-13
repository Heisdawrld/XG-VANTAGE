'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================================================
// ICONS (inline SVGs — no dependency needed)
// ============================================================================
function HomeIcon({ active }: { active?: boolean }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#818cf8' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
}
function PicksIcon({ active }: { active?: boolean }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#818cf8' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
}
function AccaIcon({ active }: { active?: boolean }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#818cf8' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="2" y1="15" x2="22" y2="15"/><line x1="8" y1="3" x2="8" y2="21"/></svg>;
}
function ProfileIcon({ active }: { active?: boolean }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#818cf8' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}

function SyncButton({ onSyncComplete }: { onSyncComplete: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fixtures', dateFrom: today, dateTo: tomorrow }),
      });
      setLastSync(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
      onSyncComplete();
    } catch { /* silent */ }
    setSyncing(false);
  };

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 transition-all text-xs text-slate-400 disabled:opacity-50"
      title={lastSync ? `Last sync: ${lastSync}` : 'Sync data'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={syncing ? 'animate-spin' : ''}>
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      {syncing ? 'Sync' : lastSync || 'Sync'}
    </button>
  );
}

// ============================================================================
// TYPES
// ============================================================================
interface Fixture {
  id: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: { name: string; id: number };
  awayTeam: { name: string; id: number };
  eventDate: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  leagueId: number;
  currentMinute?: number;
  period?: string;
  isLocalDerby: boolean;
  prediction?: {
    predictedResult: string;
    probHomeWin: number;
    probDraw: number;
    probAwayWin: number;
    confidence: number;
  } | null;
  odds?: {
    homeWin: number | null;
    draw: number | null;
    awayWin: number | null;
  } | null;
  lineup?: {
    homeFormation: string;
    awayFormation: string;
  } | null;
}

interface Pick {
  rank: number;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: number;
  awayTeamId: number;
  eventDate: string;
  predictedResult: string;
  confidence: number;
  probHomeWin: number;
  probDraw: number;
  probAwayWin: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  probOver25: number;
  probBttsYes: number;
  mostLikelyScore: string;
  recommendedBet: string;
  valueDetected: boolean;
  valueEdge: number;
  kellyStake: number;
  odds: { homeWin: number | null; draw: number | null; awayWin: number | null; over25: number | null; bttsYes: number | null } | null;
}

interface Standing {
  position: number;
  team: { name: string; id: number };
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  form: string;
  xgf: number | null;
  xga: number | null;
}

// Match Detail types
interface MatchDetailData {
  source: string;
  fixture: {
    id: number;
    leagueId: number;
    homeTeamId: number;
    awayTeamId: number;
    eventDate: string;
    status: string;
    period?: string;
    currentMinute?: number;
    homeScore: number | null;
    awayScore: number | null;
    homeScoreHt?: number | null;
    awayScoreHt?: number | null;
    isLocalDerby: boolean;
    homeTeam: { id: number; name: string; shortName?: string };
    awayTeam: { id: number; name: string; shortName?: string };
    stats?: MatchStats | null;
    incidents?: MatchIncident[] | null;
    lineup?: MatchLineup | null;
    odds?: MatchOdds | null;
    metadata?: MatchMetadata | null;
    prediction?: MatchPrediction | null;
    playerStats?: unknown[];
  };
  stats?: MatchStats | null;
  incidents?: MatchIncident[] | null;
  odds?: MatchOdds | null;
  lineups?: unknown;
  metadata?: MatchMetadata | null;
}

interface MatchStats {
  homeBallPossession: number;
  awayBallPossession: number;
  homeTotalShots: number;
  awayTotalShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeBigChances: number;
  awayBigChances: number;
  homeCornerKicks: number;
  awayCornerKicks: number;
  homePasses: number;
  awayPasses: number;
  homePassAccuracy: number;
  awayPassAccuracy: number;
  homeTotalTackles: number;
  awayTotalTackles: number;
  homeInterceptions: number;
  awayInterceptions: number;
  homeFouls: number;
  awayFouls: number;
  homeYellowCards: number;
  awayYellowCards: number;
  homeRedCards: number;
  awayRedCards: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  homeShotsInsideBox: number;
  awayShotsInsideBox: number;
  homeAttacks: number;
  awayAttacks: number;
  homeDangerousAttacks: number;
  awayDangerousAttacks: number;
  homeOffsides: number;
  awayOffsides: number;
  homeClearances: number;
  awayClearances: number;
  homeDribblesSuccess: number;
  awayDribblesSuccess: number;
  homeDribblesTotal: number;
  awayDribblesTotal: number;
}

interface MatchIncident {
  id: string;
  type: string;
  minute: number;
  addedTime?: number | null;
  player?: string | null;
  playerIn?: string | null;
  playerOut?: string | null;
  isHome?: boolean | null;
  cardType?: string | null;
  goalType?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
}

interface MatchLineup {
  lineupStatus: string;
  homeFormation: string;
  awayFormation: string;
  homePlayers: string;
  awayPlayers: string;
  homeSubstitutes: string;
  awaySubstitutes: string;
  homeUnavailable: string;
  awayUnavailable: string;
  homeConfidence?: number | null;
  awayConfidence?: number | null;
}

interface MatchOdds {
  homeWin: number | null;
  draw: number | null;
  awayWin: number | null;
  over15Goals?: number | null;
  over25Goals?: number | null;
  over35Goals?: number | null;
  under15Goals?: number | null;
  under25Goals?: number | null;
  under35Goals?: number | null;
  bttsYes?: number | null;
  bttsNo?: number | null;
}

interface MatchMetadata {
  aiPreview?: string;
  funFacts?: string;
}

interface MatchPrediction {
  probHomeWin: number;
  probDraw: number;
  probAwayWin: number;
  predictedResult: string;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  probOver15: number;
  probOver25: number;
  probOver35: number;
  probBttsYes: number;
  mostLikelyScore: string;
  confidence: number;
  modelVersion: string;
  homeAdvantageAdj: number;
  formAdvantage: number;
  restAdvantage: number;
  motivationScore: number;
  derbyFactor: number;
  rotationRisk: number;
  valueDetected: boolean;
  valueEdge: number;
  kellyStake: number;
  recommendedBet: string;
  ensembleDetail: string;
}

interface LineupPlayer {
  name: string;
  position: string;
  jerseyNumber?: number;
  rating?: number;
}

type Tab = 'home' | 'picks' | 'acca' | 'profile';
type MatchDetailTab = 'prediction' | 'stats' | 'lineup' | 'standings' | 'live';

// ============================================================================
// MAIN APP
// ============================================================================
export default function Home() {
  const [tab, setTab] = useState<Tab>('home');
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [liveEvents, setLiveEvents] = useState<Array<Record<string, unknown>>>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [accaSelections, setAccaSelections] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<number | null>(null);
  const [leagueNames, setLeagueNames] = useState<Record<number, string>>({});

  // Fetch fixtures
  const fetchFixtures = useCallback(async () => {
    try {
      const res = await fetch('/api/fixtures');
      const data = await res.json();
      setFixtures(data.fixtures || []);
      if (data.leagueMap) setLeagueNames(data.leagueMap);
    } catch { /* silent */ }
  }, []);

  // Fetch live
  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch('/api/live');
      const data = await res.json();
      setLiveEvents(data.events || []);
    } catch { /* silent */ }
  }, []);

  // Fetch picks
  const fetchPicks = useCallback(async () => {
    try {
      const res = await fetch('/api/picks?limit=10');
      const data = await res.json();
      setPicks(data.picks || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchFixtures(), fetchLive(), fetchPicks()]);
      setLoading(false);
    };
    load();
    // Refresh live every 30s
    const interval = setInterval(fetchLive, 30000);
    return () => clearInterval(interval);
  }, [fetchFixtures, fetchLive, fetchPicks]);

  // Group fixtures by league
  const groupedFixtures = fixtures.reduce((acc, f) => {
    const key = f.leagueId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(f);
    return acc;
  }, {} as Record<number, Fixture[]>);

  const toggleAcca = (pick: Pick) => {
    setAccaSelections(prev => {
      const exists = prev.find(p => p.fixtureId === pick.fixtureId);
      if (exists) return prev.filter(p => p.fixtureId !== pick.fixtureId);
      return [...prev, pick];
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-card px-4 py-3">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-accent flex items-center justify-center text-white font-bold text-sm">xG</div>
            <h1 className="text-lg font-bold text-white">Vantage</h1>
          </div>
          <div className="flex items-center gap-2">
            <SyncButton onSyncComplete={() => { fetchFixtures(); fetchPicks(); }} />
            {liveEvents.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 live-pulse" />
                {liveEvents.length} LIVE
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 pb-20 max-w-lg mx-auto w-full">
        <AnimatePresence mode="wait">
          {tab === 'home' && (
            <motion.div key="home" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <HomeTab
                fixtures={fixtures}
                groupedFixtures={groupedFixtures}
                leagueNames={leagueNames}
                liveEvents={liveEvents}
                loading={loading}
                onSelectMatch={(id) => setSelectedMatch(id)}
              />
            </motion.div>
          )}
          {tab === 'picks' && (
            <motion.div key="picks" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <PicksTab picks={picks} loading={loading} onAddToAcca={toggleAcca} accaSelections={accaSelections} onSelectMatch={(id) => setSelectedMatch(id)} />
            </motion.div>
          )}
          {tab === 'acca' && (
            <motion.div key="acca" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <AccaTab selections={accaSelections} onRemove={toggleAcca} />
            </motion.div>
          )}
          {tab === 'profile' && (
            <motion.div key="profile" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <ProfileTab />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 glass-card pb-safe">
        <div className="flex justify-around max-w-lg mx-auto py-2">
          {[
            { id: 'home' as Tab, icon: HomeIcon, label: 'Home' },
            { id: 'picks' as Tab, icon: PicksIcon, label: 'Picks' },
            { id: 'acca' as Tab, icon: AccaIcon, label: 'Acca' },
            { id: 'profile' as Tab, icon: ProfileIcon, label: 'Profile' },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex flex-col items-center gap-0.5 px-4 py-1 transition-colors"
            >
              <Icon active={tab === id} />
              <span className={`text-[10px] font-medium ${tab === id ? 'text-indigo-400' : 'text-slate-500'}`}>
                {label}
              </span>
              {id === 'acca' && accaSelections.length > 0 && (
                <span className="absolute -mt-1 ml-4 w-4 h-4 rounded-full gradient-accent text-[9px] text-white flex items-center justify-center font-bold">
                  {accaSelections.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Match Detail Overlay */}
      <AnimatePresence>
        {selectedMatch !== null && (
          <MatchDetailOverlay
            fixtureId={selectedMatch}
            onClose={() => setSelectedMatch(null)}
            leagueNames={leagueNames}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// MATCH DETAIL OVERLAY
// ============================================================================
function MatchDetailOverlay({
  fixtureId,
  onClose,
  leagueNames,
}: {
  fixtureId: number;
  onClose: () => void;
  leagueNames: Record<number, string>;
}) {
  const [matchData, setMatchData] = useState<MatchDetailData | null>(null);
  const [standingsData, setStandingsData] = useState<Standing[]>([]);
  const [activeTab, setActiveTab] = useState<MatchDetailTab>('prediction');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/match?fixtureId=${fixtureId}`);
        const data = await res.json();
        if (!cancelled) {
          setMatchData(data);
          // Fetch standings for this league
          const leagueId = data.fixture?.leagueId || data.leagueId;
          if (leagueId) {
            try {
              const sRes = await fetch(`/api/standings?leagueId=${leagueId}`);
              const sData = await sRes.json();
              if (!cancelled) setStandingsData(sData.standings || []);
            } catch { /* silent */ }
          }
        }
      } catch (error) {
        console.error('Failed to fetch match detail:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [fixtureId]);

  const fixture = matchData?.fixture;
  const prediction = fixture?.prediction || (matchData as Record<string, unknown>)?.prediction as MatchPrediction | undefined;
  const stats = fixture?.stats || (matchData as Record<string, unknown>)?.stats as MatchStats | undefined;
  const incidents = fixture?.incidents || (matchData as Record<string, unknown>)?.incidents as MatchIncident[] | undefined;
  const lineup = fixture?.lineup || (matchData as Record<string, unknown>)?.lineups as MatchLineup | undefined;
  const odds = fixture?.odds || (matchData as Record<string, unknown>)?.odds as MatchOdds | undefined;
  const metadata = fixture?.metadata || (matchData as Record<string, unknown>)?.metadata as MatchMetadata | undefined;

  const isLive = fixture?.status === 'inprogress';
  const isFinished = fixture?.status === 'finished';

  const tabs: { id: MatchDetailTab; label: string }[] = [
    { id: 'prediction', label: 'Prediction' },
    { id: 'stats', label: 'Stats' },
    { id: 'lineup', label: 'Lineup' },
    { id: 'standings', label: 'Standings' },
    ...(isLive ? [{ id: 'live' as MatchDetailTab, label: 'Live' }] : []),
  ];

  return (
    <motion.div
      className="fixed inset-0 z-[100] bg-slate-950 flex flex-col"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
    >
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 glass-card">
        {/* Back button + match info */}
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center hover:bg-slate-700 transition-colors active:scale-95"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            {fixture && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-bold text-white truncate">{fixture.homeTeam?.name || 'Home'}</span>
                  <span className="text-lg font-bold text-white">{fixture.homeScore ?? '-'}</span>
                </div>
                <div className="px-2 flex-shrink-0">
                  {isLive && (
                    <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-pulse" />
                      {fixture.currentMinute || 0}&apos;
                    </span>
                  )}
                  {!isLive && !isFinished && fixture?.eventDate && (
                    <span className="text-[10px] text-slate-500">
                      {new Date(fixture.eventDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </span>
                  )}
                  {isFinished && (
                    <span className="text-[10px] font-bold text-slate-400">FT</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                  <span className="text-lg font-bold text-white">{fixture.awayScore ?? '-'}</span>
                  <span className="text-sm font-bold text-white truncate">{fixture.awayTeam?.name || 'Away'}</span>
                </div>
              </div>
            )}
            {!fixture && loading && (
              <div className="h-5 bg-slate-800 rounded animate-pulse w-3/4" />
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 px-2">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-all relative ${
                activeTab === t.id ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.label}
              {t.id === 'live' && isLive && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block live-pulse" />
              )}
              {activeTab === t.id && (
                <motion.div
                  layoutId="matchDetailTabIndicator"
                  className="absolute bottom-0 left-2 right-2 h-0.5 gradient-accent rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-safe">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-4 space-y-4">
              <MatchDetailSkeleton />
            </motion.div>
          ) : (
            <>
              {activeTab === 'prediction' && fixture && (
                <motion.div key="prediction" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                  <PredictionTab prediction={prediction} fixture={fixture} odds={odds} metadata={metadata} />
                </motion.div>
              )}
              {activeTab === 'stats' && (
                <motion.div key="stats" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                  <StatsTab stats={stats} fixture={fixture} />
                </motion.div>
              )}
              {activeTab === 'lineup' && (
                <motion.div key="lineup" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                  <LineupTab lineup={lineup} fixture={fixture} />
                </motion.div>
              )}
              {activeTab === 'standings' && (
                <motion.div key="standings" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                  <StandingsTab standings={standingsData} fixture={fixture} leagueNames={leagueNames} />
                </motion.div>
              )}
              {activeTab === 'live' && isLive && (
                <motion.div key="live" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                  <LiveTab fixture={fixture} incidents={incidents || []} stats={stats} />
                </motion.div>
              )}
            </>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ============================================================================
// MATCH DETAIL SKELETON
// ============================================================================
function MatchDetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="glass-card rounded-xl p-6 animate-pulse">
        <div className="flex justify-center gap-8 mb-6">
          <div className="h-12 w-12 bg-slate-700 rounded-full" />
          <div className="h-8 w-16 bg-slate-700 rounded" />
          <div className="h-12 w-12 bg-slate-700 rounded-full" />
        </div>
        <div className="h-6 bg-slate-700 rounded w-2/3 mx-auto mb-4" />
        <div className="h-4 bg-slate-700 rounded w-1/2 mx-auto" />
      </div>
      <div className="glass-card rounded-xl p-4 animate-pulse space-y-3">
        <div className="h-4 bg-slate-700 rounded w-1/3" />
        <div className="h-8 bg-slate-700 rounded" />
        <div className="h-8 bg-slate-700 rounded" />
        <div className="h-8 bg-slate-700 rounded" />
      </div>
    </div>
  );
}

// ============================================================================
// PREDICTION TAB
// ============================================================================
function PredictionTab({
  prediction,
  fixture,
  odds,
  metadata,
}: {
  prediction?: MatchPrediction;
  fixture: NonNullable<MatchDetailData['fixture']>;
  odds?: MatchOdds;
  metadata?: MatchMetadata;
}) {
  if (!prediction) {
    return (
      <div className="p-4">
        <div className="glass-card rounded-xl p-8 text-center">
          <div className="text-3xl mb-3">🧠</div>
          <p className="text-slate-400 text-sm">No prediction available for this match</p>
          <p className="text-slate-500 text-xs mt-1">Sync data to generate predictions</p>
        </div>
      </div>
    );
  }

  const homeProb = prediction.probHomeWin * 100;
  const drawProb = prediction.probDraw * 100;
  const awayProb = prediction.probAwayWin * 100;
  const confPct = prediction.confidence * 100;

  // Parse ensemble detail
  let ensemble: Record<string, unknown> = {};
  try {
    ensemble = JSON.parse(prediction.ensembleDetail || '{}');
  } catch { /* ignore */ }

  const models = [
    { name: 'Poisson-xG', key: 'poisson', color: '#6366f1' },
    { name: 'ELO', key: 'elo', color: '#8b5cf6' },
    { name: 'Form', key: 'form', color: '#a78bfa' },
    { name: 'Style', key: 'style', color: '#c084fc' },
    { name: 'Context', key: 'context', color: '#e879f9' },
  ];

  return (
    <div className="p-4 space-y-4">
      {/* Match Score Header */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-center flex-1">
            <p className="text-sm font-bold text-white truncate">{fixture.homeTeam?.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">Home</p>
          </div>
          <div className="text-center px-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-white">{fixture.homeScore ?? '-'}</span>
              <span className="text-sm text-slate-600">vs</span>
              <span className="text-2xl font-bold text-white">{fixture.awayScore ?? '-'}</span>
            </div>
          </div>
          <div className="text-center flex-1">
            <p className="text-sm font-bold text-white truncate">{fixture.awayTeam?.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">Away</p>
          </div>
        </div>
      </div>

      {/* Prediction Result */}
      <div className="glass-card rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Our Prediction</h3>
        <div className="flex items-center justify-center gap-3 mb-4">
          <span className={`text-lg font-bold px-4 py-1.5 rounded-lg ${
            prediction.predictedResult === 'H' ? 'bg-indigo-500/20 text-indigo-400' :
            prediction.predictedResult === 'A' ? 'bg-amber-500/20 text-amber-400' :
            'bg-slate-500/20 text-slate-300'
          }`}>
            {prediction.predictedResult === 'H' ? fixture.homeTeam?.name?.substring(0, 3) :
             prediction.predictedResult === 'A' ? fixture.awayTeam?.name?.substring(0, 3) : 'DRAW'}
          </span>
          <ConfidenceRing confidence={confPct} />
        </div>

        {/* Probability Bar */}
        <div className="flex gap-0.5 h-8 rounded-lg overflow-hidden mb-2">
          <motion.div
            className="bg-indigo-500 flex items-center justify-center"
            initial={{ width: 0 }}
            animate={{ width: `${homeProb}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            <span className="text-[10px] text-white font-bold">{homeProb.toFixed(0)}%</span>
          </motion.div>
          <motion.div
            className="bg-slate-600 flex items-center justify-center"
            initial={{ width: 0 }}
            animate={{ width: `${drawProb}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
          >
            <span className="text-[10px] text-white font-bold">{drawProb.toFixed(0)}%</span>
          </motion.div>
          <motion.div
            className="bg-amber-500 flex items-center justify-center"
            initial={{ width: 0 }}
            animate={{ width: `${awayProb}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
          >
            <span className="text-[10px] text-white font-bold">{awayProb.toFixed(0)}%</span>
          </motion.div>
        </div>
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>Home</span>
          <span>Draw</span>
          <span>Away</span>
        </div>
      </div>

      {/* Expected Goals */}
      <div className="glass-card rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Expected Goals (xG)</h3>
        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <motion.div
              className="text-3xl font-bold text-indigo-400"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200 }}
            >
              {prediction.expectedHomeGoals.toFixed(1)}
            </motion.div>
            <p className="text-[10px] text-slate-500 mt-1">{fixture.homeTeam?.name?.substring(0, 3)}</p>
          </div>
          <div className="px-4 flex items-center gap-2">
            <XGGauge value={prediction.expectedHomeGoals} max={4} color="#6366f1" />
            <div className="text-slate-700 text-xs">vs</div>
            <XGGauge value={prediction.expectedAwayGoals} max={4} color="#f59e0b" />
          </div>
          <div className="text-center flex-1">
            <motion.div
              className="text-3xl font-bold text-amber-400"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
            >
              {prediction.expectedAwayGoals.toFixed(1)}
            </motion.div>
            <p className="text-[10px] text-slate-500 mt-1">{fixture.awayTeam?.name?.substring(0, 3)}</p>
          </div>
        </div>
        <div className="mt-3 text-center">
          <span className="text-xs text-slate-500">Most Likely Score: </span>
          <span className="text-sm font-bold text-white">{prediction.mostLikelyScore}</span>
        </div>
      </div>

      {/* Over/Under & BTTS */}
      <div className="glass-card rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Over / Under & BTTS</h3>
        <div className="space-y-3">
          {[
            { label: 'Over 1.5', prob: prediction.probOver15 },
            { label: 'Over 2.5', prob: prediction.probOver25 },
            { label: 'Over 3.5', prob: prediction.probOver35 },
          ].map(item => (
            <div key={item.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">{item.label}</span>
                <span className="text-white font-bold">{(item.prob * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: item.prob > 0.55 ? 'linear-gradient(90deg, #6366f1, #8b5cf6)' : '#475569' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${item.prob * 100}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            </div>
          ))}
          <div className="pt-2 border-t border-slate-800">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">BTTS Yes</span>
              <span className="text-white font-bold">{(prediction.probBttsYes * 100).toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: prediction.probBttsYes > 0.5 ? 'linear-gradient(90deg, #10b981, #059669)' : '#475569' }}
                initial={{ width: 0 }}
                animate={{ width: `${prediction.probBttsYes * 100}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Value Detection */}
      {prediction.valueDetected && (
        <motion.div
          className="glass-card rounded-xl p-4 border border-emerald-500/30"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full gradient-green flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 className="text-sm font-bold text-emerald-400">Value Detected</h3>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">Recommended Bet</p>
              <p className="text-sm font-bold text-white">{prediction.recommendedBet || 'N/A'}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Edge</p>
              <p className="text-sm font-bold text-emerald-400">+{(prediction.valueEdge * 100).toFixed(1)}%</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Kelly</p>
              <p className="text-sm font-bold text-indigo-400">{(prediction.kellyStake * 100).toFixed(1)}%</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Model Breakdown */}
      <div className="glass-card rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Model Breakdown</h3>
        <div className="space-y-2.5">
          {models.map(model => {
            const detail = ensemble[model.key] as Record<string, number> | undefined;
            const modelPred = detail?.predictedResult as string | undefined;
            const modelConf = detail?.confidence as number | undefined;
            return (
              <div key={model.key} className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: model.color }} />
                <span className="text-xs text-slate-300 w-20 flex-shrink-0">{model.name}</span>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: model.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(modelConf || 0) * 100}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
                <span className={`text-[10px] font-bold w-8 text-right ${
                  modelPred === 'H' ? 'text-indigo-400' : modelPred === 'A' ? 'text-amber-400' : 'text-slate-400'
                }`}>
                  {modelPred || '-'}
                </span>
                <span className="text-[10px] text-slate-500 w-10 text-right">
                  {modelConf ? `${(modelConf * 100).toFixed(0)}%` : '-'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Context Analysis */}
      <div className="glass-card rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Context Analysis</h3>
        <div className="space-y-3">
          <ContextBar label="Home Advantage" value={prediction.homeAdvantageAdj} color="#6366f1" />
          <ContextBar label="Form Advantage" value={prediction.formAdvantage} color="#8b5cf6" />
          <ContextBar label="Rest Advantage" value={prediction.restAdvantage} color="#a78bfa" />
          <ContextBar label="Motivation" value={prediction.motivationScore} neutral={true} color="#10b981" />
          <ContextBar label="Derby Factor" value={prediction.derbyFactor} neutral={true} color="#f59e0b" />
          <ContextBar label="Rotation Risk" value={prediction.rotationRisk} neutral={true} color="#ef4444" />
        </div>
      </div>

      {/* AI Preview */}
      {metadata?.aiPreview && (
        <div className="glass-card rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">AI Preview</h3>
          <p className="text-sm text-slate-300 leading-relaxed">{metadata.aiPreview}</p>
        </div>
      )}

      {/* Odds */}
      {odds && (odds.homeWin || odds.draw || odds.awayWin) && (
        <div className="glass-card rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Market Odds</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 rounded-lg bg-slate-800/50">
              <p className="text-[10px] text-slate-500 mb-1">Home</p>
              <p className="text-sm font-bold text-white">{odds.homeWin?.toFixed(2) || '-'}</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-slate-800/50">
              <p className="text-[10px] text-slate-500 mb-1">Draw</p>
              <p className="text-sm font-bold text-white">{odds.draw?.toFixed(2) || '-'}</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-slate-800/50">
              <p className="text-[10px] text-slate-500 mb-1">Away</p>
              <p className="text-sm font-bold text-white">{odds.awayWin?.toFixed(2) || '-'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CONFIDENCE RING
// ============================================================================
function ConfidenceRing({ confidence }: { confidence: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (confidence / 100) * circumference;

  const color = confidence >= 70 ? '#10b981' : confidence >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <svg width="64" height="64" className="-rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#1e293b" strokeWidth="4" />
        <motion.circle
          cx="32" cy="32" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold text-white">{confidence.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ============================================================================
// XG GAUGE
// ============================================================================
function XGGauge({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(value / max, 1);
  return (
    <div className="w-10 h-10 rounded-full border-2 border-slate-700 flex items-center justify-center relative overflow-hidden">
      <motion.div
        className="absolute bottom-0 left-0 right-0"
        style={{ background: `${color}30` }}
        initial={{ height: 0 }}
        animate={{ height: `${pct * 100}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
      <span className="text-[9px] font-bold relative z-10" style={{ color }}>{value.toFixed(1)}</span>
    </div>
  );
}

// ============================================================================
// CONTEXT BAR
// ============================================================================
function ContextBar({ label, value, color, neutral = false }: { label: string; value: number; color: string; neutral?: boolean }) {
  // For non-neutral: value ranges -1 to 1 (negative = away advantage, positive = home advantage)
  // For neutral: value ranges 0 to 1
  const displayValue = neutral ? value : (value + 1) / 2; // normalize to 0-1
  const pct = Math.max(0, Math.min(1, displayValue)) * 100;

  const description = neutral
    ? value > 0.7 ? 'High' : value > 0.4 ? 'Medium' : 'Low'
    : value > 0.3 ? 'Home' : value < -0.3 ? 'Away' : 'Balanced';

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-500 font-medium">{description}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// STATS TAB
// ============================================================================
function StatsTab({
  stats,
  fixture,
}: {
  stats?: MatchStats;
  fixture?: NonNullable<MatchDetailData['fixture']>;
}) {
  const homeName = fixture?.homeTeam?.name?.substring(0, 3) || 'Home';
  const awayName = fixture?.awayTeam?.name?.substring(0, 3) || 'Away';

  if (!stats) {
    return (
      <div className="p-4">
        <div className="glass-card rounded-xl p-8 text-center">
          <div className="text-3xl mb-3">📊</div>
          <p className="text-slate-400 text-sm">No match stats available</p>
          <p className="text-slate-500 text-xs mt-1">Stats will appear during and after the match</p>
        </div>
      </div>
    );
  }

  const statRows: { label: string; home: number; away: number; isPct?: boolean; format?: (v: number) => string }[] = [
    { label: 'Possession', home: stats.homeBallPossession, away: stats.awayBallPossession, isPct: true },
    { label: 'Total Shots', home: stats.homeTotalShots, away: stats.awayTotalShots },
    { label: 'Shots on Target', home: stats.homeShotsOnTarget, away: stats.awayShotsOnTarget },
    { label: 'xG', home: stats.homeExpectedGoals, away: stats.awayExpectedGoals, format: (v) => v.toFixed(2) },
    { label: 'Big Chances', home: stats.homeBigChances, away: stats.awayBigChances },
    { label: 'Shots Inside Box', home: stats.homeShotsInsideBox, away: stats.awayShotsInsideBox },
    { label: 'Corners', home: stats.homeCornerKicks, away: stats.awayCornerKicks },
    { label: 'Attacks', home: stats.homeAttacks, away: stats.awayAttacks },
    { label: 'Dangerous Attacks', home: stats.homeDangerousAttacks, away: stats.awayDangerousAttacks },
    { label: 'Passes', home: stats.homePasses, away: stats.awayPasses },
    { label: 'Pass Accuracy', home: stats.homePassAccuracy, away: stats.awayPassAccuracy, isPct: true },
    { label: 'Tackles', home: stats.homeTotalTackles, away: stats.awayTotalTackles },
    { label: 'Interceptions', home: stats.homeInterceptions, away: stats.awayInterceptions },
    { label: 'Clearances', home: stats.homeClearances, away: stats.awayClearances },
    { label: 'Dribbles', home: stats.homeDribblesSuccess, away: stats.awayDribblesSuccess, format: (v, i) => `${stats[`homeDribblesSuccess` as keyof MatchStats]}/${stats.homeDribblesTotal}` },
    { label: 'Offsides', home: stats.homeOffsides, away: stats.awayOffsides },
    { label: 'Fouls', home: stats.homeFouls, away: stats.awayFouls },
    { label: 'Yellow Cards', home: stats.homeYellowCards, away: stats.awayYellowCards },
    { label: 'Red Cards', home: stats.homeRedCards, away: stats.awayRedCards },
  ];

  return (
    <div className="p-4">
      <div className="glass-card rounded-xl p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
          <span className="text-xs font-bold text-indigo-400">{homeName}</span>
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Match Stats</span>
          <span className="text-xs font-bold text-amber-400">{awayName}</span>
        </div>

        {/* Stats rows */}
        <div className="space-y-3">
          {statRows.map(row => {
            const total = row.home + row.away || 1;
            const homePct = (row.home / total) * 100;
            const awayPct = (row.away / total) * 100;
            const homeWinning = row.home > row.away;
            const awayWinning = row.away > row.home;

            const homeDisplay = row.format ? row.format(row.home) : (row.isPct ? `${row.home}%` : String(row.home));
            const awayDisplay = row.format ? row.format(row.away) : (row.isPct ? `${row.away}%` : String(row.away));

            return (
              <div key={row.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-bold w-12 text-right ${homeWinning ? 'text-indigo-400' : 'text-slate-400'}`}>
                    {homeDisplay}
                  </span>
                  <span className="text-[10px] text-slate-500 flex-1 text-center">{row.label}</span>
                  <span className={`text-xs font-bold w-12 text-left ${awayWinning ? 'text-amber-400' : 'text-slate-400'}`}>
                    {awayDisplay}
                  </span>
                </div>
                <div className="flex gap-1 h-1.5">
                  <div className="flex-1 flex justify-end">
                    <motion.div
                      className="h-full rounded-l-full"
                      style={{ backgroundColor: homeWinning ? '#6366f1' : '#475569' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${homePct}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="flex-1">
                    <motion.div
                      className="h-full rounded-r-full"
                      style={{ backgroundColor: awayWinning ? '#f59e0b' : '#475569' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${awayPct}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// LINEUP TAB
// ============================================================================
function LineupTab({
  lineup,
  fixture,
}: {
  lineup?: MatchLineup;
  fixture?: NonNullable<MatchDetailData['fixture']>;
}) {
  const [side, setSide] = useState<'home' | 'away'>('home');

  const homePlayers: LineupPlayer[] = safeParseJSON(lineup?.homePlayers, []);
  const awayPlayers: LineupPlayer[] = safeParseJSON(lineup?.awayPlayers, []);
  const homeSubs: LineupPlayer[] = safeParseJSON(lineup?.homeSubstitutes, []);
  const awaySubs: LineupPlayer[] = safeParseJSON(lineup?.awaySubstitutes, []);
  const homeUnavailable: LineupPlayer[] = safeParseJSON(lineup?.homeUnavailable, []);
  const awayUnavailable: LineupPlayer[] = safeParseJSON(lineup?.awayUnavailable, []);

  const players = side === 'home' ? homePlayers : awayPlayers;
  const subs = side === 'home' ? homeSubs : awaySubs;
  const unavailable = side === 'home' ? homeUnavailable : awayUnavailable;
  const formation = side === 'home' ? lineup?.homeFormation : lineup?.awayFormation;
  const confidence = side === 'home' ? lineup?.homeConfidence : lineup?.awayConfidence;
  const teamName = side === 'home' ? fixture?.homeTeam?.name : fixture?.awayTeam?.name;

  // Group by position
  const grouped = useMemo(() => {
    const groups: Record<string, LineupPlayer[]> = {
      'GK': [], 'D': [], 'M': [], 'F': [],
    };
    for (const p of players) {
      const pos = p.position?.charAt(0).toUpperCase() || 'F';
      if (groups[pos]) groups[pos].push(p);
      else groups['F'].push(p);
    }
    return groups;
  }, [players]);

  if (!lineup || lineup.lineupStatus === 'unavailable') {
    return (
      <div className="p-4">
        <div className="glass-card rounded-xl p-8 text-center">
          <div className="text-3xl mb-3">👕</div>
          <p className="text-slate-400 text-sm">Lineups not yet available</p>
          <p className="text-slate-500 text-xs mt-1">Usually confirmed 1-2 hours before kick-off</p>
        </div>
      </div>
    );
  }

  const positionLabels: Record<string, string> = {
    'GK': 'Goalkeeper',
    'D': 'Defenders',
    'M': 'Midfielders',
    'F': 'Forwards',
  };

  return (
    <div className="p-4 space-y-4">
      {/* Team selector */}
      <div className="glass-card rounded-xl p-1 flex gap-1">
        <button
          onClick={() => setSide('home')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
            side === 'home' ? 'gradient-accent text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          {fixture?.homeTeam?.name || 'Home'}
        </button>
        <button
          onClick={() => setSide('away')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
            side === 'away' ? 'gradient-accent text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          {fixture?.awayTeam?.name || 'Away'}
        </button>
      </div>

      {/* Formation + Status */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs text-slate-500">Formation</p>
            <p className="text-xl font-bold text-white">{formation || 'N/A'}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Status</p>
            <p className={`text-sm font-bold ${
              lineup.lineupStatus === 'confirmed' ? 'text-emerald-400' :
              lineup.lineupStatus === 'predicted' ? 'text-amber-400' : 'text-slate-400'
            }`}>
              {lineup.lineupStatus === 'confirmed' ? '✓ Confirmed' :
               lineup.lineupStatus === 'predicted' ? '~ Predicted' : 'Unknown'}
            </p>
          </div>
          {confidence != null && (
            <div className="text-right">
              <p className="text-xs text-slate-500">AI Confidence</p>
              <p className="text-sm font-bold text-indigo-400">{(confidence * 100).toFixed(0)}%</p>
            </div>
          )}
        </div>
      </div>

      {/* Starting XI */}
      <div className="glass-card rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Starting XI — {teamName}
        </h3>
        <div className="space-y-4">
          {['GK', 'D', 'M', 'F'].map(pos => {
            const group = grouped[pos];
            if (!group || group.length === 0) return null;
            return (
              <div key={pos}>
                <p className="text-[10px] text-slate-500 font-semibold uppercase mb-1.5">{positionLabels[pos]}</p>
                <div className="space-y-1">
                  {group.map((player, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                      {player.jerseyNumber && (
                        <span className="text-xs font-bold text-slate-500 w-5 text-center">{player.jerseyNumber}</span>
                      )}
                      <span className="text-sm text-white">{player.name}</span>
                      {player.rating != null && (
                        <span className={`ml-auto text-xs font-bold ${
                          player.rating >= 7 ? 'text-emerald-400' :
                          player.rating >= 6 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {player.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Substitutes */}
      {subs.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Substitutes</h3>
          <div className="space-y-1">
            {subs.map((player, i) => (
              <div key={i} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                {player.jerseyNumber && (
                  <span className="text-xs font-bold text-slate-500 w-5 text-center">{player.jerseyNumber}</span>
                )}
                <span className="text-sm text-slate-300">{player.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unavailable */}
      {unavailable.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Unavailable</h3>
          <div className="space-y-1">
            {unavailable.map((player, i) => (
              <div key={i} className="flex items-center gap-2 py-1 px-2 rounded-lg">
                <span className="text-xs text-red-400">✕</span>
                <span className="text-sm text-slate-400">{player.name}</span>
                {player.position && (
                  <span className="ml-auto text-[10px] text-slate-600">{player.position}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// STANDINGS TAB
// ============================================================================
function StandingsTab({
  standings,
  fixture,
  leagueNames,
}: {
  standings: Standing[];
  fixture?: NonNullable<MatchDetailData['fixture']>;
  leagueNames: Record<number, string>;
}) {
  const homeTeamId = fixture?.homeTeamId;
  const awayTeamId = fixture?.awayTeamId;
  const leagueId = fixture?.leagueId;
  const leagueName = leagueNames[leagueId || 0] || `League #${leagueId}`;

  if (standings.length === 0) {
    return (
      <div className="p-4">
        <div className="glass-card rounded-xl p-8 text-center">
          <div className="text-3xl mb-3">🏆</div>
          <p className="text-slate-400 text-sm">No standings data available</p>
          <p className="text-slate-500 text-xs mt-1">Sync data to view league table</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="glass-card rounded-xl overflow-hidden">
        {/* League header */}
        <div className="px-4 py-3 border-b border-slate-800">
          <p className="text-sm font-bold text-white">{leagueName}</p>
          <p className="text-[10px] text-slate-500">League Standings</p>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[2rem_1fr_1.5rem_1.5rem_1.5rem_1.5rem_1.5rem_1.5rem_2.5rem_2.5rem_3rem] gap-0.5 px-2 py-2 text-[9px] text-slate-500 font-semibold uppercase border-b border-slate-800">
          <span className="text-center">#</span>
          <span>Team</span>
          <span className="text-center">P</span>
          <span className="text-center">W</span>
          <span className="text-center">D</span>
          <span className="text-center">L</span>
          <span className="text-center">GF</span>
          <span className="text-center">GA</span>
          <span className="text-center">GD</span>
          <span className="text-center">xGD</span>
          <span className="text-center">Pts</span>
        </div>

        {/* Table body */}
        <div className="max-h-96 overflow-y-auto">
          {standings.map((s, i) => {
            const isHome = s.team.id === homeTeamId;
            const isAway = s.team.id === awayTeamId;
            const highlight = isHome || isAway;

            return (
              <motion.div
                key={s.team.id}
                className={`grid grid-cols-[2rem_1fr_1.5rem_1.5rem_1.5rem_1.5rem_1.5rem_1.5rem_2.5rem_2.5rem_3rem] gap-0.5 px-2 py-1.5 items-center text-xs border-b border-slate-800/50 ${
                  highlight ? 'bg-indigo-500/10' : 'hover:bg-slate-800/30'
                }`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <span className={`text-center font-bold text-[10px] ${
                  s.position <= 4 ? 'text-emerald-400' :
                  s.position <= 6 ? 'text-blue-400' :
                  s.position > standings.length - 3 ? 'text-red-400' : 'text-slate-500'
                }`}>
                  {s.position}
                </span>
                <span className={`truncate font-medium ${highlight ? 'text-indigo-400' : 'text-white'}`}>
                  {s.team.name}
                </span>
                <span className="text-center text-slate-400">{s.played}</span>
                <span className="text-center text-slate-400">{s.won}</span>
                <span className="text-center text-slate-400">{s.drawn}</span>
                <span className="text-center text-slate-400">{s.lost}</span>
                <span className="text-center text-slate-400">{s.gf}</span>
                <span className="text-center text-slate-400">{s.ga}</span>
                <span className={`text-center font-medium ${s.gd > 0 ? 'text-emerald-400' : s.gd < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {s.gd > 0 ? '+' : ''}{s.gd}
                </span>
                <span className={`text-center font-medium text-[10px] ${
                  s.xgd != null ? (s.xgd > 0 ? 'text-emerald-400/70' : s.xgd < 0 ? 'text-red-400/70' : 'text-slate-500') : 'text-slate-600'
                }`}>
                  {s.xgd != null ? `${s.xgd > 0 ? '+' : ''}${s.xgd.toFixed(1)}` : '-'}
                </span>
                <span className="text-center font-bold text-white">{s.pts}</span>
              </motion.div>
            );
          })}
        </div>

        {/* Form display for highlighted teams */}
        {(homeTeamId || awayTeamId) && (
          <div className="px-4 py-3 border-t border-slate-800">
            <p className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Form</p>
            <div className="space-y-1.5">
              {standings.filter(s => s.team.id === homeTeamId || s.team.id === awayTeamId).map(s => (
                <div key={s.team.id} className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 w-20 truncate">{s.team.name}</span>
                  <div className="flex gap-0.5">
                    {s.form.split('').map((f, i) => (
                      <span
                        key={i}
                        className={`w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center ${
                          f === 'W' ? 'bg-emerald-500/20 text-emerald-400' :
                          f === 'D' ? 'bg-slate-500/20 text-slate-400' :
                          f === 'L' ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-600'
                        }`}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// LIVE TAB
// ============================================================================
function LiveTab({
  fixture,
  incidents,
  stats,
}: {
  fixture: NonNullable<MatchDetailData['fixture']>;
  incidents: MatchIncident[];
  stats?: MatchStats;
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Live Score */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-pulse" />
            LIVE — {fixture.currentMinute || 0}&apos;
          </span>
          <span className="text-[10px] text-slate-500">{fixture.period || 'In Progress'}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <p className="text-sm font-bold text-white truncate">{fixture.homeTeam?.name}</p>
          </div>
          <div className="flex items-center gap-3 px-4">
            <span className="text-3xl font-bold text-white">{fixture.homeScore ?? 0}</span>
            <span className="text-sm text-slate-600">-</span>
            <span className="text-3xl font-bold text-white">{fixture.awayScore ?? 0}</span>
          </div>
          <div className="text-center flex-1">
            <p className="text-sm font-bold text-white truncate">{fixture.awayTeam?.name}</p>
          </div>
        </div>
      </div>

      {/* Shotmap Visualization */}
      <div className="glass-card rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Shotmap</h3>
        <Shotmap incidents={incidents} />
      </div>

      {/* Momentum Graph */}
      <div className="glass-card rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Momentum</h3>
        <MomentumGraph incidents={incidents} />
      </div>

      {/* Match Incidents */}
      <div className="glass-card rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Match Events</h3>
        <IncidentsTimeline incidents={incidents} fixture={fixture} />
      </div>

      {/* Live Stats Summary */}
      {stats && (
        <div className="glass-card rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Live Stats</h3>
          <div className="grid grid-cols-3 gap-3">
            <StatBlock label="Shots" home={stats.homeTotalShots} away={stats.awayTotalShots} />
            <StatBlock label="On Target" home={stats.homeShotsOnTarget} away={stats.awayShotsOnTarget} />
            <StatBlock label="Corners" home={stats.homeCornerKicks} away={stats.awayCornerKicks} />
            <StatBlock label="Possession" home={stats.homeBallPossession} away={stats.awayBallPossession} isPct />
            <StatBlock label="xG" home={stats.homeExpectedGoals} away={stats.awayExpectedGoals} decimal />
            <StatBlock label="Fouls" home={stats.homeFouls} away={stats.awayFouls} />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// STAT BLOCK (Live tab)
// ============================================================================
function StatBlock({ label, home, away, isPct, decimal }: {
  label: string; home: number; away: number; isPct?: boolean; decimal?: boolean;
}) {
  const format = (v: number) => isPct ? `${v}%` : decimal ? v.toFixed(1) : String(v);
  return (
    <div className="text-center p-2 rounded-lg bg-slate-800/50">
      <div className="flex items-center justify-center gap-2 mb-1">
        <span className="text-xs font-bold text-indigo-400">{format(home)}</span>
        <span className="text-[9px] text-slate-600">vs</span>
        <span className="text-xs font-bold text-amber-400">{format(away)}</span>
      </div>
      <p className="text-[9px] text-slate-500">{label}</p>
    </div>
  );
}

// ============================================================================
// SHOTMAP (SVG pitch)
// ============================================================================
function Shotmap({ incidents }: { incidents: MatchIncident[] }) {
  const goalIncidents = incidents.filter(i => i.type === 'goal');
  const shotIncidents = incidents.filter(i => i.type === 'goal'); // In real data would include shots

  return (
    <div className="relative w-full aspect-[1.5/1] bg-emerald-900/20 rounded-lg overflow-hidden border border-emerald-800/30">
      {/* Football pitch SVG */}
      <svg viewBox="0 0 600 400" className="w-full h-full">
        {/* Pitch background */}
        <rect x="0" y="0" width="600" height="400" fill="#0d3320" />

        {/* Outer boundary */}
        <rect x="20" y="20" width="560" height="360" fill="none" stroke="#1a5c3a" strokeWidth="2" />

        {/* Halfway line */}
        <line x1="300" y1="20" x2="300" y2="380" stroke="#1a5c3a" strokeWidth="1.5" />
        <circle cx="300" cy="200" r="50" fill="none" stroke="#1a5c3a" strokeWidth="1.5" />
        <circle cx="300" cy="200" r="3" fill="#1a5c3a" />

        {/* Home penalty area */}
        <rect x="20" y="100" width="80" height="200" fill="none" stroke="#1a5c3a" strokeWidth="1.5" />
        <rect x="20" y="140" width="35" height="120" fill="none" stroke="#1a5c3a" strokeWidth="1.5" />
        <circle cx="75" cy="200" r="2" fill="#1a5c3a" />

        {/* Away penalty area */}
        <rect x="500" y="100" width="80" height="200" fill="none" stroke="#1a5c3a" strokeWidth="1.5" />
        <rect x="545" y="140" width="35" height="120" fill="none" stroke="#1a5c3a" strokeWidth="1.5" />
        <circle cx="525" cy="200" r="2" fill="#1a5c3a" />

        {/* Home goal */}
        <rect x="20" y="175" width="5" height="50" fill="#1a5c3a" />
        {/* Away goal */}
        <rect x="575" y="175" width="5" height="50" fill="#1a5c3a" />

        {/* Corner arcs */}
        <path d="M 20 25 A 5 5 0 0 1 25 20" fill="none" stroke="#1a5c3a" strokeWidth="1" />
        <path d="M 575 20 A 5 5 0 0 1 580 25" fill="none" stroke="#1a5c3a" strokeWidth="1" />
        <path d="M 20 375 A 5 5 0 0 0 25 380" fill="none" stroke="#1a5c3a" strokeWidth="1" />
        <path d="M 575 380 A 5 5 0 0 0 580 375" fill="none" stroke="#1a5c3a" strokeWidth="1" />

        {/* Goal markers */}
        {goalIncidents.map((inc, i) => {
          // Home goals on right side (attacking away goal), away goals on left side
          const isHome = inc.isHome;
          const seed = inc.minute * 7 + i;
          const x = isHome ? 400 + (seed % 150) : 50 + (seed % 150);
          const y = 60 + ((seed * 3) % 280);
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="8" fill={isHome ? '#6366f1' : '#f59e0b'} opacity="0.8" />
              <text x={x} y={y + 4} textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">⚽</text>
              <text x={x} y={y - 12} textAnchor="middle" fill={isHome ? '#818cf8' : '#fbbf24'} fontSize="9" fontWeight="bold">{inc.minute}&apos;</text>
            </g>
          );
        })}

        {/* Placeholder shots if no real shot data */}
        {shotIncidents.length === 0 && (
          <text x="300" y="200" textAnchor="middle" fill="#1a5c3a" fontSize="14" fontWeight="bold">
            No shots data yet
          </text>
        )}
      </svg>
    </div>
  );
}

// ============================================================================
// MOMENTUM GRAPH
// ============================================================================
function MomentumGraph({ incidents }: { incidents: MatchIncident[] }) {
  // Generate momentum data from incidents
  const maxMinute = 90;
  const points: { min: number; val: number }[] = [];

  // Create a simple momentum visualization based on incidents
  for (let min = 0; min <= maxMinute; min += 3) {
    let val = 0;
    for (const inc of incidents) {
      if (inc.type === 'goal') {
        val += inc.isHome ? 3 : -3;
        if (Math.abs(inc.minute - min) < 10) {
          val += inc.isHome ? 2 : -2;
        }
      }
      if (inc.type === 'card') {
        val += inc.isHome ? -0.5 : 0.5;
        if (Math.abs(inc.minute - min) < 5) {
          val += inc.isHome ? -1 : 1;
        }
      }
    }
    // Add some baseline wave
    val += Math.sin(min / 10) * 0.5;
    points.push({ min, val: Math.max(-5, Math.min(5, val)) });
  }

  const width = 300;
  const height = 80;
  const midY = height / 2;

  const pathD = points.map((p, i) => {
    const x = (p.min / maxMinute) * width;
    const y = midY - (p.val / 5) * midY;
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
        {/* Center line */}
        <line x1="0" y1={midY} x2={width} y2={midY} stroke="#334155" strokeWidth="0.5" strokeDasharray="4 4" />

        {/* Home area fill */}
        <clipPath id="homeClip">
          <rect x="0" y="0" width={width} y1="0" height={midY} />
        </clipPath>
        <path d={pathD} fill="none" stroke="#6366f1" strokeWidth="1.5" />
        <path d={`${pathD} L ${width} ${midY} L 0 ${midY} Z`} fill="url(#homeGrad)" clipPath="url(#homeClip)" opacity="0.3" />

        {/* Away area fill */}
        <clipPath id="awayClip">
          <rect x="0" y={midY} width={width} height={midY} />
        </clipPath>
        <path d={`${pathD} L ${width} ${midY} L 0 ${midY} Z`} fill="url(#awayGrad)" clipPath="url(#awayClip)" opacity="0.3" />

        <defs>
          <linearGradient id="homeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="awayGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.5" />
          </linearGradient>
        </defs>

        {/* Time markers */}
        {[0, 15, 30, 45, 60, 75, 90].map(min => (
          <g key={min}>
            <line x1={(min / maxMinute) * width} y1="0" x2={(min / maxMinute) * width} y2={height} stroke="#1e293b" strokeWidth="0.5" />
            <text x={(min / maxMinute) * width} y={height - 2} textAnchor="middle" fill="#475569" fontSize="7">{min}</text>
          </g>
        ))}
      </svg>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-indigo-400 font-semibold">← {`Home`}</span>
        <span className="text-[9px] text-amber-400 font-semibold">{`Away`} →</span>
      </div>
    </div>
  );
}

// ============================================================================
// INCIDENTS TIMELINE
// ============================================================================
function IncidentsTimeline({ incidents, fixture }: { incidents: MatchIncident[]; fixture: NonNullable<MatchDetailData['fixture']> }) {
  if (incidents.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-xs text-slate-500">No events yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-0 max-h-80 overflow-y-auto">
      {incidents.map((inc, i) => {
        const isHome = inc.isHome;
        const side = isHome ? 'home' : 'away';
        const teamName = isHome ? fixture.homeTeam?.name : fixture.awayTeam?.name;

        return (
          <motion.div
            key={inc.id || i}
            className="flex items-start gap-3 py-2.5 border-b border-slate-800/50 last:border-0"
            initial={{ opacity: 0, x: isHome ? -10 : 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            {/* Minute */}
            <div className="w-8 flex-shrink-0 text-right">
              <span className="text-xs font-bold text-slate-400">{inc.minute}&apos;</span>
            </div>

            {/* Icon */}
            <div className="w-6 flex-shrink-0 flex items-center justify-center">
              {inc.type === 'goal' && <span className="text-sm">⚽</span>}
              {inc.type === 'card' && (
                <div className={`w-3 h-4 rounded-sm ${
                  inc.cardType === 'yellow' ? 'bg-yellow-400' :
                  inc.cardType === 'red' ? 'bg-red-500' :
                  'bg-yellow-400 border-r-2 border-red-500'
                }`} />
              )}
              {inc.type === 'substitution' && <span className="text-sm">🔄</span>}
              {inc.type === 'period' && <span className="text-sm">⏱️</span>}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white font-medium">{inc.player || inc.type}</p>
              <p className="text-[10px] text-slate-500">
                {teamName?.substring(0, 15)}
                {inc.goalType && inc.goalType !== 'normal' && ` (${inc.goalType})`}
                {inc.playerIn && ` → ${inc.playerIn}`}
                {inc.playerOut && ` ↔ ${inc.playerOut}`}
              </p>
            </div>

            {/* Score at that time */}
            {inc.type === 'goal' && inc.homeScore != null && inc.awayScore != null && (
              <div className="flex-shrink-0">
                <span className="text-xs font-bold text-white bg-slate-800 px-2 py-0.5 rounded">
                  {inc.homeScore} - {inc.awayScore}
                </span>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

// ============================================================================
// HELPER: Safe JSON parse
// ============================================================================
function safeParseJSON<T>(str: string | undefined | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

// ============================================================================
// HOME TAB
// ============================================================================
function HomeTab({
  fixtures, groupedFixtures, leagueNames, liveEvents, loading, onSelectMatch,
}: {
  fixtures: Fixture[];
  groupedFixtures: Record<number, Fixture[]>;
  leagueNames: Record<number, string>;
  liveEvents: Array<Record<string, unknown>>;
  loading: boolean;
  onSelectMatch: (id: number) => void;
}) {
  const [dateOffset, setDateOffset] = useState(0);

  const getDate = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d;
  };

  const dateLabel = (offset: number) => {
    const d = getDate(offset);
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Tomorrow';
    if (offset === -1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
  };

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Date selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[-1, 0, 1, 2, 3].map(offset => (
          <button
            key={offset}
            onClick={() => setDateOffset(offset)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              dateOffset === offset
                ? 'gradient-accent text-white shadow-lg shadow-indigo-500/25'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {dateLabel(offset)}
          </button>
        ))}
      </div>

      {/* Live matches */}
      {liveEvents.length > 0 && dateOffset === 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 live-pulse" />
            LIVE NOW
          </h2>
          <div className="space-y-2">
            {liveEvents.map((ev: Record<string, unknown>) => (
              <div
                key={ev.id as number}
                onClick={() => onSelectMatch(ev.id as number)}
                className="glass-card rounded-xl p-3 cursor-pointer hover:border-indigo-500/30 transition-all active:scale-[0.98]"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-500 font-medium">{ev.league_name as string}</span>
                  <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-pulse" />
                    {ev.current_minute as number}&apos;
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{ev.home_team as string}</span>
                  <span className="text-lg font-bold text-white">{ev.home_score as number}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{ev.away_team as string}</span>
                  <span className="text-lg font-bold text-white">{ev.away_score as number}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fixtures by league */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="h-3 bg-slate-700 rounded w-24 mb-3" />
              <div className="space-y-2">
                {[1, 2].map(j => (
                  <div key={j} className="flex justify-between">
                    <div className="h-4 bg-slate-700 rounded w-32" />
                    <div className="h-4 bg-slate-700 rounded w-8" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : fixtures.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">⚽</div>
          <p className="text-slate-400 text-sm">No matches found for today.</p>
          <p className="text-slate-500 text-xs mt-1">Sync data or check another date.</p>
        </div>
      ) : (
        Object.entries(groupedFixtures).map(([leagueId, matches]) => (
          <div key={leagueId}>
            <h2 className="text-xs font-semibold text-slate-500 mb-2 px-1 uppercase tracking-wider">
              {leagueNames[parseInt(leagueId)] || `League #${leagueId}`}
            </h2>
            <div className="glass-card rounded-xl overflow-hidden divide-y divide-slate-800">
              {matches.map(fix => (
                <FixtureRow key={fix.id} fixture={fix} onClick={() => onSelectMatch(fix.id)} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function FixtureRow({ fixture, onClick }: { fixture: Fixture; onClick: () => void }) {
  const isLive = fixture.status === 'inprogress';
  const isFinished = fixture.status === 'finished';
  const pred = fixture.prediction;

  return (
    <div
      onClick={onClick}
      className="flex items-center px-3 py-2.5 cursor-pointer hover:bg-slate-800/50 transition-all active:scale-[0.99]"
    >
      {/* Team names + scores */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white truncate">{fixture.homeTeam.name}</span>
          <span className={`text-sm font-bold ml-2 ${isLive ? 'text-emerald-400' : 'text-white'}`}>
            {fixture.homeScore ?? '-'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-white truncate">{fixture.awayTeam.name}</span>
          <span className={`text-sm font-bold ml-2 ${isLive ? 'text-emerald-400' : 'text-white'}`}>
            {fixture.awayScore ?? '-'}
          </span>
        </div>
      </div>

      {/* Prediction indicator */}
      {pred && !isFinished && (
        <div className="ml-3 flex flex-col items-end">
          <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            pred.predictedResult === 'H' ? 'bg-indigo-500/20 text-indigo-400' :
            pred.predictedResult === 'A' ? 'bg-amber-500/20 text-amber-400' :
            'bg-slate-500/20 text-slate-400'
          }`}>
            {pred.predictedResult === 'H' ? fixture.homeTeam.name.substring(0, 3) :
             pred.predictedResult === 'A' ? fixture.awayTeam.name.substring(0, 3) : 'DRAW'}
          </div>
          <span className="text-[9px] text-slate-500 mt-0.5">{(pred.confidence * 100).toFixed(0)}%</span>
        </div>
      )}

      {/* Live indicator */}
      {isLive && (
        <div className="ml-2 flex items-center">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-pulse" />
        </div>
      )}

      {/* Time */}
      {!isLive && !isFinished && (
        <span className="ml-2 text-[10px] text-slate-500">
          {new Date(fixture.eventDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </span>
      )}
    </div>
  );
}

// ============================================================================
// PICKS TAB
// ============================================================================
function PicksTab({ picks, loading, onAddToAcca, accaSelections, onSelectMatch }: {
  picks: Pick[];
  loading: boolean;
  onAddToAcca: (pick: Pick) => void;
  accaSelections: Pick[];
  onSelectMatch: (id: number) => void;
}) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Top Picks</h1>
        <p className="text-sm text-slate-400">{today} — AI-powered predictions</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="h-5 bg-slate-700 rounded w-3/4 mb-3" />
              <div className="h-3 bg-slate-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : picks.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🧠</div>
          <p className="text-slate-400 text-sm">No picks available yet.</p>
          <p className="text-slate-500 text-xs mt-1">Sync data to generate predictions.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {picks.map((pick, i) => {
            const inAcca = accaSelections.some(a => a.fixtureId === pick.fixtureId);
            return (
              <motion.div
                key={pick.fixtureId}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card rounded-xl p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="cursor-pointer" onClick={() => onSelectMatch(pick.fixtureId)}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded">#{pick.rank}</span>
                      {pick.valueDetected && (
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded">VALUE</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-white">{pick.homeTeam} vs {pick.awayTeam}</p>
                  </div>
                  <button
                    onClick={() => onAddToAcca(pick)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      inAcca
                        ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {inAcca ? '✓ Added' : '+ Acca'}
                  </button>
                </div>

                {/* Prediction bar */}
                <div className="flex gap-0.5 h-6 rounded-lg overflow-hidden mb-2">
                  <div className="bg-indigo-500 bar-fill flex items-center justify-center" style={{ width: `${pick.probHomeWin * 100}%` }}>
                    <span className="text-[9px] text-white font-bold">{(pick.probHomeWin * 100).toFixed(0)}%</span>
                  </div>
                  <div className="bg-slate-600 bar-fill flex items-center justify-center" style={{ width: `${pick.probDraw * 100}%` }}>
                    <span className="text-[9px] text-white font-bold">{(pick.probDraw * 100).toFixed(0)}%</span>
                  </div>
                  <div className="bg-amber-500 bar-fill flex items-center justify-center" style={{ width: `${pick.probAwayWin * 100}%` }}>
                    <span className="text-[9px] text-white font-bold">{(pick.probAwayWin * 100).toFixed(0)}%</span>
                  </div>
                </div>

                {/* Details row */}
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>
                    Prediction: <b className={pick.predictedResult === 'H' ? 'text-indigo-400' : pick.predictedResult === 'A' ? 'text-amber-400' : 'text-slate-300'}>
                      {pick.predictedResult === 'H' ? pick.homeTeam.substring(0, 3) : pick.predictedResult === 'A' ? pick.awayTeam.substring(0, 3) : 'Draw'}
                    </b>
                  </span>
                  <span>xG: {pick.expectedHomeGoals.toFixed(1)} - {pick.expectedAwayGoals.toFixed(1)}</span>
                  <span>Score: {pick.mostLikelyScore}</span>
                </div>

                {/* Market data */}
                <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
                  <span>O2.5: {(pick.probOver25 * 100).toFixed(0)}%</span>
                  <span>BTTS: {(pick.probBttsYes * 100).toFixed(0)}%</span>
                  <span>Conf: {(pick.confidence * 100).toFixed(0)}%</span>
                  {pick.recommendedBet && <span className="text-emerald-400 font-bold">→ {pick.recommendedBet}</span>}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ACCA TAB
// ============================================================================
function AccaTab({ selections, onRemove }: { selections: Pick[]; onRemove: (pick: Pick) => void }) {
  const combinedOdds = selections.reduce((acc, s) => {
    if (!s.odds) return acc;
    const odds = s.predictedResult === 'H' ? s.odds.homeWin : s.predictedResult === 'A' ? s.odds.awayWin : s.odds.draw;
    return acc * (odds || 1.5);
  }, 1);

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Acca Builder</h1>
        <p className="text-sm text-slate-400">Build your accumulator from top picks</p>
      </div>

      {selections.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-slate-400 text-sm">No selections yet</p>
          <p className="text-slate-500 text-xs mt-1">Add picks from the Picks tab</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {selections.map((pick, i) => (
              <motion.div
                key={pick.fixtureId}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card rounded-xl p-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-white">{pick.homeTeam} vs {pick.awayTeam}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs font-bold ${pick.predictedResult === 'H' ? 'text-indigo-400' : pick.predictedResult === 'A' ? 'text-amber-400' : 'text-slate-300'}`}>
                      {pick.predictedResult === 'H' ? pick.homeTeam.substring(0, 3) : pick.predictedResult === 'A' ? pick.awayTeam.substring(0, 3) : 'Draw'}
                    </span>
                    <span className="text-[10px] text-slate-500">{(pick.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <button onClick={() => onRemove(pick)} className="text-slate-500 hover:text-red-400 transition-colors">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </motion.div>
            ))}
          </div>

          {/* Acca summary */}
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400">Selections</span>
              <span className="text-sm font-bold text-white">{selections.length}</span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400">Combined Odds</span>
              <span className="text-sm font-bold text-indigo-400">{combinedOdds.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Avg Confidence</span>
              <span className="text-sm font-bold text-emerald-400">
                {(selections.reduce((a, s) => a + s.confidence, 0) / selections.length * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// PROFILE TAB
// ============================================================================
function ProfileTab() {
  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Profile</h1>
        <p className="text-sm text-slate-400">Manage your account</p>
      </div>

      <div className="glass-card rounded-xl p-6 text-center">
        <div className="w-16 h-16 rounded-full gradient-accent flex items-center justify-center text-2xl font-bold text-white mx-auto mb-3">
          V
        </div>
        <h2 className="text-lg font-bold text-white">Vantage User</h2>
        <p className="text-sm text-slate-400 mt-1">Free Plan</p>
      </div>

      <div className="glass-card rounded-xl divide-y divide-slate-800">
        {[
          { label: 'Edit Profile', icon: '✏️' },
          { label: 'Notification Settings', icon: '🔔' },
          { label: 'Prediction Accuracy', icon: '📊' },
          { label: 'Upgrade to Pro', icon: '⭐' },
          { label: 'Help & Support', icon: '❓' },
          { label: 'Sign Out', icon: '🚪' },
        ].map(item => (
          <button key={item.label} className="flex items-center justify-between w-full px-4 py-3 text-sm text-white hover:bg-slate-800/50 transition-colors">
            <span className="flex items-center gap-3">
              <span>{item.icon}</span>
              {item.label}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-slate-600 mt-4">xG-Vantage v1.0 — Football Intelligence Engine</p>
    </div>
  );
}
