import { create } from 'zustand';

interface UIState {
  activeSport: 'football' | 'basketball';
  activeDate: string;
  expandedLeagues: Set<number>;
  pickFilter: 'ALL' | 'SAFE' | 'VALUE' | 'ELITE';
  searchQuery: string;
  setActiveSport: (sport: 'football' | 'basketball') => void;
  setActiveDate: (date: string) => void;
  toggleLeague: (leagueId: number) => void;
  setPickFilter: (filter: 'ALL' | 'SAFE' | 'VALUE' | 'ELITE') => void;
  setSearchQuery: (query: string) => void;
}

const today = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

export const useUIStore = create<UIState>((set) => ({
  activeSport: 'football',
  activeDate: today,
  expandedLeagues: new Set<number>(),
  pickFilter: 'ALL',
  searchQuery: '',

  setActiveSport: (sport) => set({ activeSport: sport }),
  setActiveDate: (date) => set({ activeDate: date }),
  toggleLeague: (leagueId) =>
    set((state) => {
      const next = new Set(state.expandedLeagues);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return { expandedLeagues: next };
    }),
  setPickFilter: (filter) => set({ pickFilter: filter }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
