'use client';

import { ConfidenceRing } from '@/components/shared/confidence-ring';
import { TeamLogo } from '@/components/ui/team-logo';
import type { PickData } from '@/lib/api-client';

interface PickCardProps {
  pick: PickData;
  onSelect?: (fixtureId: number) => void;
}

export function PickCard({ pick, onSelect }: PickCardProps) {
  const rankColors: Record<number, string> = {
    1: '#ffd700',
    2: '#c0c0c0',
    3: '#cd7f32',
  };

  const rankColor = rankColors[pick.rank] || '#9ca3af';
  const confPct = pick.confidence * 100;

  const getTierBadge = (tier?: string) => {
    switch (tier?.toUpperCase()) {
      case 'ELITE':
        return <span className="badge-elite px-2 py-0.5 rounded-full text-[10px] font-bold">ELITE</span>;
      case 'VALUE':
        return <span className="badge-value px-2 py-0.5 rounded-full text-[10px] font-bold">VALUE BET</span>;
      default:
        return <span className="badge-green px-2 py-0.5 rounded-full text-[10px] font-bold">PLAYABLE</span>;
    }
  };

  return (
    <div
      onClick={() => onSelect?.(pick.fixtureId)}
      className="glass-card glass-card-hover rounded-2xl p-4 transition-all cursor-pointer"
    >
      <div className="flex items-start gap-3">
        {/* Rank Medal */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: `linear-gradient(135deg, ${rankColor}20, ${rankColor}08)`,
            border: `1px solid ${rankColor}30`,
          }}
        >
          <span className="text-sm font-bold" style={{ color: rankColor }}>
            #{pick.rank}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Match with logos */}
          <div className="flex items-center gap-2 mb-1">
            <TeamLogo
              teamId={pick.homeTeamId}
              name={pick.homeTeam}
              shortName={pick.homeTeamShortName}
              logoUrl={pick.homeTeamLogo}
              size={20}
            />
            <span className="text-sm font-bold text-white truncate">{pick.homeTeam}</span>
            <span className="text-xs text-[#9ca3af]">vs</span>
            <span className="text-sm font-bold text-white truncate">{pick.awayTeam}</span>
            <TeamLogo
              teamId={pick.awayTeamId}
              name={pick.awayTeam}
              shortName={pick.awayTeamShortName}
              logoUrl={pick.awayTeamLogo}
              size={20}
            />
          </div>

          {/* Prediction */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-[#10e774]">
              {pick.pickLabel || pick.recommendedBet || 'Home Win'}
            </span>
            {getTierBadge(pick.tier)}
          </div>

          {/* Time */}
          <p className="text-[10px] text-[#9ca3af]">
            {new Date(pick.eventDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </p>
        </div>

        {/* Confidence */}
        <div className="flex-shrink-0">
          <ConfidenceRing confidence={confPct} size={48} />
        </div>
      </div>

      {/* Edge indicator */}
      {pick.valueDetected && (
        <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.04)] flex items-center justify-between">
          <span className="text-[10px] text-[#9ca3af]">Edge vs Market</span>
          <span className="text-xs font-bold text-[#10e774]">+{((pick.edge || pick.valueEdge || 0)).toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}
