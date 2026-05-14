// ============================================================================
// xG-Vantage V2 Engine — Feature Builder Module
// ============================================================================
// Assembles 100+ features from database data to feed the prediction engine.
// Every sub-module handles missing data gracefully with sensible defaults.
// Uses recency weighting bands and opponent quality weighting from constants.
// ============================================================================

import { client } from '@/lib/db-turso';
import type {
  FeatureVector,
  FlatFeatureVector,
  FormFeatures,
  LastMatchMemory,
  SplitFeatures,
  H2HFeatures,
  TeamStrengthFeatures,
  ContextFeatures,
  MotivationType,
  VolatilityFeatures,
  MarketFeatures,
  BsdIntelligenceFeatures,
  InjuryFeatures,
  LineupFeatures,
  ProfileFeatures,
  FixtureRow,
  StandingRow,
  EloRow,
  OddsRow,
} from './types';
import {
  RECENCY_BANDS,
  OPPONENT_QUALITY,
  CONTEXT_PARAMS,
  ENRICHMENT_TIERS,
  MANAGER_STYLE_MULTIPLIERS,
  WEATHER_CODES,
  LEAGUE_PRESTIGE,
  DEFAULT_LEAGUE_PRESTIGE,
  GLICKO_PARAMS,
  MOMENTUM_PARAMS,
  XG_PARAMS,
  getLeaguePrestige,
} from './constants';

// ============================================================================
// Internal Types — Fetched Data Context
// ============================================================================

// Extended fixture row with DB schema fields not in types.ts FixtureRow
interface ExtendedFixtureRow extends FixtureRow {
  is_local_derby: number | null;
  travel_distance_km: number | null;
  season_id: number | null;
}

// Extended standing row with xG fields from DB schema
interface ExtendedStandingRow extends StandingRow {
  xgf: number | null;
  xga: number | null;
  xg_games: number | null;
  team_name: string | null;
}

interface MatchRow {
  id: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  event_date: string;
  home_expected_goals: number | null;
  away_expected_goals: number | null;
  home_ball_possession: number | null;
  away_ball_possession: number | null;
  home_total_shots: number | null;
  away_total_shots: number | null;
  home_shots_on_target: number | null;
  away_shots_on_target: number | null;
  home_corner_kicks: number | null;
  away_corner_kicks: number | null;
  home_fouls: number | null;
  away_fouls: number | null;
}

interface ProfileRow {
  team_id: number;
  style: string | null;
  avg_goals_scored: number | null;
  avg_goals_conceded: number | null;
  avg_xg_for: number | null;
  avg_xg_against: number | null;
  possession: number | null;
  clean_sheet_pct: number | null;
  btts_pct: number | null;
  over_25_pct: number | null;
  home_avg_scored: number | null;
  home_avg_conceded: number | null;
  away_avg_scored: number | null;
  away_avg_conceded: number | null;
  tactical_profile: string | null;
  preferred_formation: string | null;
  press_intensity: string | null;
  def_line: string | null;
  form: string | null;
  home_form: string | null;
  away_form: string | null;
}

interface LineupRow {
  fixture_id: number;
  lineup_status: string | null;
  home_formation: string | null;
  away_formation: string | null;
  home_players: string | null;
  away_players: string | null;
  home_substitutes: string | null;
  away_substitutes: string | null;
  home_unavailable: string | null;
  away_unavailable: string | null;
  home_confidence: number | null;
  away_confidence: number | null;
}

