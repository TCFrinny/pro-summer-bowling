/**
 * Pro Summer Singles — Phase 1 data model.
 *
 * This file owns:
 *   - Types shared across UI, admin, and the league store.
 *   - Pure seed generators (roster, subs, schedule, seeded historical results).
 *   - The single pure aggregation function `buildSnapshot(db)` that derives
 *     every public projection from the raw database. Public route reads MUST
 *     go through `league-store.getLeagueState().snapshot` — this file never
 *     holds mutable module-level state.
 *
 * Scoring (unchanged 7-point duckpin singles):
 *   3 games/match. Per game: 2 pts to higher HANDICAP game score (1/1 on tie).
 *   +1 pt to higher 3-game HANDICAP set total (0.5/0.5 on tie). Every fully
 *   bowled match distributes exactly 7 points. Handicap = floor(0.80 * (160 -
 *   entry average)), min 0. Season = 11 weeks. Standings: points DESC, then
 *   handicap pinfall DESC.
 *
 * Linescore notation: exact result+cumulative only. Frames 1-9 mark ∈ {X, /,
 * -}. Frame 10 mark ∈ {XXX, XX, X/, /X, X, /, -}. Cumulative totals carry the
 * pin information; no ball-level data is ever stored.
 */

import {
  rollMockGame,
  stdev,
  summarizeGame,
  validateGame,
  type FrameLinescore,
  type GameLinescore,
  type GameSegments,
} from "./duckpin";
import { computeEliminationBounds } from "./elimination-bounds";
import {
  aggregateStandingsTotals,
  findLatestResultWeek,
  rankByStandings,
} from "./standings-rank";
import {
  buildSubstituteData,
  type SubstituteIdentity,
  type SubstituteProfile,
} from "./substitute-profiles";
import {
  HIGH_GAME_MILESTONE,
  HIGH_SET_MILESTONE,
  mergeMilestoneRows,
} from "./leaderboard-milestone";

export type {
  SubstituteIdentity,
  SubstituteProfile,
  SubstituteWeekRow,
} from "./substitute-profiles";

export {
  classifyFrame,
  isValidRegulationMark,
  isValidTenthMark,
  summarizeGame,
  type FrameLinescore,
  type GameLinescore,
  type GameSegments,
} from "./duckpin";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LEAGUE_NAME = "Pro Summer Singles";
export const VENUE_NAME = "Mt. Airy Lanes";
export const SEASON_LABEL = "2026 Summer";
export const TOTAL_WEEKS = 11;
export const SEEDED_COMPLETED_WEEKS = 7;

export const LANE_PAIRS = [
  "1-2", "3-4", "5-6", "7-8", "9-10", "11-12",
] as const;
export type LanePair = (typeof LANE_PAIRS)[number];

/** Handicap formula: floor(0.80 * (160 - entry)), minimum 0. */
export function computeHandicap(entryAverage: number): number {
  return Math.max(0, Math.floor(0.8 * (160 - entryAverage)));
}

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type BowlerId = string;

export interface Bowler {
  id: BowlerId;
  name: string;
  entryAverage: number;
  handicap: number;
  scratchAverage: number;
  points: number;
  pointsLost: number;
  gamePoints: number;
  setPoints: number;
  scratchPinfall: number;
  handicapPinfall: number;
  highGame: number;
  highSet: number;
  matchesPlayed: number;
  gamesPlayed: number;
  actualGamesRolled: number;
  actualScratchPinfall: number;
  movement: number;
  /** Optional permanent-person link. Present after the multi-season
   *  history migration is applied and the snapshot builder threads
   *  `person_id` from the rostered_bowlers row. Older saved snapshots
   *  MUST still parse and render — treat as undefined when missing. */
  personId?: string;
  /** Human-facing league ID Number (`bowler_number`) for the current season.
   *  Optional/nullable so older cached snapshots without this field still
   *  parse and render. NEVER the internal row id or the person UUID. */
  bowlerNumber?: string | null;
}

export type MatchStatus = "scheduled" | "completed";
export type ParticipationStatus = "rostered" | "substitute" | "absent";

export interface SideParticipation {
  scheduledId: BowlerId;
  status: ParticipationStatus;
  actualId: BowlerId | null;
  actualName: string;
  /** Three scratch game scores entered for an ABSENT side. When present
   *  they feed match handicap game/set totals and standings handicap
   *  pinfall using the SCHEDULED bowler's handicap. They MUST NOT flow
   *  into any personal statistic (average, games bowled, high game/set,
   *  linescore/mark metrics, advanced stats, lane scratch averages). */
  absentScores?: [number, number, number];
}

export interface PointsOverride {
  enabled: true;
  pointsA: number;
  pointsB: number;
  reason: string;
}

export interface Match {
  id: string;
  week: number;
  lanePair: LanePair;
  slot: number;
  status: MatchStatus;
  bowlerA: BowlerId;
  bowlerB: BowlerId;
  /** FROZEN scheduled bowler ID numbers at schedule-publish time.
   *  Displayed only on Schedule pages. Editing a bowler's ID number
   *  in Manage Bowlers changes future draft schedules, but a match
   *  already saved here keeps whatever was published with it. */
  bowlerNumberA?: string;
  bowlerNumberB?: string;
  result?: MatchResult;
}

/** Format a scheduled-bowler cell as "Name (ID 01234)". Used ONLY on
 *  Schedule and Admin Schedule Builder rows. Never used on standings,
 *  weekly results, profiles, statistics, leaderboards, lane data, or
 *  result-entry linescore headings. */
export function formatScheduleName(name: string, bowlerNumber?: string): string {
  if (!bowlerNumber) return name;
  return `${name} (ID ${bowlerNumber})`;
}

export type GameAward = 0 | 1 | 2;
export type SetAward = 0 | 0.5 | 1;

export interface MatchSegments {
  first5: number;
  last5: number;
  bigOpening: number;
  bigFinish: number;
  clutchMarks: number;
  clutchOpportunities: number;
}

export interface BowlerMatchLinescore {
  scheduledId: BowlerId;
  actualId: BowlerId | null;
  actualName: string;
  isSub: boolean;
  entryAverage: number;
  handicap: number;
  games: [GameLinescore, GameLinescore, GameLinescore];
  scratchSet: number;
  handicapGames: [number, number, number];
  handicapSet: number;
  strikes: number;
  spares: number;
  opens: number;
  marks: number;
  openPinsLeft: number;
  framesRolled: number;
  segments: MatchSegments;
}

export interface MatchResult {
  scheduledA: BowlerId;
  scheduledB: BowlerId;
  /** FROZEN scheduled bowler display names at result-save time.
   *  Roster renames must NOT rewrite completed history. Every completed
   *  result read (Weekly Results, history, leaderboards, lane data)
   *  reads these fields, never the current roster name. */
  scheduledNameA: string;
  scheduledNameB: string;
  actualA: BowlerId | null;
  actualB: BowlerId | null;
  actualNameA: string;
  actualNameB: string;
  isSubA: boolean;
  isSubB: boolean;
  subA?: string;
  subB?: string;
  participationA: SideParticipation;
  participationB: SideParticipation;
  /** Frozen scheduled entry avg / handicap at save time — used for POA,
   *  lane summaries, and handicap totals. */
  entryAverageA: number;
  entryAverageB: number;
  handicapA: number;
  handicapB: number;
  linescoreA: BowlerMatchLinescore | null;
  linescoreB: BowlerMatchLinescore | null;
  gamesA: [number, number, number];
  gamesB: [number, number, number];
  handicapGamesA: [number, number, number];
  handicapGamesB: [number, number, number];
  scratchTotalA: number;
  scratchTotalB: number;
  handicapTotalA: number;
  handicapTotalB: number;
  gameAwardsA: [GameAward, GameAward, GameAward];
  gameAwardsB: [GameAward, GameAward, GameAward];
  gamePointsA: number;
  gamePointsB: number;
  setPointA: SetAward;
  setPointB: SetAward;
  totalPointsA: number;
  totalPointsB: number;
  pointsOverride: PointsOverride | null;
  winner: "A" | "B" | "T";
  /** Final-week live score-only marker. When true, no frame linescores exist
   *  for this match; downstream aggregation MUST skip frame-derived stats
   *  (Mark %, Strike %, Pins Lost, First 5 / Last 5, Clutch, etc.) and MUST
   *  use `completedGameCount` + `pairCompleted` to gate credit. */
  scoreOnly?: boolean;
  /** 0..3, pairs where BOTH sides have entered a scratch score. Only present
   *  when `scoreOnly === true`. Full linescore rows treat this as 3. */
  completedGameCount?: 0 | 1 | 2 | 3;
  /** Per-game completion mask (indexed 0..2). Only present when scoreOnly. */
  pairCompleted?: [boolean, boolean, boolean];
}

export interface AwardedPoints {
  pointsA: number;
  pointsB: number;
  overridden: boolean;
  reason?: string;
}
export function getAwardedPoints(r: MatchResult): AwardedPoints {
  if (r.pointsOverride && r.pointsOverride.enabled) {
    return {
      pointsA: r.pointsOverride.pointsA,
      pointsB: r.pointsOverride.pointsB,
      overridden: true,
      reason: r.pointsOverride.reason,
    };
  }
  return { pointsA: r.totalPointsA, pointsB: r.totalPointsB, overridden: false };
}

