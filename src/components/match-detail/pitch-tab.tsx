'use client';

import { EmptyState } from '@/components/shared/empty-state';
import { Crosshair } from 'lucide-react';

interface PitchTabProps {
  stats?: Record<string, unknown> | null;
  fixture: Record<string, unknown>;
}

export function PitchTab({ stats, fixture }: PitchTabProps) {
  const homeTeam = fixture.homeTeam as Record<string, string> | undefined;
  const awayTeam = fixture.awayTeam as Record<string, string> | undefined;
  const shotmap = stats?.shotmap as Array<Record<string, unknown>> | undefined;
  const momentum = stats?.momentum as Array<{ m: number; v: number }> | undefined;

  return (
    <div className="p-4 space-y-4">
      {/* Pitch Visualization */}
      <div className="glass-card rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-3">Shotmap</h3>
        <div className="relative aspect-[3/2] rounded-xl overflow-hidden" style={{
          background: 'linear-gradient(180deg, #0a1a0f 0%, #0d200f 50%, #0a1a0f 100%)',
          border: '1px solid rgba(16, 231, 116, 0.1)',
        }}>
          {/* Pitch markings */}
          <div className="absolute inset-4 border border-[rgba(16,231,116,0.15)] rounded-sm">
            {/* Center line */}
            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[rgba(16,231,116,0.1)]" />
            {/* Center circle */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 border border-[rgba(16,231,116,0.1)] rounded-full" />
            {/* Penalty areas */}
            <div className="absolute top-1/2 -translate-y-1/2 left-0 w-12 h-1/2 border-r border-t border-b border-[rgba(16,231,116,0.1)]" />
            <div className="absolute top-1/2 -translate-y-1/2 right-0 w-12 h-1/2 border-l border-t border-b border-[rgba(16,231,116,0.1)]" />
          </div>

          {/* Shots */}
          {shotmap && shotmap.length > 0 ? (
            shotmap.map((shot, i) => {
              const isHome = shot.is_home as boolean;
              const x = ((shot.player_coordinates as Record<string, number>)?.x || 50);
              const y = ((shot.player_coordinates as Record<string, number>)?.y || 50);
              return (
                <div
                  key={i}
                  className="absolute w-2.5 h-2.5 rounded-full"
                  style={{
                    left: `${isHome ? x : 100 - x}%`,
                    top: `${y}%`,
                    background: isHome ? '#10e774' : '#f59e0b',
                    boxShadow: `0 0 6px ${isHome ? 'rgba(16,231,116,0.5)' : 'rgba(245,158,11,0.5)'}`,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              );
            })
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-xs text-[rgba(255,255,255,0.2)]">No shot data</p>
            </div>
          )}

          {/* Team labels */}
          <div className="absolute bottom-2 left-3 text-[10px] font-semibold text-[rgba(16,231,116,0.4)]">
            {homeTeam?.name || 'Home'}
          </div>
          <div className="absolute bottom-2 right-3 text-[10px] font-semibold text-[rgba(245,158,11,0.4)]">
            {awayTeam?.name || 'Away'}
          </div>
        </div>
      </div>

      {/* Momentum */}
      <div className="glass-card rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-3">Live Momentum</h3>
        {momentum && momentum.length > 0 ? (
          <div className="h-24 flex items-end gap-px">
            {momentum.slice(-60).map((m, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm min-w-[2px]"
                style={{
                  height: `${Math.abs(m.v) * 100}%`,
                  background: m.v > 0 ? '#10e774' : '#f59e0b',
                  opacity: 0.6,
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Crosshair}
            title="No momentum data"
            description="Momentum graph will appear during the match"
          />
        )}
      </div>

      {/* xG Display */}
      <div className="glass-card rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-3">Live xG</h3>
        <div className="flex items-center justify-between">
          <div className="text-center">
            <p className="text-2xl font-bold text-[#10e774]">
              {(stats?.homeExpectedGoals as number)?.toFixed(2) || '0.00'}
            </p>
            <p className="text-[10px] text-[#9ca3af]">{homeTeam?.name || 'Home'}</p>
          </div>
          <div className="text-[#9ca3af] text-xs">xG</div>
          <div className="text-center">
            <p className="text-2xl font-bold text-[#f59e0b]">
              {(stats?.awayExpectedGoals as number)?.toFixed(2) || '0.00'}
            </p>
            <p className="text-[10px] text-[#9ca3af]">{awayTeam?.name || 'Away'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