interface FixtureContext {
  fixture: FixtureRow;
  homeMatches: MatchRow[];
  awayMatches: MatchRow[];
  homeHomeMatches: MatchRow[];
  awayAwayMatches: MatchRow[];
  h2hMatches: MatchRow[];
  standings: ExtendedStandingRow[];
  homeProfile: ProfileRow | null;
  awayProfile: ProfileRow | null;
  homeElo: EloRow | null;
  awayElo: EloRow | null;
  odds: OddsRow | null;
  lineup: LineupRow | null;
  leagueName: string;
  leagueCountry: string;
  homePrevMatchDate: string | null;
  awayPrevMatchDate: string | null;
  homeRecentCount14d: number;
  awayRecentCount14d: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Safe number extraction from DB row values */
function safeNum(val: unknown, def: number = 0): number {
  if (val === null || val === undefined) return def;
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

/** Clamp a number between min and max */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Compute days between two date strings */
function daysBetween(dateStr1: string, dateStr2: string): number {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
}

/** Get recency weight based on match age in days */
function getRecencyWeight(matchDate: string, referenceDate: string): number {
  const days = daysBetween(matchDate, referenceDate);
  if (days <= 14) return RECENCY_BANDS['14d'];
  if (days <= 30) return RECENCY_BANDS['30d'];
  if (days <= 60) return RECENCY_BANDS['60d'];
  if (days <= 120) return RECENCY_BANDS['120d'];
  return RECENCY_BANDS['older'];
}

/** Get opponent quality weight from standings position */
function getOpponentQualityWeight(
  opponentTeamId: number,
  standings: ExtendedStandingRow[],
): number {
  const standing = standings.find((s) => s.team_id === opponentTeamId);
  if (!standing) return OPPONENT_QUALITY.mid;
  const pos = standing.position;
  const totalTeams = standings.length || 20;
  const top4Cutoff = Math.max(4, Math.ceil(totalTeams * 0.2));
  const top8Cutoff = Math.max(8, Math.ceil(totalTeams * 0.4));
  const bottom4Cutoff = totalTeams - Math.max(4, Math.ceil(totalTeams * 0.2));
  if (pos <= top4Cutoff) return OPPONENT_QUALITY.top4;
  if (pos <= top8Cutoff) return OPPONENT_QUALITY.top8;
  if (pos > bottom4Cutoff) return OPPONENT_QUALITY.bottom4;
  return OPPONENT_QUALITY.mid;
}

/** Compute weighted average */
function weightedAvg(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  let sumW = 0;
  let sumVW = 0;
  for (let i = 0; i < values.length; i++) {
    sumVW += values[i] * weights[i];
    sumW += weights[i];
  }
  return sumW > 0 ? sumVW / sumW : 0;
}

/** Simple average */
function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Variance of an array */
function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

/** Parse team's perspective from a match row */
interface TeamMatchPerspective {
  goalsScored: number;
  goalsConceded: number;
  xgFor: number | null;
  xgAgainst: number | null;
  possession: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  corners: number | null;
  fouls: number | null;
  isHome: boolean;
  result: 'W' | 'D' | 'L';
  opponentId: number;
  eventDate: string;
}

function getTeamPerspective(
  match: MatchRow,
  teamId: number,
): TeamMatchPerspective | null {
  if (match.home_score === null || match.away_score === null) return null;
  const isHome = match.home_team_id === teamId;
  const goalsScored = isHome ? match.home_score : match.away_score;
  const goalsConceded = isHome ? match.away_score : match.home_score;
  const xgFor = isHome ? match.home_expected_goals : match.away_expected_goals;
  const xgAgainst = isHome ? match.away_expected_goals : match.home_expected_goals;
  const possession = isHome ? match.home_ball_possession : match.away_ball_possession;
  const shots = isHome ? match.home_total_shots : match.away_total_shots;
  const shotsOnTarget = isHome ? match.home_shots_on_target : match.away_shots_on_target;
  const corners = isHome ? match.home_corner_kicks : match.away_corner_kicks;
  const fouls = isHome ? match.home_fouls : match.away_fouls;
  const opponentId = isHome ? match.away_team_id : match.home_team_id;
  let result: 'W' | 'D' | 'L';
  if (goalsScored > goalsConceded) result = 'W';
  else if (goalsScored < goalsConceded) result = 'L';
  else result = 'D';

  return {
    goalsScored,
    goalsConceded,
    xgFor,
    xgAgainst,
    possession,
    shots,
    shotsOnTarget,
    corners,
    fouls,
    isHome,
    result,
    opponentId,
    eventDate: match.event_date,
  };
}

/** Count consecutive results of the same type from the start of the array */
function countStreak(results: ('W' | 'D' | 'L')[], targetType: 'W' | 'L'): number {
  let count = 0;
  for (const r of results) {
    if (r === targetType) count++;
    else break;
  }
  return count;
}

/** Compute streak score from -1 (cold) to +1 (hot) */
function computeStreakScore(results: ('W' | 'D' | 'L')[]): number {
  const winStreak = countStreak(results, 'W');
  const lossStreak = countStreak(results, 'L');
  if (winStreak > 0) return clamp(winStreak / 5, 0, 1);
  if (lossStreak > 0) return -clamp(lossStreak / 5, 0, 1);
  return 0;
}

/** Default FormFeatures */
function defaultFormFeatures(): FormFeatures {
  return {
    homeWeightedScored: 1.1,
    homeWeightedConceded: 1.0,
    awayWeightedScored: 0.9,
    awayWeightedConceded: 1.15,
    overallWeightedScored: 1.0,
    overallWeightedConceded: 1.05,
    homeStreakScore: 0,
    awayStreakScore: 0,
    formPointsHome: 0.45,
    formPointsAway: 0.40,
    homeXgAvg: 1.2,
    awayXgAvg: 1.0,
    homeXgConcededAvg: 1.0,
    awayXgConcededAvg: 1.15,
    homeWinRate: 0.45,
    homeDrawRate: 0.27,
    homeLossRate: 0.28,
    awayWinRate: 0.30,
    awayDrawRate: 0.27,
    awayLossRate: 0.43,
    homeBttsRate: 0.50,
    awayBttsRate: 0.50,
    homeOver25Rate: 0.45,
    awayOver25Rate: 0.42,
    homeOver15Rate: 0.70,
    awayOver15Rate: 0.65,
    homeCleanSheetRate: 0.25,
    awayCleanSheetRate: 0.20,
    homeMatchCount: 0,
    awayMatchCount: 0,
  };
}

// ============================================================================
// Data Fetching — Builds the FixtureContext
// ============================================================================

async function fetchFixture(fixtureId: number): Promise<FixtureRow | null> {
  try {
    const res = await client.execute({
      sql: `SELECT f.*, ht.name as home_team_name, at.name as away_team_name,
                   l.name as league_name, l.country as league_country
            FROM fixtures f
            LEFT JOIN teams ht ON ht.id = f.home_team_id
            LEFT JOIN teams at ON at.id = f.away_team_id
            LEFT JOIN leagues l ON l.id = f.league_id
            WHERE f.id = ?`,
      args: [fixtureId],
    });
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: safeNum(r.id),
      league_id: safeNum(r.league_id),
      home_team_id: safeNum(r.home_team_id),
      away_team_id: safeNum(r.away_team_id),
      home_team_name: String(r.home_team_name ?? ''),
      away_team_name: String(r.away_team_name ?? ''),
      home_score: r.home_score != null ? safeNum(r.home_score) : null,
      away_score: r.away_score != null ? safeNum(r.away_score) : null,
      match_date: String(r.event_date ?? ''),
      match_status: String(r.status ?? 'notstarted'),
      bsd_id: safeNum(r.bsd_id, 0),
      round: r.round_name != null ? String(r.round_name) : null,
      weather_code: r.weather_code != null ? safeNum(r.weather_code) : null,
      weather_temp: r.temperature != null ? safeNum(r.temperature) : null,
      weather_wind: r.wind_speed != null ? safeNum(r.wind_speed) : null,
      is_local_derby: r.is_local_derby != null ? safeNum(r.is_local_derby) : null,
      travel_distance_km: r.travel_distance_km != null ? safeNum(r.travel_distance_km) : null,
      season_id: r.season_id != null ? safeNum(r.season_id) : null,
    } as ExtendedFixtureRow & { league_name?: string; league_country?: string };
  } catch {
    return null;
  }
}

async function fetchTeamMatches(
  teamId: number,
  beforeDate: string,
  limit: number = 20,
): Promise<MatchRow[]> {
  try {
    const res = await client.execute({
      sql: `SELECT f.id, f.home_team_id, f.away_team_id, f.home_score, f.away_score, f.event_date,
              fs.home_expected_goals, fs.away_expected_goals,
              fs.home_ball_possession, fs.away_ball_possession,
              fs.home_total_shots, fs.away_total_shots,
              fs.home_shots_on_target, fs.away_shots_on_target,
              fs.home_corner_kicks, fs.away_corner_kicks,
              fs.home_fouls, fs.away_fouls
            FROM fixtures f
            LEFT JOIN fixture_stats fs ON fs.fixture_id = f.id
            WHERE (f.home_team_id = ? OR f.away_team_id = ?)
              AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
              AND f.event_date < ?
            ORDER BY f.event_date DESC
            LIMIT ?`,
      args: [teamId, teamId, beforeDate, limit],
    });
    return res.rows.map((r) => ({
      id: safeNum(r.id),
      home_team_id: safeNum(r.home_team_id),
      away_team_id: safeNum(r.away_team_id),
      home_score: r.home_score != null ? safeNum(r.home_score) : null,
      away_score: r.away_score != null ? safeNum(r.away_score) : null,
      event_date: String(r.event_date ?? ''),
      home_expected_goals: r.home_expected_goals != null ? safeNum(r.home_expected_goals) : null,
      away_expected_goals: r.away_expected_goals != null ? safeNum(r.away_expected_goals) : null,
      home_ball_possession: r.home_ball_possession != null ? safeNum(r.home_ball_possession) : null,
      away_ball_possession: r.away_ball_possession != null ? safeNum(r.away_ball_possession) : null,
      home_total_shots: r.home_total_shots != null ? safeNum(r.home_total_shots) : null,
      away_total_shots: r.away_total_shots != null ? safeNum(r.away_total_shots) : null,
      home_shots_on_target: r.home_shots_on_target != null ? safeNum(r.home_shots_on_target) : null,
      away_shots_on_target: r.away_shots_on_target != null ? safeNum(r.away_shots_on_target) : null,
      home_corner_kicks: r.home_corner_kicks != null ? safeNum(r.home_corner_kicks) : null,
      away_corner_kicks: r.away_corner_kicks != null ? safeNum(r.away_corner_kicks) : null,
      home_fouls: r.home_fouls != null ? safeNum(r.home_fouls) : null,
      away_fouls: r.away_fouls != null ? safeNum(r.away_fouls) : null,
    }));
  } catch {
    return [];
  }
}

async function fetchVenueMatches(
  teamId: number,
  venue: 'home' | 'away',
  beforeDate: string,
  limit: number = 15,
): Promise<MatchRow[]> {
  try {
    const col = venue === 'home' ? 'f.home_team_id' : 'f.away_team_id';
    const res = await client.execute({
      sql: `SELECT f.id, f.home_team_id, f.away_team_id, f.home_score, f.away_score, f.event_date,
              fs.home_expected_goals, fs.away_expected_goals,
              fs.home_ball_possession, fs.away_ball_possession,
              fs.home_total_shots, fs.away_total_shots,
              fs.home_shots_on_target, fs.away_shots_on_target,
              fs.home_corner_kicks, fs.away_corner_kicks,
              fs.home_fouls, fs.away_fouls
            FROM fixtures f
            LEFT JOIN fixture_stats fs ON fs.fixture_id = f.id
            WHERE ${col} = ?
              AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
              AND f.event_date < ?
            ORDER BY f.event_date DESC
            LIMIT ?`,
      args: [teamId, beforeDate, limit],
    });
    return res.rows.map((r) => ({
      id: safeNum(r.id),
      home_team_id: safeNum(r.home_team_id),
      away_team_id: safeNum(r.away_team_id),
      home_score: r.home_score != null ? safeNum(r.home_score) : null,
      away_score: r.away_score != null ? safeNum(r.away_score) : null,
      event_date: String(r.event_date ?? ''),
      home_expected_goals: r.home_expected_goals != null ? safeNum(r.home_expected_goals) : null,
      away_expected_goals: r.away_expected_goals != null ? safeNum(r.away_expected_goals) : null,
      home_ball_possession: r.home_ball_possession != null ? safeNum(r.home_ball_possession) : null,
      away_ball_possession: r.away_ball_possession != null ? safeNum(r.away_ball_possession) : null,
      home_total_shots: r.home_total_shots != null ? safeNum(r.home_total_shots) : null,
      away_total_shots: r.away_total_shots != null ? safeNum(r.away_total_shots) : null,
      home_shots_on_target: r.home_shots_on_target != null ? safeNum(r.home_shots_on_target) : null,
      away_shots_on_target: r.away_shots_on_target != null ? safeNum(r.away_shots_on_target) : null,
      home_corner_kicks: r.home_corner_kicks != null ? safeNum(r.home_corner_kicks) : null,
      away_corner_kicks: r.away_corner_kicks != null ? safeNum(r.away_corner_kicks) : null,
      home_fouls: r.home_fouls != null ? safeNum(r.home_fouls) : null,
      away_fouls: r.away_fouls != null ? safeNum(r.away_fouls) : null,
    }));
  } catch {
    return [];
  }
}

async function fetchH2HMatches(
  homeTeamId: number,
  awayTeamId: number,
  limit: number = 10,
): Promise<MatchRow[]> {
  try {
    const res = await client.execute({
      sql: `SELECT f.id, f.home_team_id, f.away_team_id, f.home_score, f.away_score, f.event_date,
              fs.home_expected_goals, fs.away_expected_goals,
              fs.home_ball_possession, fs.away_ball_possession,
              fs.home_total_shots, fs.away_total_shots,
              fs.home_shots_on_target, fs.away_shots_on_target,
              fs.home_corner_kicks, fs.away_corner_kicks,
              fs.home_fouls, fs.away_fouls
            FROM fixtures f
            LEFT JOIN fixture_stats fs ON fs.fixture_id = f.id
            WHERE ((f.home_team_id = ? AND f.away_team_id = ?)
                OR (f.home_team_id = ? AND f.away_team_id = ?))
              AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
            ORDER BY f.event_date DESC
            LIMIT ?`,
      args: [homeTeamId, awayTeamId, awayTeamId, homeTeamId, limit],
    });
    return res.rows.map((r) => ({
      id: safeNum(r.id),
      home_team_id: safeNum(r.home_team_id),
      away_team_id: safeNum(r.away_team_id),
      home_score: r.home_score != null ? safeNum(r.home_score) : null,
      away_score: r.away_score != null ? safeNum(r.away_score) : null,
      event_date: String(r.event_date ?? ''),
      home_expected_goals: r.home_expected_goals != null ? safeNum(r.home_expected_goals) : null,
      away_expected_goals: r.away_expected_goals != null ? safeNum(r.away_expected_goals) : null,
      home_ball_possession: r.home_ball_possession != null ? safeNum(r.home_ball_possession) : null,
      away_ball_possession: r.away_ball_possession != null ? safeNum(r.away_ball_possession) : null,
      home_total_shots: r.home_total_shots != null ? safeNum(r.home_total_shots) : null,
      away_total_shots: r.away_total_shots != null ? safeNum(r.away_total_shots) : null,
      home_shots_on_target: r.home_shots_on_target != null ? safeNum(r.home_shots_on_target) : null,
      away_shots_on_target: r.away_shots_on_target != null ? safeNum(r.away_shots_on_target) : null,
      home_corner_kicks: r.home_corner_kicks != null ? safeNum(r.home_corner_kicks) : null,
      away_corner_kicks: r.away_corner_kicks != null ? safeNum(r.away_corner_kicks) : null,
      home_fouls: r.home_fouls != null ? safeNum(r.home_fouls) : null,
      away_fouls: r.away_fouls != null ? safeNum(r.away_fouls) : null,
    }));
  } catch {
    return [];
  }
}

async function fetchStandings(leagueId: number, seasonId?: number): Promise<ExtendedStandingRow[]> {
  try {
    let sql = `SELECT * FROM standings WHERE league_id = ?`;
    const args: (number | string)[] = [leagueId];
    if (seasonId != null) {
      sql += ` AND season_id = ?`;
      args.push(seasonId);
    }
    sql += ` ORDER BY position`;
    const res = await client.execute({ sql, args });
    return res.rows.map((r) => ({
      league_id: safeNum(r.league_id),
      team_id: safeNum(r.team_id),
      position: safeNum(r.position, 99),
      played: safeNum(r.played),
      won: safeNum(r.won),
      drawn: safeNum(r.drawn),
      lost: safeNum(r.lost),
      points: safeNum(r.pts ?? r.points),
      goals_for: safeNum(r.gf ?? r.goals_for),
      goals_against: safeNum(r.ga ?? r.goals_against),
      xgf: r.xgf != null ? safeNum(r.xgf) : null,
      xga: r.xga != null ? safeNum(r.xga) : null,
      xg_games: r.xg_games != null ? safeNum(r.xg_games) : null,
      team_name: r.team_name != null ? String(r.team_name) : null,
    } as ExtendedStandingRow));
  } catch {
    return [];
  }
}

async function fetchTeamProfile(teamId: number, leagueId: number): Promise<ProfileRow | null> {
  try {
    const res = await client.execute({
      sql: `SELECT * FROM team_profiles WHERE team_id = ? AND league_id = ? LIMIT 1`,
      args: [teamId, leagueId],
    });
    if (res.rows.length === 0) {
      // Try without league filter
      const res2 = await client.execute({
        sql: `SELECT * FROM team_profiles WHERE team_id = ? LIMIT 1`,
        args: [teamId],
      });
      if (res2.rows.length === 0) return null;
      const r = res2.rows[0];
      return mapProfileRow(r);
    }
    return mapProfileRow(res.rows[0]);
  } catch {
    return null;
  }
}

function mapProfileRow(r: Record<string, unknown>): ProfileRow {
  return {
    team_id: safeNum(r.team_id),
    style: r.style != null ? String(r.style) : null,
    avg_goals_scored: r.avg_goals_scored != null ? safeNum(r.avg_goals_scored) : null,
    avg_goals_conceded: r.avg_goals_conceded != null ? safeNum(r.avg_goals_conceded) : null,
    avg_xg_for: r.avg_xg_for != null ? safeNum(r.avg_xg_for) : null,
    avg_xg_against: r.avg_xg_against != null ? safeNum(r.avg_xg_against) : null,
    possession: r.possession != null ? safeNum(r.possession) : null,
    clean_sheet_pct: r.clean_sheet_pct != null ? safeNum(r.clean_sheet_pct) : null,
    btts_pct: r.btts_pct != null ? safeNum(r.btts_pct) : null,
    over_25_pct: r.over_25_pct != null ? safeNum(r.over_25_pct) : null,
    home_avg_scored: r.home_avg_scored != null ? safeNum(r.home_avg_scored) : null,
    home_avg_conceded: r.home_avg_conceded != null ? safeNum(r.home_avg_conceded) : null,
    away_avg_scored: r.away_avg_scored != null ? safeNum(r.away_avg_scored) : null,
    away_avg_conceded: r.away_avg_conceded != null ? safeNum(r.away_avg_conceded) : null,
    tactical_profile: r.tactical_profile != null ? String(r.tactical_profile) : null,
    preferred_formation: r.preferred_formation != null ? String(r.preferred_formation) : null,
    press_intensity: r.press_intensity != null ? String(r.press_intensity) : null,
    def_line: r.def_line != null ? String(r.def_line) : null,
    form: r.form != null ? String(r.form) : null,
    home_form: r.home_form != null ? String(r.home_form) : null,
    away_form: r.away_form != null ? String(r.away_form) : null,
  };
}

async function fetchTeamElo(teamId: number, leagueId: number): Promise<EloRow | null> {
  try {
    const res = await client.execute({
      sql: `SELECT * FROM team_elo WHERE team_id = ? AND league_id = ? LIMIT 1`,
      args: [teamId, leagueId],
    });
    if (res.rows.length === 0) {
      const res2 = await client.execute({
        sql: `SELECT * FROM team_elo WHERE team_id = ? LIMIT 1`,
        args: [teamId],
      });
      if (res2.rows.length === 0) return null;
      const r = res2.rows[0];
      return {
        team_id: safeNum(r.team_id),
        elo_rating: safeNum(r.elo_rating, GLICKO_PARAMS.defaultRating),
        elo_home_rating: safeNum(r.elo_home_rating, GLICKO_PARAMS.defaultRating),
        elo_away_rating: safeNum(r.elo_away_rating, GLICKO_PARAMS.defaultRating),
      };
    }
    const r = res.rows[0];
    return {
      team_id: safeNum(r.team_id),
      elo_rating: safeNum(r.elo_rating, GLICKO_PARAMS.defaultRating),
      elo_home_rating: safeNum(r.elo_home_rating, GLICKO_PARAMS.defaultRating),
      elo_away_rating: safeNum(r.elo_away_rating, GLICKO_PARAMS.defaultRating),
    };
  } catch {
    return null;
  }
}

async function fetchFixtureOdds(fixtureId: number): Promise<OddsRow | null> {
  try {
    const res = await client.execute({
      sql: `SELECT * FROM fixture_odds WHERE fixture_id = ? LIMIT 1`,
      args: [fixtureId],
    });
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      fixture_id: safeNum(r.fixture_id),
      home_win: r.home_win != null ? safeNum(r.home_win) : null,
      draw: r.draw != null ? safeNum(r.draw) : null,
      away_win: r.away_win != null ? safeNum(r.away_win) : null,
      over_25: r.over_25_goals != null ? safeNum(r.over_25_goals) : (r.over_25 != null ? safeNum(r.over_25) : null),
      under_25: r.under_25_goals != null ? safeNum(r.under_25_goals) : (r.under_25 != null ? safeNum(r.under_25) : null),
      btts_yes: r.btts_yes != null ? safeNum(r.btts_yes) : null,
      btts_no: r.btts_no != null ? safeNum(r.btts_no) : null,
    };
  } catch {
    return null;
  }
}

