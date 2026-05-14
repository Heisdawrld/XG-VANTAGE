'use client';

const API_BASE = '';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('xg_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as Record<string, string>).error || `API Error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// Types
export interface FixtureData {
  id: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: { id: number; name: string; shortName?: string; logo?: string | null };
  awayTeam: { id: number; name: string; shortName?: string; logo?: string | null };
  leagueName?: string;
  eventDate: string;
  status: string;
  currentMinute?: number;
  period?: string;
  homeScore: number | null;
  awayScore: number | null;
  homeScoreHt?: number | null;
  awayScoreHt?: number | null;
  isLocalDerby: boolean;
  prediction?: {
    pickType?: string;
    pickLabel?: string;
    predictedResult: string;
    probHomeWin: number;
    probDraw: number;
    probAwayWin: number;
    confidence: number;
    tier?: string;
    verdict?: string;
  } | null;
  odds?: {
    homeWin: number | null;
    draw: number | null;
    awayWin: number | null;
  } | null;
  lineup?: {
    homeFormation: string;
    awayFormation: string;
  } | null;
}

export interface PickData {
  rank: number;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamShortName?: string | null;
  awayTeamShortName?: string | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  eventDate: string;
  leagueId?: number;
  pickType?: string;
  pickLabel?: string;
  confidence: number;
  tier?: string;
  verdict?: string;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  over25Prob?: number;
  bttsYesProb?: number;
  homeXg?: number;
  awayXg?: number;
  edge?: number;
  recommendedBet?: string;
  valueDetected?: boolean;
  valueEdge?: number;
  odds?: {
    homeWin: number | null;
    draw: number | null;
    awayWin: number | null;
    over25?: number | null;
    bttsYes?: number | null;
  } | null;
}

export interface MatchDetailData {
  source: string;
  fixture: Record<string, unknown>;
}

export interface TrackRecordData {
  overall: {
    total: number;
    won: number;
    lost: number;
    void: number;
    winRate: number;
  };
  byPickType: Array<{
    pickType: string;
    total: number;
    won: number;
    lost: number;
    void: number;
    winRate: number;
  }>;
  monthly: Array<{
    month: string;
    total: number;
    won: number;
    lost: number;
    winRate: number;
  }>;
}

export interface UserData {
  id: string;
  email: string;
  username: string;
  plan: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  referralCode?: string | null;
  planExpiresAt?: string | null;
  isExpired?: boolean;
}

// API Methods
export const api = {
  // Auth
  login: (email: string, password: string) =>
    apiFetch<{ token: string; user: UserData }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, username: string, password: string) =>
    apiFetch<{ id: string; email: string; username: string; plan: string; referralCode: string; message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    }),

  getMe: () =>
    apiFetch<UserData>('/api/auth/me'),

  // Fixtures
  getFixtures: (date?: string) => {
    const params = date ? `?date=${date}` : '';
    return apiFetch<{ count: number; fixtures: FixtureData[]; grouped: Record<number, { leagueId: number; leagueName: string; fixtures: FixtureData[] }>; leagueMap: Record<number, string> }>(`/api/fixtures${params}`);
  },

  // Picks
  getPicks: (limit = 10) =>
    apiFetch<{ date: string; count: number; picks: PickData[] }>(`/api/picks?limit=${limit}`),

  // Match Detail
  getMatch: (fixtureId: number) =>
    apiFetch<MatchDetailData>(`/api/match?fixtureId=${fixtureId}`),

  // Live
  getLive: () =>
    apiFetch<{ count: number; events: FixtureData[] }>('/api/live'),

  // Standings
  getStandings: (leagueId: number) =>
    apiFetch<{ standings: Array<Record<string, unknown>> }>(`/api/standings?leagueId=${leagueId}`),

  // Leagues
  getLeagues: () =>
    apiFetch<{ count: number; leagues: Array<Record<string, unknown>> }>('/api/leagues'),

  // ACCA
  getAccas: () =>
    apiFetch<{ count: number; accas: Array<Record<string, unknown>> }>('/api/acca'),

  createAcca: (pickIds: number[], totalOdds?: number) =>
    apiFetch<{ success: boolean; acca: Record<string, unknown> }>('/api/acca', {
      method: 'POST',
      body: JSON.stringify({ pickIds, totalOdds }),
    }),

  // Track Record
  getTrackRecord: () =>
    apiFetch<TrackRecordData>('/api/track-record'),

  // Sync
  sync: (dateFrom?: string, dateTo?: string) =>
    apiFetch<unknown>('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ action: 'fixtures', dateFrom, dateTo }),
    }),
};
