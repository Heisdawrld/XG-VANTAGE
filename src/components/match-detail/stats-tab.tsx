'use client';

import { motion } from 'framer-motion';
import { TeamLogo } from '@/components/ui/team-logo';

interface StatsTabProps {
  stats?: Record<string, unknown> | null;
  fixture: Record<string, unknown>;
}

// Form result badge colors
const formColors: Record<string, { bg: string; text: string }> = {
  W: { bg: 'rgba(16, 231, 116, 0.15)', text: '#10e774' },
  D: { bg: 'rgba(255, 193, 7, 0.15)', text: '#ffc107' },
  L: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${day}/${month}`;
  } catch {
    return '';
  }
}

export function StatsTab({ stats, fixture }: StatsTabProps) {
  const homeTeam = fixture.homeTeam as Record<string, unknown> | undefined;
  const awayTeam = fixture.awayTeam as Record<string, unknown> | undefined;
  const homeTeamId = homeTeam?.id as number | undefined;
  const awayTeamId = awayTeam?.id as number | undefined;
  const h2h = fixture.h2h as { matches: Array<Record<string, unknown>>; summary: { totalMatches: number; homeWins: number; draws: number; awayWins: number; homeGoals: number; awayGoals: number } } | undefined;
  const homeLast5 = fixture.homeLast5 as Array<Record<string, unknown>> | undefined;
  const awayLast5 = fixture.awayLast5 as Array<Record<string, unknown>> | undefined;
  const homeProfile = fixture.homeProfile as Record<string, unknown> | undefined;
  const awayProfile = fixture.awayProfile as Record<string, unknown> | undefined;

  // Match stats rows - include all available stats
  const statRows = [
    { label: 'Possession', home: stats?.homeBallPossession as number, away: stats?.awayBallPossession as number, suffix: '%' },
    { label: 'Total Shots', home: stats?.homeTotalShots as number, away: stats?.awayTotalShots as number },
    { label: 'Shots on Target', home: stats?.homeShotsOnTarget as number, away: stats?.awayShotsOnTarget as number },
    { label: 'Big Chances', home: stats?.homeBigChances as number, away: stats?.awayBigChances as number },
    { label: 'Corners', home: stats?.homeCornerKicks as number, away: stats?.awayCornerKicks as number },
    { label: 'Passes', home: stats?.homePasses as number, away: stats?.awayPasses as number },
    { label: 'Pass Accuracy', home: stats?.homePassAccuracy as number, away: stats?.awayPassAccuracy as number, suffix: '%' },
    { label: 'Tackles', home: stats?.homeTackles as number, away: stats?.awayTackles as number },
    { label: 'Interceptions', home: stats?.homeInterceptions as number, away: stats?.awayInterceptions as number },
    { label: 'Attacks', home: stats?.homeAttacks as number, away: stats?.awayAttacks as number },
    { label: 'Dangerous Attacks', home: stats?.homeDangerousAttacks as number, away: stats?.awayDangerousAttacks as number },
    { label: 'Fouls', home: stats?.homeFouls as number, away: stats?.awayFouls as number },
    { label: 'Yellow Cards', home: stats?.homeYellowCards as number, away: stats?.awayYellowCards as number },
    { label: 'xG', home: stats?.homeExpectedGoals as number, away: stats?.awayExpectedGoals as number },
  ].filter(r => r.home != null || r.away != null); // Only show stats that have data

  const hasStats = statRows.some(r => r.home != null || r.away != null);

  return (
    <div className="p-4 space-y-4">
      {/* ====== MATCH STATS SECTION ====== */}
      {hasStats ? (
        <div className="space-y-3">
          {/* Team Headers with logos */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <TeamLogo
                teamId={homeTeamId}
                name={homeTeam?.name as string}
                shortName={homeTeam?.shortName as string}
                logoUrl={homeTeam?.logo as string}
                size={32}
              />
              <p className="text-sm font-bold text-white truncate">{homeTeam?.name || 'Home'}</p>
            </div>
            <div className="px-3">
              <span className="text-xs text-[#9ca3af] font-medium">MATCH STATS</span>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
              <p className="text-sm font-bold text-white truncate">{awayTeam?.name || 'Away'}</p>
              <TeamLogo
                teamId={awayTeamId}
                name={awayTeam?.name as string}
                shortName={awayTeam?.shortName as string}
                logoUrl={awayTeam?.logo as string}
                size={32}
              />
            </div>
          </div>

          {/* Stats Grid */}
          <div className="glass-card rounded-2xl p-4 space-y-3">
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
                  <div className="flex items-center justify-between mb-1">
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
      ) : (
        <div className="glass-card rounded-2xl p-6 text-center">
          <div className="flex items-center justify-center gap-4 mb-3">
            <TeamLogo teamId={homeTeamId} name={homeTeam?.name as string} shortName={homeTeam?.shortName as string} logoUrl={homeTeam?.logo as string} size={40} />
            <span className="text-lg text-[#9ca3af]">VS</span>
            <TeamLogo teamId={awayTeamId} name={awayTeam?.name as string} shortName={awayTeam?.shortName as string} logoUrl={awayTeam?.logo as string} size={40} />
          </div>
          <p className="text-[#9ca3af] text-sm">No match stats available yet</p>
          <p className="text-[rgba(255,255,255,0.3)] text-xs mt-1">Stats will appear once the match begins</p>
        </div>
      )}

      {/* ====== TEAM DNA / PROFILE COMPARISON ====== */}
      {(homeProfile || awayProfile) && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider px-1">Team Profile</h3>
          <div className="glass-card rounded-2xl p-4 space-y-3">
            {/* Style badges */}
            <div className="flex items-center justify-between">
              <span className="text-xs px-2 py-1 rounded-full bg-[rgba(16,231,116,0.1)] text-[#10e774] font-medium">
                {homeProfile?.style ? String(homeProfile.style).replace('_', ' ') : 'N/A'}
              </span>
              <span className="text-[10px] text-[#9ca3af] uppercase">Style</span>
              <span className="text-xs px-2 py-1 rounded-full bg-[rgba(16,231,116,0.1)] text-[#10e774] font-medium">
                {awayProfile?.style ? String(awayProfile.style).replace('_', ' ') : 'N/A'}
              </span>
            </div>

            {/* Form string */}
            {(homeProfile?.form || awayProfile?.form) && (
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {String(homeProfile?.form || '').split('').slice(-5).map((ch, i) => (
                    <span key={i} className="w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded" style={{ background: formColors[ch]?.bg, color: formColors[ch]?.text }}>
                      {ch}
                    </span>
                  ))}
                </div>
                <span className="text-[10px] text-[#9ca3af] uppercase">Form</span>
                <div className="flex gap-1">
                  {String(awayProfile?.form || '').split('').slice(-5).map((ch, i) => (
                    <span key={i} className="w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded" style={{ background: formColors[ch]?.bg, color: formColors[ch]?.text }}>
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Avg Goals Scored */}
            <ProfileBar label="Avg Goals Scored" home={homeProfile?.avgGoalsScored as number} away={awayProfile?.avgGoalsScored as number} />
            {/* Avg Goals Conceded */}
            <ProfileBar label="Avg Goals Conceded" home={homeProfile?.avgGoalsConceded as number} away={awayProfile?.avgGoalsConceded as number} invert />
            {/* Possession */}
            <ProfileBar label="Avg Possession" home={homeProfile?.possession as number} away={awayProfile?.possession as number} suffix="%" />
            {/* Clean Sheet % */}
            <ProfileBar label="Clean Sheet %" home={homeProfile?.cleanSheetPct as number} away={awayProfile?.cleanSheetPct as number} suffix="%" />
            {/* BTTS % */}
            <ProfileBar label="BTTS %" home={homeProfile?.bttsPct as number} away={awayProfile?.bttsPct as number} suffix="%" />
            {/* Over 2.5 % */}
            <ProfileBar label="Over 2.5 %" home={homeProfile?.over25Pct as number} away={awayProfile?.over25Pct as number} suffix="%" />
          </div>
        </div>
      )}

      {/* ====== HEAD TO HEAD SECTION ====== */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider px-1">Head to Head</h3>
        {h2h && h2h.matches.length > 0 ? (
          <>
            {/* H2H Summary */}
            <div className="glass-card rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-center flex-1">
                  <TeamLogo teamId={homeTeamId} name={homeTeam?.name as string} shortName={homeTeam?.shortName as string} logoUrl={homeTeam?.logo as string} size={28} />
                  <p className="text-lg font-bold text-[#10e774] mt-1">{h2h.summary.homeWins}</p>
                  <p className="text-[10px] text-[#9ca3af]">Wins</p>
                </div>
                <div className="text-center px-4">
                  <p className="text-lg font-bold text-[#ffc107]">{h2h.summary.draws}</p>
                  <p className="text-[10px] text-[#9ca3af]">Draws</p>
                  <div className="mt-1 px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.04)]">
                    <span className="text-[9px] text-[rgba(255,255,255,0.3)]">{h2h.summary.totalMatches} matches</span>
                  </div>
                </div>
                <div className="text-center flex-1">
                  <TeamLogo teamId={awayTeamId} name={awayTeam?.name as string} shortName={awayTeam?.shortName as string} logoUrl={awayTeam?.logo as string} size={28} />
                  <p className="text-lg font-bold text-[#ef4444] mt-1">{h2h.summary.awayWins}</p>
                  <p className="text-[10px] text-[#9ca3af]">Wins</p>
                </div>
              </div>
              {/* Win ratio bar */}
              <div className="flex h-2 rounded-full overflow-hidden bg-[rgba(255,255,255,0.06)]">
                {h2h.summary.totalMatches > 0 && (
                  <>
                    <motion.div
                      className="h-full bg-[#10e774]"
                      initial={{ width: 0 }}
                      animate={{ width: `${(h2h.summary.homeWins / h2h.summary.totalMatches) * 100}%` }}
                      transition={{ duration: 0.8 }}
                    />
                    <motion.div
                      className="h-full bg-[#ffc107]"
                      initial={{ width: 0 }}
                      animate={{ width: `${(h2h.summary.draws / h2h.summary.totalMatches) * 100}%` }}
                      transition={{ duration: 0.8 }}
                    />
                    <motion.div
                      className="h-full bg-[#ef4444]"
                      initial={{ width: 0 }}
                      animate={{ width: `${(h2h.summary.awayWins / h2h.summary.totalMatches) * 100}%` }}
                      transition={{ duration: 0.8 }}
                    />
                  </>
                )}
              </div>
              {/* Goals summary */}
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-[#9ca3af]">{h2h.summary.homeGoals} goals</span>
                <span className="text-[10px] text-[rgba(255,255,255,0.3)]">Total Goals</span>
                <span className="text-xs text-[#9ca3af]">{h2h.summary.awayGoals} goals</span>
              </div>
            </div>

            {/* H2H Match List */}
            <div className="space-y-2">
              {h2h.matches.slice(0, 5).map((match, i) => {
                const isHomeTeamHome = match.homeTeamId === homeTeamId;
                const homeWon = (match.homeScore as number) > (match.awayScore as number);
                const awayWon = (match.awayScore as number) > (match.homeScore as number);
                const draw = (match.homeScore as number) === (match.awayScore as number);

                return (
                  <motion.div
                    key={match.id as number}
                    className="glass-card rounded-xl px-3 py-2.5 flex items-center justify-between"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-[10px] text-[rgba(255,255,255,0.3)] w-8">{formatDate(match.date as string)}</span>
                      <span className={`text-xs font-medium truncate ${(isHomeTeamHome && homeWon) || (!isHomeTeamHome && awayWon) ? 'text-white' : 'text-[#9ca3af]'}`}>
                        {isHomeTeamHome ? (homeTeam?.name as string || 'Home') : (awayTeam?.name as string || 'Away')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3">
                      <span className={`text-sm font-bold ${(isHomeTeamHome && homeWon) || (!isHomeTeamHome && awayWon) ? 'text-[#10e774]' : 'text-white'}`}>
                        {String(match.homeScore)}
                      </span>
                      <span className="text-xs text-[rgba(255,255,255,0.2)]">-</span>
                      <span className={`text-sm font-bold ${(isHomeTeamHome && awayWon) || (!isHomeTeamHome && homeWon) ? 'text-[#10e774]' : 'text-white'}`}>
                        {String(match.awayScore)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                      <span className={`text-xs font-medium truncate ${(!isHomeTeamHome && homeWon) || (isHomeTeamHome && awayWon) ? 'text-white' : 'text-[#9ca3af]'}`}>
                        {isHomeTeamHome ? (awayTeam?.name as string || 'Away') : (homeTeam?.name as string || 'Home')}
                      </span>
                      {draw && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(255,193,7,0.1)] text-[#ffc107]">D</span>}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="glass-card rounded-2xl p-6 text-center">
            <p className="text-[#9ca3af] text-sm">No head-to-head data available</p>
            <p className="text-[rgba(255,255,255,0.3)] text-xs mt-1">H2H history will appear when past meetings are synced</p>
          </div>
        )}
      </div>

      {/* ====== LAST 5 MATCHES - HOME TEAM ====== */}
      <Last5Section
        team={homeTeam}
        matches={homeLast5}
        label="Last 5 Matches"
      />

      {/* ====== LAST 5 MATCHES - AWAY TEAM ====== */}
      <Last5Section
        team={awayTeam}
        matches={awayLast5}
        label="Last 5 Matches"
      />
    </div>
  );
}

// ====== PROFILE BAR COMPONENT ======
function ProfileBar({ label, home, away, suffix = '', invert = false }: { label: string; home?: number; away?: number; suffix?: string; invert?: boolean }) {
  if (home == null && away == null) return null;
  const h = home ?? 0;
  const a = away ?? 0;
  const total = h + a || 1;
  const homePct = (h / total) * 100;
  const awayPct = (a / total) * 100;
  // For "conceded" type stats, lower is better
  const homeLeading = invert ? h < a : h > a;
  const awayLeading = invert ? a < h : a > h;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-bold ${homeLeading ? 'text-[#10e774]' : 'text-white'}`}>
          {h.toFixed(1)}{suffix}
        </span>
        <span className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{label}</span>
        <span className={`text-xs font-bold ${awayLeading ? 'text-[#10e774]' : 'text-white'}`}>
          {a.toFixed(1)}{suffix}
        </span>
      </div>
      <div className="flex gap-1 h-1">
        <div className="flex-1 rounded-full overflow-hidden bg-[rgba(255,255,255,0.06)] flex justify-end">
          <div className="h-full rounded-full" style={{ width: `${homePct}%`, background: homeLeading ? '#10e774' : 'rgba(255,255,255,0.2)' }} />
        </div>
        <div className="flex-1 rounded-full overflow-hidden bg-[rgba(255,255,255,0.06)]">
          <div className="h-full rounded-full" style={{ width: `${awayPct}%`, background: awayLeading ? '#10e774' : 'rgba(255,255,255,0.2)' }} />
        </div>
      </div>
    </div>
  );
}