async function fetchFixtureLineup(fixtureId: number): Promise<LineupRow | null> {
  try {
    const res = await client.execute({
      sql: `SELECT * FROM fixture_lineups WHERE fixture_id = ? LIMIT 1`,
      args: [fixtureId],
    });
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      fixture_id: safeNum(r.fixture_id),
      lineup_status: r.lineup_status != null ? String(r.lineup_status) : null,
      home_formation: r.home_formation != null ? String(r.home_formation) : null,
      away_formation: r.away_formation != null ? String(r.away_formation) : null,
      home_players: r.home_players != null ? String(r.home_players) : null,
      away_players: r.away_players != null ? String(r.away_players) : null,
      home_substitutes: r.home_substitutes != null ? String(r.home_substitutes) : null,
      away_substitutes: r.away_substitutes != null ? String(r.away_substitutes) : null,
      home_unavailable: r.home_unavailable != null ? String(r.home_unavailable) : null,
      away_unavailable: r.away_unavailable != null ? String(r.away_unavailable) : null,
      home_confidence: r.home_confidence != null ? safeNum(r.home_confidence) : null,
      away_confidence: r.away_confidence != null ? safeNum(r.away_confidence) : null,
    };
  } catch {
    return null;
  }
}

/** Find the previous match date for a team before the given date */
async function fetchPrevMatchDate(teamId: number, beforeDate: string): Promise<string | null> {
  try {
    const res = await client.execute({
      sql: `SELECT event_date FROM fixtures
            WHERE (home_team_id = ? OR away_team_id = ?)
              AND home_score IS NOT NULL
              AND event_date < ?
            ORDER BY event_date DESC LIMIT 1`,
      args: [teamId, teamId, beforeDate],
    });
    if (res.rows.length === 0) return null;
    return String(res.rows[0].event_date);
  } catch {
    return null;
  }
}

