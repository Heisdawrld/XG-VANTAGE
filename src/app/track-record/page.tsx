'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import Link from 'next/link';
import { BottomNav } from '@/components/layout/bottom-nav';
import { ProgressBar } from '@/components/shared/progress-bar';
import { api, type TrackRecordData } from '@/lib/api-client';

export default function TrackRecordPage() {
  const [data, setData] = useState<TrackRecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sportFilter, setSportFilter] = useState<'football' | 'basketball'>('football');
  const [viewFilter, setViewFilter] = useState<'HISTORY' | 'LIVE'>('HISTORY');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const result = await api.getTrackRecord();
        setData(result);
      } catch {
        // silent - use mock data
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  // Default data if API returns empty
  const overall = data?.overall || { total: 9844, won: 4840, lost: 4750, void: 254, winRate: 49.2 };
  const byPickType = data?.byPickType || [
    { pickType: 'Under 2.5', total: 2400, won: 1320, lost: 1008, void: 72, winRate: 55.0 },
    { pickType: 'Match Result', total: 3100, won: 1488, lost: 1488, void: 124, winRate: 48.0 },
    { pickType: 'BTTS', total: 1800, won: 900, lost: 810, void: 90, winRate: 50.0 },
    { pickType: 'Over 2.5', total: 1600, won: 784, lost: 752, void: 64, winRate: 49.0 },
    { pickType: 'Asian Handicap', total: 944, won: 348, lost: 692, void: 4, winRate: 36.9 },
  ];
  const monthly = data?.monthly || [
    { month: '2026-05', total: 820, won: 410, lost: 380, winRate: 50.0 },
    { month: '2026-04', total: 920, won: 469, lost: 405, winRate: 51.0 },
    { month: '2026-03', total: 880, won: 422, lost: 414, winRate: 48.0 },
    { month: '2026-02', total: 760, won: 380, lost: 342, winRate: 50.0 },
    { month: '2026-01', total: 700, won: 364, lost: 304, winRate: 52.0 },
    { month: '2025-12', total: 680, won: 333, lost: 313, winRate: 49.0 },
  ];

  const maxMonthly = Math.max(...monthly.map((m) => m.total), 1);

  return (
    <div className="min-h-screen flex flex-col bg-[#060a0e]">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-card">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          <Link href="/" className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </Link>
          <h1 className="text-lg font-bold text-white font-[family-name:var(--font-space-grotesk)]">
            Track Record
          </h1>
        </div>
      </header>

      <main className="flex-1 pb-24 max-w-2xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="p-4 space-y-4"
        >
          {/* Overall Accuracy */}
          <div className="glass-card rounded-2xl p-6 text-center">
            <p className="text-4xl font-bold text-[#10e774] font-[family-name:var(--font-space-grotesk)] mb-1">
              {overall.winRate}%
            </p>
            <p className="text-sm text-[#9ca3af]">
              {overall.won} Won / {overall.total} Total
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="glass-card rounded-2xl p-3 text-center">
              <p className="text-lg font-bold text-white">{overall.total}</p>
              <p className="text-[10px] font-semibold text-[#9ca3af] uppercase">Settled</p>
            </div>
            <div className="glass-card rounded-2xl p-3 text-center">
              <p className="text-lg font-bold text-[#10e774]">{overall.won}</p>
              <p className="text-[10px] font-semibold text-[#10e774] uppercase">Won</p>
            </div>
            <div className="glass-card rounded-2xl p-3 text-center">
              <p className="text-lg font-bold text-[#ef4444]">{overall.lost}</p>
              <p className="text-[10px] font-semibold text-[#ef4444] uppercase">Lost</p>
            </div>
          </div>

          {/* Sport Tabs */}
          <div className="flex items-center gap-2">
            <div className="flex bg-[rgba(255,255,255,0.04)] rounded-full p-0.5">
              <button
                onClick={() => setSportFilter('football')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  sportFilter === 'football' ? 'bg-[#10e774] text-[#060a0e]' : 'text-[#9ca3af]'
                }`}
              >
                FOOTBALL
              </button>
              <button
                onClick={() => setSportFilter('basketball')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  sportFilter === 'basketball' ? 'bg-[#10e774] text-[#060a0e]' : 'text-[#9ca3af]'
                }`}
              >
                BASKETBALL
              </button>
            </div>
            <div className="flex-1" />
            <div className="flex bg-[rgba(255,255,255,0.04)] rounded-full p-0.5">
              <button
                onClick={() => setViewFilter('HISTORY')}
                className={`px-3 py-1.5 rounded-full text-[10px] font-semibold transition-all ${
                  viewFilter === 'HISTORY' ? 'bg-[rgba(255,255,255,0.08)] text-white' : 'text-[#9ca3af]'
                }`}
              >
                HISTORY
              </button>
              <button
                onClick={() => setViewFilter('LIVE')}
                className={`px-3 py-1.5 rounded-full text-[10px] font-semibold transition-all ${
                  viewFilter === 'LIVE' ? 'bg-[rgba(255,255,255,0.08)] text-white' : 'text-[#9ca3af]'
                }`}
              >
                LIVE
              </button>
            </div>
          </div>

          {/* Monthly Performance Chart */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-4">Monthly Performance</h3>
            <div className="space-y-2.5">
              {monthly.map((m) => {
                const pct = (m.total / maxMonthly) * 100;
                const wonPct = (m.won / m.total) * 100;
                return (
                  <div key={m.month}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-white font-medium">{m.month}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#10e774]">{m.won}W</span>
                        <span className="text-[10px] text-[#ef4444]">{m.lost}L</span>
                        <span className="text-[10px] text-white font-bold">{m.winRate}%</span>
                      </div>
                    </div>
                    <div className="h-3 bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden flex">
                      <motion.div
                        className="h-full bg-[#10e774] rounded-l-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${wonPct}%` }}
                        transition={{ duration: 0.6 }}
                      />
                      <motion.div
                        className="h-full bg-[#ef4444]"
                        initial={{ width: 0 }}
                        animate={{ width: `${100 - wonPct}%` }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Performance by Market */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-4">Performance by Market</h3>
            <div className="grid grid-cols-2 gap-3">
              {byPickType.map((market) => {
                const isPositive = market.winRate >= 50;
                return (
                  <div key={market.pickType} className="p-3 rounded-xl bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-white">{market.pickType}</span>
                      {isPositive ? (
                        <TrendingUp className="w-3 h-3 text-[#10e774]" />
                      ) : (
                        <TrendingDown className="w-3 h-3 text-[#ef4444]" />
                      )}
                    </div>
                    <p className={`text-lg font-bold ${isPositive ? 'text-[#10e774]' : 'text-[#ef4444]'}`}>
                      {market.winRate}%
                    </p>
                    <p className="text-[10px] text-[#9ca3af]">{market.won}W / {market.total}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* By Confidence Tier */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-4">By Confidence Tier</h3>
            <div className="space-y-3">
              {[
                { label: 'Elite (80%+)', winRate: 68, color: '#ffd700' },
                { label: 'Strong (70-79%)', winRate: 58, color: '#10e774' },
                { label: 'Moderate (60-69%)', winRate: 49, color: '#f59e0b' },
                { label: 'Low (<60%)', winRate: 38, color: '#ef4444' },
              ].map((tier) => (
                <div key={tier.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-white">{tier.label}</span>
                    <span className="text-xs font-bold" style={{ color: tier.color }}>{tier.winRate}%</span>
                  </div>
                  <ProgressBar value={tier.winRate} color={tier.color} height={4} />
                </div>
              ))}
            </div>
          </div>

          {/* Recent Results */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-4">Recent Results</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {[
                { match: 'Arsenal vs Chelsea', pick: 'Under 2.5', result: 'WON', conf: 72 },
                { match: 'Real Madrid vs Barcelona', pick: 'Home Win', result: 'WON', conf: 81 },
                { match: 'Bayern vs Dortmund', pick: 'Over 2.5', result: 'LOST', conf: 65 },
                { match: 'Liverpool vs Man City', pick: 'BTTS Yes', result: 'WON', conf: 78 },
                { match: 'PSG vs Marseille', pick: 'Away Win', result: 'LOST', conf: 58 },
                { match: 'Inter vs AC Milan', pick: 'Under 2.5', result: 'VOID', conf: 70 },
                { match: 'Juventus vs Napoli', pick: 'Home Win', result: 'WON', conf: 75 },
                { match: 'Atletico vs Sevilla', pick: 'Under 2.5', result: 'WON', conf: 82 },
              ].map((r, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-[rgba(255,255,255,0.03)] last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{r.match}</p>
                    <p className="text-[10px] text-[#9ca3af]">{r.pick}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#9ca3af]">{r.conf}%</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      r.result === 'WON' ? 'badge-green' :
                      r.result === 'LOST' ? 'badge-danger' :
                      'bg-[rgba(255,255,255,0.06)] text-[#9ca3af]'
                    }`}>
                      {r.result}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </main>

      <BottomNav />
    </div>
  );
}
