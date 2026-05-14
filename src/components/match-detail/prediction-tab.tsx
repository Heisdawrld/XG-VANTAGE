'use client';

import { motion } from 'framer-motion';
import { ConfidenceRing } from '@/components/shared/confidence-ring';
import { Share2, TrendingUp, Shield, Target } from 'lucide-react';

interface PredictionTabProps {
  fixture: Record<string, unknown>;
  prediction?: Record<string, unknown> | null;
  odds?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export function PredictionTab({ fixture, prediction, odds, metadata }: PredictionTabProps) {
  if (!prediction) {
    return (
      <div className="p-4">
        <div className="glass-card rounded-2xl p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[rgba(16,231,116,0.08)] flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">🧠</span>
          </div>
          <p className="text-[#9ca3af] text-sm">No prediction available for this match</p>
          <p className="text-[rgba(255,255,255,0.3)] text-xs mt-1">Sync data to generate predictions</p>
        </div>
      </div>
    );
  }

  const homeProb = ((prediction.probHomeWin as number) || 0) * 100;
  const drawProb = ((prediction.probDraw as number) || 0) * 100;
  const awayProb = ((prediction.probAwayWin as number) || 0) * 100;
  const confPct = ((prediction.confidence as number) || 0) * 100;
  const verdict = (prediction.verdict as string) || 'MODERATE';
  const recommendedBet = (prediction.recommendedBet as string) || (prediction.pickLabel as string) || '';
  const valueDetected = prediction.valueDetected as boolean;
  const valueEdge = ((prediction.valueEdge as number) || (prediction.edge as number) || 0) * 100;

  const homeTeam = fixture.homeTeam as Record<string, string> | undefined;
  const awayTeam = fixture.awayTeam as Record<string, string> | undefined;

  const verdictColors: Record<string, string> = {
    STRONG: '#10e774',
    MODERATE: '#f59e0b',
    WEAK: '#ef4444',
  };

  return (
    <div className="p-4 space-y-4">
      {/* Share Pick */}
      <button className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] transition-colors text-sm text-[#9ca3af]">
        <Share2 className="w-4 h-4" />
        Share Pick
      </button>

      {/* Badges */}
      <div className="flex gap-2 flex-wrap">
        {confPct >= 75 && (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[rgba(16,231,116,0.12)] border border-[rgba(16,231,116,0.2)]">
            <Target className="w-3 h-3 text-[#10e774]" />
            <span className="text-[10px] font-bold text-[#10e774]">PICK THIS</span>
          </div>
        )}
        {confPct >= 65 && (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[rgba(59,130,246,0.12)] border border-[rgba(59,130,246,0.2)]">
            <Shield className="w-3 h-3 text-[#60a5fa]" />
            <span className="text-[10px] font-bold text-[#60a5fa]">LOW RISK</span>
          </div>
        )}
        {valueDetected && (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[rgba(245,158,11,0.12)] border border-[rgba(245,158,11,0.2)]">
            <TrendingUp className="w-3 h-3 text-[#f59e0b]" />
            <span className="text-[10px] font-bold text-[#f59e0b]">VALUE</span>
          </div>
        )}
      </div>

      {/* Verdict */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider">Verdict</span>
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: verdictColors[verdict] || '#f59e0b' }}
          >
            {verdict}
          </span>
        </div>

        {/* Main Prediction */}
        <div className="text-center mb-5">
          <p className="text-2xl font-bold text-[#10e774] mb-2 font-[family-name:var(--font-space-grotesk)]">
            {recommendedBet || 'HOME WIN'}
          </p>
          <div className="flex justify-center">
            <ConfidenceRing confidence={confPct} size={72} strokeWidth={5} />
          </div>
        </div>

        {/* Actionable Edge */}
        {valueDetected && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-[rgba(16,231,116,0.06)] border border-[rgba(16,231,116,0.12)]">
            <span className="text-xs text-[#9ca3af]">Actionable Edge</span>
            <span className="text-sm font-bold text-[#10e774]">+{valueEdge.toFixed(1)}% vs Bookmakers</span>
          </div>
        )}
      </div>

      {/* Probability Bars */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-4">Phantom Decision Stack</h3>

        {/* Home */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-white font-medium">{homeTeam?.name || 'Home'}</span>
            <span className="text-xs font-bold text-white">{homeProb.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-[#10e774]"
              initial={{ width: 0 }}
              animate={{ width: `${homeProb}%` }}
              transition={{ duration: 0.8 }}
            />
          </div>
        </div>

        {/* Draw */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-white font-medium">Draw</span>
            <span className="text-xs font-bold text-white">{drawProb.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-[#9ca3af]"
              initial={{ width: 0 }}
              animate={{ width: `${drawProb}%` }}
              transition={{ duration: 0.8 }}
            />
          </div>
        </div>

        {/* Away */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-white font-medium">{awayTeam?.name || 'Away'}</span>
            <span className="text-xs font-bold text-white">{awayProb.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-[#f59e0b]"
              initial={{ width: 0 }}
              animate={{ width: `${awayProb}%` }}
              transition={{ duration: 0.8 }}
            />
          </div>
        </div>
      </div>

      {/* Key Reasons */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-3">Key Reasons</h3>
        <div className="space-y-2">
          {[
            `Strong ${(prediction.pickType as string) === '1' ? 'home' : 'away'} advantage based on form`,
            `${(homeTeam?.name || 'Home')} xG: ${((prediction.homeXg as number) || 0).toFixed(2)} vs ${(awayTeam?.name || 'Away')}: ${((prediction.awayXg as number) || 0).toFixed(2)}`,
            `Confidence: ${confPct.toFixed(0)}% — ${verdict.toLowerCase()} signal`,
            valueDetected ? 'Value detected against market odds' : null,
          ].filter(Boolean).map((reason, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#10e774] mt-1.5 flex-shrink-0" />
              <p className="text-xs text-[#9ca3af]">{reason}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Odds */}
      {odds && (
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-3">Market Odds</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-3 rounded-xl bg-[rgba(255,255,255,0.03)]">
              <p className="text-[10px] text-[#9ca3af] mb-1">Home</p>
              <p className="text-base font-bold text-white">{(odds.homeWin as number)?.toFixed(2) || '-'}</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-[rgba(255,255,255,0.03)]">
              <p className="text-[10px] text-[#9ca3af] mb-1">Draw</p>
              <p className="text-base font-bold text-white">{(odds.draw as number)?.toFixed(2) || '-'}</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-[rgba(255,255,255,0.03)]">
              <p className="text-[10px] text-[#9ca3af] mb-1">Away</p>
              <p className="text-base font-bold text-white">{(odds.awayWin as number)?.toFixed(2) || '-'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