function isHalfPointIncrement(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;
}
export function validatePointsOverride(
  o: PointsOverride,
): { ok: true } | { ok: false; error: string } {
  const { pointsA, pointsB, reason } = o;
  if (!isHalfPointIncrement(pointsA) || !isHalfPointIncrement(pointsB))
    return { ok: false, error: "Points must be in 0.5-point increments." };
  if (pointsA < 0 || pointsA > 7 || pointsB < 0 || pointsB > 7)
    return { ok: false, error: "Each side must be between 0 and 7." };
  if (pointsA + pointsB > 7 + 1e-9)
    return { ok: false, error: "Combined awarded points cannot exceed 7." };
  if (!reason || reason.trim().length === 0)
    return { ok: false, error: "A reason/note is required for overrides." };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Week metadata
// ---------------------------------------------------------------------------

export interface WeekSummary {
  week: number;
  date: string;
  completed: boolean;
  /** admin state for the schedule slots for this week. */
  published: boolean;
}

// ---------------------------------------------------------------------------
// Seed generators (deterministic; no module-level mutable state)
// ---------------------------------------------------------------------------

const FIRST = [
  "Alex", "Ben", "Carla", "Danny", "Eli", "Faith", "Grant", "Hank", "Ivy",
  "Jake", "Kara", "Leo", "Mia", "Nate", "Owen", "Paige", "Quinn", "Rita",
  "Sam", "Tori", "Ulises", "Vera", "Wes", "Xio", "Yara", "Zane", "Amos",
  "Bree", "Cody", "Dax", "Erin", "Finn", "Gwen", "Hugo", "Iris", "Jules",
];
const LAST = [
  "Alvarez", "Boone", "Chen", "Diaz", "Ellis", "Ford", "Gomez", "Hart",
  "Ito", "Jansen", "Kim", "Lopez", "Meyer", "Novak", "Ochoa", "Park",
  "Quinn", "Reyes", "Singh", "Tate", "Ueda", "Vega", "Ward", "Xu", "York",
  "Zamora", "Adair", "Bell", "Cruz", "Doyle", "Estes", "Fields", "Grimes",
  "Holt", "Ingle", "Jain",
];
export const SEED_SUB_NAMES = [
  "Rick M.", "Terry L.", "Alicia P.", "Marco V.", "Dee K.", "Ronnie F.",
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fresh copy of the seeded 36-bowler roster. All aggregate fields start at 0
 *  — `buildSnapshot` fills them in from linescores. */
export function seedBowlers(): Bowler[] {
  const rand = mulberry32(20260615);
  return FIRST.map((f, i) => {
    const entry = 110 + Math.floor(rand() * 55);
    return {
      id: `b${(i + 1).toString().padStart(2, "0")}`,
      name: `${f} ${LAST[i]}`,
      entryAverage: entry,
      handicap: computeHandicap(entry),
      scratchAverage: 0,
      points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
      scratchPinfall: 0, handicapPinfall: 0,
      highGame: 0, highSet: 0,
      matchesPlayed: 0, gamesPlayed: 0,
      actualGamesRolled: 0, actualScratchPinfall: 0,
      movement: Math.round((rand() - 0.5) * 6),
    };
  });
}

export function seedWeeks(): WeekSummary[] {
  return Array.from({ length: TOTAL_WEEKS }).map((_, i) => ({
    week: i + 1,
    date: new Date(2026, 5, 4 + i * 7).toISOString(),
    completed: i < SEEDED_COMPLETED_WEEKS,
    published: true,
  }));
}

function matchSegmentsOf(
  games: [GameLinescore, GameLinescore, GameLinescore],
): MatchSegments {
  const sum = (fn: (g: GameLinescore) => number) => games.reduce((s, g) => s + fn(g), 0);
  return {
    first5: sum((g) => g.segments.first5),
    last5: sum((g) => g.segments.last5),
    bigOpening: sum((g) => g.segments.bigOpening),
    bigFinish: sum((g) => g.segments.bigFinish),
    clutchMarks: sum((g) => g.segments.clutchMarks),
    clutchOpportunities: 6,
  };
}

/** Build a BowlerMatchLinescore from three GameLinescores + who rolled. */
export function assembleSideLinescore(input: {
  scheduled: Bowler;
  actualId: BowlerId | null;
  actualName: string;
  isSub: boolean;
  entryAverage: number;
  handicap: number;
  games: [GameLinescore, GameLinescore, GameLinescore];
}): BowlerMatchLinescore {
  const { scheduled, actualId, actualName, isSub, entryAverage, handicap, games } = input;
  const handicapGames: [number, number, number] = [
    games[0].scratchTotal + handicap,
    games[1].scratchTotal + handicap,
    games[2].scratchTotal + handicap,
  ];
  const scratchSet = games[0].scratchTotal + games[1].scratchTotal + games[2].scratchTotal;
  const strikes = games.reduce((s, g) => s + g.strikes, 0);
  const spares = games.reduce((s, g) => s + g.spares, 0);
  const opens = games.reduce((s, g) => s + g.opens, 0);
  const openPinsLeft = games.reduce((s, g) => s + g.openPinsLeft, 0);
  return {
    scheduledId: scheduled.id,
    actualId,
    actualName,
    isSub,
    entryAverage,
    handicap,
    games,
    scratchSet,
    handicapGames,
    handicapSet: scratchSet + handicap * 3,
    strikes, spares, opens,
    marks: strikes + spares,
    openPinsLeft,
    framesRolled: 30,
    segments: matchSegmentsOf(games),
  };
}

/**
 * Compute the frame-derived MatchResult from participation + linescores.
 * Central to `applyResult` in the store AND the mock-data seeder.
 * Uses HANDICAP game scores for the per-game 2-point awards, and HANDICAP
 * set totals for the 1-point set award.
 */
export function computeMatchResult(input: {
  scheduledA: Bowler;
  scheduledB: Bowler;
  /** FROZEN scheduled display names at save time. */
  scheduledNameA: string;
  scheduledNameB: string;
  participationA: SideParticipation;
  participationB: SideParticipation;
  entryAverageA: number;
  entryAverageB: number;
  handicapA: number;
  handicapB: number;
  linescoreA: BowlerMatchLinescore | null;
  linescoreB: BowlerMatchLinescore | null;
  pointsOverride: PointsOverride | null;
}): MatchResult {
  const {
    scheduledA, scheduledB, scheduledNameA, scheduledNameB,
    participationA, participationB,
    entryAverageA, entryAverageB, handicapA, handicapB,
    linescoreA, linescoreB, pointsOverride,
  } = input;

  const bowledA = participationA.status !== "absent" && linescoreA != null;
  const bowledB = participationB.status !== "absent" && linescoreB != null;

  // An absent side has NO pinfall — scratch/handicap game/set = 0. The
  // side that bowled retains its own valid totals; do not credit the
  // opponent with phantom handicap pinfall just because they showed up.
  // Absent-with-scores flow: admin enters three numeric scratch scores
  // for the absent side. Those scores feed handicap game/set totals and
  // standings handicap pinfall using the SCHEDULED bowler's handicap,
  // but personal statistics (average, high game/set, mark metrics) are
  // excluded downstream in the snapshot builder.
  const absentScoresA = participationA.status === "absent"
    ? participationA.absentScores : undefined;
  const absentScoresB = participationB.status === "absent"
    ? participationB.absentScores : undefined;
  const hasScoresA = bowledA || !!absentScoresA;
  const hasScoresB = bowledB || !!absentScoresB;

  const gamesA: [number, number, number] = bowledA
    ? [linescoreA!.games[0].scratchTotal, linescoreA!.games[1].scratchTotal, linescoreA!.games[2].scratchTotal]
    : (absentScoresA ?? [0, 0, 0]);
  const gamesB: [number, number, number] = bowledB
    ? [linescoreB!.games[0].scratchTotal, linescoreB!.games[1].scratchTotal, linescoreB!.games[2].scratchTotal]
    : (absentScoresB ?? [0, 0, 0]);
  const hcpGamesA: [number, number, number] = hasScoresA
    ? [gamesA[0] + handicapA, gamesA[1] + handicapA, gamesA[2] + handicapA]
    : [0, 0, 0];
  const hcpGamesB: [number, number, number] = hasScoresB
    ? [gamesB[0] + handicapB, gamesB[1] + handicapB, gamesB[2] + handicapB]
    : [0, 0, 0];
  const scratchA = gamesA[0] + gamesA[1] + gamesA[2];
  const scratchB = gamesB[0] + gamesB[1] + gamesB[2];
  const hcpTotalA = hasScoresA ? scratchA + handicapA * 3 : 0;
  const hcpTotalB = hasScoresB ? scratchB + handicapB * 3 : 0;

  const gameAwardsA: [GameAward, GameAward, GameAward] = [0, 0, 0];
  const gameAwardsB: [GameAward, GameAward, GameAward] = [0, 0, 0];
  let gpA = 0, gpB = 0;
  let setPointA: SetAward = 0, setPointB: SetAward = 0;

  if (hasScoresA && hasScoresB) {
    for (let i = 0; i < 3; i++) {
      const sa = hcpGamesA[i];
      const sb = hcpGamesB[i];
      if (sa > sb) { gameAwardsA[i] = 2; gpA += 2; }
      else if (sb > sa) { gameAwardsB[i] = 2; gpB += 2; }
      else { gameAwardsA[i] = 1; gameAwardsB[i] = 1; gpA += 1; gpB += 1; }
    }
    if (hcpTotalA > hcpTotalB) { setPointA = 1; setPointB = 0; }
    else if (hcpTotalB > hcpTotalA) { setPointA = 0; setPointB = 1; }
    else { setPointA = 0.5; setPointB = 0.5; }
  }
  const totalPointsA = gpA + setPointA;
  const totalPointsB = gpB + setPointB;
  const finalA = pointsOverride?.enabled ? pointsOverride.pointsA : totalPointsA;
  const finalB = pointsOverride?.enabled ? pointsOverride.pointsB : totalPointsB;
  const winner: "A" | "B" | "T" =
    finalA > finalB ? "A" : finalB > finalA ? "B" : "T";

  return {
    scheduledA: scheduledA.id, scheduledB: scheduledB.id,
    scheduledNameA, scheduledNameB,
    actualA: participationA.actualId, actualB: participationB.actualId,
    actualNameA: participationA.actualName, actualNameB: participationB.actualName,
    isSubA: participationA.status === "substitute",
    isSubB: participationB.status === "substitute",
    subA: participationA.status === "substitute" ? participationA.actualName : undefined,
    subB: participationB.status === "substitute" ? participationB.actualName : undefined,
    participationA, participationB,
    entryAverageA, entryAverageB, handicapA, handicapB,
    linescoreA, linescoreB,
    gamesA, gamesB,
    handicapGamesA: hcpGamesA, handicapGamesB: hcpGamesB,
    scratchTotalA: scratchA, scratchTotalB: scratchB,
    handicapTotalA: hcpTotalA, handicapTotalB: hcpTotalB,
    gameAwardsA, gameAwardsB,
    gamePointsA: gpA, gamePointsB: gpB,
    setPointA, setPointB,
    totalPointsA, totalPointsB,
    pointsOverride,
    winner,
  };
}

export function assertMatchResult(m: Match, r: MatchResult): void {
  const id = m.id;
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`Match ${id}: ${msg}`);
  };
  const bowledA = r.participationA.status !== "absent" && r.linescoreA != null;
  const bowledB = r.participationB.status !== "absent" && r.linescoreB != null;
  if (bowledA && bowledB && !r.pointsOverride) {
    for (let i = 0; i < 3; i++) {
      check(r.gameAwardsA[i] + r.gameAwardsB[i] === 2, `game ${i + 1} awards must sum to 2`);
    }
    check(r.setPointA + r.setPointB === 1, "set points must sum to 1");
    check(r.totalPointsA + r.totalPointsB === 7,
      `match must distribute exactly 7 points (got ${r.totalPointsA}+${r.totalPointsB})`);
  }
  if (bowledA && r.linescoreA) {
    for (let i = 0; i < 3; i++) validateGame(r.linescoreA.games[i], `${id} A g${i + 1}`);
  }
  if (bowledB && r.linescoreB) {
    for (let i = 0; i < 3; i++) validateGame(r.linescoreB.games[i], `${id} B g${i + 1}`);
  }
  if (r.pointsOverride) {
    const chk = validatePointsOverride(r.pointsOverride);
    check(chk.ok, chk.ok ? "" : chk.error);
  }
}