// ====== LAST 5 MATCHES SECTION ======
function Last5Section({ team, matches, label }: { team?: Record<string, unknown>; matches?: Array<Record<string, unknown>>; label: string }) {
  if (!matches || matches.length === 0) return null;

  const teamId = team?.id as number | undefined;
  const teamName = (team?.name as string) || 'Team';

  // Count form results
  let wins = 0, draws = 0, losses = 0;
  for (const m of matches) {
    const r = m.result as string;
    if (r === 'W') wins++;
    else if (r === 'D') draws++;
    else losses++;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <TeamLogo
            teamId={teamId}
            name={team?.name as string}
            shortName={team?.shortName as string}
            logoUrl={team?.logo as string}
            size={20}
          />
          <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider">{label}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {matches.map((m, i) => {
            const r = m.result as string;
            const colors = formColors[r] || formColors['D'];
            return (
              <span key={i} className="w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded" style={{ background: colors.bg, color: colors.text }}>
                {r}
              </span>
            );
          })}
          <span className="text-[10px] text-[rgba(255,255,255,0.3)] ml-1">{wins}W {draws}D {losses}L</span>
        </div>
      </div>

      <div className="space-y-2">
        {matches.map((match, i) => {
          const isHome = match.homeTeamId === teamId;
          const homeScore = match.homeScore as number;
          const awayScore = match.awayScore as number;
          const teamScore = isHome ? homeScore : awayScore;
          const oppScore = isHome ? awayScore : homeScore;

          return (
            <motion.div
              key={match.id as number}
              className="glass-card rounded-xl px-3 py-2.5"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded flex-shrink-0`}
                    style={{ background: formColors[match.result as string]?.bg, color: formColors[match.result as string]?.text }}>
                    {match.result as string}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-medium text-white truncate">
                        {isHome ? teamName : (match.awayTeamName as string)}
                      </span>
                      <span className="text-xs text-[rgba(255,255,255,0.4)]">{teamScore}-{oppScore}</span>
                      <span className="text-xs text-[rgba(255,255,255,0.4)]">{isHome ? (match.awayTeamName as string) : teamName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-[rgba(255,255,255,0.25)]">{formatDate(match.date as string)}</span>
                      {match.leagueName && (
                        <span className="text-[10px] text-[rgba(255,255,255,0.2)]">{match.leagueName as string}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  <span className={`text-sm font-bold ${teamScore > oppScore ? 'text-[#10e774]' : teamScore < oppScore ? 'text-[#ef4444]' : 'text-[#ffc107]'}`}>
                    {homeScore} - {awayScore}
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
