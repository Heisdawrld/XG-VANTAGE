'use client';

interface LeagueTabProps {
  standings?: Array<Record<string, unknown>>;
  fixture: Record<string, unknown>;
  leagueName?: string;
}

export function LeagueTab({ standings, fixture, leagueName }: LeagueTabProps) {
  const homeTeam = fixture.homeTeam as Record<string, unknown> | undefined;
  const awayTeam = fixture.awayTeam as Record<string, unknown> | undefined;
  const homeTeamId = fixture.homeTeamId as number;
  const awayTeamId = fixture.awayTeamId as number;

  if (!standings || standings.length === 0) {
    return (
      <div className="p-4">
        <div className="glass-card rounded-2xl p-8 text-center">
          <p className="text-[#9ca3af] text-sm">No standings data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {leagueName && (
        <h3 className="text-sm font-bold text-white font-[family-name:var(--font-space-grotesk)]">
          {leagueName}
        </h3>
      )}

      <div className="glass-card rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[2rem_1fr_2.5rem_2.5rem_2.5rem_2.5rem_2.5rem_2.5rem] gap-1 px-3 py-2 text-[9px] font-bold text-[#9ca3af] uppercase tracking-wider border-b border-[rgba(255,255,255,0.04)]">
          <span>#</span>
          <span>Team</span>
          <span className="text-center">P</span>
          <span className="text-center">W</span>
          <span className="text-center">D</span>
          <span className="text-center">L</span>
          <span className="text-center">GD</span>
          <span className="text-center">Pts</span>
        </div>

        {/* Rows */}
        <div className="max-h-96 overflow-y-auto">
          {standings.map((row, i) => {
            const teamId = row.teamId as number || row.team_id as number;
            const isHome = teamId === homeTeamId;
            const isAway = teamId === awayTeamId;
            const isHighlighted = isHome || isAway;

            return (
              <div
                key={i}
                className={`grid grid-cols-[2rem_1fr_2.5rem_2.5rem_2.5rem_2.5rem_2.5rem_2.5rem] gap-1 px-3 py-2 text-xs transition-colors ${
                  isHighlighted
                    ? 'bg-[rgba(16,231,116,0.06)] border-l-2 border-[#10e774]'
                    : i % 2 === 0
                      ? 'bg-[rgba(255,255,255,0.01)]'
                      : ''
                }`}
              >
                <span className={`font-bold ${isHighlighted ? 'text-[#10e774]' : 'text-[#9ca3af]'}`}>
                  {row.position as number || i + 1}
                </span>
                <span className={`font-medium truncate ${isHighlighted ? 'text-[#10e774]' : 'text-white'}`}>
                  {(row.team as Record<string, string>)?.name || (row.teamName as string) || (row.team_name as string) || `Team ${teamId}`}
                </span>
                <span className="text-center text-[#9ca3af]">{row.played as number || 0}</span>
                <span className="text-center text-[#9ca3af]">{row.won as number || 0}</span>
                <span className="text-center text-[#9ca3af]">{row.drawn as number || 0}</span>
                <span className="text-center text-[#9ca3af]">{row.lost as number || 0}</span>
                <span className="text-center text-[#9ca3af]">{row.gd as number || 0}</span>
                <span className="text-center font-bold text-white">{row.pts as number || 0}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