/** Seed 18 matches for a given week from a fixed shuffle of the roster. */
export function seedWeekMatches(week: number, bowlers: Bowler[]): Match[] {
  const r = mulberry32(1000 + week);
  const shuffled = [...bowlers].sort(() => r() - 0.5);
  const matches: Match[] = [];
  const completed = week <= SEEDED_COMPLETED_WEEKS;
  for (let p = 0; p < LANE_PAIRS.length; p++) {
    for (let m = 0; m < 3; m++) {
      const idx = p * 6 + m * 2;
      const a = shuffled[idx];
      const b = shuffled[idx + 1];
      const match: Match = {
        id: `w${week}-${LANE_PAIRS[p]}-${m + 1}`,
        week, lanePair: LANE_PAIRS[p], slot: m + 1,
        status: completed ? "completed" : "scheduled",
        bowlerA: a.id, bowlerB: b.id,
      };
      if (completed) {
        const isSubA = r() < 0.06;
        const isSubB = r() < 0.06;
        const subNameA = isSubA ? SEED_SUB_NAMES[Math.floor(r() * SEED_SUB_NAMES.length)] : null;
        const subNameB = isSubB ? SEED_SUB_NAMES[Math.floor(r() * SEED_SUB_NAMES.length)] : null;
        const skillA = Math.max(0.1, Math.min(0.95, (a.entryAverage - 90) / 80));
        const skillB = Math.max(0.1, Math.min(0.95, (b.entryAverage - 90) / 80));
        const lsA = assembleSideLinescore({
          scheduled: a,
          actualId: isSubA ? null : a.id,
          actualName: isSubA ? `Sub — ${subNameA}` : a.name,
          isSub: isSubA,
          entryAverage: a.entryAverage,
          handicap: a.handicap,
          games: [rollMockGame(r, skillA), rollMockGame(r, skillA), rollMockGame(r, skillA)],
        });
        const lsB = assembleSideLinescore({
          scheduled: b,
          actualId: isSubB ? null : b.id,
          actualName: isSubB ? `Sub — ${subNameB}` : b.name,
          isSub: isSubB,
          entryAverage: b.entryAverage,
          handicap: b.handicap,
          games: [rollMockGame(r, skillB), rollMockGame(r, skillB), rollMockGame(r, skillB)],
        });
        match.result = computeMatchResult({
          scheduledA: a, scheduledB: b,
          scheduledNameA: a.name, scheduledNameB: b.name,
          participationA: {
            scheduledId: a.id,
            status: isSubA ? "substitute" : "rostered",
            actualId: isSubA ? null : a.id,
            actualName: isSubA ? (subNameA ?? "Substitute") : a.name,
          },
          participationB: {
            scheduledId: b.id,
            status: isSubB ? "substitute" : "rostered",
            actualId: isSubB ? null : b.id,
            actualName: isSubB ? (subNameB ?? "Substitute") : b.name,
          },
          entryAverageA: a.entryAverage, entryAverageB: b.entryAverage,
          handicapA: a.handicap, handicapB: b.handicap,
          linescoreA: lsA, linescoreB: lsB,
          pointsOverride: null,
        });
        assertMatchResult(match, match.result);
      }
      matches.push(match);
    }
  }
  return matches;
}

/** Seed the whole schedule/history for the season. */
export function seedMatchesByWeek(bowlers: Bowler[]): Record<number, Match[]> {
  const out: Record<number, Match[]> = {};
  for (let w = 1; w <= TOTAL_WEEKS; w++) out[w] = seedWeekMatches(w, bowlers);
  return out;
}

// ---------------------------------------------------------------------------
// Snapshot types (derived projections)
// ---------------------------------------------------------------------------

export interface StandingsRow {
  rank: number;
  bowler: Bowler;
  movement: number;
}

export interface BowlerHistoryRow {
  week: number;
  matchId: string;
  lanePair: LanePair;
  opponent: string;
  opponentId: BowlerId;
  actualBowler: string;
  isSub: boolean;
  /** True when the scheduled bowler was Absent for the week. Score fields
   *  and linescore are null / zero; W-L and override note still populate. */
  absent: boolean;
  /** True when this row was fed by final-week live scoring (score-only,
   *  no frame linescore). `scores` reflect entered games (0 for pending
   *  pairs). Frame-derived stats stay zero. `completedGameCount` tracks
   *  how many pairs both sides scored. */
  scoreOnly?: boolean;
  completedGameCount?: 0 | 1 | 2 | 3;
  pairCompleted?: [boolean, boolean, boolean];
  scores: [number, number, number];
  handicap: number;
  handicapGames: [number, number, number];
  scratchTotal: number;
  handicapTotal: number;
  opponentScratchTotal: number;
  opponentHandicapTotal: number;
  gameAwards: [GameAward, GameAward, GameAward];
  gamePoints: number;
  setPoint: SetAward;
  totalPoints: number;
  pointsLost: number;
  pointsOverridden: boolean;
  overrideReason?: string;
  poaSet: number;
  poaBestGame: number;
  result: "W" | "L" | "T";
  linescore: BowlerMatchLinescore | null;
  opponentLinescore: BowlerMatchLinescore | null;
  weekStrikes: number;
  weekSpares: number;
  weekOpens: number;
  weekMarks: number;
  weekMarkPct: number;
  weekStrikePct: number;
  weekSpareConversionPct: number;
  weekOpenPct: number;
  weekPinsLost: number;
  weekFirst5: number;
  weekLast5: number;
  weekBigOpening: number;
  weekBigFinish: number;
  weekClutchMarks: number;
  weekClutchOpportunities: number;
  weekClutchPct: number;
}

