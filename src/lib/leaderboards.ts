/**
 * All-Time Leaderboards — pure aggregation + ranking module.
 *
 * NO Supabase, NO globals, NO current-scoring imports. Server functions
 * gather per-season identity contributions and call
 * `aggregateSeasonContributions()` here. UI selects a category and calls
 * `buildLeaderboard()`. Every eligibility threshold, sort direction, and
 * tie-breaker lives here so tests can exercise it deterministically.
 *
 * IDENTITY MODEL
 *   - `identityKey` is the sole dedup key. Callers use `person:<uuid>` for
 *     linked identities and `unlinked:<seasonId>:<participantRef>` for
 *     unlinked historical (or unlinked current) participants. Never merge
 *     by display name.
 *
 * ELIGIBILITY
 *   - Scratch Average / Career POA require >= 9 personal games.
 *   - Frame-rate categories require >= 90 full-linescore frames.
 *   - Clutch % requires >= 20 clutch opportunities.
 *   - Ratings use the existing rating-quality rules the caller applies
 *     when it builds season rating contributions (>=3 actual games per
 *     season). Career rating cells stay non-null only when a career
 *     aggregate exists AND aggregate actual/opponent games >= 9.
 *
 * SORTING
 *   1) primary metric (direction per category)
 *   2) larger eligible sample (asc for "lower-is-better", desc otherwise)
 *   3) display name alphabetical (case-insensitive, en locale)
 *   Competition ranking; every row tied at rank 10 is included.
 *   Missing values are excluded, never converted to zero.
 */

import { computeCareerRatings, type CareerSeasonContribution } from "./ratings";
import { HIGH_GAME_MILESTONE, HIGH_SET_MILESTONE } from "./leaderboard-milestone";

// ---------------------------------------------------------------------------
// Identity + input contribution shape
// ---------------------------------------------------------------------------

/** Route kinds for public leaderboard rows. `Person` links to permanent
 *  career profile; the other three name the correct unlinked seasonal
 *  profile (current-season roster/sub or archived historical). */
export const LeaderboardIdentityKind = {
  Person: "person",
  CurrentRoster: "current-roster",
  CurrentSub: "current-sub",
  Historical: "historical",
} as const;
export type LeaderboardIdentityKind =
  (typeof LeaderboardIdentityKind)[keyof typeof LeaderboardIdentityKind];

export interface LeaderboardIdentity {
  key: string;                    // dedup key; see IDENTITY MODEL above
  displayName: string;
  personId: string | null;
  unlinkedSeasonId: string | null;
  unlinkedParticipantRef: string | null;
  /** Explicit route kind. Optional for back-compat; defaults to Historical
   *  when unlinked and Person when personId is present. */
  hrefKind?: LeaderboardIdentityKind;
}

/**
 * Provenance of a specific High Game / High Set performance. Attached only
 * to High Game and High Set entries on the All-Time Leaderboards.
 *
 * `week` is null for older summary-only historical data where the exact
 * week is not documented — UI renders "Week unavailable". `seasonSortYear`
 * is the four-digit year (or null) used for the deterministic
 * "earliest documented occurrence" tie-break when the same value was
 * achieved multiple times: lower year wins, then lower week; null week and
 * null year sort AFTER known values so a documented week always beats an
 * undocumented one on tie.
 */
export interface HighScoreProvenance {
  seasonId: string;
  seasonLabel: string;
  seasonSortYear: number | null;
  week: number | null;
  value: number;
}

/** True when `a` is the earlier documented occurrence at the same value.
 *  Undefined `a` means "no incumbent yet", so `b` wins. */
export function pickEarlierProvenance(
  a: HighScoreProvenance | null | undefined,
  b: HighScoreProvenance,
): HighScoreProvenance {
  if (!a) return b;
  // year: null sorts LAST
  const ay = a.seasonSortYear ?? Number.POSITIVE_INFINITY;
  const by = b.seasonSortYear ?? Number.POSITIVE_INFINITY;
  if (ay !== by) return ay < by ? a : b;
  const aw = a.week ?? Number.POSITIVE_INFINITY;
  const bw = b.week ?? Number.POSITIVE_INFINITY;
  if (aw !== bw) return aw < bw ? a : b;
  // Deterministic final tie-break so the choice is stable across runs.
  return a.seasonId <= b.seasonId ? a : b;
}

