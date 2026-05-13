'use client';

import { useState, useEffect, useCallback } from 'react';
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

type Tab = 'home' | 'picks' | 'acca' | 'profile';

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

  // Fetch fixtures
  const fetchFixtures = useCallback(async () => {
    try {
      const res = await fetch('/api/fixtures');
      const data = await res.json();
      setFixtures(data.fixtures || []);
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

  const leagueNames: Record<number, string> = {
    17: 'Premier League', 3: 'La Liga', 9: 'Serie A', 6: 'Ligue 1', 13: 'Scottish Prem',
    8: 'Bundesliga', 14: 'Pro League', 30: 'AFCON', 29: 'CAF CL', 34: 'Serie B',
  };

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
          {liveEvents.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 live-pulse" />
              {liveEvents.length} LIVE
            </div>
          )}
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
              <PicksTab picks={picks} loading={loading} onAddToAcca={toggleAcca} accaSelections={accaSelections} />
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
    </div>
  );
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
function PicksTab({ picks, loading, onAddToAcca, accaSelections }: {
  picks: Pick[];
  loading: boolean;
  onAddToAcca: (pick: Pick) => void;
  accaSelections: Pick[];
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
                  <div>
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
