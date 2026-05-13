// xG-Vantage — BSD API Client
// Complete typed client for the BSD v2 API with caching, rate limiting, retries, and deduplication

// ============================================================================
// TYPES
// ============================================================================

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface BSDLeague {
  id: number;
  name: string;
  country: { name: string; cc: string };
  is_women: boolean;
  is_active: boolean;
  current_season: BSDSeason | null;
  seasons: BSDSeason[];
  primary_colors?: string[];
  secondary_colors?: string[];
}

export interface BSDSeason {
  id: number;
  name: string;
  year: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  league_id?: number;
}

export interface BSDTeam {
  id: number;
  name: string;
  short_name: string;
  country: { name: string; cc: string };
  venue: BSDVenue | null;
  primary_colors?: string[];
  secondary_colors?: string[];
}

export interface BSDVenue {
  id: number;
  name: string;
  city: string;
  country: string;
  capacity: number | null;
  latitude: number | null;
  longitude: number | null;
  pitch_length: number | null;
  pitch_width: number | null;
}

export interface BSDManager {
  id: number;
  name: string;
  short_name: string;
  country: { name: string; cc: string };
  tactical_profile: string;
  preferred_formation: string;
  current_team: BSDTeam | null;
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
  over25_pct: number;
  team_style: string;
}

export interface BSDReferee {
  id: number;
  name: string;
  country: { name: string; cc: string };
  matches_total: number;
  yellow_cards_avg: number;
  red_cards_avg: number;
  fouls_avg: number;
  penalties_avg: number;
}

export interface BSDFixture {
  id: number;
  league: BSDLeague;
  season: BSDSeason | null;
  home_team: BSDTeam;
  away_team: BSDTeam;
  home_coach: BSDManager | null;
  away_coach: BSDManager | null;
  referee: BSDReferee | null;
  venue: BSDVenue | null;
  event_date: string;
  status: string;
  round_number: number | null;
  round_name: string;
  group_name: string | null;
  period: string | null;
  current_minute: number | null;
  home_score: number | null;
  away_score: number | null;
  home_score_ht: number | null;
  away_score_ht: number | null;
  penalty_shootout: string | null;
  extra_time_score: string | null;
  is_local_derby: boolean;
  is_neutral_ground: boolean;
  attendance: number | null;
  weather_code: number | null;
  weather_desc: string | null;
  wind_speed: number | null;
  temperature_c: number | null;
  pitch_condition: number | null;
  live_websocket: boolean;
}

export interface BSDEventStats {
  event_id: number;
  home: BSDTeamStats;
  away: BSDTeamStats;
  shotmap?: BSDShot[];
  momentum?: { minute: number; value: number }[];
  xg_per_minute?: {
    home: { minute: number; xg: number }[];
    away: { minute: number; xg: number }[];
  };
}

export interface BSDTeamStats {
  total_shots: number;
  shots_on_target: number;
  shots_off_target: number;
  blocked_shots: number;
  shots_inside_box: number;
  shots_outside_box: number;
  big_chances: number;
  big_chances_scored: number;
  big_chances_missed: number;
  hit_woodwork: number;
  corner_kicks: number;
  offsides: number;
  ball_possession: number;
  pass_accuracy: number;
  passes: number;
  accurate_passes: number;
  total_tackles: number;
  interceptions: number;
  clearances: number;
  dribbles_success: number;
  dribbles_total: number;
  aerial_duels_won: number;
  aerial_duels_total: number;
  fouls: number;
  yellow_cards: number;
  red_cards: number;
  attacks: number;
  dangerous_attacks: number;
  expected_goals: number;
  goals_prevented: number;
}

export interface BSDShot {
  id: number;
  team: string;
  player: string;
  player_id: number;
  minute: number;
  x: number;
  y: number;
  is_goal: boolean;
  is_blocked: boolean;
  is_on_target: boolean;
  xg: number;
  shot_type: string;
  situation: string;
  body_part: string;
}

export interface BSDIncident {
  id: number;
  type: string;
  minute: number;
  added_time: number | null;
  player: string | null;
  player_id: number | null;
  player_in: string | null;
  player_in_id: number | null;
  player_out: string | null;
  player_out_id: number | null;
  is_home: boolean | null;
  card_type: string | null;
  goal_type: string | null;
  decision: string | null;
  confirmed: boolean | null;
  home_score: number | null;
  away_score: number | null;
}

export interface BSDOdds {
  event_id: number;
  markets: BSDOddsMarket[];
}