/** A per-season contribution for a single identity. Missing measurements
 *  MUST be `null` (never 0). */
export interface SeasonContribution {
  identityKey: string;
  identity: LeaderboardIdentity;

  championship: boolean;

  // Personal record
  gameWins: number;
  setWins: number;
  // Overall roster-credit points won (rostered only; substitute rows: 0)
  overallWins: number;

  // Scoring — personal
  games: number;
  scratchPinfall: number;
  highGame: number | null;
  highSet: number | null;
  /** Provenance for the exact High Game / High Set performance credited
   *  above. Present whenever `highGame`/`highSet` is set. */
  highGameProvenance?: HighScoreProvenance | null;
  highSetProvenance?: HighScoreProvenance | null;
  poaSum: number | null;    // sum(gameScore - entryAvg) across ALL personal games
  poaGames: number | null;  // sample for POA

  // Frame stats — FULL_LINESCORE ONLY
  strikes: number | null;
  spares: number | null;
  opens: number | null;
  framesRolled: number | null;
  openPinsLeft: number | null;
  clutchMarks: number | null;
  clutchOpportunities: number | null;

  // Season ratings (already computed against that season's environment).
  offense: number | null;
  defense: number | null;
  actualRatingGames: number;    // sample for offense per season
  opponentRatingGames: number;  // sample for defense per season
  fullLinescoreGames: number;   // for career quality
}

// ---------------------------------------------------------------------------
// Aggregated career row
// ---------------------------------------------------------------------------

export interface AllTimeRow {
  identity: LeaderboardIdentity;
  championships: number;
  gameWins: number;
  setWins: number;
  overallWins: number;

  games: number;
  scratchPinfall: number;
  scratchAverage: number | null;
  highGame: number | null;
  highSet: number | null;
  /** Provenance of the career-best High Game / High Set. Selected as the
   *  earliest documented occurrence across all contributing seasons. */
  highGameProvenance: HighScoreProvenance | null;
  highSetProvenance: HighScoreProvenance | null;
  poaSum: number;
  poaGames: number;
  careerPOA: number | null;

  strikes: number;
  spares: number;
  opens: number;
  marks: number;
  framesRolled: number;
  openPinsLeft: number;
  markPct: number | null;
  spareConversionPct: number | null;
  openPct: number | null;
  pinsLostPerGame: number | null;
  clutchMarks: number;
  clutchOpportunities: number;
  clutchPct: number | null;

  offense: number | null;
  defense: number | null;
  twoWay: number | null;
  actualRatingGames: number;
  opponentRatingGames: number;
  fullLinescoreGames: number;
}

function addN(cur: number, v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return cur;
  return cur + v;
}