export interface BowlerSeasonExtras {
  bestGamePOA: number;
  bestSetPOA: number;
  seasonPOA: number;
  lanePairUsage: { lanePair: LanePair; count: number }[];
  strikes: number;
  spares: number;
  opens: number;
  marks: number;
  framesRolled: number;
  markPct: number;
  strikePct: number;
  sparePct: number;
  openPct: number;
  spareConversionPct: number;
  /** Average pins lost per ACTUAL roster game rolled. Denominator is
   *  the count of GameLinescore records this bowler personally rolled
   *  (substitute performances and absent weeks excluded). */
  pinsLost: number;
  consistency: number;
  matchesRostered: number;
  /** Count of GameLinescore records personally rolled (roster only). */
  gamesRostered: number;
  /** Per-game averages across every roster GameLinescore. */
  first5PerGame: number;
  last5PerGame: number;
  bigOpeningPerGame: number;
  bigFinishPerGame: number;
  clutchPct: number;
  clutchMarks: number;
  clutchOpportunities: number;
}

export interface ScratchGameRow { bowlerId: BowlerId; bowlerName: string; week: number; matchId: string; opponent: string; scratch: number; handicap: number; }
export interface ScratchSetRow { bowlerId: BowlerId; bowlerName: string; week: number; matchId: string; opponent: string; scratchSet: number; handicapSet: number; }
export interface AverageRow { bowlerId: BowlerId; bowlerName: string; games: number; scratchAverage: number; scratchPinfall: number; }
export interface CreditedSeasonRow { bowlerId: BowlerId; bowlerName: string; points: number; pointsLost: number; matches: number; }
export interface VolumeRow { bowlerId: BowlerId; bowlerName: string; games: number; strikes: number; spares: number; opens: number; }
export interface AdvancedRow {
  bowlerId: BowlerId; bowlerName: string;
  games: number; frames: number; matches: number;
  strikes: number; spares: number; opens: number; marks: number;
  markPct: number; strikePct: number; sparePct: number; openPct: number;
  spareConversionPct: number;
  /** Average pins lost per actual roster game rolled. */
  pinsLost: number;
  consistency: number;
  /** Per-game averages across every roster GameLinescore in scope. */
  first5PerGame: number; last5PerGame: number;
  bigOpeningPerGame: number; bigFinishPerGame: number;
  first5Total: number; last5Total: number;
  bigOpeningTotal: number; bigFinishTotal: number;
  clutchMarks: number; clutchOpportunities: number; clutchPct: number;
}
export interface StandardLeaderboards {
  scope: "season" | number;
  scratchHighGame: ScratchGameRow[];
  scratchHighSeries: ScratchSetRow[];
  topScratchAverages: AverageRow[];
  hcpHighGame: ScratchGameRow[];
  hcpHighSeries: ScratchSetRow[];
  topTotalPoints: CreditedSeasonRow[];
  mostStrikes: VolumeRow[];
  mostSpares: VolumeRow[];
  fewestOpens: VolumeRow[];
}
export interface AdvancedLeaderboards {
  scope: "season" | number;
  rows: AdvancedRow[];
  minGamesForPct: number;
  consistencyEligible: boolean;
  minGamesForConsistency: number;
  singleWeek: boolean;
}
export interface LanePairSummary {
  lanePair: LanePair; games: number; average: number; plusMinusPOA: number;
}
export type EliminationStatus =
  | "calculating"
  | "clinched"
  | "eliminated"
  | "alive"
  | "tiebreaker_only"
  | "not_proven";
export interface EliminationRow {
  bowler: Bowler;
  status: EliminationStatus;
  /** Plain-language reason shown to admins/spectators on the elimination page. */
  note?: string;
  /** Best possible final points total under the constructive scenario. */
  maxFinalPoints?: number;
  /** Name of the bowler's next published opponent (if any). */
  nextOpponent?: string;
  /** Best proven margin over the strongest opponent under the alive/tie proof
   *  (in display points). 0 for tiebreaker_only. */
  bestMargin?: number;
  /** Test-only diagnostics from the solver. Present when a witness exists or
   *  the search budget was exhausted. Not rendered by the public UI. */
  diagnostics?: {
    witnessPairs?: Array<{ week: number; pairs: Array<[BowlerId, BowlerId]> }>;
    witnessFinals?: Record<BowlerId, number>;
    witnessType?: "strict" | "tie";
    budgetExhausted?: boolean;
  };
}
export interface EliminationSnapshot {
  lastCalculatedAt: string; weeksRemaining: number; rows: EliminationRow[];
  /** How this row set was derived. `bounds_only` (cheap, server-side) uses
   *  only trivial arithmetic on current points and remaining match counts;
   *  `full` is the schedule-aware solver output run by the admin browser
   *  and persisted through `saveFullEliminationResult`. */
  calculationMode?: "bounds_only" | "full";
  /** PublicSnapshot.builtAt this elimination result was proven against.
   *  Used as a concurrency token so admin recalculations can't overwrite
   *  results computed against a stale roster/schedule. */
  sourceBuiltAt?: number;
}

/** The single object every public read comes from. */
export interface PublicSnapshot {
  builtAt: number;
  bowlers: Bowler[];
  bowlersById: Record<BowlerId, Bowler>;
  weeks: WeekSummary[];
  matchesByWeek: Record<number, Match[]>;
  standings: StandingsRow[];
  history: Record<BowlerId, BowlerHistoryRow[]>;
  extras: Record<BowlerId, BowlerSeasonExtras>;
  seasonBoards: { standard: StandardLeaderboards; advanced: AdvancedLeaderboards };
  weekBoards: Record<number, { standard: StandardLeaderboards; advanced: AdvancedLeaderboards }>;
  seasonLanes: LanePairSummary[];
  weekLanes: Record<number, LanePairSummary[]>;
  elimination: EliminationSnapshot;
  /** OPTIONAL on old snapshots. Public substitute list (active pool subs
   *  plus any sub with historical performances). */
  substitutes?: SubstituteIdentity[];
  /** OPTIONAL on old snapshots. Aggregated per-substitute profile keyed
   *  by substitute id. */
  substituteProfiles?: Record<string, SubstituteProfile>;
}

// ---------------------------------------------------------------------------
// Snapshot builder — pure function. Runs only on admin save / initial seed.
// ---------------------------------------------------------------------------

interface RosterFrameStats {
  strikes: number; spares: number; opens: number;
  framesRolled: number; openPinsLeft: number;
  gameScores: number[]; scratchPinfall: number;
  /** Number of scheduled matches this bowler personally rolled. */
  matches: number;
  /** Number of valid GameLinescore records this bowler personally rolled.
   *  Sole denominator for per-game rates (First 5, Pins Lost, etc.). */
  games: number;
  first5: number; last5: number; bigOpening: number; bigFinish: number;
  clutchMarks: number; clutchOpportunities: number;
}
function emptyRoster(): RosterFrameStats {
  return {
    strikes: 0, spares: 0, opens: 0, framesRolled: 0, openPinsLeft: 0,
    gameScores: [], scratchPinfall: 0, matches: 0, games: 0,
    first5: 0, last5: 0, bigOpening: 0, bigFinish: 0,
    clutchMarks: 0, clutchOpportunities: 0,
  };
}