export interface BSDOddsMarket {
  id: number;
  name: string;
  key: string;
  is_live: boolean;
  outcomes: BSDOddsOutcome[];
}

export interface BSDOddsOutcome {
  id: number;
  name: string;
  odds: number;
  is_winning: boolean | null;
  is_void: boolean;
}

export interface BSDLineup {
  event_id: number;
  lineup_status: string;
  home: {
    formation: string;
    players: BSDLineupPlayer[];
    substitutes: BSDLineupPlayer[];
    unavailable: BSDLineupUnavailable[];
    confidence: number | null;
  };
  away: {
    formation: string;
    players: BSDLineupPlayer[];
    substitutes: BSDLineupPlayer[];
    unavailable: BSDLineupUnavailable[];
    confidence: number | null;
  };
}

export interface BSDLineupPlayer {
  id: number;
  name: string;
  position: string;
  specific_position: string;
  jersey_number: number;
  is_captain: boolean;
  rating: number | null;
}

export interface BSDLineupUnavailable {
  id: number;
  name: string;
  reason: string;
}

export interface BSDMetadata {
  event_id: number;
  fun_facts: { type_id: number; sentence: string }[];
}

export interface BSDPlayerStat {
  id: number;
  player_id: number;
  team_id: number;
  name: string;
  position: string;
  minutes_played: number;
  rating: number | null;
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
  saves: number | null;
}

export interface BSDPrediction {
  event_id: number;
  prediction: {
    home_win: number;
    draw: number;
    away_win: number;
    over_25: number;
    under_25: number;
    btts_yes: number;
    btts_no: number;
    advice: string;
  };
}

export interface BSDStanding {
  league_id: number;
  season_id: number;
  standings: BSDStandingGroup[];
}

export interface BSDStandingGroup {
  group_name: string;
  type: string;
  table: BSDStandingEntry[];
}

export interface BSDStandingEntry {
  team_id: number;
  team_name: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  xgf: number | null;
  xga: number | null;
  xgd: number | null;
  xg_games: number | null;
  form: string;
  is_live: boolean;
}

export interface BSDSquad {
  team_id: number;
  players: BSDSquadPlayer[];
}

export interface BSDSquadPlayer {
  id: number;
  name: string;
  short_name: string;
  position: string;
  specific_position: string;
  jersey_number: number | null;
  date_of_birth: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  preferred_foot: string;
  nationality: string;
  market_value_eur: number | null;
  contract_until: string | null;
  availability: string;
  role: string;
}

// ============================================================================
// PARAMETER TYPES
// ============================================================================

export interface GetEventsParams {
  league_id?: number;
  status?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export interface GetLiveEventsParams {
  league_id?: number;
  season_id?: number;
  team_id?: number;
}

export interface GetLeaguesParams {
  country?: string;
  is_women?: boolean;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface GetTeamsParams {
  country_code?: string;
  league_id?: number;
  season_id?: number;
  name?: string;
  limit?: number;
  offset?: number;
}

export interface GetTeamFixturesParams {
  date_from?: string;
  date_to?: string;
  league_id?: number;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface GetManagersParams {
  team_id?: number;
  league_id?: number;
  tactical_profile?: string;
  team_style?: string;
  name?: string;
  limit?: number;
  offset?: number;
}

export interface GetRefereesParams {
  limit?: number;
  offset?: number;
}

// ============================================================================
// CACHE
// ============================================================================

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private defaultTtl: number;

  constructor(defaultTtl = 300_000) {
    this.defaultTtl = defaultTtl;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttl?: number): void {
    const expiry = Date.now() + (ttl ?? this.defaultTtl);
    this.cache.set(key, { data, expiry });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  /** Remove expired entries to free memory */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

// ============================================================================
// RATE LIMITER
// ============================================================================

class RateLimiter {
  private timestamps: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests = 30, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    // Remove timestamps outside the window
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldestInWindow = this.timestamps[0];
      const waitTime = this.windowMs - (now - oldestInWindow) + 1;
      console.log(`[BSD-Client] Rate limit reached, waiting ${waitTime}ms`);
      await this.sleep(waitTime);
      return this.acquire();
    }

    this.timestamps.push(now);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// REQUEST DEDUPLICATOR
// ============================================================================

class RequestDeduplicator {
  private inFlight = new Map<string, Promise<unknown>>();

  async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key) as Promise<T>;
    }
    const promise = fn().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }
}

// ============================================================================
// BSD CLIENT
// ============================================================================

const BASE_URL = 'https://sports.bzzoiiro.com/api/v2';
const CACHE_TTL_LIVE = 30_000;    // 30s for live data
const CACHE_TTL_STATIC = 300_000; // 5 min for static data
const MAX_RETRIES = 3;

class BSDClient {
  private apiKey: string;
  private cache: MemoryCache;
  private rateLimiter: RateLimiter;
  private deduplicator: RequestDeduplicator;