/** Aggregate per-season contributions into one career row per identity. */
export function aggregateSeasonContributions(
  contribs: readonly SeasonContribution[],
): AllTimeRow[] {
  interface Acc {
    identity: LeaderboardIdentity;
    championships: number;
    gameWins: number; setWins: number; overallWins: number;
    games: number; scratchPinfall: number;
    highGame: number | null; highSet: number | null;
    highGameProv: HighScoreProvenance | null;
    highSetProv: HighScoreProvenance | null;
    poaSum: number; poaGames: number;
    strikes: number; spares: number; opens: number;
    framesRolled: number; openPinsLeft: number;
    clutchMarks: number; clutchOpportunities: number;
    offense: number | null; defense: number | null; twoWay: number | null;
    actualRatingGames: number; opponentRatingGames: number;
    fullLinescoreGames: number;
  }
  const map = new Map<string, Acc>();
  // One CareerSeasonContribution per per-season row, grouped by identity.
  // Rating aggregation is delegated to `computeCareerRatings` so the
  // all-time leaderboard cannot diverge from permanent career profiles.
  const ratingContribsByKey = new Map<string, CareerSeasonContribution[]>();
  for (const c of contribs) {
    let a = map.get(c.identityKey);
    if (!a) {
      a = {
        identity: c.identity,
        championships: 0,
        gameWins: 0, setWins: 0, overallWins: 0,
        games: 0, scratchPinfall: 0,
        highGame: null, highSet: null,
        highGameProv: null, highSetProv: null,
        poaSum: 0, poaGames: 0,
        strikes: 0, spares: 0, opens: 0,
        framesRolled: 0, openPinsLeft: 0,
        clutchMarks: 0, clutchOpportunities: 0,
        offense: null, defense: null, twoWay: null,
        actualRatingGames: 0, opponentRatingGames: 0, fullLinescoreGames: 0,
      };
      map.set(c.identityKey, a);
    }
    if (c.championship) a.championships += 1;
    a.gameWins += c.gameWins;
    a.setWins += c.setWins;
    a.overallWins += c.overallWins;
    a.games += c.games;
    a.scratchPinfall += c.scratchPinfall;
    if (c.highGame != null) {
      if (a.highGame == null || c.highGame > a.highGame) {
        a.highGame = c.highGame;
        a.highGameProv = c.highGameProvenance ?? null;
      } else if (c.highGame === a.highGame && c.highGameProvenance) {
        a.highGameProv = pickEarlierProvenance(a.highGameProv, c.highGameProvenance);
      }
    }
    if (c.highSet != null) {
      if (a.highSet == null || c.highSet > a.highSet) {
        a.highSet = c.highSet;
        a.highSetProv = c.highSetProvenance ?? null;
      } else if (c.highSet === a.highSet && c.highSetProvenance) {
        a.highSetProv = pickEarlierProvenance(a.highSetProv, c.highSetProvenance);
      }
    }
    if (c.poaSum != null && c.poaGames != null) {
      a.poaSum += c.poaSum; a.poaGames += c.poaGames;
    }
    a.strikes = addN(a.strikes, c.strikes);
    a.spares = addN(a.spares, c.spares);
    a.opens = addN(a.opens, c.opens);
    a.framesRolled = addN(a.framesRolled, c.framesRolled);
    a.openPinsLeft = addN(a.openPinsLeft, c.openPinsLeft);
    a.clutchMarks = addN(a.clutchMarks, c.clutchMarks);
    a.clutchOpportunities = addN(a.clutchOpportunities, c.clutchOpportunities);
    const arr = ratingContribsByKey.get(c.identityKey) ?? [];
    arr.push({
      seasonId: "",
      offense: c.offense,
      defense: c.defense,
      actualGames: c.actualRatingGames,
      opponentGames: c.opponentRatingGames,
      fullLinescoreGames: c.fullLinescoreGames,
    });
    ratingContribsByKey.set(c.identityKey, arr);
  }
  for (const [key, entries] of ratingContribsByKey.entries()) {
    const a = map.get(key);
    if (!a) continue;
    const cr = computeCareerRatings(key, entries);
    a.offense = cr.offensiveRating;
    a.defense = cr.matchupDefense;
    a.twoWay = cr.twoWayRating;
    a.actualRatingGames = cr.totals.actualGames;
    a.opponentRatingGames = cr.totals.opponentGames;
    a.fullLinescoreGames = cr.totals.fullLinescoreGames;
  }
  const out: AllTimeRow[] = [];
  for (const a of map.values()) {
    const marks = a.strikes + a.spares;
    const spareOpp = a.spares + a.opens;
    out.push({
      identity: a.identity,
      championships: a.championships,
      gameWins: a.gameWins,
      setWins: a.setWins,
      overallWins: a.overallWins,
      games: a.games,
      scratchPinfall: a.scratchPinfall,
      scratchAverage: a.games > 0 ? Number((a.scratchPinfall / a.games).toFixed(3)) : null,
      highGame: a.highGame,
      highSet: a.highSet,
      highGameProvenance: a.highGame != null ? a.highGameProv : null,
      highSetProvenance: a.highSet != null ? a.highSetProv : null,
      poaSum: a.poaSum,
      poaGames: a.poaGames,
      careerPOA: a.poaGames > 0 ? Number((a.poaSum / a.poaGames).toFixed(3)) : null,
      strikes: a.strikes,
      spares: a.spares,
      opens: a.opens,
      marks,
      framesRolled: a.framesRolled,
      openPinsLeft: a.openPinsLeft,
      markPct: a.framesRolled > 0 ? (marks / a.framesRolled) * 100 : null,
      spareConversionPct: spareOpp > 0 ? (a.spares / spareOpp) * 100 : null,
      openPct: a.framesRolled > 0 ? (a.opens / a.framesRolled) * 100 : null,
      pinsLostPerGame: a.framesRolled > 0 ? a.openPinsLeft / (a.framesRolled / 10) : null,
      clutchMarks: a.clutchMarks,
      clutchOpportunities: a.clutchOpportunities,
      clutchPct: a.clutchOpportunities > 0 ? (a.clutchMarks / a.clutchOpportunities) * 100 : null,
      offense: a.offense,
      defense: a.defense,
      twoWay: a.twoWay,
      actualRatingGames: a.actualRatingGames,
      opponentRatingGames: a.opponentRatingGames,
      fullLinescoreGames: a.fullLinescoreGames,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Category catalogue
// ---------------------------------------------------------------------------

export type LeaderboardGroup = "records" | "scoring" | "frame" | "ratings";
export type LeaderboardCategoryId =
  | "championships" | "gameWins" | "setWins" | "overallWins"
  | "games" | "scratchPinfall" | "scratchAverage" | "highGame" | "highSet" | "careerPOA"
  | "strikes" | "spares" | "marks" | "markPct" | "spareConversionPct"
  | "openPct" | "pinsLostPerGame" | "clutchPct"
  | "offense" | "defense" | "twoWay";

export interface CategoryDef {
  id: LeaderboardCategoryId;
  group: LeaderboardGroup;
  label: string;
  primaryLabel: string;
  secondaryLabel: string;
  /** Sort direction on the primary value. */
  direction: "desc" | "asc";
  /** Extract the primary value or `null` when the row is not eligible. */
  primary: (r: AllTimeRow) => number | null;
  /** Sample used for tie-break AND to display alongside the value. */
  sample: (r: AllTimeRow) => number;
  /** Additional eligibility gate beyond `primary != null`. */
  eligible: (r: AllTimeRow) => boolean;
  /** Formatter for display. */
  format: (v: number) => string;
  /** Sample formatter. */
  formatSample: (v: number) => string;
  /**
   * When set, every row whose primary value meets/exceeds this threshold
   * is always included, even when it falls outside the normal top-N cap.
   * Used for duckpin milestones (High Game >=200, High Set >=500).
   */
  milestoneThreshold?: number;
  /** Optional provenance extractor used ONLY for High Game / High Set. */
  provenanceOf?: (r: AllTimeRow) => HighScoreProvenance | null | undefined;
}

const int = (v: number) => v.toLocaleString();
const dec1 = (v: number) => v.toFixed(1);
const dec3 = (v: number) => v.toFixed(3);
const pct = (v: number) => `${v.toFixed(1)}%`;
const poaFmt = (v: number) => {
  const r = Number(v.toFixed(2));
  if (r === 0) return "0.00";
  const sign = r > 0 ? "+" : "-";
  return `${sign}${Math.abs(r).toFixed(2)}`;
};

const MIN_GAMES_AVG_POA = 9;
const MIN_FRAMES_RATES = 90;
const MIN_CLUTCH_OPP = 20;
const MIN_RATING_GAMES = 9;

export const LEADERBOARD_CATEGORIES: CategoryDef[] = [
  // ----- Records
  {
    id: "championships", group: "records", label: "Championships",
    primaryLabel: "Titles", secondaryLabel: "Seasons",
    direction: "desc",
    primary: (r) => (r.championships > 0 ? r.championships : null),
    sample: (r) => r.championships,
    eligible: (r) => r.championships > 0,
    format: int, formatSample: int,
  },
  {
    id: "gameWins", group: "records", label: "Game Wins",
    primaryLabel: "Games W", secondaryLabel: "Games",
    direction: "desc",
    primary: (r) => (r.games > 0 ? r.gameWins : null),
    sample: (r) => r.games,
    eligible: (r) => r.games > 0,
    format: int, formatSample: int,
  },
  {
    id: "setWins", group: "records", label: "Set Wins",
    primaryLabel: "Sets W", secondaryLabel: "Games",
    direction: "desc",
    primary: (r) => (r.games > 0 ? r.setWins : null),
    sample: (r) => r.games,
    eligible: (r) => r.games > 0,
    format: int, formatSample: int,
  },
  {
    id: "overallWins", group: "records", label: "Overall Wins",
    primaryLabel: "Points W", secondaryLabel: "Games",
    direction: "desc",
    primary: (r) => (r.games > 0 || r.overallWins > 0 ? r.overallWins : null),
    sample: (r) => r.games,
    eligible: (r) => r.games > 0 || r.overallWins > 0,
    format: (v) => (Number.isInteger(v) ? int(v) : v.toFixed(1)),
    formatSample: int,
  },
  // ----- Scoring
  {
    id: "games", group: "scoring", label: "Games Bowled",
    primaryLabel: "Games", secondaryLabel: "Pinfall",
    direction: "desc",
    primary: (r) => (r.games > 0 ? r.games : null),
    sample: (r) => r.scratchPinfall,
    eligible: (r) => r.games > 0,
    format: int, formatSample: int,
  },
  {
    id: "scratchPinfall", group: "scoring", label: "Scratch Pinfall",
    primaryLabel: "Pinfall", secondaryLabel: "Games",
    direction: "desc",
    primary: (r) => (r.games > 0 ? r.scratchPinfall : null),
    sample: (r) => r.games,
    eligible: (r) => r.games > 0,
    format: int, formatSample: int,
  },
  {
    id: "scratchAverage", group: "scoring", label: "Scratch Average",
    primaryLabel: "Average", secondaryLabel: "Games",
    direction: "desc",
    primary: (r) => (r.games >= MIN_GAMES_AVG_POA ? r.scratchAverage : null),
    sample: (r) => r.games,
    eligible: (r) => r.games >= MIN_GAMES_AVG_POA && r.scratchAverage != null,
    format: dec3, formatSample: int,
  },
  {
    id: "highGame", group: "scoring", label: "High Game",
    primaryLabel: "Best G", secondaryLabel: "Games",
    direction: "desc",
    primary: (r) => r.highGame,
    sample: (r) => r.games,
    eligible: (r) => r.highGame != null,
    format: int, formatSample: int,
    milestoneThreshold: HIGH_GAME_MILESTONE,
    provenanceOf: (r) => r.highGameProvenance,
  },
  {
    id: "highSet", group: "scoring", label: "High Set",
    primaryLabel: "Best S", secondaryLabel: "Games",
    direction: "desc",
    primary: (r) => r.highSet,
    sample: (r) => r.games,
    eligible: (r) => r.highSet != null,
    format: int, formatSample: int,
    milestoneThreshold: HIGH_SET_MILESTONE,
    provenanceOf: (r) => r.highSetProvenance,
  },
  {
    id: "careerPOA", group: "scoring", label: "Career POA",
    primaryLabel: "POA / G", secondaryLabel: "Games",
    direction: "desc",
    primary: (r) => (r.poaGames >= MIN_GAMES_AVG_POA ? r.careerPOA : null),
    sample: (r) => r.poaGames,
    eligible: (r) => r.poaGames >= MIN_GAMES_AVG_POA && r.careerPOA != null,
    format: poaFmt, formatSample: int,
  },
  // ----- Frame stats
  {
    id: "strikes", group: "frame", label: "Strikes",
    primaryLabel: "Strikes", secondaryLabel: "Frames",
    direction: "desc",
    primary: (r) => (r.framesRolled > 0 ? r.strikes : null),
    sample: (r) => r.framesRolled,
    eligible: (r) => r.framesRolled > 0,
    format: int, formatSample: int,
  },
  {
    id: "spares", group: "frame", label: "Spares",
    primaryLabel: "Spares", secondaryLabel: "Frames",
    direction: "desc",
    primary: (r) => (r.framesRolled > 0 ? r.spares : null),
    sample: (r) => r.framesRolled,
    eligible: (r) => r.framesRolled > 0,
    format: int, formatSample: int,
  },
  {
    id: "marks", group: "frame", label: "Total Marks",
    primaryLabel: "Marks", secondaryLabel: "Frames",
    direction: "desc",
    primary: (r) => (r.framesRolled > 0 ? r.marks : null),
    sample: (r) => r.framesRolled,
    eligible: (r) => r.framesRolled > 0,
    format: int, formatSample: int,
  },
  {
    id: "markPct", group: "frame", label: "Mark %",
    primaryLabel: "Mark %", secondaryLabel: "Frames",
    direction: "desc",
    primary: (r) => (r.framesRolled >= MIN_FRAMES_RATES ? r.markPct : null),
    sample: (r) => r.framesRolled,
    eligible: (r) => r.framesRolled >= MIN_FRAMES_RATES && r.markPct != null,
    format: pct, formatSample: int,
  },
  {
    id: "spareConversionPct", group: "frame", label: "Spare Conversion %",
    primaryLabel: "Spare Conv %", secondaryLabel: "Frames",
    direction: "desc",
    primary: (r) => (r.framesRolled >= MIN_FRAMES_RATES ? r.spareConversionPct : null),
    sample: (r) => r.framesRolled,
    eligible: (r) => r.framesRolled >= MIN_FRAMES_RATES && r.spareConversionPct != null,
    format: pct, formatSample: int,
  },
  {
    id: "openPct", group: "frame", label: "Open % (lower better)",
    primaryLabel: "Open %", secondaryLabel: "Frames",
    direction: "asc",
    primary: (r) => (r.framesRolled >= MIN_FRAMES_RATES ? r.openPct : null),
    sample: (r) => r.framesRolled,
    eligible: (r) => r.framesRolled >= MIN_FRAMES_RATES && r.openPct != null,
    format: pct, formatSample: int,
  },
  {
    id: "pinsLostPerGame", group: "frame", label: "Pins Lost / Game (lower better)",
    primaryLabel: "PL / G", secondaryLabel: "Frames",
    direction: "asc",
    primary: (r) => (r.framesRolled >= MIN_FRAMES_RATES ? r.pinsLostPerGame : null),
    sample: (r) => r.framesRolled,
    eligible: (r) => r.framesRolled >= MIN_FRAMES_RATES && r.pinsLostPerGame != null,
    format: dec1, formatSample: int,
  },
  {
    id: "clutchPct", group: "frame", label: "Clutch %",
    primaryLabel: "Clutch %", secondaryLabel: "Opps",
    direction: "desc",
    primary: (r) => (r.clutchOpportunities >= MIN_CLUTCH_OPP ? r.clutchPct : null),
    sample: (r) => r.clutchOpportunities,
    eligible: (r) => r.clutchOpportunities >= MIN_CLUTCH_OPP && r.clutchPct != null,
    format: pct, formatSample: int,
  },
  // ----- Ratings
  {
    id: "offense", group: "ratings", label: "Offensive Rating",
    primaryLabel: "Offense", secondaryLabel: "Games",
    direction: "desc",
    primary: (r) => (r.actualRatingGames >= MIN_RATING_GAMES ? r.offense : null),
    sample: (r) => r.actualRatingGames,
    eligible: (r) => r.actualRatingGames >= MIN_RATING_GAMES && r.offense != null,
    format: dec1, formatSample: int,
  },
  {
    id: "defense", group: "ratings", label: "Matchup Defense",
    primaryLabel: "Defense", secondaryLabel: "Opp Games",
    direction: "desc",
    primary: (r) => (r.opponentRatingGames >= MIN_RATING_GAMES ? r.defense : null),
    sample: (r) => r.opponentRatingGames,
    eligible: (r) => r.opponentRatingGames >= MIN_RATING_GAMES && r.defense != null,
    format: dec1, formatSample: int,
  },
  {
    id: "twoWay", group: "ratings", label: "Two-Way Rating",
    primaryLabel: "Two-Way", secondaryLabel: "Games",
    direction: "desc",
    primary: (r) =>
      (r.actualRatingGames >= MIN_RATING_GAMES && r.opponentRatingGames >= MIN_RATING_GAMES)
        ? r.twoWay : null,
    sample: (r) => Math.min(r.actualRatingGames, r.opponentRatingGames),
    eligible: (r) =>
      r.actualRatingGames >= MIN_RATING_GAMES &&
      r.opponentRatingGames >= MIN_RATING_GAMES && r.twoWay != null,
    format: dec1, formatSample: int,
  },
];

export function findCategory(id: LeaderboardCategoryId): CategoryDef {
  const c = LEADERBOARD_CATEGORIES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown leaderboard category ${id}`);
  return c;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  rank: number;
  identity: LeaderboardIdentity;
  primary: number;
  primaryDisplay: string;
  sample: number;
  sampleDisplay: string;
  /** Present only on High Game / High Set entries. */
  provenance?: HighScoreProvenance | null;
}

export interface LeaderboardResult {
  category: CategoryDef;
  entries: LeaderboardEntry[];
}

/** Compare display names in a stable, locale-aware way. */
function nameCmp(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

export function buildLeaderboard(
  rows: readonly AllTimeRow[],
  categoryId: LeaderboardCategoryId,
  limit = 10,
): LeaderboardResult {
  const cat = findCategory(categoryId);
  interface Ranked {
    id: LeaderboardIdentity;
    v: number;
    sample: number;
    provenance?: HighScoreProvenance | null;
  }
  const eligible: Ranked[] = [];
  for (const r of rows) {
    if (!cat.eligible(r)) continue;
    const v = cat.primary(r);
    if (v == null) continue;
    eligible.push({
      id: r.identity, v, sample: cat.sample(r),
      provenance: cat.provenanceOf ? cat.provenanceOf(r) ?? null : undefined,
    });
  }
  eligible.sort((a, b) => {
    if (a.v !== b.v) return cat.direction === "desc" ? b.v - a.v : a.v - b.v;
    // Larger eligible sample second (always).
    if (a.sample !== b.sample) return b.sample - a.sample;
    return nameCmp(a.id.displayName, b.id.displayName);
  });

  // Competition ranking on the PRIMARY metric only. Rows with equal
  // primary values share the same rank even when their samples differ
  // (sample is a within-rank sort tiebreaker, not part of the rank key).
  const entries: LeaderboardEntry[] = [];
  let rank = 0;
  let prevV: number | null = null;
  for (let i = 0; i < eligible.length; i++) {
    const cur = eligible[i];
    if (prevV === null || cur.v !== prevV) rank = i + 1;
    prevV = cur.v;
    if (rank > limit) {
      // Milestone override: keep including qualifying rows past the cap.
      // Eligible is sorted desc by primary, so once we drop below the
      // threshold we can stop.
      if (cat.milestoneThreshold == null) break;
      if (cat.direction !== "desc") break;
      if (cur.v < cat.milestoneThreshold) break;
    }
    entries.push({
      rank,
      identity: cur.id,
      primary: cur.v,
      primaryDisplay: cat.format(cur.v),
      sample: cur.sample,
      sampleDisplay: cat.formatSample(cur.sample),
      provenance: cur.provenance,
    });
  }
  return { category: cat, entries };
}