/** Count matches in last N days for fixture congestion */
async function countRecentMatches(teamId: number, beforeDate: string, daysWindow: number = 14): Promise<number> {
  try {
    const cutoffDate = new Date(new Date(beforeDate).getTime() - daysWindow * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    const res = await client.execute({
      sql: `SELECT COUNT(*) as cnt FROM fixtures
            WHERE (home_team_id = ? OR away_team_id = ?)
              AND home_score IS NOT NULL
              AND event_date >= ? AND event_date < ?`,
      args: [teamId, teamId, cutoffDate, beforeDate],
    });
    if (res.rows.length === 0) return 0;
    return safeNum(res.rows[0].cnt);
  } catch {
    return 0;
  }
}

// ============================================================================
// Sub-Module 1: Form Features
// ============================================================================

function computeFormFeatures(
  homeMatches: MatchRow[],
  awayMatches: MatchRow[],
  standings: ExtendedStandingRow[],
  fixtureDate: string,
): FormFeatures {
  const defaults = defaultFormFeatures();
  const homeTeamId = homeMatches.length > 0 ? (homeMatches[0].home_team_id || homeMatches[0].away_team_id) : 0;
  const awayTeamId = awayMatches.length > 0 ? (awayMatches[0].home_team_id || awayMatches[0].away_team_id) : 0;

  // --- Compute home team form from all recent matches ---
  const homePerspectives = homeMatches
    .map((m) => getTeamPerspective(m, homeTeamId))
    .filter((p): p is TeamMatchPerspective => p !== null);

  const awayPerspectives = awayMatches
    .map((m) => getTeamPerspective(m, awayTeamId))
    .filter((p): p is TeamMatchPerspective => p !== null);

  if (homePerspectives.length === 0 && awayPerspectives.length === 0) return defaults;

  // --- Home team form ---
  const homeResults = computeWeightedTeamForm(homePerspectives, standings, fixtureDate, homeTeamId);
  // --- Away team form ---
  const awayResults = computeWeightedTeamForm(awayPerspectives, standings, fixtureDate, awayTeamId);

  return {
    homeWeightedScored: homeResults.weightedScored || defaults.homeWeightedScored,
    homeWeightedConceded: homeResults.weightedConceded || defaults.homeWeightedConceded,
    awayWeightedScored: awayResults.weightedScored || defaults.awayWeightedScored,
    awayWeightedConceded: awayResults.weightedConceded || defaults.awayWeightedConceded,
    overallWeightedScored: (homeResults.weightedScored + awayResults.weightedScored) / 2 || defaults.overallWeightedScored,
    overallWeightedConceded: (homeResults.weightedConceded + awayResults.weightedConceded) / 2 || defaults.overallWeightedConceded,
    homeStreakScore: homeResults.streakScore,
    awayStreakScore: awayResults.streakScore,
    formPointsHome: homeResults.formPoints,
    formPointsAway: awayResults.formPoints,
    homeXgAvg: homeResults.xgAvg || defaults.homeXgAvg,
    awayXgAvg: awayResults.xgAvg || defaults.awayXgAvg,
    homeXgConcededAvg: homeResults.xgConcededAvg || defaults.homeXgConcededAvg,
    awayXgConcededAvg: awayResults.xgConcededAvg || defaults.awayXgConcededAvg,
    homeWinRate: homeResults.winRate,
    homeDrawRate: homeResults.drawRate,
    homeLossRate: homeResults.lossRate,
    awayWinRate: awayResults.winRate,
    awayDrawRate: awayResults.drawRate,
    awayLossRate: awayResults.lossRate,
    homeBttsRate: homeResults.bttsRate,
    awayBttsRate: awayResults.bttsRate,
    homeOver25Rate: homeResults.over25Rate,
    awayOver25Rate: awayResults.over25Rate,
    homeOver15Rate: homeResults.over15Rate,
    awayOver15Rate: awayResults.over15Rate,
    homeCleanSheetRate: homeResults.cleanSheetRate,
    awayCleanSheetRate: awayResults.cleanSheetRate,
    homeMatchCount: homePerspectives.length,
    awayMatchCount: awayPerspectives.length,
  };
}

interface WeightedTeamFormResult {
  weightedScored: number;
  weightedConceded: number;
  streakScore: number;
  formPoints: number;
  xgAvg: number;
  xgConcededAvg: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  bttsRate: number;
  over25Rate: number;
  over15Rate: number;
  cleanSheetRate: number;
}

function computeWeightedTeamForm(
  perspectives: TeamMatchPerspective[],
  standings: ExtendedStandingRow[],
  fixtureDate: string,
  _teamId: number,
): WeightedTeamFormResult {
  if (perspectives.length === 0) {
    return {
      weightedScored: 0, weightedConceded: 0, streakScore: 0, formPoints: 0.4,
      xgAvg: 0, xgConcededAvg: 0, winRate: 0.33, drawRate: 0.27, lossRate: 0.40,
      bttsRate: 0.50, over25Rate: 0.45, over15Rate: 0.68, cleanSheetRate: 0.22,
    };
  }

  const weights: number[] = [];
  const scoredArr: number[] = [];
  const concededArr: number[] = [];
  const xgForArr: number[] = [];
  const xgAgainstArr: number[] = [];

  let wins = 0, draws = 0, losses = 0;
  let bttsCount = 0, over25Count = 0, over15Count = 0, cleanSheets = 0;
  const results: ('W' | 'D' | 'L')[] = [];

  for (const p of perspectives) {
    const recencyW = getRecencyWeight(p.eventDate, fixtureDate);
    const oppQualW = getOpponentQualityWeight(p.opponentId, standings);
    const w = recencyW * oppQualW;
    weights.push(w);
    scoredArr.push(p.goalsScored);
    concededArr.push(p.goalsConceded);
    if (p.xgFor != null) xgForArr.push(p.xgFor);
    if (p.xgAgainst != null) xgAgainstArr.push(p.xgAgainst);

    if (p.result === 'W') wins++;
    else if (p.result === 'D') draws++;
    else losses++;
    results.push(p.result);

    if (p.goalsScored > 0 && p.goalsConceded > 0) bttsCount++;
    if (p.goalsScored + p.goalsConceded > 2.5) over25Count++;
    if (p.goalsScored + p.goalsConceded > 1.5) over15Count++;
    if (p.goalsConceded === 0) cleanSheets++;
  }

  const total = perspectives.length;
  // Form points: W=3, D=1, L=0 normalized to 0-1
  const formPoints = clamp((wins * 3 + draws * 1) / (total * 3), 0, 1);

  // Weighted xG averages (equal weight for xG since fewer data points)
  const xgAvg = xgForArr.length > 0 ? avg(xgForArr) : 0;
  const xgConcededAvg = xgAgainstArr.length > 0 ? avg(xgAgainstArr) : 0;

  // Apply momentum bonuses
  const streakScore = computeStreakScore(results);
  const hotStreak = countStreak(results, 'W') >= MOMENTUM_PARAMS.hotStreakWins;
  const coldStreak = countStreak(results, 'L') >= MOMENTUM_PARAMS.coldStreakLosses;
  const momentumBoost = hotStreak ? MOMENTUM_PARAMS.hotBoost : coldStreak ? -MOMENTUM_PARAMS.coldPenalty : 0;

  const adjustedFormPoints = clamp(formPoints + momentumBoost, 0, 1);

  return {
    weightedScored: weightedAvg(scoredArr, weights),
    weightedConceded: weightedAvg(concededArr, weights),
    streakScore,
    formPoints: adjustedFormPoints,
    xgAvg,
    xgConcededAvg,
    winRate: wins / total,
    drawRate: draws / total,
    lossRate: losses / total,
    bttsRate: bttsCount / total,
    over25Rate: over25Count / total,
    over15Rate: over15Count / total,
    cleanSheetRate: cleanSheets / total,
  };
}

// ============================================================================
// Sub-Module 2: Last Match Memory
// ============================================================================

function computeLastMatchMemory(
  homeMatches: MatchRow[],
  awayMatches: MatchRow[],
  homeTeamId: number,
  awayTeamId: number,
): LastMatchMemory {
  const homeFirst = homeMatches.length > 0 ? getTeamPerspective(homeMatches[0], homeTeamId) : null;
  const awayFirst = awayMatches.length > 0 ? getTeamPerspective(awayMatches[0], awayTeamId) : null;

  // Attack signal: how many goals vs their typical output
  // Normalize: 0 goals = -0.3, 1 goal = 0.0, 2+ goals = positive
  const homeAttackSignal = homeFirst
    ? clamp((homeFirst.goalsScored - 1.0) / 1.5, -1, 1)
    : 0;
  const awayAttackSignal = awayFirst
    ? clamp((awayFirst.goalsScored - 0.9) / 1.5, -1, 1)
    : 0;

  // Defense signal: conceding goals (inverted — more conceded = more negative)
  const homeDefenseSignal = homeFirst
    ? clamp((1.0 - homeFirst.goalsConceded) / 1.5, -1, 1)
    : 0;
  const awayDefenseSignal = awayFirst
    ? clamp((1.0 - awayFirst.goalsConceded) / 1.5, -1, 1)
    : 0;

  // Volatility signal: how surprising was the result?
  // High scoring match = high volatility
  const homeVolatilitySignal = homeFirst
    ? clamp((homeFirst.goalsScored + homeFirst.goalsConceded - 2.0) / 3.0, -1, 1)
    : 0;
  const awayVolatilitySignal = awayFirst
    ? clamp((awayFirst.goalsScored + awayFirst.goalsConceded - 2.0) / 3.0, -1, 1)
    : 0;

  return {
    homeAttackSignal,
    homeDefenseSignal,
    homeVolatilitySignal,
    awayAttackSignal,
    awayDefenseSignal,
    awayVolatilitySignal,
  };
}

// ============================================================================
// Sub-Module 3: Split Features (Venue-Specific)
// ============================================================================

function computeSplitFeatures(
  homeHomeMatches: MatchRow[],
  awayAwayMatches: MatchRow[],
  standings: ExtendedStandingRow[],
  fixtureDate: string,
  homeTeamId: number,
  awayTeamId: number,
): SplitFeatures {
  // Home team at home
  const homeHomePersp = homeHomeMatches
    .map((m) => getTeamPerspective(m, homeTeamId))
    .filter((p): p is TeamMatchPerspective => p !== null);

  // Away team away
  const awayAwayPersp = awayAwayMatches
    .map((m) => getTeamPerspective(m, awayTeamId))
    .filter((p): p is TeamMatchPerspective => p !== null);

  // Home-at-home stats
  const hh = computeVenueStats(homeHomePersp, standings, fixtureDate);
  // Away-at-away stats
  const aa = computeVenueStats(awayAwayPersp, standings, fixtureDate);

  return {
    homeAtHomeScored: hh.avgScored || 1.3,
    homeAtHomeConceded: hh.avgConceded || 0.9,
    homeAtHomeXg: hh.avgXg || 1.3,
    homeAtHomeWinRate: hh.winRate || 0.50,
    homeAtHomeBttsRate: hh.bttsRate || 0.50,
    homeAtHomeOver25: hh.over25Rate || 0.48,
    awayAtAwayScored: aa.avgScored || 1.0,
    awayAtAwayConceded: aa.avgConceded || 1.2,
    awayAtAwayXg: aa.avgXg || 1.0,
    awayAtAwayWinRate: aa.winRate || 0.30,
    awayAtAwayBttsRate: aa.bttsRate || 0.52,
    awayAtAwayOver25: aa.over25Rate || 0.45,
  };
}

interface VenueStats {
  avgScored: number;
  avgConceded: number;
  avgXg: number;
  winRate: number;
  bttsRate: number;
  over25Rate: number;
}

function computeVenueStats(
  perspectives: TeamMatchPerspective[],
  standings: ExtendedStandingRow[],
  fixtureDate: string,
): VenueStats {
  if (perspectives.length === 0) {
    return { avgScored: 0, avgConceded: 0, avgXg: 0, winRate: 0, bttsRate: 0, over25Rate: 0 };
  }

  const weights: number[] = [];
  const scored: number[] = [];
  const conceded: number[] = [];
  const xg: number[] = [];
  let wins = 0, btts = 0, over25 = 0;

  for (const p of perspectives) {
    const recencyW = getRecencyWeight(p.eventDate, fixtureDate);
    const oppQualW = getOpponentQualityWeight(p.opponentId, standings);
    weights.push(recencyW * oppQualW);
    scored.push(p.goalsScored);
    conceded.push(p.goalsConceded);
    if (p.xgFor != null) xg.push(p.xgFor);
    if (p.result === 'W') wins++;
    if (p.goalsScored > 0 && p.goalsConceded > 0) btts++;
    if (p.goalsScored + p.goalsConceded > 2.5) over25++;
  }

  const total = perspectives.length;
  return {
    avgScored: weightedAvg(scored, weights),
    avgConceded: weightedAvg(conceded, weights),
    avgXg: xg.length > 0 ? avg(xg) : 0,
    winRate: wins / total,
    bttsRate: btts / total,
    over25Rate: over25 / total,
  };
}

// ============================================================================
// Sub-Module 4: Head-to-Head Features
// ============================================================================

function computeH2HFeatures(
  h2hMatches: MatchRow[],
  homeTeamId: number,
  awayTeamId: number,
  fixtureDate: string,
): H2HFeatures {
  if (h2hMatches.length === 0) {
    return {
      totalMatches: 0,
      homeWinRate: 0.40,
      drawRate: 0.27,
      awayWinRate: 0.33,
      avgGoals: 2.5,
      avgHomeGoals: 1.35,
      avgAwayGoals: 1.15,
      bttsRate: 0.50,
      over25Rate: 0.47,
      homeWinLast3: 0.33,
      recencyWeight: 0,
    };
  }

  let homeWins = 0, draws = 0, awayWins = 0;
  let totalGoals = 0, totalHomeGoals = 0, totalAwayGoals = 0;
  let bttsCount = 0, over25Count = 0;
  const recentHomeWins: number[] = []; // 1 if home team won, 0 otherwise

  for (const m of h2hMatches) {
    if (m.home_score === null || m.away_score === null) continue;
    const isOriginalHome = m.home_team_id === homeTeamId;
    const homeGoals = m.home_score;
    const awayGoals = m.away_score;

    totalGoals += homeGoals + awayGoals;
    totalHomeGoals += homeGoals;
    totalAwayGoals += awayGoals;

    if (homeGoals === awayGoals) {
      draws++;
    } else if (isOriginalHome && homeGoals > awayGoals) {
      homeWins++;
      recentHomeWins.push(1);
    } else if (!isOriginalHome && awayGoals > homeGoals) {
      homeWins++;
      recentHomeWins.push(1);
    } else {
      awayWins++;
      recentHomeWins.push(0);
    }

    if (homeGoals > 0 && awayGoals > 0) bttsCount++;
    if (homeGoals + awayGoals > 2.5) over25Count++;
  }

  const validMatches = h2hMatches.filter(
    (m) => m.home_score !== null && m.away_score !== null,
  ).length;

  // Recency weight: how fresh is the H2H data
  const mostRecentDate = h2hMatches[0]?.event_date;
  let recencyWeight = 0;
  if (mostRecentDate) {
    const daysSince = daysBetween(mostRecentDate, fixtureDate);
    if (daysSince <= 180) recencyWeight = 1.0;
    else if (daysSince <= 365) recencyWeight = 0.7;
    else if (daysSince <= 730) recencyWeight = 0.4;
    else recencyWeight = 0.2;
  }

  // Last 3 home team wins
  const last3 = recentHomeWins.slice(0, 3);
  const homeWinLast3 = last3.length > 0 ? last3.reduce((a, b) => a + b, 0) / last3.length : 0.33;

  return {
    totalMatches: validMatches,
    homeWinRate: validMatches > 0 ? homeWins / validMatches : 0.40,
    drawRate: validMatches > 0 ? draws / validMatches : 0.27,
    awayWinRate: validMatches > 0 ? awayWins / validMatches : 0.33,
    avgGoals: validMatches > 0 ? totalGoals / validMatches : 2.5,
    avgHomeGoals: validMatches > 0 ? totalHomeGoals / validMatches : 1.35,
    avgAwayGoals: validMatches > 0 ? totalAwayGoals / validMatches : 1.15,
    bttsRate: validMatches > 0 ? bttsCount / validMatches : 0.50,
    over25Rate: validMatches > 0 ? over25Count / validMatches : 0.47,
    homeWinLast3,
    recencyWeight,
  };
}

// ============================================================================
// Sub-Module 5: Team Strength (ELO-based)
// ============================================================================

function computeTeamStrength(
  homeElo: EloRow | null,
  awayElo: EloRow | null,
  homeProfile: ProfileRow | null,
  awayProfile: ProfileRow | null,
  leagueId: number,
  awayTeamLeagueId?: number,
): TeamStrengthFeatures {
  const defaultRating = GLICKO_PARAMS.defaultRating;

  // ELO ratings
  const homeBaseRating = homeElo?.elo_rating ?? defaultRating;
  const awayBaseRating = awayElo?.elo_rating ?? defaultRating;
  const homeHomeRating = homeElo?.elo_home_rating ?? homeBaseRating;
  const awayAwayRating = awayElo?.elo_away_rating ?? awayBaseRating;

  // Normalize ELO to 0-1 scale (1500 = 0.5, 2000 = 1.0, 1000 = 0.0)
  const normalizeElo = (elo: number) => clamp((elo - 1000) / 1000, 0, 1);

  const homeBase = normalizeElo(homeHomeRating);
  const awayBase = normalizeElo(awayAwayRating);

  // Attack/defense ratings derived from ELO + profile scoring/conceding rates
  const homeAttackRating = clamp(
    homeBase * 0.6 + (homeProfile?.avg_goals_scored ?? 1.15) / 3.0 * 0.4,
    0, 1,
  );
  const homeDefenseRating = clamp(
    homeBase * 0.6 + (1 - (homeProfile?.avg_goals_conceded ?? 1.0) / 3.0) * 0.4,
    0, 1,
  );
  const awayAttackRating = clamp(
    awayBase * 0.6 + (awayProfile?.avg_goals_scored ?? 1.0) / 3.0 * 0.4,
    0, 1,
  );
  const awayDefenseRating = clamp(
    awayBase * 0.6 + (1 - (awayProfile?.avg_goals_conceded ?? 1.15) / 3.0) * 0.4,
    0, 1,
  );

  // League strength difference
  const homeLeaguePrestige = getLeaguePrestige(leagueId);
  const awayLeaguePrestige = getLeaguePrestige(awayTeamLeagueId ?? leagueId);
  const leagueStrengthDiff = homeLeaguePrestige - awayLeaguePrestige;

  return {
    homeBaseRating: homeBase,
    homeAttackRating,
    homeDefenseRating,
    awayBaseRating: awayBase,
    awayAttackRating,
    awayDefenseRating,
    strengthGap: homeBase - awayBase,
    attackGap: homeAttackRating - awayAttackRating,
    defenseGap: homeDefenseRating - awayDefenseRating,
    leagueStrengthDiff,
  };
}

// ============================================================================
// Sub-Module 6: Context Features
// ============================================================================

function computeContextFeatures(
  fixture: FixtureRow,
  standings: ExtendedStandingRow[],
  homePrevMatchDate: string | null,
  awayPrevMatchDate: string | null,
  homeRecentCount14d: number,
  awayRecentCount14d: number,
): ContextFeatures {
  const homeTeamId = fixture.home_team_id;
  const awayTeamId = fixture.away_team_id;
  const fixtureDate = fixture.match_date;
  const totalTeams = standings.length || 20;

  // Find standings for each team
  const homeStanding = standings.find((s) => s.team_id === homeTeamId);
  const awayStanding = standings.find((s) => s.team_id === awayTeamId);

  const homePosition = homeStanding?.position ?? Math.ceil(totalTeams / 2);
  const awayPosition = awayStanding?.position ?? Math.ceil(totalTeams / 2);

  // Motivation classification based on table position
  const homeMotivation = classifyMotivation(homePosition, totalTeams, homeStanding);
  const awayMotivation = classifyMotivation(awayPosition, totalTeams, awayStanding);

  const motivationScores = CONTEXT_PARAMS.motivationScores;
  const homeMotivationScore = motivationScores[homeMotivation] ?? 0.4;
  const awayMotivationScore = motivationScores[awayMotivation] ?? 0.4;

  // Rotation risk: more games in 14 days = higher rotation risk
  const homeRotationRisk = clamp(homeRecentCount14d / 7, 0, 1);
  const awayRotationRisk = clamp(awayRecentCount14d / 7, 0, 1);

  // Points to safety (distance from relegation zone)
  const relegationLine = Math.ceil(totalTeams * 0.8); // bottom 20%
  const safetyPoints = standings.find((s) => s.position === relegationLine)?.points ?? 35;
  const homePointsToSafety = homeStanding ? safetyPoints - homeStanding.points : 0;
  const awayPointsToSafety = awayStanding ? safetyPoints - awayStanding.points : 0;

  // Derby detection (from fixture metadata)
  const extFixture = fixture as ExtendedFixtureRow;
  const isDerby = extFixture.is_local_derby === 1;
  const derbyIntensity = isDerby ? CONTEXT_PARAMS.derbyIntensityMap.same_city : 0;

  // Travel distance
  const travelDistance = safeNum(extFixture.travel_distance_km, 0);
  let travelImpact = 0;
  if (travelDistance > 2000) {
    travelImpact = CONTEXT_PARAMS.travelImpactVeryFar;
  } else if (travelDistance > CONTEXT_PARAMS.travelDistanceThreshold) {
    travelImpact = CONTEXT_PARAMS.travelImpactFar;
  }

  // Rest advantage (days between previous match and this one)
  let homeRestDays = 7; // default optimal
  let awayRestDays = 7;
  if (homePrevMatchDate) {
    homeRestDays = daysBetween(homePrevMatchDate, fixtureDate);
  }
  if (awayPrevMatchDate) {
    awayRestDays = daysBetween(awayPrevMatchDate, fixtureDate);
  }

  // Penalize too little or too much rest
  const restScore = (days: number): number => {
    const { min, max } = CONTEXT_PARAMS.restOptimal;
    if (days >= min && days <= max) return 1.0;
    if (days < CONTEXT_PARAMS.fatigueThreshold) return 1.0 - CONTEXT_PARAMS.fatigueScore;
    if (days > CONTEXT_PARAMS.rustThreshold) return 1.0 - CONTEXT_PARAMS.rustScore;
    return 0.8;
  };

  const restAdvantage = restScore(homeRestDays) - restScore(awayRestDays); // -1 to 1

  // Fixture congestion
  const homeCongestion = clamp(homeRecentCount14d / 6, 0, 1);
  const awayCongestion = clamp(awayRecentCount14d / 6, 0, 1);
  const fixtureCongestion = (homeCongestion + awayCongestion) / 2;

  // Alignment score: how similarly motivated are both teams
  const motivationDiff = Math.abs(homeMotivationScore - awayMotivationScore);
  const alignmentScore = 1 - motivationDiff;

  return {
    homeMotivation,
    awayMotivation,
    homeMotivationScore,
    awayMotivationScore,
    homeRotationRisk,
    awayRotationRisk,
    homeTablePosition: homePosition,
    awayTablePosition: awayPosition,
    homePointsToSafety,
    awayPointsToSafety,
    isDerby,
    derbyIntensity,
    travelDistance,
    travelImpact,
    restAdvantage,
    fixtureCongestion,
    alignmentScore,
  };
}

function classifyMotivation(
  position: number,
  totalTeams: number,
  standing: StandingRow | undefined,
): MotivationType {
  if (position <= 1) return 'title_race';
  if (position <= Math.ceil(totalTeams * 0.15)) return 'champions_league';
  if (position <= Math.ceil(totalTeams * 0.30)) return 'europa';
  if (position > totalTeams - Math.ceil(totalTeams * 0.15)) return 'relegation';
  if (position > totalTeams - Math.ceil(totalTeams * 0.20)) return 'relegation';
  // Check if newly promoted (low points relative to position)
  if (standing && standing.played > 10 && standing.points / standing.played < 0.7) return 'relegation';
  return 'midtable';
}

// ============================================================================
// Sub-Module 7: Volatility Features
// ============================================================================

function computeVolatilityFeatures(
  homeMatches: MatchRow[],
  awayMatches: MatchRow[],
  homeTeamId: number,
  awayTeamId: number,
  strength: TeamStrengthFeatures,
  context: ContextFeatures,
  dataQualityFlags: { hasOdds: boolean; hasLineup: boolean; hasProfile: boolean; hasElo: boolean; hasH2H: boolean },
): VolatilityFeatures {
  // Form variance from recent results
  const homePerspectives = homeMatches
    .map((m) => getTeamPerspective(m, homeTeamId))
    .filter((p): p is TeamMatchPerspective => p !== null);
  const awayPerspectives = awayMatches
    .map((m) => getTeamPerspective(m, awayTeamId))
    .filter((p): p is TeamMatchPerspective => p !== null);

  // Compute goal total variance per team
  const homeGoalTotals = homePerspectives.map((p) => p.goalsScored + p.goalsConceded);
  const awayGoalTotals = awayPerspectives.map((p) => p.goalsScored + p.goalsConceded);

  const homeFormVariance = clamp(variance(homeGoalTotals) / 4, 0, 1); // normalize
  const awayFormVariance = clamp(variance(awayGoalTotals) / 4, 0, 1);

  // Upset risk: strength gap is small → higher upset risk
  const strengthGap = Math.abs(strength.strengthGap);
  const homeUpsetRisk = clamp(0.5 - strengthGap * 0.5 + homeFormVariance * 0.3, 0, 1);
  const awayUpsetRisk = clamp(0.5 - strengthGap * 0.5 + awayFormVariance * 0.3, 0, 1);

  // Data completeness: count how many data sources are present
  const totalSources = 7; // form, h2h, elo, profile, odds, lineup, standings
  let presentSources = 3; // form + standings always present (even if empty)
  if (dataQualityFlags.hasElo) presentSources++;
  if (dataQualityFlags.hasProfile) presentSources++;
  if (dataQualityFlags.hasOdds) presentSources++;
  if (dataQualityFlags.hasLineup) presentSources++;
  if (dataQualityFlags.hasH2H) presentSources++;
  const dataCompleteness = presentSources / totalSources;

  // Match count factor
  const homeMatchCount = homePerspectives.length;
  const awayMatchCount = awayPerspectives.length;
  const matchCountFactor = clamp(
    Math.min(homeMatchCount, awayMatchCount) / ENRICHMENT_TIERS.good.minMatches,
    0, 1,
  );

  const adjustedCompleteness = dataCompleteness * 0.7 + matchCountFactor * 0.3;

  // Chaos score: composite of volatility indicators
  const weatherImpact = getWeatherImpact(null); // would need fixture weather
  const chaosScore = clamp(
    (homeFormVariance + awayFormVariance) / 2 * 0.35 +
    (homeUpsetRisk + awayUpsetRisk) / 2 * 0.25 +
    context.fixtureCongestion * 0.15 +
    context.derbyIntensity * 0.10 +
    (1 - adjustedCompleteness) * 0.15 +
    weatherImpact * 0.0, // placeholder for weather
    0, 1,
  );

  // Composite volatility score
  const volatilityScore = clamp(
    (homeFormVariance + awayFormVariance) / 2 * 0.4 +
    chaosScore * 0.35 +
    (1 - adjustedCompleteness) * 0.25,
    0, 1,
  );

  // Enrichment tier
  let enrichmentTier: 'rich' | 'good' | 'partial' | 'thin';
  const minMatches = Math.min(homeMatchCount, awayMatchCount);
  if (adjustedCompleteness >= ENRICHMENT_TIERS.rich.minFeatures && minMatches >= ENRICHMENT_TIERS.rich.minMatches) {
    enrichmentTier = 'rich';
  } else if (adjustedCompleteness >= ENRICHMENT_TIERS.good.minFeatures && minMatches >= ENRICHMENT_TIERS.good.minMatches) {
    enrichmentTier = 'good';
  } else if (adjustedCompleteness >= ENRICHMENT_TIERS.partial.minFeatures && minMatches >= ENRICHMENT_TIERS.partial.minMatches) {
    enrichmentTier = 'partial';
  } else {
    enrichmentTier = 'thin';
  }

  return {
    homeFormVariance,
    awayFormVariance,
    homeUpsetRisk,
    awayUpsetRisk,
    dataCompleteness: adjustedCompleteness,
    matchChaos: chaosScore,
    volatilityScore,
    enrichmentTier,
  };
}

function getWeatherImpact(weatherCode: number | null): number {
  if (weatherCode === null) return 0;
  return WEATHER_CODES[weatherCode]?.impact ?? 0;
}

// ============================================================================
// Sub-Module 8: Market Features
// ============================================================================

function computeMarketFeatures(odds: OddsRow | null): MarketFeatures {
  if (!odds || (odds.home_win == null && odds.draw == null && odds.away_win == null)) {
    return {
      impliedHomeWin: 0.45,
      impliedDraw: 0.27,
      impliedAwayWin: 0.28,
      impliedOver25: 0.47,
      impliedUnder25: 0.53,
      impliedBttsYes: 0.50,
      impliedBttsNo: 0.50,
      hasOdds: false,
      oddsConfidence: 0,
      bookmakerMargin: 0,
    };
  }

  // Implied probability = 1 / decimal odds
  const impliedProb = (oddsVal: number | null) =>
    oddsVal != null && oddsVal > 1 ? 1 / oddsVal : null;

  const impHome = impliedProb(odds.home_win) ?? 0.45;
  const impDraw = impliedProb(odds.draw) ?? 0.27;
  const impAway = impliedProb(odds.away_win) ?? 0.28;
  const impOver25 = impliedProb(odds.over_25) ?? 0.47;
  const impUnder25 = impliedProb(odds.under_25) ?? 0.53;
  const impBttsYes = impliedProb(odds.btts_yes) ?? 0.50;
  const impBttsNo = impliedProb(odds.btts_no) ?? 0.50;

  // Bookmaker margin = sum of implied probabilities - 1
  const margin1x2 = impHome + impDraw + impAway - 1;
  const bookmakerMargin = clamp(margin1x2, 0, 0.25);

  // Odds confidence: lower margin = more confident/sharp odds
  const oddsConfidence = clamp(1 - bookmakerMargin * 5, 0.2, 1.0);

  return {
    impliedHomeWin: impHome,
    impliedDraw: impDraw,
    impliedAwayWin: impAway,
    impliedOver25: impOver25,
    impliedUnder25: impUnder25,
    impliedBttsYes: impBttsYes,
    impliedBttsNo: impBttsNo,
    hasOdds: true,
    oddsConfidence,
    bookmakerMargin,
  };
}

// ============================================================================
// Sub-Module 9: BSD Intelligence Features
// ============================================================================

function computeBsdIntelligenceFeatures(
  standings: ExtendedStandingRow[],
  homeTeamId: number,
  awayTeamId: number,
  homeProfile: ProfileRow | null,
  awayProfile: ProfileRow | null,
  homeMatches: MatchRow[],
  awayMatches: MatchRow[],
): BsdIntelligenceFeatures {
  // xG table from standings
  const homeStanding = standings.find((s) => s.team_id === homeTeamId);
  const awayStanding = standings.find((s) => s.team_id === awayTeamId);

  // xG from standings (xgf, xga per game)
  let homeXgTable: number | null = null;
  let awayXgTable: number | null = null;

  if (homeStanding && homeStanding.xgf != null) {
    const xgf = safeNum(homeStanding.xgf);
    const xgGames = safeNum(homeStanding.xg_games, homeStanding.played);
    homeXgTable = xgGames > 0 ? xgf / xgGames : null;
  }
  if (awayStanding && awayStanding.xgf != null) {
    const xgf = safeNum(awayStanding.xgf);
    const xgGames = safeNum(awayStanding.xg_games, awayStanding.played);
    awayXgTable = xgGames > 0 ? xgf / xgGames : null;
  }

  // Manager style from team profile
  const homeManagerStyle = homeProfile?.tactical_profile ?? homeProfile?.style ?? null;
  const awayManagerStyle = awayProfile?.tactical_profile ?? awayProfile?.style ?? null;

  // Over bias from manager style
  const getOverBias = (style: string | null): number => {
    if (!style) return 0;
    const normalizedStyle = style.toLowerCase().replace(/[\s-]/g, '_');
    // Try direct match
    if (MANAGER_STYLE_MULTIPLIERS[normalizedStyle]) {
      return MANAGER_STYLE_MULTIPLIERS[normalizedStyle].overBias;
    }
    // Fuzzy match
    if (normalizedStyle.includes('attack') || normalizedStyle.includes('gung')) return 0.12;
    if (normalizedStyle.includes('conserv') || normalizedStyle.includes('defen')) return -0.12;
    if (normalizedStyle.includes('prag')) return -0.05;
    return 0;
  };

  const homeManagerOverBias = getOverBias(homeManagerStyle);
  const awayManagerOverBias = getOverBias(awayManagerStyle);

  // Player impact gap from recent fixture stats
  // Use average xG created vs conceded as proxy for player quality
  const homeXgForAvg = computeAvgXgFromMatches(homeMatches, homeTeamId, 'for');
  const homeXgAgainstAvg = computeAvgXgFromMatches(homeMatches, homeTeamId, 'against');
  const awayXgForAvg = computeAvgXgFromMatches(awayMatches, awayTeamId, 'for');
  const awayXgAgainstAvg = computeAvgXgFromMatches(awayMatches, awayTeamId, 'against');

  // Player impact: attack - defense balance
  const homePlayerImpact = homeXgForAvg - homeXgAgainstAvg;
  const awayPlayerImpact = awayXgForAvg - awayXgAgainstAvg;
  const playerImpactGap = clamp(homePlayerImpact - awayPlayerImpact, -2, 2);

  // Player rating gap: xG for as proxy
  const playerRatingGap = clamp(homeXgForAvg - awayXgForAvg, -2, 2);

  const hasManagerData = homeManagerStyle != null || awayManagerStyle != null;
  const hasPlayerData = homeXgForAvg > 0 || awayXgForAvg > 0;

  return {
    homeXgTable,
    awayXgTable,
    homeManagerStyle,
    awayManagerStyle,
    homeManagerOverBias,
    awayManagerOverBias,
    playerImpactGap,
    playerRatingGap,
    hasManagerData,
    hasPlayerData,
  };
}

function computeAvgXgFromMatches(
  matches: MatchRow[],
  teamId: number,
  direction: 'for' | 'against',
): number {
  const xgValues: number[] = [];
  for (const m of matches) {
    const isHome = m.home_team_id === teamId;
    if (direction === 'for') {
      const xg = isHome ? m.home_expected_goals : m.away_expected_goals;
      if (xg != null) xgValues.push(xg);
    } else {
      const xg = isHome ? m.away_expected_goals : m.home_expected_goals;
      if (xg != null) xgValues.push(xg);
    }
  }
  return xgValues.length > 0 ? avg(xgValues) : 0;
}

// ============================================================================
// Sub-Module 10: Injury Features
// ============================================================================

function computeInjuryFeatures(
  lineup: LineupRow | null,
  homeProfile: ProfileRow | null,
  awayProfile: ProfileRow | null,
): InjuryFeatures {
  if (!lineup) {
    return {
      homeKeyMissingCount: 0,
      awayKeyMissingCount: 0,
      homeXgImpact: 0,
      awayXgImpact: 0,
      homeSquadDepth: 0.5,
      awaySquadDepth: 0.5,
    };
  }

  // Parse unavailable players JSON
  const homeUnavailable = parsePlayerJson(lineup.home_unavailable);
  const awayUnavailable = parsePlayerJson(lineup.away_unavailable);

  // Count key missing players (those with high importance)
  const homeKeyMissingCount = countKeyPlayers(homeUnavailable);
  const awayKeyMissingCount = countKeyPlayers(awayUnavailable);

  // Estimate xG impact: each key missing player reduces xG by ~0.05-0.15
  const homeXgImpact = clamp(homeKeyMissingCount * 0.10, 0, 0.5);
  const awayXgImpact = clamp(awayKeyMissingCount * 0.10, 0, 0.5);

  // Squad depth estimate from substitutes
  const homeSubs = parsePlayerJson(lineup.home_substitutes);
  const awaySubs = parsePlayerJson(lineup.away_substitutes);
  const homeSquadDepth = estimateSquadDepth(homeSubs.length, homeKeyMissingCount);
  const awaySquadDepth = estimateSquadDepth(awaySubs.length, awayKeyMissingCount);

  return {
    homeKeyMissingCount,
    awayKeyMissingCount,
    homeXgImpact,
    awayXgImpact,
    homeSquadDepth,
    awaySquadDepth,
  };
}

function parsePlayerJson(jsonStr: string | null): Array<Record<string, unknown>> {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

function countKeyPlayers(players: Array<Record<string, unknown>>): number {
  let count = 0;
  for (const p of players) {
    // Check if player is a key player (captain, high rating, important position)
    const isCaptain = p.captain === true || p.captain === 'true' || p.captain === 1;
    const rating = safeNum(p.rating, 0);
    const position = String(p.position ?? p.pos ?? '').toLowerCase();
    const isAttacker = position.includes('forward') || position.includes('striker') || position.includes('winger') || position === 'fw' || position === 'am';
    const isKeyMidfielder = position.includes('midfield') && rating > 7;
    const isKeyDefender = position.includes('defend') && rating > 7;
    const reason = String(p.reason ?? '').toLowerCase();
    const isInjury = reason.includes('injur') || reason.includes('knock');

    if (isCaptain || rating >= 7.5 || isAttacker || isKeyMidfielder || isKeyDefender) {
      if (isInjury || !reason || reason === 'injured') count++;
      else count += 0.5; // suspended/other less impactful
    }
  }
  return Math.round(count);
}

function estimateSquadDepth(subCount: number, keyMissing: number): number {
  // 7+ subs = full squad, 5-6 = decent, <5 = thin
  const baseDepth = clamp(subCount / 9, 0, 1);
  const depthPenalty = keyMissing * 0.08;
  return clamp(baseDepth - depthPenalty, 0.1, 1);
}

// ============================================================================
// Sub-Module 11: Lineup Features
// ============================================================================

function computeLineupFeatures(
  lineup: LineupRow | null,
  homeProfile: ProfileRow | null,
  awayProfile: ProfileRow | null,
): LineupFeatures {
  if (!lineup || !lineup.home_formation) {
    // No lineup data — estimate from profiles
    return {
      homePredictedStrength: 0.5,
      awayPredictedStrength: 0.5,
      homeAttackerCount: estimateAttackerCount(homeProfile?.preferred_formation ?? null),
      awayAttackerCount: estimateAttackerCount(awayProfile?.preferred_formation ?? null),
      homeFormation: homeProfile?.preferred_formation ?? null,
      awayFormation: awayProfile?.preferred_formation ?? null,
      hasLineupData: false,
      lineupConfidence: 0,
    };
  }

  const hasLineupData = lineup.lineup_status === 'confirmed' || lineup.lineup_status === 'official';

  // Parse formations
  const homeFormation = lineup.home_formation;
  const awayFormation = lineup.away_formation;

  // Count attackers from formation
  const homeAttackerCount = countAttackersFromFormation(homeFormation);
  const awayAttackerCount = countAttackersFromFormation(awayFormation);

  // Predicted strength from player ratings
  const homePlayers = parsePlayerJson(lineup.home_players);
  const awayPlayers = parsePlayerJson(lineup.away_players);

  const homeAvgRating = computeAvgRating(homePlayers);
  const awayAvgRating = computeAvgRating(awayPlayers);

  // Normalize ratings (6.0 = 0, 10.0 = 1.0)
  const homePredictedStrength = clamp((homeAvgRating - 5.5) / 4.0, 0.1, 1.0) || 0.5;
  const awayPredictedStrength = clamp((awayAvgRating - 5.5) / 4.0, 0.1, 1.0) || 0.5;

  // Lineup confidence
  const lineupConfidence = hasLineupData
    ? clamp(safeNum(lineup.home_confidence, 0.5) + safeNum(lineup.away_confidence, 0.5) / 2, 0, 1)
    : 0.3;

  return {
    homePredictedStrength,
    awayPredictedStrength,
    homeAttackerCount,
    awayAttackerCount,
    homeFormation,
    awayFormation,
    hasLineupData,
    lineupConfidence,
  };
}

function countAttackersFromFormation(formation: string | null): number {
  if (!formation) return 2;
  // Parse "4-3-3" format → last number = attackers
  const parts = formation.replace(/[^0-9-]/g, '').split('-').map(Number).filter((n) => !isNaN(n));
  if (parts.length >= 3) return parts[parts.length - 1];
  if (parts.length === 2) return parts[1]; // e.g., "4-4" diamond
  return 2;
}

function estimateAttackerCount(formation: string | null): number {
  return countAttackersFromFormation(formation);
}

function computeAvgRating(players: Array<Record<string, unknown>>): number {
  if (players.length === 0) return 0;
  const ratings = players
    .map((p) => safeNum(p.rating, 0))
    .filter((r) => r > 0);
  return ratings.length > 0 ? avg(ratings) : 0;
}

// ============================================================================
// Sub-Module 12: Profile Features
// ============================================================================

function computeProfileFeatures(
  homeProfile: ProfileRow | null,
  awayProfile: ProfileRow | null,
  homeMatches: MatchRow[],
  awayMatches: MatchRow[],
  homeTeamId: number,
  awayTeamId: number,
): ProfileFeatures {
  // Possession from profile or computed from recent matches
  const homePossession = homeProfile?.possession ?? computeAvgPossession(homeMatches, homeTeamId) ?? 50;
  const awayPossession = awayProfile?.possession ?? computeAvgPossession(awayMatches, awayTeamId) ?? 50;

  // Shots per game from recent matches
  const homeShotsPerGame = computeAvgShots(homeMatches, homeTeamId) || 12;
  const awayShotsPerGame = computeAvgShots(awayMatches, awayTeamId) || 11;

  // Shots on target
  const homeShotsOnTargetPerGame = computeAvgShotsOnTarget(homeMatches, homeTeamId) || 4.5;
  const awayShotsOnTargetPerGame = computeAvgShotsOnTarget(awayMatches, awayTeamId) || 4.0;

  // Corners per game
  const homeCornersPerGame = computeAvgCorners(homeMatches, homeTeamId) || 5.5;
  const awayCornersPerGame = computeAvgCorners(awayMatches, awayTeamId) || 5.0;

  // Fouls per game
  const homeFoulsPerGame = computeAvgFouls(homeMatches, homeTeamId) || 12;
  const awayFoulsPerGame = computeAvgFouls(awayMatches, awayTeamId) || 12;

  // Style
  const homeStyle = homeProfile?.style ?? 'balanced';
  const awayStyle = awayProfile?.style ?? 'balanced';

  // Style clash: how different are the styles
  const styleClash = computeStyleClash(homeStyle, awayStyle, homePossession, awayPossession);

  return {
    homePossession,
    awayPossession,
    homeShotsPerGame,
    awayShotsPerGame,
    homeShotsOnTargetPerGame,
    awayShotsOnTargetPerGame,
    homeCornersPerGame,
    awayCornersPerGame,
    homeFoulsPerGame,
    awayFoulsPerGame,
    homeStyle,
    awayStyle,
    styleClash,
  };
}

function computeAvgPossession(matches: MatchRow[], teamId: number): number | null {
  const values: number[] = [];
  for (const m of matches) {
    const isHome = m.home_team_id === teamId;
    const poss = isHome ? m.home_ball_possession : m.away_ball_possession;
    if (poss != null) values.push(poss);
  }
  return values.length > 0 ? avg(values) : null;
}

function computeAvgShots(matches: MatchRow[], teamId: number): number {
  const values: number[] = [];
  for (const m of matches) {
    const isHome = m.home_team_id === teamId;
    const shots = isHome ? m.home_total_shots : m.away_total_shots;
    if (shots != null) values.push(shots);
  }
  return values.length > 0 ? avg(values) : 0;
}

function computeAvgShotsOnTarget(matches: MatchRow[], teamId: number): number {
  const values: number[] = [];
  for (const m of matches) {
    const isHome = m.home_team_id === teamId;
    const sot = isHome ? m.home_shots_on_target : m.away_shots_on_target;
    if (sot != null) values.push(sot);
  }
  return values.length > 0 ? avg(values) : 0;
}

function computeAvgCorners(matches: MatchRow[], teamId: number): number {
  const values: number[] = [];
  for (const m of matches) {
    const isHome = m.home_team_id === teamId;
    const corners = isHome ? m.home_corner_kicks : m.away_corner_kicks;
    if (corners != null) values.push(corners);
  }
  return values.length > 0 ? avg(values) : 0;
}

function computeAvgFouls(matches: MatchRow[], teamId: number): number {
  const values: number[] = [];
  for (const m of matches) {
    const isHome = m.home_team_id === teamId;
    const fouls = isHome ? m.home_fouls : m.away_fouls;
    if (fouls != null) values.push(fouls);
  }
  return values.length > 0 ? avg(values) : 0;
}

function computeStyleClash(
  homeStyle: string,
  awayStyle: string,
  homePossession: number,
  awayPossession: number,
): number {
  // Map styles to attack/defense orientation
  const styleMap: Record<string, { attack: number; defense: number }> = {
    attacking: { attack: 0.8, defense: 0.3 },
    gung_ho: { attack: 0.95, defense: 0.15 },
    balanced: { attack: 0.5, defense: 0.5 },
    pragmatic: { attack: 0.4, defense: 0.65 },
    conservative: { attack: 0.25, defense: 0.8 },
    defensive: { attack: 0.2, defense: 0.85 },
    counter_attacking: { attack: 0.45, defense: 0.6 },
    possession: { attack: 0.55, defense: 0.45 },
    high_press: { attack: 0.7, defense: 0.4 },
    low_block: { attack: 0.2, defense: 0.85 },
  };

  const home = styleMap[homeStyle.toLowerCase().replace(/[\s-]/g, '_')] ?? { attack: 0.5, defense: 0.5 };
  const away = styleMap[awayStyle.toLowerCase().replace(/[\s-]/g, '_')] ?? { attack: 0.5, defense: 0.5 };

  // Style clash = how much the styles create open play
  // High attack vs low defense = high clash (open game)
  // Low attack vs high defense = low clash (tight game)
  const homeAttackVsAwayDefense = home.attack * (1 - away.defense);
  const awayAttackVsHomeDefense = away.attack * (1 - home.defense);

  // Possession gap contributes to clash
  const possessionGap = Math.abs(homePossession - awayPossession) / 50;

  const clash = clamp(
    (homeAttackVsAwayDefense + awayAttackVsHomeDefense) / 2 * 0.7 + possessionGap * 0.3,
    0, 1,
  );

  return clash;
}

// ============================================================================
// Main: buildFeatureVector
// ============================================================================

export async function buildFeatureVector(fixtureId: number): Promise<FeatureVector> {
  // Step 1: Fetch the fixture
  const fixtureRow = await fetchFixture(fixtureId);
  if (!fixtureRow) {
    // Return a full default feature vector if fixture not found
    return buildDefaultFeatureVector();
  }

  const fixture = fixtureRow;
  const homeTeamId = fixture.home_team_id;
  const awayTeamId = fixture.away_team_id;
  const leagueId = fixture.league_id;
  const fixtureDate = fixture.match_date || new Date().toISOString();

  // Step 2: Fetch all data in parallel
  const [
    homeMatches,
    awayMatches,
    homeHomeMatches,
    awayAwayMatches,
    h2hMatches,
    standings,
    homeProfile,
    awayProfile,
    homeElo,
    awayElo,
    odds,
    lineup,
    homePrevDate,
    awayPrevDate,
    homeRecent14d,
    awayRecent14d,
  ] = await Promise.all([
    fetchTeamMatches(homeTeamId, fixtureDate, 20),
    fetchTeamMatches(awayTeamId, fixtureDate, 20),
    fetchVenueMatches(homeTeamId, 'home', fixtureDate, 15),
    fetchVenueMatches(awayTeamId, 'away', fixtureDate, 15),
    fetchH2HMatches(homeTeamId, awayTeamId, 10),
    fetchStandings(leagueId),
    fetchTeamProfile(homeTeamId, leagueId),
    fetchTeamProfile(awayTeamId, leagueId),
    fetchTeamElo(homeTeamId, leagueId),
    fetchTeamElo(awayTeamId, leagueId),
    fetchFixtureOdds(fixtureId),
    fetchFixtureLineup(fixtureId),
    fetchPrevMatchDate(homeTeamId, fixtureDate),
    fetchPrevMatchDate(awayTeamId, fixtureDate),
    countRecentMatches(homeTeamId, fixtureDate, 14),
    countRecentMatches(awayTeamId, fixtureDate, 14),
  ]);

  // Step 3: Compute all 12 feature sub-modules
  const form = computeFormFeatures(homeMatches, awayMatches, standings, fixtureDate);
  const lastMatch = computeLastMatchMemory(homeMatches, awayMatches, homeTeamId, awayTeamId);
  const split = computeSplitFeatures(homeHomeMatches, awayAwayMatches, standings, fixtureDate, homeTeamId, awayTeamId);
  const h2h = computeH2HFeatures(h2hMatches, homeTeamId, awayTeamId, fixtureDate);
  const strength = computeTeamStrength(homeElo, awayElo, homeProfile, awayProfile, leagueId, leagueId);
  const context = computeContextFeatures(
    fixture, standings, homePrevDate, awayPrevDate, homeRecent14d, awayRecent14d,
  );
  const market = computeMarketFeatures(odds);

  // Data quality flags for volatility computation
  const dataQualityFlags = {
    hasOdds: market.hasOdds,
    hasLineup: lineup != null && lineup.home_formation != null,
    hasProfile: homeProfile != null || awayProfile != null,
    hasElo: homeElo != null && awayElo != null,
    hasH2H: h2hMatches.length > 0,
  };

  const volatility = computeVolatilityFeatures(
    homeMatches, awayMatches, homeTeamId, awayTeamId, strength, context, dataQualityFlags,
  );
  const bsdIntel = computeBsdIntelligenceFeatures(
    standings, homeTeamId, awayTeamId, homeProfile, awayProfile, homeMatches, awayMatches,
  );
  const injury = computeInjuryFeatures(lineup, homeProfile, awayProfile);
  const lineupFeatures = computeLineupFeatures(lineup, homeProfile, awayProfile);
  const profile = computeProfileFeatures(
    homeProfile, awayProfile, homeMatches, awayMatches, homeTeamId, awayTeamId,
  );

  return {
    form,
    lastMatch,
    split,
    h2h,
    strength,
    context,
    volatility,
    market,
    bsdIntel,
    injury,
    lineup: lineupFeatures,
    profile,
  };
}

/** Build a full default feature vector for error cases */
function buildDefaultFeatureVector(): FeatureVector {
  return {
    form: defaultFormFeatures(),
    lastMatch: {
      homeAttackSignal: 0, homeDefenseSignal: 0, homeVolatilitySignal: 0,
      awayAttackSignal: 0, awayDefenseSignal: 0, awayVolatilitySignal: 0,
    },
    split: {
      homeAtHomeScored: 1.3, homeAtHomeConceded: 0.9, homeAtHomeXg: 1.3,
      homeAtHomeWinRate: 0.50, homeAtHomeBttsRate: 0.50, homeAtHomeOver25: 0.48,
      awayAtAwayScored: 1.0, awayAtAwayConceded: 1.2, awayAtAwayXg: 1.0,
      awayAtAwayWinRate: 0.30, awayAtAwayBttsRate: 0.52, awayAtAwayOver25: 0.45,
    },
    h2h: {
      totalMatches: 0, homeWinRate: 0.40, drawRate: 0.27, awayWinRate: 0.33,
      avgGoals: 2.5, avgHomeGoals: 1.35, avgAwayGoals: 1.15,
      bttsRate: 0.50, over25Rate: 0.47, homeWinLast3: 0.33, recencyWeight: 0,
    },
    strength: {
      homeBaseRating: 0.5, homeAttackRating: 0.5, homeDefenseRating: 0.5,
      awayBaseRating: 0.5, awayAttackRating: 0.5, awayDefenseRating: 0.5,
      strengthGap: 0, attackGap: 0, defenseGap: 0, leagueStrengthDiff: 0,
    },
    context: {
      homeMotivation: 'unknown', awayMotivation: 'unknown',
      homeMotivationScore: 0.4, awayMotivationScore: 0.4,
      homeRotationRisk: 0, awayRotationRisk: 0,
      homeTablePosition: 10, awayTablePosition: 10,
      homePointsToSafety: 0, awayPointsToSafety: 0,
      isDerby: false, derbyIntensity: 0,
      travelDistance: 0, travelImpact: 0,
      restAdvantage: 0, fixtureCongestion: 0, alignmentScore: 0.5,
    },
    volatility: {
      homeFormVariance: 0.3, awayFormVariance: 0.3,
      homeUpsetRisk: 0.5, awayUpsetRisk: 0.5,
      dataCompleteness: 0.2, matchChaos: 0.5,
      volatilityScore: 0.5, enrichmentTier: 'thin',
    },
    market: {
      impliedHomeWin: 0.45, impliedDraw: 0.27, impliedAwayWin: 0.28,
      impliedOver25: 0.47, impliedUnder25: 0.53,
      impliedBttsYes: 0.50, impliedBttsNo: 0.50,
      hasOdds: false, oddsConfidence: 0, bookmakerMargin: 0,
    },
    bsdIntel: {
      homeXgTable: null, awayXgTable: null,
      homeManagerStyle: null, awayManagerStyle: null,
      homeManagerOverBias: 0, awayManagerOverBias: 0,
      playerImpactGap: 0, playerRatingGap: 0,
      hasManagerData: false, hasPlayerData: false,
    },
    injury: {
      homeKeyMissingCount: 0, awayKeyMissingCount: 0,
      homeXgImpact: 0, awayXgImpact: 0,
      homeSquadDepth: 0.5, awaySquadDepth: 0.5,
    },
    lineup: {
      homePredictedStrength: 0.5, awayPredictedStrength: 0.5,
      homeAttackerCount: 2, awayAttackerCount: 2,
      homeFormation: null, awayFormation: null,
      hasLineupData: false, lineupConfidence: 0,
    },
    profile: {
      homePossession: 50, awayPossession: 50,
      homeShotsPerGame: 12, awayShotsPerGame: 11,
      homeShotsOnTargetPerGame: 4.5, awayShotsOnTargetPerGame: 4.0,
      homeCornersPerGame: 5.5, awayCornersPerGame: 5.0,
      homeFoulsPerGame: 12, awayFoulsPerGame: 12,
      homeStyle: 'balanced', awayStyle: 'balanced',
      styleClash: 0.3,
    },
  };
}

// ============================================================================
// Flatten Feature Vector — converts nested FeatureVector to ~100+ flat scalars
// ============================================================================

export function flattenFeatureVector(fv: FeatureVector): FlatFeatureVector {
  const flat: FlatFeatureVector = {};

  // 1. Form features (25 keys)
  flat['form_homeWeightedScored'] = fv.form.homeWeightedScored;
  flat['form_homeWeightedConceded'] = fv.form.homeWeightedConceded;
  flat['form_awayWeightedScored'] = fv.form.awayWeightedScored;
  flat['form_awayWeightedConceded'] = fv.form.awayWeightedConceded;
  flat['form_overallWeightedScored'] = fv.form.overallWeightedScored;
  flat['form_overallWeightedConceded'] = fv.form.overallWeightedConceded;
  flat['form_homeStreakScore'] = fv.form.homeStreakScore;
  flat['form_awayStreakScore'] = fv.form.awayStreakScore;
  flat['form_formPointsHome'] = fv.form.formPointsHome;
  flat['form_formPointsAway'] = fv.form.formPointsAway;
  flat['form_homeXgAvg'] = fv.form.homeXgAvg;
  flat['form_awayXgAvg'] = fv.form.awayXgAvg;
  flat['form_homeXgConcededAvg'] = fv.form.homeXgConcededAvg;
  flat['form_awayXgConcededAvg'] = fv.form.awayXgConcededAvg;
  flat['form_homeWinRate'] = fv.form.homeWinRate;
  flat['form_homeDrawRate'] = fv.form.homeDrawRate;
  flat['form_homeLossRate'] = fv.form.homeLossRate;
  flat['form_awayWinRate'] = fv.form.awayWinRate;
  flat['form_awayDrawRate'] = fv.form.awayDrawRate;
  flat['form_awayLossRate'] = fv.form.awayLossRate;
  flat['form_homeBttsRate'] = fv.form.homeBttsRate;
  flat['form_awayBttsRate'] = fv.form.awayBttsRate;
  flat['form_homeOver25Rate'] = fv.form.homeOver25Rate;
  flat['form_awayOver25Rate'] = fv.form.awayOver25Rate;
  flat['form_homeOver15Rate'] = fv.form.homeOver15Rate;
  flat['form_awayOver15Rate'] = fv.form.awayOver15Rate;
  flat['form_homeCleanSheetRate'] = fv.form.homeCleanSheetRate;
  flat['form_awayCleanSheetRate'] = fv.form.awayCleanSheetRate;
  flat['form_homeMatchCount'] = fv.form.homeMatchCount;
  flat['form_awayMatchCount'] = fv.form.awayMatchCount;

  // 2. Last match memory (6 keys)
  flat['lastMatch_homeAttackSignal'] = fv.lastMatch.homeAttackSignal;
  flat['lastMatch_homeDefenseSignal'] = fv.lastMatch.homeDefenseSignal;
  flat['lastMatch_homeVolatilitySignal'] = fv.lastMatch.homeVolatilitySignal;
  flat['lastMatch_awayAttackSignal'] = fv.lastMatch.awayAttackSignal;
  flat['lastMatch_awayDefenseSignal'] = fv.lastMatch.awayDefenseSignal;
  flat['lastMatch_awayVolatilitySignal'] = fv.lastMatch.awayVolatilitySignal;

  // 3. Split features (12 keys)
  flat['split_homeAtHomeScored'] = fv.split.homeAtHomeScored;
  flat['split_homeAtHomeConceded'] = fv.split.homeAtHomeConceded;
  flat['split_homeAtHomeXg'] = fv.split.homeAtHomeXg;
  flat['split_homeAtHomeWinRate'] = fv.split.homeAtHomeWinRate;
  flat['split_homeAtHomeBttsRate'] = fv.split.homeAtHomeBttsRate;
  flat['split_homeAtHomeOver25'] = fv.split.homeAtHomeOver25;
  flat['split_awayAtAwayScored'] = fv.split.awayAtAwayScored;
  flat['split_awayAtAwayConceded'] = fv.split.awayAtAwayConceded;
  flat['split_awayAtAwayXg'] = fv.split.awayAtAwayXg;
  flat['split_awayAtAwayWinRate'] = fv.split.awayAtAwayWinRate;
  flat['split_awayAtAwayBttsRate'] = fv.split.awayAtAwayBttsRate;
  flat['split_awayAtAwayOver25'] = fv.split.awayAtAwayOver25;

  // 4. H2H features (11 keys)
  flat['h2h_totalMatches'] = fv.h2h.totalMatches;
  flat['h2h_homeWinRate'] = fv.h2h.homeWinRate;
  flat['h2h_drawRate'] = fv.h2h.drawRate;
  flat['h2h_awayWinRate'] = fv.h2h.awayWinRate;
  flat['h2h_avgGoals'] = fv.h2h.avgGoals;
  flat['h2h_avgHomeGoals'] = fv.h2h.avgHomeGoals;
  flat['h2h_avgAwayGoals'] = fv.h2h.avgAwayGoals;
  flat['h2h_bttsRate'] = fv.h2h.bttsRate;
  flat['h2h_over25Rate'] = fv.h2h.over25Rate;
  flat['h2h_homeWinLast3'] = fv.h2h.homeWinLast3;
  flat['h2h_recencyWeight'] = fv.h2h.recencyWeight;

  // 5. Team strength features (10 keys)
  flat['strength_homeBaseRating'] = fv.strength.homeBaseRating;
  flat['strength_homeAttackRating'] = fv.strength.homeAttackRating;
  flat['strength_homeDefenseRating'] = fv.strength.homeDefenseRating;
  flat['strength_awayBaseRating'] = fv.strength.awayBaseRating;
  flat['strength_awayAttackRating'] = fv.strength.awayAttackRating;
  flat['strength_awayDefenseRating'] = fv.strength.awayDefenseRating;
  flat['strength_strengthGap'] = fv.strength.strengthGap;
  flat['strength_attackGap'] = fv.strength.attackGap;
  flat['strength_defenseGap'] = fv.strength.defenseGap;
  flat['strength_leagueStrengthDiff'] = fv.strength.leagueStrengthDiff;

  // 6. Context features (14 numeric keys + encoded motivation)
  flat['context_homeMotivationScore'] = fv.context.homeMotivationScore;
  flat['context_awayMotivationScore'] = fv.context.awayMotivationScore;
  flat['context_homeRotationRisk'] = fv.context.homeRotationRisk;
  flat['context_awayRotationRisk'] = fv.context.awayRotationRisk;
  flat['context_homeTablePosition'] = fv.context.homeTablePosition;
  flat['context_awayTablePosition'] = fv.context.awayTablePosition;
  flat['context_homePointsToSafety'] = fv.context.homePointsToSafety;
  flat['context_awayPointsToSafety'] = fv.context.awayPointsToSafety;
  flat['context_isDerby'] = fv.context.isDerby ? 1 : 0;
  flat['context_derbyIntensity'] = fv.context.derbyIntensity;
  flat['context_travelDistance'] = fv.context.travelDistance;
  flat['context_travelImpact'] = fv.context.travelImpact;
  flat['context_restAdvantage'] = fv.context.restAdvantage;
  flat['context_fixtureCongestion'] = fv.context.fixtureCongestion;
  flat['context_alignmentScore'] = fv.context.alignmentScore;
  // Encode motivation types as numeric
  flat['context_homeMotivation_enc'] = encodeMotivation(fv.context.homeMotivation);
  flat['context_awayMotivation_enc'] = encodeMotivation(fv.context.awayMotivation);

  // 7. Volatility features (7 keys + encoded tier)
  flat['volatility_homeFormVariance'] = fv.volatility.homeFormVariance;
  flat['volatility_awayFormVariance'] = fv.volatility.awayFormVariance;
  flat['volatility_homeUpsetRisk'] = fv.volatility.homeUpsetRisk;
  flat['volatility_awayUpsetRisk'] = fv.volatility.awayUpsetRisk;
  flat['volatility_dataCompleteness'] = fv.volatility.dataCompleteness;
  flat['volatility_matchChaos'] = fv.volatility.matchChaos;
  flat['volatility_volatilityScore'] = fv.volatility.volatilityScore;
  flat['volatility_enrichmentTier_enc'] = encodeEnrichmentTier(fv.volatility.enrichmentTier);

  // 8. Market features (10 keys)
  flat['market_impliedHomeWin'] = fv.market.impliedHomeWin;
  flat['market_impliedDraw'] = fv.market.impliedDraw;
  flat['market_impliedAwayWin'] = fv.market.impliedAwayWin;
  flat['market_impliedOver25'] = fv.market.impliedOver25;
  flat['market_impliedUnder25'] = fv.market.impliedUnder25;
  flat['market_impliedBttsYes'] = fv.market.impliedBttsYes;
  flat['market_impliedBttsNo'] = fv.market.impliedBttsNo;
  flat['market_hasOdds'] = fv.market.hasOdds ? 1 : 0;
  flat['market_oddsConfidence'] = fv.market.oddsConfidence;
  flat['market_bookmakerMargin'] = fv.market.bookmakerMargin;

  // 9. BSD intelligence features (8 numeric keys)
  flat['bsdIntel_homeXgTable'] = fv.bsdIntel.homeXgTable ?? 0;
  flat['bsdIntel_awayXgTable'] = fv.bsdIntel.awayXgTable ?? 0;
  flat['bsdIntel_homeManagerOverBias'] = fv.bsdIntel.homeManagerOverBias;
  flat['bsdIntel_awayManagerOverBias'] = fv.bsdIntel.awayManagerOverBias;
  flat['bsdIntel_playerImpactGap'] = fv.bsdIntel.playerImpactGap;
  flat['bsdIntel_playerRatingGap'] = fv.bsdIntel.playerRatingGap;
  flat['bsdIntel_hasManagerData'] = fv.bsdIntel.hasManagerData ? 1 : 0;
  flat['bsdIntel_hasPlayerData'] = fv.bsdIntel.hasPlayerData ? 1 : 0;

  // 10. Injury features (6 keys)
  flat['injury_homeKeyMissingCount'] = fv.injury.homeKeyMissingCount;
  flat['injury_awayKeyMissingCount'] = fv.injury.awayKeyMissingCount;
  flat['injury_homeXgImpact'] = fv.injury.homeXgImpact;
  flat['injury_awayXgImpact'] = fv.injury.awayXgImpact;
  flat['injury_homeSquadDepth'] = fv.injury.homeSquadDepth;
  flat['injury_awaySquadDepth'] = fv.injury.awaySquadDepth;

  // 11. Lineup features (7 numeric keys)
  flat['lineup_homePredictedStrength'] = fv.lineup.homePredictedStrength;
  flat['lineup_awayPredictedStrength'] = fv.lineup.awayPredictedStrength;
  flat['lineup_homeAttackerCount'] = fv.lineup.homeAttackerCount;
  flat['lineup_awayAttackerCount'] = fv.lineup.awayAttackerCount;
  flat['lineup_hasLineupData'] = fv.lineup.hasLineupData ? 1 : 0;
  flat['lineup_lineupConfidence'] = fv.lineup.lineupConfidence;
  flat['lineup_homeFormation_enc'] = encodeFormation(fv.lineup.homeFormation);
  flat['lineup_awayFormation_enc'] = encodeFormation(fv.lineup.awayFormation);

  // 12. Profile features (13 numeric keys)
  flat['profile_homePossession'] = fv.profile.homePossession;
  flat['profile_awayPossession'] = fv.profile.awayPossession;
  flat['profile_homeShotsPerGame'] = fv.profile.homeShotsPerGame;
  flat['profile_awayShotsPerGame'] = fv.profile.awayShotsPerGame;
  flat['profile_homeShotsOnTargetPerGame'] = fv.profile.homeShotsOnTargetPerGame;
  flat['profile_awayShotsOnTargetPerGame'] = fv.profile.awayShotsOnTargetPerGame;
  flat['profile_homeCornersPerGame'] = fv.profile.homeCornersPerGame;
  flat['profile_awayCornersPerGame'] = fv.profile.awayCornersPerGame;
  flat['profile_homeFoulsPerGame'] = fv.profile.homeFoulsPerGame;
  flat['profile_awayFoulsPerGame'] = fv.profile.awayFoulsPerGame;
  flat['profile_styleClash'] = fv.profile.styleClash;
  flat['profile_homeStyle_enc'] = encodeStyle(fv.profile.homeStyle);
  flat['profile_awayStyle_enc'] = encodeStyle(fv.profile.awayStyle);

  return flat;
}

// ============================================================================
// Encoding Helpers for Flatten
// ============================================================================

function encodeMotivation(m: MotivationType): number {
  const map: Record<MotivationType, number> = {
    title_race: 1.0,
    champions_league: 0.85,
    europa: 0.70,
    midtable: 0.40,
    relegation: 0.90,
    promoted: 0.50,
    friendly: 0.20,
    unknown: 0.40,
  };
  return map[m] ?? 0.4;
}

function encodeEnrichmentTier(tier: 'rich' | 'good' | 'partial' | 'thin'): number {
  const map = { rich: 1.0, good: 0.75, partial: 0.45, thin: 0.15 };
  return map[tier] ?? 0.15;
}

function encodeFormation(formation: string | null): number {
  if (!formation) return 0;
  // Encode common formations as numeric
  const map: Record<string, number> = {
    '4-3-3': 0.80, '4-4-2': 0.60, '4-2-3-1': 0.70, '3-5-2': 0.55,
    '3-4-3': 0.75, '4-1-4-1': 0.50, '5-3-2': 0.40, '5-4-1': 0.30,
    '4-5-1': 0.45, '4-3-2-1': 0.55, '4-4-1-1': 0.50, '3-4-1-2': 0.50,
  };
  return map[formation] ?? 0.5;
}

function encodeStyle(style: string): number {
  const map: Record<string, number> = {
    attacking: 0.85, gung_ho: 0.95, balanced: 0.50, pragmatic: 0.35,
    conservative: 0.20, defensive: 0.15, counter_attacking: 0.40,
    possession: 0.55, high_press: 0.75, low_block: 0.15,
  };
  return map[style.toLowerCase().replace(/[\s-]/g, '_')] ?? 0.5;
}