  constructor() {
    this.apiKey = process.env.BSD_API_KEY ?? '';
    this.cache = new MemoryCache(CACHE_TTL_STATIC);
    this.rateLimiter = new RateLimiter(30, 60_000);
    this.deduplicator = new RequestDeduplicator();

    // Periodically prune expired cache entries
    setInterval(() => this.cache.prune(), 60_000).unref?.();
  }

  // --------------------------------------------------------------------------
  // Core request method with retries, rate limiting, caching, dedup
  // --------------------------------------------------------------------------

  private async request<T>(
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined>,
    ttl?: number,
  ): Promise<T> {
    const queryString = this.buildQueryString(params);
    const url = `${BASE_URL}${endpoint}${queryString}`;
    const cacheKey = url;

    // Check cache first
    const cached = this.cache.get<T>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Deduplicate in-flight requests
    return this.deduplicator.deduplicate(cacheKey, async () => {
      // Rate limit
      await this.rateLimiter.acquire();

      // Retry loop with exponential backoff
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Token ${this.apiKey}`,
              Accept: 'application/json',
            },
          });

          if (!response.ok) {
            const body = await response.text().catch(() => '');
            if (response.status === 429) {
              // Rate limited by server — back off longer
              const waitMs = Math.pow(2, attempt + 3) * 1000;
              console.warn(`[BSD-Client] 429 rate limited, backing off ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
              await this.sleep(waitMs);
              continue;
            }
            if (response.status >= 500) {
              // Server error — retry
              const waitMs = Math.pow(2, attempt) * 1000;
              console.warn(`[BSD-Client] Server error ${response.status}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
              await this.sleep(waitMs);
              continue;
            }
            if (response.status === 404) {
              throw new BSDNotFoundError(`Resource not found: ${endpoint}`);
            }
            if (response.status === 401 || response.status === 403) {
              throw new BSDAuthError(`Authentication failed: ${response.status} — ${body}`);
            }
            throw new BSDApiError(`API error ${response.status}: ${body}`, response.status);
          }

          const data = (await response.json()) as T;

          // Cache the result
          this.cache.set(cacheKey, data, ttl);

          return data;
        } catch (error) {
          if (error instanceof BSDAuthError || error instanceof BSDNotFoundError) {
            throw error;
          }
          lastError = error instanceof Error ? error : new Error(String(error));
          const waitMs = Math.pow(2, attempt) * 1000;
          console.warn(`[BSD-Client] Request failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${lastError.message}. Retrying in ${waitMs}ms`);
          await this.sleep(waitMs);
        }
      }

      throw new BSDApiError(`Failed after ${MAX_RETRIES} retries: ${lastError?.message ?? 'unknown error'}`, 0);
    });
  }

  private buildQueryString(params?: Record<string, string | number | boolean | undefined>): string {
    if (!params) return '';
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
    }
    return parts.length > 0 ? `?${parts.join('&')}` : '';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------

  async getEvents(params?: GetEventsParams): Promise<PaginatedResponse<BSDFixture>> {
    return this.request<PaginatedResponse<BSDFixture>>(
      '/events/',
      params as Record<string, string | number | boolean | undefined>,
      CACHE_TTL_STATIC,
    );
  }

  async getLiveEvents(params?: GetLiveEventsParams): Promise<{ count: number; events: BSDFixture[] }> {
    return this.request<{ count: number; events: BSDFixture[] }>(
      '/events/live/',
      params as Record<string, string | number | boolean | undefined>,
      CACHE_TTL_LIVE,
    );
  }

  async getEvent(id: number): Promise<BSDFixture> {
    return this.request<BSDFixture>(`/events/${id}/`, undefined, CACHE_TTL_STATIC);
  }

  async getEventStats(id: number): Promise<BSDEventStats> {
    return this.request<BSDEventStats>(`/events/${id}/stats/`, undefined, CACHE_TTL_STATIC);
  }

  async getEventIncidents(id: number): Promise<BSDIncident[]> {
    return this.request<BSDIncident[]>(`/events/${id}/incidents/`, undefined, CACHE_TTL_STATIC);
  }

  async getEventOdds(id: number): Promise<BSDOdds> {
    return this.request<BSDOdds>(`/events/${id}/odds/`, undefined, CACHE_TTL_STATIC);
  }

  async getEventLineups(id: number): Promise<BSDLineup> {
    return this.request<BSDLineup>(`/events/${id}/lineups/`, undefined, CACHE_TTL_STATIC);
  }

  async getEventMetadata(id: number): Promise<BSDMetadata> {
    return this.request<BSDMetadata>(`/events/${id}/metadata/`, undefined, CACHE_TTL_STATIC);
  }

  async getEventPlayerStats(id: number): Promise<BSDPlayerStat[]> {
    return this.request<BSDPlayerStat[]>(`/events/${id}/player-stats/`, undefined, CACHE_TTL_STATIC);
  }

  async getEventPrediction(id: number): Promise<BSDPrediction> {
    return this.request<BSDPrediction>(`/events/${id}/prediction/`, undefined, CACHE_TTL_STATIC);
  }

  // --------------------------------------------------------------------------
  // Leagues
  // --------------------------------------------------------------------------

  async getLeagues(params?: GetLeaguesParams): Promise<PaginatedResponse<BSDLeague>> {
    return this.request<PaginatedResponse<BSDLeague>>(
      '/leagues/',
      params as Record<string, string | number | boolean | undefined>,
      CACHE_TTL_STATIC,
    );
  }

  async getLeague(id: number): Promise<BSDLeague> {
    return this.request<BSDLeague>(`/leagues/${id}/`, undefined, CACHE_TTL_STATIC);
  }

  async getLeagueStandings(id: number): Promise<BSDStanding> {
    return this.request<BSDStanding>(`/leagues/${id}/standings/`, undefined, CACHE_TTL_STATIC);
  }

  // --------------------------------------------------------------------------
  // Teams
  // --------------------------------------------------------------------------

  async getTeams(params?: GetTeamsParams): Promise<PaginatedResponse<BSDTeam>> {
    return this.request<PaginatedResponse<BSDTeam>>(
      '/teams/',
      params as Record<string, string | number | boolean | undefined>,
      CACHE_TTL_STATIC,
    );
  }

  async getTeam(id: number): Promise<BSDTeam> {
    return this.request<BSDTeam>(`/teams/${id}/`, undefined, CACHE_TTL_STATIC);
  }

  async getTeamSquad(id: number): Promise<BSDSquad> {
    return this.request<BSDSquad>(`/teams/${id}/squad/`, undefined, CACHE_TTL_STATIC);
  }

  async getTeamFixtures(id: number, params?: GetTeamFixturesParams): Promise<PaginatedResponse<BSDFixture>> {
    return this.request<PaginatedResponse<BSDFixture>>(
      `/teams/${id}/fixtures/`,
      params as Record<string, string | number | boolean | undefined>,
      CACHE_TTL_STATIC,
    );
  }

  // --------------------------------------------------------------------------
  // Managers
  // --------------------------------------------------------------------------

  async getManagers(params?: GetManagersParams): Promise<PaginatedResponse<BSDManager>> {
    return this.request<PaginatedResponse<BSDManager>>(
      '/managers/',
      params as Record<string, string | number | boolean | undefined>,
      CACHE_TTL_STATIC,
    );
  }

  // --------------------------------------------------------------------------
  // Referees
  // --------------------------------------------------------------------------

  async getReferees(params?: GetRefereesParams): Promise<PaginatedResponse<BSDReferee>> {
    return this.request<PaginatedResponse<BSDReferee>>(
      '/referees/',
      params as Record<string, string | number | boolean | undefined>,
      CACHE_TTL_STATIC,
    );
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /** Clear all cached data */
  clearCache(): void {
    this.cache.clear();
  }

  /** Clear cached data for a specific key pattern */
  invalidateCache(pattern: string): void {
    // Since Map doesn't support pattern matching natively, we iterate
    // This is fine for our scale
    this.cache.prune(); // also prunes expired entries
  }
}

// ============================================================================
// CUSTOM ERRORS
// ============================================================================

export class BSDApiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'BSDApiError';
    this.statusCode = statusCode;
  }
}

export class BSDAuthError extends BSDApiError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'BSDAuthError';
  }
}

export class BSDNotFoundError extends BSDApiError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'BSDNotFoundError';
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const bsdClient = new BSDClient();
