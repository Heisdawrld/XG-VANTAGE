// BSD API v2 Client — Football data provider
// Base: https://sports.bzzoiro.com/api/v2/
// Auth: Authorization: Token {key}

const BSD_BASE = 'https://sports.bzzoiro.com/api/v2/';

interface CacheEntry<T> {
  data: T;
  expires: number;
}

interface RequestOptions {
  cache?: boolean;
  ttl?: number;
}

// In-memory cache
const cache = new Map<string, CacheEntry<unknown>>();
// In-flight request deduplication
const inFlight = new Map<string, Promise<unknown>>();
// Rate limiting
let requestTimestamps: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 30;

function getApiKey(): string {
  const key = process.env.BSD_API_KEY;
  if (!key) throw new Error('BSD_API_KEY environment variable is not set');
  return key;
}

async function rateLimitCheck(): Promise<void> {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < 60000);
  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    const waitMs = 60000 - (now - requestTimestamps[0]);
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  requestTimestamps.push(now);
}

async function bsdFetch<T>(path: string, opts?: RequestOptions): Promise<T> {
  const url = `${BSD_BASE}${path}`;
  const cacheKey = url;
  const ttl = opts?.ttl ?? 300; // default 5 min

  // Check cache
  if (opts?.cache !== false) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data as T;
    }
  }

  // Dedup in-flight requests
  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey) as Promise<T>;
  }

  const promise = (async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rateLimitCheck();
        const res = await fetch(url, {
          headers: { Authorization: `Token ${getApiKey()}` },
        });
        if (!res.ok) {
          if (res.status === 429) {
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
            continue;
          }
          throw new Error(`BSD API ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        // Cache result
        if (opts?.cache !== false) {
          cache.set(cacheKey, { data, expires: Date.now() + ttl * 1000 });
        }
        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastError;
  })();

  inFlight.set(cacheKey, promise);
  try {
    const result = await promise;
    return result as T;
  } finally {
    inFlight.delete(cacheKey);
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface BSDLeague {
  id: number;
  name: string;
  country: string;
  is_women: boolean;
  is_active: boolean;
  current_season?: {
    id: number;
    name: string;
    year: number;
    start_date?: string;
    end_date?: string;
    is_current: boolean;
  };
}

export interface BSDEvent {
  id: number;
  league_id: number;
  season_id?: number;
  home_team_id: number;
  home_team: string;
  away_team_id: number;
  away_team: string;
  home_coach_id?: number;
  away_coach_id?: number;
  referee_id?: number;
  venue_id?: number;
  event_date: string;
  status: 'notstarted' | 'inprogress' | 'finished' | 'postponed' | 'cancelled';
  round_number?: number;
  round_name?: string;
  group_name?: string;
  period?: string;
  current_minute?: number;
  home_score?: number;
  away_score?: number;
  home_score_ht?: number;
  away_score_ht?: number;
  penalty_shootout?: string;
  extra_time_score?: string;
  is_local_derby: boolean;
  is_neutral_ground: boolean;
  travel_distance_km?: number;
  weather?: {
    code?: number;
    description?: string;
    wind_speed?: number;
    temperature_c?: number;
  };
  pitch_condition?: number;
  attendance?: number;
  live_websocket: boolean;
  last_updated?: string;
}

export interface BSDLiveEvent {
  id: number;
  league_id: number;
  league_name: string;
  home_team_id: number;
  home_team: string;
  away_team_id: number;
  away_team: string;
  event_date: string;
  status: string;
  period?: string;
  current_minute?: number;
  home_score: number;
  away_score: number;
  home_score_ht?: number;
  away_score_ht?: number;
  live_websocket: boolean;
  last_updated: string;
}

export interface BSDStanding {
  position: number;
  team_id: number;
  team_name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  xgf?: number;
  xga?: number;
  xgd?: number;
  xg_games?: number;
  form: string;
  live: boolean;
}

export interface BSDStats {
  event_id: number;
  stats: {
    home: Record<string, unknown>;
    away: Record<string, unknown>;
  };
  shotmap?: Array<Record<string, unknown>>;
  momentum?: Array<{ m: number; v: number }>;
  average_positions?: Record<string, unknown>;
  xg_per_minute?: Array<Record<string, unknown>>;
}

export interface BSDOdds {
  event_id: number;
  odds: {
    home_win?: number;
    draw?: number;
    away_win?: number;
    over_15_goals?: number;
    over_25_goals?: number;
    over_35_goals?: number;
    under_15_goals?: number;
    under_25_goals?: number;
    under_35_goals?: number;
    btts_yes?: number;
    btts_no?: number;
  };
}

export interface BSDLineup {
  event_id: number;
  lineup_status: 'confirmed' | 'predicted' | 'unavailable';
  beta: boolean;
  lineups?: {
    home?: {
      team_id: number;
      team_name: string;
      formation: string;
      confidence?: number;
      players: Array<{ id: number; name: string; short_name: string; position: string; jersey_number: number; ai_score?: number }>;
      substitutes?: Array<{ id: number; name: string; short_name: string; position: string; jersey_number: number; ai_score?: number }>;
    };
    away?: {
      team_id: number;
      team_name: string;
      formation: string;
      confidence?: number;
      players: Array<{ id: number; name: string; short_name: string; position: string; jersey_number: number; ai_score?: number }>;
      substitutes?: Array<{ id: number; name: string; short_name: string; position: string; jersey_number: number; ai_score?: number }>;
    };
  };
  unavailable_players?: {
    home?: Array<{ id: number; name: string; status: string; reason?: string }>;
    away?: Array<{ id: number; name: string; status: string; reason?: string }>;
  };
  updated_at?: string;
}

export interface BSDManager {
  id: number;
  name: string;
  short_name: string;
  country: string;
  tactical_profile: string;
  preferred_formation: string;
  current_team_id?: number;
  matches_total: number;
  wins: number;
  draws: number;
  losses: number;
  win_pct: number;
  avg_goals_scored: number;
  avg_goals_conceded: number;
  avg_possession: number;
  clean_sheet_pct: number;
  btts_pct: number;
  over_25_pct: number;
  team_style?: string;
}

export interface BSDIncident {
  event_id: number;
  incidents: Array<{
    type: string;
    minute: number;
    added_time?: number;
    player?: string;
    player_id?: number;
    player_in?: string;
    player_in_id?: number;
    player_out?: string;
    player_out_id?: number;
    is_home?: boolean;
    card_type?: string;
    goal_type?: string;
    decision?: string;
    confirmed?: boolean;
    home_score?: number;
    away_score?: number;
    sequence?: Array<Record<string, unknown>>;
  }>;
}

export interface BSDMetadata {
  event_id: number;
  funfacts?: Array<{ type_id: number; sentence: string }>;
  ai_preview?: { text: string; generated_at: string };
}

export interface BSDPlayerStat {
  event_id: number;
  count: number;
  player_stats: Array<{
    id: number;
    player_id: number;
    event_id: number;
    team_id: number;
    minutes_played: number;
    rating?: number;
    goals: number;
    goal_assist: number;
    expected_goals: number;
    expected_assists: number;
    total_shots: number;
    shots_on_target: number;
    total_pass: number;
    accurate_pass: number;
    key_pass: number;
    total_tackle: number;
    interception: number;
    yellow_card: number;
    red_card: number;
    saves?: number;
  }>;
}

export interface BSDTeamSquad {
  team_id: number;
  count: number;
  players: Array<{
    id: number;
    name: string;
    short_name: string;
    position: string;
    jersey_number: number;
    nationality: string;
    date_of_birth?: string;
  }>;
}

// ============================================================================
// API METHODS
// ============================================================================

export const bsdClient = {
  // Events
  getEvents(params?: {
    league_id?: number; status?: string; date_from?: string; date_to?: string; limit?: number; offset?: number;
  }): Promise<{ count: number; next?: string; previous?: string | null; results: BSDEvent[] }> {
    const qs = new URLSearchParams();
    if (params?.league_id) qs.set('league_id', String(params.league_id));
    if (params?.status) qs.set('status', params.status);
    if (params?.date_from) qs.set('date_from', params.date_from);
    if (params?.date_to) qs.set('date_to', params.date_to);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    return bsdFetch(`events/?${qs.toString()}`, { ttl: 60 });
  },

  getLiveEvents(params?: { league_id?: number; season_id?: number; team_id?: number }): Promise<{ count: number; events: BSDLiveEvent[] }> {
    const qs = new URLSearchParams();
    if (params?.league_id) qs.set('league_id', String(params.league_id));
    if (params?.season_id) qs.set('season_id', String(params.season_id));
    if (params?.team_id) qs.set('team_id', String(params.team_id));
    return bsdFetch(`events/live/?${qs.toString()}`, { ttl: 30 });
  },

  getEvent(id: number): Promise<BSDEvent> {
    return bsdFetch(`events/${id}/`, { ttl: 120 });
  },

  getEventStats(id: number): Promise<BSDStats> {
    return bsdFetch(`events/${id}/stats/`, { ttl: 300 });
  },

  getEventIncidents(id: number): Promise<BSDIncident> {
    return bsdFetch(`events/${id}/incidents/`, { ttl: 300 });
  },

  getEventOdds(id: number): Promise<BSDOdds> {
    return bsdFetch(`events/${id}/odds/`, { ttl: 180 });
  },

  getEventLineups(id: number): Promise<BSDLineup> {
    return bsdFetch(`events/${id}/lineups/`, { ttl: 120 });
  },

  getEventMetadata(id: number): Promise<BSDMetadata> {
    return bsdFetch(`events/${id}/metadata/`, { ttl: 300 });
  },

  getEventPlayerStats(id: number): Promise<BSDPlayerStat> {
    return bsdFetch(`events/${id}/player-stats/`, { ttl: 300 });
  },

  // Leagues
  getLeagues(params?: { country?: string; is_women?: boolean; is_active?: boolean; limit?: number; offset?: number }): Promise<{ count: number; next?: string; previous?: string | null; results: BSDLeague[] }> {
    const qs = new URLSearchParams();
    if (params?.country) qs.set('country', params.country);
    if (params?.is_women !== undefined) qs.set('is_women', String(params.is_women));
    if (params?.is_active !== undefined) qs.set('is_active', String(params.is_active));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    return bsdFetch(`leagues/?${qs.toString()}`, { ttl: 3600 });
  },

  getLeague(id: number): Promise<BSDLeague> {
    return bsdFetch(`leagues/${id}/`, { ttl: 3600 });
  },

  getLeagueStandings(id: number): Promise<{ league_id: number; season: { id: number; name: string }; standings: BSDStanding[] }> {
    return bsdFetch(`leagues/${id}/standings/`, { ttl: 600 });
  },

  // Teams
  getTeams(params?: { country_code?: string; league_id?: number; season_id?: number; name?: string; limit?: number; offset?: number }): Promise<{ count: number; results: Array<{ id: number; name: string; short_name: string; country: string; venue_id?: number }> }> {
    const qs = new URLSearchParams();
    if (params?.country_code) qs.set('country_code', params.country_code);
    if (params?.league_id) qs.set('league_id', String(params.league_id));
    if (params?.season_id) qs.set('season_id', String(params.season_id));
    if (params?.name) qs.set('name', params.name);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    return bsdFetch(`teams/?${qs.toString()}`, { ttl: 3600 });
  },

  getTeam(id: number): Promise<{ id: number; name: string; short_name: string; country: string; venue_id?: number }> {
    return bsdFetch(`teams/${id}/`, { ttl: 3600 });
  },

  getTeamSquad(id: number): Promise<BSDTeamSquad> {
    return bsdFetch(`teams/${id}/squad/`, { ttl: 1800 });
  },

  getTeamFixtures(id: number, params?: { date_from?: string; date_to?: string; league_id?: number; status?: string; limit?: number; offset?: number }): Promise<{ count: number; next?: string; previous?: string | null; results: BSDEvent[] }> {
    const qs = new URLSearchParams();
    if (params?.date_from) qs.set('date_from', params.date_from);
    if (params?.date_to) qs.set('date_to', params.date_to);
    if (params?.league_id) qs.set('league_id', String(params.league_id));
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    return bsdFetch(`teams/${id}/fixtures/?${qs.toString()}`, { ttl: 60, cache: false });
  },

  // Managers
  getManagers(params?: { team_id?: number; league_id?: number; tactical_profile?: string; team_style?: string; name?: string; limit?: number; offset?: number }): Promise<{ count: number; results: BSDManager[] }> {
    const qs = new URLSearchParams();
    if (params?.team_id) qs.set('team_id', String(params.team_id));
    if (params?.league_id) qs.set('league_id', String(params.league_id));
    if (params?.tactical_profile) qs.set('tactical_profile', params.tactical_profile);
    if (params?.team_style) qs.set('team_style', params.team_style);
    if (params?.name) qs.set('name', params.name);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    return bsdFetch(`managers/?${qs.toString()}`, { ttl: 3600 });
  },

  // Referees
  getReferees(params?: { league_id?: number; name?: string; limit?: number; offset?: number }): Promise<{ count: number; results: Array<Record<string, unknown>> }> {
    const qs = new URLSearchParams();
    if (params?.league_id) qs.set('league_id', String(params.league_id));
    if (params?.name) qs.set('name', params.name);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    return bsdFetch(`referees/?${qs.toString()}`, { ttl: 3600 });
  },

  // Utility: clear cache
  clearCache() {
    cache.clear();
  },
};
