'use client';

import { EmptyState } from '@/components/shared/empty-state';
import { Users } from 'lucide-react';

interface LineupsTabProps {
  lineup?: Record<string, unknown> | null;
  fixture: Record<string, unknown>;
}

export function LineupsTab({ lineup, fixture }: LineupsTabProps) {
  const homeTeam = fixture.homeTeam as Record<string, string> | undefined;
  const awayTeam = fixture.awayTeam as Record<string, string> | undefined;

  if (!lineup || (lineup.lineupStatus as string) === 'unavailable') {
    return (
      <div className="p-4">
        <EmptyState
          icon={Users}
          title="Lineups not available"
          description="Lineups will appear once confirmed before the match"
        />
      </div>
    );
  }

  const homeFormation = (lineup.homeFormation as string) || '4-4-2';
  const awayFormation = (lineup.awayFormation as string) || '4-4-2';

  const parsePlayers = (data: unknown): Array<{ name: string; position: string; jerseyNumber?: number }> => {
    if (!data) return [];
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch { return []; }
    }
    return Array.isArray(data) ? data : [];
  };

  const homePlayers = parsePlayers(lineup.homePlayers);
  const awayPlayers = parsePlayers(lineup.awayPlayers);
  const homeSubs = parsePlayers(lineup.homeSubstitutes);
  const awaySubs = parsePlayers(lineup.awaySubstitutes);
  const homeUnavailable = parsePlayers(lineup.homeUnavailable);
  const awayUnavailable = parsePlayers(lineup.awayUnavailable);

  return (
    <div className="p-4 space-y-4">
      {/* Formations */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-center">
            <span className="text-lg font-bold text-[#10e774]">{homeFormation}</span>
            <p className="text-[10px] text-[#9ca3af]">{homeTeam?.name || 'Home'}</p>
          </div>
          <div className="text-xs text-[rgba(255,255,255,0.2)]">FORMATIONS</div>
          <div className="text-center">
            <span className="text-lg font-bold text-[#f59e0b]">{awayFormation}</span>
            <p className="text-[10px] text-[#9ca3af]">{awayTeam?.name || 'Away'}</p>
          </div>
        </div>

        {/* Lineup Status */}
        {(lineup.lineupStatus as string) && (
          <div className="text-center">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${
              (lineup.lineupStatus as string) === 'confirmed'
                ? 'badge-green'
                : 'bg-[rgba(245,158,11,0.12)] text-[#f59e0b] border border-[rgba(245,158,11,0.2)]'
            }`}>
              {(lineup.lineupStatus as string) === 'confirmed' ? '✓ CONFIRMED' : 'PREDICTED'}
            </span>
          </div>
        )}
      </div>

      {/* Players */}
      <div className="grid grid-cols-2 gap-3">
        {/* Home XI */}
        <div className="glass-card rounded-2xl p-3">
          <h4 className="text-[10px] font-bold text-[#10e774] uppercase tracking-wider mb-2">
            {homeTeam?.name || 'Home'} XI
          </h4>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {homePlayers.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-[#9ca3af] w-5">
                  {p.jerseyNumber || ''}
                </span>
                <span className="text-xs text-white truncate">{p.name}</span>
                <span className="text-[10px] text-[rgba(255,255,255,0.2)] ml-auto">{p.position}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Away XI */}
        <div className="glass-card rounded-2xl p-3">
          <h4 className="text-[10px] font-bold text-[#f59e0b] uppercase tracking-wider mb-2">
            {awayTeam?.name || 'Away'} XI
          </h4>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {awayPlayers.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-[#9ca3af] w-5">
                  {p.jerseyNumber || ''}
                </span>
                <span className="text-xs text-white truncate">{p.name}</span>
                <span className="text-[10px] text-[rgba(255,255,255,0.2)] ml-auto">{p.position}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Substitutes */}
      {(homeSubs.length > 0 || awaySubs.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="glass-card rounded-2xl p-3">
            <h4 className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-wider mb-2">Subs</h4>
            <div className="space-y-1.5">
              {homeSubs.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-[#9ca3af] w-5">{p.jerseyNumber || ''}</span>
                  <span className="text-xs text-white truncate">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="glass-card rounded-2xl p-3">
            <h4 className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-wider mb-2">Subs</h4>
            <div className="space-y-1.5">
              {awaySubs.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-[#9ca3af] w-5">{p.jerseyNumber || ''}</span>
                  <span className="text-xs text-white truncate">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Unavailable */}
      {(homeUnavailable.length > 0 || awayUnavailable.length > 0) && (
        <div className="glass-card rounded-2xl p-4">
          <h4 className="text-[10px] font-bold text-[#ef4444] uppercase tracking-wider mb-3">Missing / Unavailable</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              {homeUnavailable.map((p, i) => (
                <p key={i} className="text-xs text-[#9ca3af]">{p.name}</p>
              ))}
            </div>
            <div className="space-y-1">
              {awayUnavailable.map((p, i) => (
                <p key={i} className="text-xs text-[#9ca3af]">{p.name}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