export function buildSnapshot(input: {
  bowlers: Bowler[];
  weeks: WeekSummary[];
  matchesByWeek: Record<number, Match[]>;
  /** IDs of bowlers currently visible on public roster/standings and
   *  eligible for scheduling. When omitted, every provided bowler is
   *  treated as active (back-compat with seed/deterministic tests).
   *  Bowlers NOT in this set are HISTORICAL: their completed results and
   *  identity remain in `bowlersById`, `history`, and leaderboards so
   *  their opponent's stats and the historical record survive, but they
   *  do not appear on `snapshot.bowlers`, `standings`, or `elimination`. */
  activeBowlerIds?: ReadonlySet<BowlerId>;
  /** Optional current-season substitute pool. Defaults to empty so
   *  legacy seed and deterministic tests continue to build snapshots
   *  without substitute data. Aggregation reads FROZEN linescore fields
   *  from each completed MatchResult — editing the pool later does not
   *  rewrite historical calculations. */
  substitutes?: readonly SubstituteIdentity[];
}): PublicSnapshot {
  // Deep-clone bowlers so we can mutate aggregate fields without touching the
  // raw db.
  const allBowlers = input.bowlers.map((b) => ({ ...b,
    scratchAverage: 0, points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0, actualScratchPinfall: 0,
  }));
  const activeIds: ReadonlySet<BowlerId> =
    input.activeBowlerIds ?? new Set(allBowlers.map((b) => b.id));
  const bowlersById: Record<BowlerId, Bowler> = Object.fromEntries(allBowlers.map((b) => [b.id, b]));
  const weeks = input.weeks;
  const matchesByWeek = input.matchesByWeek;


  // 1) Bowler season totals from completed matches.
  const allCompleted: Match[] = [];
  for (const w of weeks) {
    // Aggregate every match with a saved result — a partial week counts.
    // `m.result` is the source of truth; `w.completed` is a display flag.
    for (const m of matchesByWeek[w.week] ?? []) if (m.result) allCompleted.push(m);
  }
  for (const m of allCompleted) {
    const r = m.result!;
    const a = bowlersById[m.bowlerA];
    const b = bowlersById[m.bowlerB];
    if (!a || !b) continue; // scheduled bowler archived+removed from db
    const awarded = getAwardedPoints(r);

    // Scheduled participation counts as a matchesPlayed entry (present on
    // the schedule). Absent sides never contribute to gamesPlayed or to
    // any personal statistic, BUT if the admin entered three absent
    // scratch scores those scores must feed standings handicap pinfall
    // (handicapTotalA is already computed with the scheduled handicap by
    // computeMatchResult; it is 0 when no scores were entered).
    // Score-only (live final-week) matches credit ONLY the completed pairs
    // to gamesPlayed / scratchPinfall / high-game; high-set only awards when
    // all three games exist so it represents a real 3-game total.
    const scoreOnly = r.scoreOnly === true;
    const completed = scoreOnly ? (r.completedGameCount ?? 0) : 3;
    const mask: [boolean, boolean, boolean] = r.pairCompleted ?? [true, true, true];

    a.matchesPlayed += 1;
    if (r.participationA.status !== "absent") {
      a.gamesPlayed += completed;
    }
    a.handicapPinfall += r.handicapTotalA;
    a.gamePoints += r.gamePointsA; a.setPoints += r.setPointA;
    a.points += awarded.pointsA;
    a.pointsLost += awarded.pointsB;

    b.matchesPlayed += 1;
    if (r.participationB.status !== "absent") {
      b.gamesPlayed += completed;
    }
    b.handicapPinfall += r.handicapTotalB;
    b.gamePoints += r.gamePointsB; b.setPoints += r.setPointB;
    b.points += awarded.pointsB;
    b.pointsLost += awarded.pointsA;

    const lsA = r.linescoreA;
    // Frame-linescore path (existing) — unchanged for weeks 1..10.
    if (lsA && !lsA.isSub && r.participationA.status !== "absent") {
      a.actualGamesRolled += 3;
      a.actualScratchPinfall += r.scratchTotalA;
      a.scratchPinfall += r.scratchTotalA;
      for (const g of r.gamesA) if (g > a.highGame) a.highGame = g;
      if (r.scratchTotalA > a.highSet) a.highSet = r.scratchTotalA;
    } else if (scoreOnly && !r.isSubA && r.participationA.status !== "absent") {
      // Score-only rostered credit — only completed pairs contribute.
      for (let i = 0; i < 3; i++) {
        if (!mask[i]) continue;
        a.actualGamesRolled += 1;
        a.actualScratchPinfall += r.gamesA[i];
        a.scratchPinfall += r.gamesA[i];
        if (r.gamesA[i] > a.highGame) a.highGame = r.gamesA[i];
      }
      if (completed === 3 && r.scratchTotalA > a.highSet) a.highSet = r.scratchTotalA;
    }
    const lsB = r.linescoreB;
    if (lsB && !lsB.isSub && r.participationB.status !== "absent") {
      b.actualGamesRolled += 3;
      b.actualScratchPinfall += r.scratchTotalB;
      b.scratchPinfall += r.scratchTotalB;
      for (const g of r.gamesB) if (g > b.highGame) b.highGame = g;
      if (r.scratchTotalB > b.highSet) b.highSet = r.scratchTotalB;
    } else if (scoreOnly && !r.isSubB && r.participationB.status !== "absent") {
      for (let i = 0; i < 3; i++) {
        if (!mask[i]) continue;
        b.actualGamesRolled += 1;
        b.actualScratchPinfall += r.gamesB[i];
        b.scratchPinfall += r.gamesB[i];
        if (r.gamesB[i] > b.highGame) b.highGame = r.gamesB[i];
      }
      if (completed === 3 && r.scratchTotalB > b.highSet) b.highSet = r.scratchTotalB;
    }
  }
  for (const bowler of allBowlers) {
    bowler.scratchAverage = bowler.actualGamesRolled > 0
      ? Number((bowler.actualScratchPinfall / bowler.actualGamesRolled).toFixed(3))
      : bowler.entryAverage;
  }

  // 2) Standings — PUBLIC roster only. Archived / inactive bowlers keep
  // aggregated stats in `bowlersById` (for opponent histories and name
  // resolution) but do not appear on the standings board.
  const publicBowlers = allBowlers.filter((b) => activeIds.has(b.id));
  const sorted = [...publicBowlers].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.handicapPinfall !== a.handicapPinfall)
      return b.handicapPinfall - a.handicapPinfall;
    return a.id.localeCompare(b.id);
  });

  // 2a) Movement — compare current official rank to the standings as
  // they stood BEFORE the latest result-bearing week began. Movement is
  // display metadata only; it never affects points, pinfall, averages,
  // rankings, elimination, or history.
  const cutoffWeek = findLatestResultWeek(matchesByWeek);
  const activeIdList = publicBowlers.map((b) => b.id);
  const activeIdSet: ReadonlySet<BowlerId> = new Set(activeIdList);
  const currentRankMap = rankByStandings(
    activeIdList,
    new Map(
      publicBowlers.map((b) => [
        b.id,
        { points: b.points, handicapPinfall: b.handicapPinfall },
      ]),
    ),
  );
  let priorRankMap: Map<BowlerId, number> | null = null;
  if (cutoffWeek !== null) {
    const priorMatches: Match[] = [];
    for (const w of weeks) {
      if (w.week >= cutoffWeek) continue;
      for (const m of matchesByWeek[w.week] ?? []) {
        if (m.result) priorMatches.push(m);
      }
    }
    if (priorMatches.length > 0) {
      // Only bowlers who actually appeared in a prior match get a prior
      // baseline rank. A newly activated bowler with no prior history
      // must show movement 0 rather than a fabricated jump from the
      // bottom of a zero-points baseline.
      const priorParticipants = new Set<BowlerId>();
      for (const m of priorMatches) {
        if (activeIdSet.has(m.bowlerA)) priorParticipants.add(m.bowlerA);
        if (activeIdSet.has(m.bowlerB)) priorParticipants.add(m.bowlerB);
      }
      const priorTotals = aggregateStandingsTotals(priorParticipants, priorMatches);
      priorRankMap = rankByStandings([...priorParticipants], priorTotals);
    }
  }
  for (const b of publicBowlers) {
    const cur = currentRankMap.get(b.id);
    const prev = priorRankMap?.get(b.id);
    b.movement = cur != null && prev != null ? prev - cur : 0;
  }
  const standings: StandingsRow[] = sorted.map((b, i) => ({
    rank: i + 1, bowler: b, movement: b.movement,
  }));

  // 3) History per bowler — populated for ALL bowlers (including archived)
  // so historical profiles keep resolving.
  const history: Record<BowlerId, BowlerHistoryRow[]> = {};
  for (const b of allBowlers) history[b.id] = [];

  for (const w of weeks) {
    // History: include any match with a saved result.
    for (const m of matchesByWeek[w.week] ?? []) {
      const res = m.result;
      if (!res) continue;
      for (const isA of [true, false]) {
        const selfId = isA ? m.bowlerA : m.bowlerB;
        const self = bowlersById[selfId];
        if (!self) continue;
        const oppId = isA ? m.bowlerB : m.bowlerA;
        const scores = isA ? res.gamesA : res.gamesB;
        const scratchTotal = isA ? res.scratchTotalA : res.scratchTotalB;
        const hdcp = isA ? res.handicapA : res.handicapB;
        const hdcpGames = isA ? res.handicapGamesA : res.handicapGamesB;
        const hdcpTotal = isA ? res.handicapTotalA : res.handicapTotalB;
        const gp = isA ? res.gamePointsA : res.gamePointsB;
        const sp = isA ? res.setPointA : res.setPointB;
        const awarded = getAwardedPoints(res);
        const tp = isA ? awarded.pointsA : awarded.pointsB;
        const lostPts = isA ? awarded.pointsB : awarded.pointsA;
        const awards = isA ? res.gameAwardsA : res.gameAwardsB;
        const isSub = isA ? res.isSubA : res.isSubB;
        const ls = isA ? res.linescoreA : res.linescoreB;
        const oppLs = isA ? res.linescoreB : res.linescoreA;
        const participation = isA ? res.participationA : res.participationB;
        // FROZEN scheduled entry avg / opponent name — from the result,
        // not the current roster record. Renaming a bowler or editing
        // an entry average must NOT rewrite completed history.
        const selfFrozenAvg = isA ? res.entryAverageA : res.entryAverageB;
        const oppFrozenName = isA ? res.scheduledNameB : res.scheduledNameA;
        const resultLetter: "W" | "L" | "T" =
          res.winner === "T" ? "T" : (isA ? res.winner === "A" : res.winner === "B") ? "W" : "L";

        if (participation.status === "absent" || !ls) {
          // Two variants share this branch:
          //   1) Absent — scheduled bowler did not play. `absent: true`.
          //   2) Score-only (live final week) — participation was rostered/sub
          //      but no frame linescore exists yet. `scoreOnly: true`.
          const isScoreOnly = res.scoreOnly === true && participation.status !== "absent";
          const absentScores = participation.absentScores;
          const rowScores: [number, number, number] =
            isScoreOnly ? scores : (absentScores ?? [0, 0, 0]);
          const rowScratchTotal = isA ? res.scratchTotalA : res.scratchTotalB;
          const rowHandicapTotal = isA ? res.handicapTotalA : res.handicapTotalB;
          const rowHandicapGames = isA ? res.handicapGamesA : res.handicapGamesB;
          history[selfId].push({
            week: w.week, matchId: m.id, lanePair: m.lanePair,
            opponent: oppFrozenName, opponentId: oppId,
            actualBowler: isScoreOnly
              ? (isSub ? (participation.actualName || "Substitute") : (isA ? res.scheduledNameA : res.scheduledNameB))
              : "Absent",
            isSub: isScoreOnly ? isSub : false,
            absent: !isScoreOnly,
            scoreOnly: isScoreOnly || undefined,
            completedGameCount: isScoreOnly ? res.completedGameCount : undefined,
            pairCompleted: isScoreOnly ? res.pairCompleted : undefined,
            scores: rowScores, handicap: hdcp,
            handicapGames: rowHandicapGames,
            scratchTotal: rowScratchTotal, handicapTotal: rowHandicapTotal,
            opponentScratchTotal: isA ? res.scratchTotalB : res.scratchTotalA,
            opponentHandicapTotal: isA ? res.handicapTotalB : res.handicapTotalA,
            gameAwards: awards, gamePoints: gp, setPoint: sp,
            totalPoints: tp, pointsLost: lostPts,
            pointsOverridden: awarded.overridden, overrideReason: awarded.reason,
            poaSet: 0, poaBestGame: 0,
            result: resultLetter,
            linescore: null, opponentLinescore: oppLs,
            weekStrikes: 0, weekSpares: 0, weekOpens: 0, weekMarks: 0,
            weekMarkPct: 0, weekStrikePct: 0, weekSpareConversionPct: 0,
            weekOpenPct: 0, weekPinsLost: 0,
            weekFirst5: 0, weekLast5: 0, weekBigOpening: 0, weekBigFinish: 0,
            weekClutchMarks: 0, weekClutchOpportunities: 0, weekClutchPct: 0,
          });
          continue;
        }
        const poaSet = scratchTotal - 3 * selfFrozenAvg;
        const poaBest = Math.max(...scores.map((g) => g - selfFrozenAvg));
        const frames = ls.framesRolled;
        const marks = ls.marks;
        const spareOpp = ls.spares + ls.opens;
        const clutchOpp = ls.segments.clutchOpportunities;
        history[selfId].push({
          week: w.week, matchId: m.id, lanePair: m.lanePair,
          opponent: oppFrozenName, opponentId: oppId,
          actualBowler: isSub ? ls.actualName : (isA ? res.scheduledNameA : res.scheduledNameB),
          isSub, absent: false, scores, handicap: hdcp, handicapGames: hdcpGames,
          scratchTotal, handicapTotal: hdcpTotal,
          opponentScratchTotal: isA ? res.scratchTotalB : res.scratchTotalA,
          opponentHandicapTotal: isA ? res.handicapTotalB : res.handicapTotalA,
          gameAwards: awards, gamePoints: gp, setPoint: sp,
          totalPoints: tp, pointsLost: lostPts,
          pointsOverridden: awarded.overridden, overrideReason: awarded.reason,
          poaSet, poaBestGame: poaBest,
          result: resultLetter,
          linescore: ls, opponentLinescore: oppLs,
          weekStrikes: ls.strikes, weekSpares: ls.spares, weekOpens: ls.opens, weekMarks: marks,
          weekMarkPct: frames > 0 ? (marks / frames) * 100 : 0,
          weekStrikePct: frames > 0 ? (ls.strikes / frames) * 100 : 0,
          weekSpareConversionPct: spareOpp > 0 ? (ls.spares / spareOpp) * 100 : 0,
          weekOpenPct: frames > 0 ? (ls.opens / frames) * 100 : 0,
          weekPinsLost: ls.opens > 0 ? ls.openPinsLeft / ls.opens : 0,
          weekFirst5: ls.segments.first5, weekLast5: ls.segments.last5,
          weekBigOpening: ls.segments.bigOpening, weekBigFinish: ls.segments.bigFinish,
          weekClutchMarks: ls.segments.clutchMarks,
          weekClutchOpportunities: clutchOpp,
          weekClutchPct: clutchOpp > 0 ? (ls.segments.clutchMarks / clutchOpp) * 100 : 0,
        });
      }
    }
  }

  // 4) Season extras per bowler
  const extras: Record<BowlerId, BowlerSeasonExtras> = {};
  for (const b of allBowlers) {
    const rows = history[b.id];
    const usage = new Map<LanePair, number>(LANE_PAIRS.map((lp) => [lp, 0]));
    let bestGame = 0, bestSet = 0;
    for (const r of rows) {
      if (r.poaBestGame > bestGame || bestGame === 0) bestGame = r.poaBestGame;
      if (r.poaSet > bestSet || bestSet === 0) bestSet = r.poaSet;
      usage.set(r.lanePair, (usage.get(r.lanePair) ?? 0) + 1);
    }
    const s = emptyRoster();
    for (const w of weeks) {
      // Per-bowler frame stats: any match with a saved result contributes.
      for (const m of matchesByWeek[w.week] ?? []) {
        const r = m.result;
        if (!r) continue;
        const isA = m.bowlerA === b.id;
        const isB = m.bowlerB === b.id;
        if (!isA && !isB) continue;
        const ls = isA ? r.linescoreA : r.linescoreB;
        if (!ls || ls.isSub) continue;
        s.strikes += ls.strikes; s.spares += ls.spares; s.opens += ls.opens;
        s.framesRolled += ls.framesRolled; s.openPinsLeft += ls.openPinsLeft;
        s.scratchPinfall += ls.scratchSet; s.matches += 1;
        // Per-game aggregation: count every GameLinescore explicitly so
        // absences, subs, and future partial matches never inflate the
        // denominator. `ls.games` is the authoritative per-match array.
        for (const g of ls.games) {
          s.games += 1;
          s.first5 += g.segments.first5;
          s.last5 += g.segments.last5;
          s.bigOpening += g.segments.bigOpening;
          s.bigFinish += g.segments.bigFinish;
          s.clutchMarks += g.segments.clutchMarks;
          // 2 clutch opportunities per game (frames 9 & 10).
          s.clutchOpportunities += 2;
          s.gameScores.push(g.scratchTotal);
        }
      }
    }
    const marks = s.strikes + s.spares;
    const spareOpp = s.spares + s.opens;
    const seasonPOA = b.actualGamesRolled > 0
      ? Number((b.actualScratchPinfall / b.actualGamesRolled - b.entryAverage).toFixed(3))
      : 0;
    extras[b.id] = {
      bestGamePOA: rows.length ? bestGame : 0,
      bestSetPOA: rows.length ? bestSet : 0,
      seasonPOA,
      lanePairUsage: LANE_PAIRS.map((lp) => ({ lanePair: lp, count: usage.get(lp) ?? 0 })),
      strikes: s.strikes, spares: s.spares, opens: s.opens, marks, framesRolled: s.framesRolled,
      markPct: s.framesRolled > 0 ? (marks / s.framesRolled) * 100 : 0,
      strikePct: s.framesRolled > 0 ? (s.strikes / s.framesRolled) * 100 : 0,
      sparePct: s.framesRolled > 0 ? (s.spares / s.framesRolled) * 100 : 0,
      openPct: s.framesRolled > 0 ? (s.opens / s.framesRolled) * 100 : 0,
      spareConversionPct: spareOpp > 0 ? (s.spares / spareOpp) * 100 : 0,
      // Pins Lost / Game — denominator is actual roster games rolled,
      // not open frames and not matches. Safe for absences/subs.
      pinsLost: s.games > 0 ? s.openPinsLeft / s.games : 0,
      consistency: stdev(s.gameScores),
      matchesRostered: s.matches,
      gamesRostered: s.games,
      first5PerGame: s.games > 0 ? s.first5 / s.games : 0,
      last5PerGame: s.games > 0 ? s.last5 / s.games : 0,
      bigOpeningPerGame: s.games > 0 ? s.bigOpening / s.games : 0,
      bigFinishPerGame: s.games > 0 ? s.bigFinish / s.games : 0,
      clutchPct: s.clutchOpportunities > 0 ? (s.clutchMarks / s.clutchOpportunities) * 100 : 0,
      clutchMarks: s.clutchMarks,
      clutchOpportunities: s.clutchOpportunities,
    };
  }

  // 5) Leaderboards per scope
  const buildBoards = (scope: "season" | number) => {
    const scopeMatches: Match[] = scope === "season"
      ? allCompleted
      : (matchesByWeek[scope] ?? []).filter((m) => m.result);
    const scratchGames: ScratchGameRow[] = [];
    const scratchSets: ScratchSetRow[] = [];
    const hcpGames: ScratchGameRow[] = [];
    const hcpSets: ScratchSetRow[] = [];
    interface Acc {
      bowlerId: BowlerId; bowlerName: string;
      games: number; matches: number; frames: number;
      strikes: number; spares: number; opens: number; openPinsLeft: number;
      scratchPinfall: number; gameScores: number[];
      first5: number; last5: number; bigOpening: number; bigFinish: number;
      clutchMarks: number; clutchOpportunities: number;
    }
    const acc = new Map<BowlerId, Acc>();
    const ensure = (id: BowlerId, name: string): Acc => {
      let a = acc.get(id);
      if (!a) {
        a = { bowlerId: id, bowlerName: name, games: 0, matches: 0, frames: 0,
          strikes: 0, spares: 0, opens: 0, openPinsLeft: 0,
          scratchPinfall: 0, gameScores: [],
          first5: 0, last5: 0, bigOpening: 0, bigFinish: 0,
          clutchMarks: 0, clutchOpportunities: 0 };
        acc.set(id, a);
      }
      return a;
    };
    const creditedSeason = new Map<BowlerId, CreditedSeasonRow>();

    for (const m of scopeMatches) {
      const r = m.result!;
      for (const isA of [true, false]) {
        const schedId = isA ? m.bowlerA : m.bowlerB;
        const sched = bowlersById[schedId];
        if (!sched) continue;
        const oppId = isA ? m.bowlerB : m.bowlerA;
        const oppName = bowlersById[oppId]?.name ?? "—";
        const ls = isA ? r.linescoreA : r.linescoreB;
        const scratchGamesArr = isA ? r.gamesA : r.gamesB;
        const hdcpGamesArr = isA ? r.handicapGamesA : r.handicapGamesB;
        const scratchTot = isA ? r.scratchTotalA : r.scratchTotalB;
        const hdcpTot = isA ? r.handicapTotalA : r.handicapTotalB;
        const awarded = getAwardedPoints(r);
        const awardedForSide = isA ? awarded.pointsA : awarded.pointsB;
        const awardedForOpp = isA ? awarded.pointsB : awarded.pointsA;
        const participation = isA ? r.participationA : r.participationB;

        // Credited (HCP + Points) — scheduled bowler.
        if (participation.status !== "absent" && ls) {
          for (let i = 0; i < 3; i++) {
            hcpGames.push({
              bowlerId: sched.id, bowlerName: sched.name,
              week: m.week, matchId: m.id, opponent: oppName,
              scratch: scratchGamesArr[i], handicap: hdcpGamesArr[i],
            });
          }
          hcpSets.push({
            bowlerId: sched.id, bowlerName: sched.name,
            week: m.week, matchId: m.id, opponent: oppName,
            scratchSet: scratchTot, handicapSet: hdcpTot,
          });
        }
        let row = creditedSeason.get(sched.id);
        if (!row) {
          row = { bowlerId: sched.id, bowlerName: sched.name, points: 0, pointsLost: 0, matches: 0 };
          creditedSeason.set(sched.id, row);
        }
        row.points += awardedForSide;
        row.pointsLost += awardedForOpp;
        row.matches += 1;

        // ROSTER-ONLY — actual bowler, roster member only.
        if (ls && !ls.isSub && ls.actualId) {
          const rid = ls.actualId;
          const rname = bowlersById[rid]?.name ?? ls.actualName;
          for (let i = 0; i < 3; i++) {
            const g = ls.games[i];
            scratchGames.push({
              bowlerId: rid, bowlerName: rname,
              week: m.week, matchId: m.id, opponent: oppName,
              scratch: g.scratchTotal, handicap: g.scratchTotal + ls.handicap,
            });
          }
          scratchSets.push({
            bowlerId: rid, bowlerName: rname,
            week: m.week, matchId: m.id, opponent: oppName,
            scratchSet: ls.scratchSet, handicapSet: ls.handicapSet,
          });
          const a = ensure(rid, rname);
          a.games += 3; a.matches += 1; a.frames += ls.framesRolled;
          a.strikes += ls.strikes; a.spares += ls.spares; a.opens += ls.opens;
          a.openPinsLeft += ls.openPinsLeft;
          a.scratchPinfall += ls.scratchSet;
          a.first5 += ls.segments.first5; a.last5 += ls.segments.last5;
          a.bigOpening += ls.segments.bigOpening; a.bigFinish += ls.segments.bigFinish;
          a.clutchMarks += ls.segments.clutchMarks;
          a.clutchOpportunities += ls.segments.clutchOpportunities;
          for (const g of ls.games) a.gameScores.push(g.scratchTotal);
        }
      }
    }
    const topN = <T,>(arr: T[], key: (x: T) => number, n: number, asc = false): T[] =>
      [...arr].sort((x, y) => (asc ? key(x) - key(y) : key(y) - key(x))).slice(0, n);
    const averages: AverageRow[] = [...acc.values()]
      .filter((a) => a.games >= 3)
      .map((a) => ({
        bowlerId: a.bowlerId, bowlerName: a.bowlerName, games: a.games,
        scratchAverage: Number((a.scratchPinfall / a.games).toFixed(3)),
        scratchPinfall: a.scratchPinfall,
      }));
    const volume: VolumeRow[] = [...acc.values()].map((a) => ({
      bowlerId: a.bowlerId, bowlerName: a.bowlerName,
      games: a.games, strikes: a.strikes, spares: a.spares, opens: a.opens,
    }));
    const standard: StandardLeaderboards = {
      scope,
      scratchHighGame: mergeMilestoneRows(
        topN(scratchGames, (x) => x.scratch, 5), scratchGames,
        (x) => x.scratch, HIGH_GAME_MILESTONE,
      ),
      scratchHighSeries: mergeMilestoneRows(
        topN(scratchSets, (x) => x.scratchSet, 5), scratchSets,
        (x) => x.scratchSet, HIGH_SET_MILESTONE,
      ),
      topScratchAverages: topN(averages, (x) => x.scratchAverage, 10),
      hcpHighGame: mergeMilestoneRows(
        topN(hcpGames, (x) => x.handicap, 5), hcpGames,
        (x) => x.handicap, HIGH_GAME_MILESTONE,
      ),
      hcpHighSeries: mergeMilestoneRows(
        topN(hcpSets, (x) => x.handicapSet, 5), hcpSets,
        (x) => x.handicapSet, HIGH_SET_MILESTONE,
      ),
      topTotalPoints: topN([...creditedSeason.values()], (x) => x.points, 10),
      mostStrikes: topN(volume, (x) => x.strikes, 10),
      mostSpares: topN(volume, (x) => x.spares, 10),
      fewestOpens: topN(volume.filter((v) => v.games >= 3), (x) => x.opens, 10, true),
    };
    const MIN_PCT = 3;
    const MIN_CONSISTENCY_SEASON = 6;
    const isSeason = scope === "season";
    const rows: AdvancedRow[] = [...acc.values()]
      .filter((a) => a.games >= MIN_PCT)
      .map((a) => {
        const marks = a.strikes + a.spares;
        const spareOpp = a.spares + a.opens;
        const matches = a.matches;
        const g = a.games;
        return {
          bowlerId: a.bowlerId, bowlerName: a.bowlerName,
          games: g, frames: a.frames, matches,
          strikes: a.strikes, spares: a.spares, opens: a.opens, marks,
          markPct: a.frames > 0 ? (marks / a.frames) * 100 : 0,
          strikePct: a.frames > 0 ? (a.strikes / a.frames) * 100 : 0,
          sparePct: a.frames > 0 ? (a.spares / a.frames) * 100 : 0,
          openPct: a.frames > 0 ? (a.opens / a.frames) * 100 : 0,
          spareConversionPct: spareOpp > 0 ? (a.spares / spareOpp) * 100 : 0,
          // Pins Lost / Game — denominator is games rolled, not open frames.
          pinsLost: g > 0 ? a.openPinsLeft / g : 0,
          consistency: isSeason && g >= MIN_CONSISTENCY_SEASON ? stdev(a.gameScores) : 0,
          // Per-game denominators — a match-level sum divided by
          // matches would double-count when a match ever has fewer
          // than 3 valid games (partial saves, absences).
          first5PerGame: g > 0 ? a.first5 / g : 0,
          last5PerGame: g > 0 ? a.last5 / g : 0,
          bigOpeningPerGame: g > 0 ? a.bigOpening / g : 0,
          bigFinishPerGame: g > 0 ? a.bigFinish / g : 0,
          first5Total: a.first5, last5Total: a.last5,
          bigOpeningTotal: a.bigOpening, bigFinishTotal: a.bigFinish,
          clutchMarks: a.clutchMarks, clutchOpportunities: a.clutchOpportunities,
          clutchPct: a.clutchOpportunities > 0 ? (a.clutchMarks / a.clutchOpportunities) * 100 : 0,
        };
      });
    const advanced: AdvancedLeaderboards = {
      scope, rows,
      minGamesForPct: MIN_PCT,
      consistencyEligible: isSeason,
      minGamesForConsistency: MIN_CONSISTENCY_SEASON,
      singleWeek: !isSeason,
    };
    return { standard, advanced };
  };
  const seasonBoards = buildBoards("season");
  const weekHasResult = (w: WeekSummary) => (matchesByWeek[w.week] ?? []).some((m) => m.result);
  const weekBoards: Record<number, { standard: StandardLeaderboards; advanced: AdvancedLeaderboards }> = {};
  // Partial weeks are first-class: any week with at least one saved
  // result gets its own boards immediately. `completed` remains a
  // display-only flag driven by "every scheduled slot has a result".
  for (const w of weeks) if (weekHasResult(w)) weekBoards[w.week] = buildBoards(w.week);


  // 6) Lane data (derived from actual scratch scores by lane pair).
  const laneBucket = () => new Map<LanePair, { pins: number; games: number; poaSum: number; poaCount: number }>(
    LANE_PAIRS.map((lp) => [lp, { pins: 0, games: 0, poaSum: 0, poaCount: 0 }]),
  );
  const seasonLaneMap = laneBucket();
  const weekLaneMaps: Record<number, ReturnType<typeof laneBucket>> = {};
  for (const w of weeks) if (weekHasResult(w)) weekLaneMaps[w.week] = laneBucket();

  for (const m of allCompleted) {
    const r = m.result!;
    const lb = seasonLaneMap.get(m.lanePair)!;
    const wb = weekLaneMaps[m.week]?.get(m.lanePair);
    for (const isA of [true, false]) {
      const ls = isA ? r.linescoreA : r.linescoreB;
      if (!ls) continue;
      // Use FROZEN scheduled entry average from the result — editing a
      // roster average later must not rewrite historical lane POA.
      const frozenAvg = isA ? r.entryAverageA : r.entryAverageB;
      for (const g of ls.games) {
        lb.pins += g.scratchTotal; lb.games += 1;
        lb.poaSum += g.scratchTotal - frozenAvg; lb.poaCount += 1;
        if (wb) {
          wb.pins += g.scratchTotal; wb.games += 1;
          wb.poaSum += g.scratchTotal - frozenAvg; wb.poaCount += 1;
        }
      }
    }
  }
  const laneSummariesFrom = (map: ReturnType<typeof laneBucket>): LanePairSummary[] =>
    LANE_PAIRS.map((lp) => {
      const b = map.get(lp)!;
      return {
        lanePair: lp,
        games: b.games,
        average: b.games > 0 ? Number((b.pins / b.games).toFixed(3)) : 0,
        plusMinusPOA: b.poaCount > 0 ? Number((b.poaSum / b.poaCount).toFixed(2)) : 0,
      };
    });
  const seasonLanes = laneSummariesFrom(seasonLaneMap);
  const weekLanes: Record<number, LanePairSummary[]> = {};
  for (const [wk, map] of Object.entries(weekLaneMaps)) weekLanes[Number(wk)] = laneSummariesFrom(map);

  // 7) Elimination — bounds-only proof-safe pass. Deliberately does NOT
  // invoke the full schedule-aware solver (which is O(exponential) in the
  // worst case and would blow the 10 ms Cloudflare Worker CPU limit on the
  // real 36-bowler roster). The admin browser runs the full solver in a
  // Web Worker and persists results via `saveFullEliminationResult`.
  const elimination: EliminationSnapshot = computeEliminationBounds({
    activeBowlers: publicBowlers,
    weeks,
    matchesByWeek,
    totalWeeks: Math.max(TOTAL_WEEKS, weeks.length),
  });

  // 8) Substitute identities + profiles — public read-only aggregation.
  const subData = buildSubstituteData({
    substitutes: input.substitutes ?? [],
    weeks,
    matchesByWeek,
  });

  return {
    builtAt: Date.now(),
    bowlers: publicBowlers, bowlersById, weeks, matchesByWeek,
    standings, history, extras,
    seasonBoards, weekBoards,
    seasonLanes, weekLanes,
    elimination,
    substitutes: subData.substitutes,
    substituteProfiles: subData.substituteProfiles,
  };
}

