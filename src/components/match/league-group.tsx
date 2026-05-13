'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MatchCard } from './match-card';
import type { FixtureData } from '@/lib/api-client';

interface LeagueGroupProps {
  leagueId: number;
  leagueName: string;
  fixtures: FixtureData[];
  defaultExpanded?: boolean;
}

export function LeagueGroup({ leagueId, leagueName, fixtures, defaultExpanded = false }: LeagueGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Get country flag emoji from league name patterns
  const getFlag = (name: string) => {
    if (name.includes('Premier League')) return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    if (name.includes('La Liga')) return '🇪🇸';
    if (name.includes('Serie A')) return '🇮🇹';
    if (name.includes('Bundesliga')) return '🇩🇪';
    if (name.includes('Ligue 1')) return '🇫🇷';
    if (name.includes('Champions League')) return '🏆';
    if (name.includes('Europa')) return '🏆';
    if (name.includes('Copa')) return '🌎';
    if (name.includes('MLS')) return '🇺🇸';
    if (name.includes('Eredivisie')) return '🇳🇱';
    if (name.includes('Primeira')) return '🇵🇹';
    if (name.includes('Super Lig')) return '🇹🇷';
    return '⚽';
  };

  return (
    <div className="mb-2">
      {/* League Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[rgba(255,255,255,0.02)] transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">{getFlag(leagueName)}</span>
          <span className="text-sm font-semibold text-white">{leagueName}</span>
          <span className="text-xs text-[#9ca3af] bg-[rgba(255,255,255,0.04)] px-1.5 py-0.5 rounded-full">
            {fixtures.length}
          </span>
        </div>
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-4 h-4 text-[#9ca3af]" />
        </motion.div>
      </button>

      {/* Matches */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-2 space-y-2 pb-2">
              {fixtures.map((fixture) => (
                <MatchCard
                  key={fixture.id}
                  id={fixture.id}
                  homeTeam={fixture.homeTeam}
                  awayTeam={fixture.awayTeam}
                  status={fixture.status}
                  homeScore={fixture.homeScore}
                  awayScore={fixture.awayScore}
                  currentMinute={fixture.currentMinute}
                  period={fixture.period}
                  eventDate={fixture.eventDate}
                  prediction={fixture.prediction}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
