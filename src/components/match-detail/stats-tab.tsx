'use client';

import { motion } from 'framer-motion';

interface StatsTabProps {
  stats?: Record<string, unknown> | null;
  fixture: Record<string, unknown>;
}

export function StatsTab({ stats, fixture }: StatsTabProps) {
  const homeTeam = fixture.homeTeam as Record<string, string> | undefined;
  const awayTeam = fixture.awayTeam as Record<string, string> | undefined;

  if (!stats) {
    return (
      <div className="p-4">
        <div className="glass-card rounded-2xl p-8 text-center">
          <p className="text-[#9ca3af] text-sm">No stats available for this match</p>
          <p className="text-[rgba(255,255,255,0.3)] text-xs mt-1">Stats will appear once the match begins</p>
        </div>
      </div>
    );
  }

  const statRows = [
    { label: 'Possession', home: stats.homeBallPossession as number, away: stats.awayBallPossession as number, suffix: '%' },
    { label: 'Total Shots', home: stats.homeTotalShots as number, away: stats.awayTotalShots as number },
    { label: 'Shots on Target', home: stats.homeShotsOnTarget as number, away: stats.awayShotsOnTarget as number },
    { label: 'Big Chances', home: stats.homeBigChances as number, away: stats.awayBigChances as number },
    { label: 'Corners', home: stats.homeCornerKicks as number, away: stats.awayCornerKicks as number },
    { label: 'Passes', home: stats.homePasses as number, away: stats.awayPasses as number },
    { label: 'Pass Accuracy', home: stats.homePassAccuracy as number, away: stats.awayPassAccuracy as number, suffix: '%' },
    { label: 'Tackles', home: stats.homeTotalTackles as number, away: stats.awayTotalTackles as number },
    { label: 'Interceptions', home: stats.homeInterceptions as number, away: stats.awayInterceptions as number },
    { label: 'Fouls', home: stats.homeFouls as number, away: stats.awayFouls as number },
    { label: 'Yellow Cards', home: stats.homeYellowCards as number, away: stats.awayYellowCards as number },
    { label: 'xG', home: stats.homeExpectedGoals as number, away: stats.awayExpectedGoals as number },
  ];

  return (
    <div className="p-4 space-y-4">
      {/* Team Headers */}
      <div className="flex items-center justify-between">
        <div className="text-center flex-1">
          <p className="text-sm font-bold text-white">{homeTeam?.name || 'Home'}</p>
        </div>
        <div className="px-4">
          <span className="text-xs text-[#9ca3af]">VS</span>
        </div>
        <div className="text-center flex-1">
          <p className="text-sm font-bold text-white">{awayTeam?.name || 'Away'}</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="glass-card rounded-2xl p-4 space-y-4">
        {statRows.map((row) => {
          const homeVal = row.home || 0;
          const awayVal = row.away || 0;
          const total = homeVal + awayVal || 1;
          const homePct = (homeVal / total) * 100;
          const awayPct = (awayVal / total) * 100;
          const homeLeading = homeVal > awayVal;
          const awayLeading = awayVal > homeVal;

          return (
            <div key={row.label}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-sm font-bold ${homeLeading ? 'text-[#10e774]' : 'text-white'}`}>
                  {typeof homeVal === 'number' ? (Number.isInteger(homeVal) ? homeVal : homeVal.toFixed(1)) : homeVal}
                  {row.suffix || ''}
                </span>
                <span className="text-[10px] text-[#9ca3af] uppercase tracking-wider font-medium">
                  {row.label}
                </span>
                <span className={`text-sm font-bold ${awayLeading ? 'text-[#10e774]' : 'text-white'}`}>
                  {typeof awayVal === 'number' ? (Number.isInteger(awayVal) ? awayVal : awayVal.toFixed(1)) : awayVal}
                  {row.suffix || ''}
                </span>
              </div>
              <div className="flex gap-1 h-1.5">
                <div className="flex-1 rounded-full overflow-hidden bg-[rgba(255,255,255,0.06)] flex justify-end">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: homeLeading ? '#10e774' : 'rgba(255,255,255,0.2)' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${homePct}%` }}
                    transition={{ duration: 0.6 }}
                  />
                </div>
                <div className="flex-1 rounded-full overflow-hidden bg-[rgba(255,255,255,0.06)]">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: awayLeading ? '#10e774' : 'rgba(255,255,255,0.2)' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${awayPct}%` }}
                    transition={{ duration: 0.6 }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