// ---------------------------------------------------------------------------
// Public helpers — delegate to the store's snapshot. Public routes never
// trigger aggregation; they just read the pre-built snapshot.
// ---------------------------------------------------------------------------

// The store imports from this file, so we do a lazy runtime require to avoid
// a circular ES-module hazard. `_snapshot()` throws only if called before the
// store has initialized, which cannot happen at render time.
let _snapshotProvider: (() => PublicSnapshot) | null = null;
export function _installSnapshotProvider(fn: () => PublicSnapshot): void {
  _snapshotProvider = fn;
}
function snap(): PublicSnapshot {
  if (!_snapshotProvider) throw new Error("league store not initialized");
  return _snapshotProvider();
}

export function getAllBowlers(): Bowler[] { return snap().bowlers; }
export function getBowler(id: BowlerId): Bowler | undefined { return snap().bowlersById[id]; }
export function getWeeks(): WeekSummary[] { return snap().weeks; }
export function getMatchesForWeek(week: number): Match[] { return snap().matchesByWeek[week] ?? []; }
export function getStandingsSnapshot(): StandingsRow[] { return snap().standings; }
export function getBowlerHistory(id: BowlerId): BowlerHistoryRow[] { return snap().history[id] ?? []; }
export function getBowlerSeasonExtras(id: BowlerId): BowlerSeasonExtras {
  return snap().extras[id] ?? {
    bestGamePOA: 0, bestSetPOA: 0, seasonPOA: 0,
    lanePairUsage: LANE_PAIRS.map((lp) => ({ lanePair: lp, count: 0 })),
    strikes: 0, spares: 0, opens: 0, marks: 0, framesRolled: 0,
    markPct: 0, strikePct: 0, sparePct: 0, openPct: 0,
    spareConversionPct: 0, pinsLost: 0, consistency: 0, matchesRostered: 0, gamesRostered: 0,
    first5PerGame: 0, last5PerGame: 0, bigOpeningPerGame: 0, bigFinishPerGame: 0,
    clutchPct: 0, clutchMarks: 0, clutchOpportunities: 0,
  };
}
export function getStandardLeaderboards(scope: "season" | number): StandardLeaderboards {
  const s = snap();
  return scope === "season" ? s.seasonBoards.standard : s.weekBoards[scope]?.standard ?? s.seasonBoards.standard;
}
export function getAdvancedLeaderboards(scope: "season" | number): AdvancedLeaderboards {
  const s = snap();
  return scope === "season" ? s.seasonBoards.advanced : s.weekBoards[scope]?.advanced ?? s.seasonBoards.advanced;
}
export function getSeasonLaneSummaries(): LanePairSummary[] { return snap().seasonLanes; }
export function getWeekLaneSummaries(week: number): LanePairSummary[] {
  return snap().weekLanes[week] ?? [];
}
export function getEliminationSnapshot(): EliminationSnapshot { return snap().elimination; }

