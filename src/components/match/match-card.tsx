'use client';

import Link from 'next/link';
import { ConfidenceRing } from '@/components/shared/confidence-ring';
import { TeamLogo } from '@/components/ui/team-logo';

interface MatchCardProps {
  id: number;
  homeTeam: { id?: number; name: string; shortName?: string; logo?: string };
  awayTeam: { id?: number; name: string; shortName?: string; logo?: string };
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  currentMinute?: number;
  period?: string;
  eventDate: string;
  prediction?: {
    predictedResult: string;
    confidence: number;
    pickLabel?: string;
    pickType?: string;
  } | null;
  compact?: boolean;
}

export function MatchCard({
  id,
  homeTeam,
  awayTeam,
  status,
  homeScore,
  awayScore,
  currentMinute,
  eventDate,
  prediction,
  compact = false,
}: MatchCardProps) {
  const isLive = status === 'inprogress';
  const isFinished = status === 'finished';
  const isUpcoming = status === 'notstarted';

  const timeStr = isUpcoming
    ? new Date(eventDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  return (
    <Link href={`/match/${id}`}>
      <div className="glass-card glass-card-hover rounded-2xl p-4 transition-all cursor-pointer group">
        <div className="flex items-center gap-3">
          {/* Home Team */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <TeamLogo
                teamId={homeTeam.id}
                name={homeTeam.name}
                shortName={homeTeam.shortName}
                logoUrl={homeTeam.logo}
                size={28}
              />
              <span className="text-sm font-semibold text-white truncate">{homeTeam.name}</span>
            </div>
          </div>

          {/* Score / Time */}
          <div className="flex flex-col items-center px-3 flex-shrink-0">
            {isLive && (
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10e774] live-pulse" />
                <span className="text-[10px] font-bold text-[#10e774]">{currentMinute || 0}&apos;</span>
              </div>
            )}
            {isFinished && (
              <span className="text-[10px] font-bold text-[#9ca3af] mb-0.5">FT</span>
            )}
            <div className="flex items-center gap-2">
              <span className={`text-lg font-bold ${isLive ? 'text-[#10e774]' : 'text-white'}`}>
                {homeScore ?? (timeStr || '-')}
              </span>
              {(isLive || isFinished) && (
                <>
                  <span className="text-xs text-[rgba(255,255,255,0.2)]">-</span>
                  <span className={`text-lg font-bold ${isLive ? 'text-[#10e774]' : 'text-white'}`}>
                    {awayScore ?? '-'}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Away Team */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 justify-end">
              <span className="text-sm font-semibold text-white truncate">{awayTeam.name}</span>
              <TeamLogo
                teamId={awayTeam.id}
                name={awayTeam.name}
                shortName={awayTeam.shortName}
                logoUrl={awayTeam.logo}
                size={28}
              />
            </div>
          </div>
        </div>

        {/* Prediction row */}
        {prediction && !compact && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[rgba(255,255,255,0.04)]">
            <div className="flex items-center gap-2">
              {prediction.pickLabel && (
                <span className="text-xs font-semibold text-[#10e774]">
                  {prediction.pickLabel}
                </span>
              )}
              {!prediction.pickLabel && prediction.predictedResult && (
                <span className="text-xs font-semibold text-[#10e774]">
                  {prediction.predictedResult === 'H' ? 'Home Win' :
                   prediction.predictedResult === 'A' ? 'Away Win' : 'Draw'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <ConfidenceRing confidence={prediction.confidence * 100} size={32} strokeWidth={3} />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