/** Public substitute list. Empty array when reading a pre-deploy snapshot
 *  that lacks the field, so old caches never crash the page. */
export function getPublicSubstitutes(): SubstituteIdentity[] {
  return snap().substitutes ?? [];
}
/** Aggregated per-substitute profile. Undefined when the substitute is
 *  unknown OR the snapshot predates this feature. */
export function getSubstituteProfile(id: string): SubstituteProfile | undefined {
  return snap().substituteProfiles?.[id];
}

/** Compatibility export — a live view over the roster. Kept as a getter-
 *  backed proxy is unnecessary because consumers call `.map` on this array
 *  at render time and re-render on store change (via `useLeagueSnapshot`). */
export const BOWLERS: Bowler[] & { readonly length: number } =
  new Proxy([] as Bowler[], {
    get(_t, prop) {
      const list = snap().bowlers as unknown as Record<PropertyKey, unknown>;
      const v = list[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(list) : v;
    },
  }) as unknown as Bowler[] & { readonly length: number };

/** Compatibility export — live week list. */
export const WEEKS: WeekSummary[] = new Proxy([] as WeekSummary[], {
  get(_t, prop) {
    const list = snap().weeks as unknown as Record<PropertyKey, unknown>;
    const v = list[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(list) : v;
  },
}) as unknown as WeekSummary[];


// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatPoints(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}
export function formatRecord(won: number, lost: number): string {
  return `${formatPoints(won)} - ${formatPoints(lost)}`;
}
export function computePointsBehind(
  leader: Pick<Bowler, "points" | "pointsLost">,
  bowler: Pick<Bowler, "points" | "pointsLost">,
): number {
  const pb = ((leader.points - bowler.points) + (bowler.pointsLost - leader.pointsLost)) / 2;
  return pb < 0 ? 0 : pb;
}
