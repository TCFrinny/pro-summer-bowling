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
}

export type MatchStatus = "scheduled" | "completed";
export type ParticipationStatus = "rostered" | "substitute" | "absent";

export interface SideParticipation {
  scheduledId: BowlerId;
  status: ParticipationStatus;
  actualId: BowlerId | null;
  actualName: string;
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
  result?: MatchResult;
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
    scheduledA, scheduledB, participationA, participationB,
    entryAverageA, entryAverageB, handicapA, handicapB,
    linescoreA, linescoreB, pointsOverride,
  } = input;

  const gamesA: [number, number, number] = linescoreA
    ? [linescoreA.games[0].scratchTotal, linescoreA.games[1].scratchTotal, linescoreA.games[2].scratchTotal]
    : [0, 0, 0];
  const gamesB: [number, number, number] = linescoreB
    ? [linescoreB.games[0].scratchTotal, linescoreB.games[1].scratchTotal, linescoreB.games[2].scratchTotal]
    : [0, 0, 0];
  const hcpGamesA: [number, number, number] = [gamesA[0] + handicapA, gamesA[1] + handicapA, gamesA[2] + handicapA];
  const hcpGamesB: [number, number, number] = [gamesB[0] + handicapB, gamesB[1] + handicapB, gamesB[2] + handicapB];
  const scratchA = gamesA[0] + gamesA[1] + gamesA[2];
  const scratchB = gamesB[0] + gamesB[1] + gamesB[2];
  const hcpTotalA = scratchA + handicapA * 3;
  const hcpTotalB = scratchB + handicapB * 3;

  const bowledA = participationA.status !== "absent" && linescoreA != null;
  const bowledB = participationB.status !== "absent" && linescoreB != null;

  const gameAwardsA: [GameAward, GameAward, GameAward] = [0, 0, 0];
  const gameAwardsB: [GameAward, GameAward, GameAward] = [0, 0, 0];
  let gpA = 0, gpB = 0;
  let setPointA: SetAward = 0, setPointB: SetAward = 0;

  if (bowledA && bowledB) {
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
  // Frame-derived totals (before any override).
  const totalPointsA = gpA + setPointA;
  const totalPointsB = gpB + setPointB;
  const finalA = pointsOverride?.enabled ? pointsOverride.pointsA : totalPointsA;
  const finalB = pointsOverride?.enabled ? pointsOverride.pointsB : totalPointsB;

  const winner: "A" | "B" | "T" =
    finalA > finalB ? "A" : finalB > finalA ? "B" : "T";

  return {
    scheduledA: scheduledA.id, scheduledB: scheduledB.id,
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
          entryAverage: isSubA ? Math.round(100 + r() * 60) : a.entryAverage,
          handicap: a.handicap,
          games: [rollMockGame(r, skillA), rollMockGame(r, skillA), rollMockGame(r, skillA)],
        });
        const lsB = assembleSideLinescore({
          scheduled: b,
          actualId: isSubB ? null : b.id,
          actualName: isSubB ? `Sub — ${subNameB}` : b.name,
          isSub: isSubB,
          entryAverage: isSubB ? Math.round(100 + r() * 60) : b.entryAverage,
          handicap: b.handicap,
          games: [rollMockGame(r, skillB), rollMockGame(r, skillB), rollMockGame(r, skillB)],
        });
        match.result = computeMatchResult({
          scheduledA: a, scheduledB: b,
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
  linescore: BowlerMatchLinescore;
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
  pinsLost: number;
  consistency: number;
  matchesRostered: number;
  first5PerMatch: number;
  last5PerMatch: number;
  bigOpeningPerMatch: number;
  bigFinishPerMatch: number;
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
  pinsLost: number;
  consistency: number;
  first5PerMatch: number; last5PerMatch: number;
  bigOpeningPerMatch: number; bigFinishPerMatch: number;
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
  | "calculating" | "clinched" | "eliminated" | "alive" | "not_proven";
export interface EliminationRow {
  bowler: Bowler; status: EliminationStatus; note?: string;
}
export interface EliminationSnapshot {
  lastCalculatedAt: string; weeksRemaining: number; rows: EliminationRow[];
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
}

// ---------------------------------------------------------------------------
// Snapshot builder — pure function. Runs only on admin save / initial seed.
// ---------------------------------------------------------------------------

interface RosterFrameStats {
  strikes: number; spares: number; opens: number;
  framesRolled: number; openPinsLeft: number;
  gameScores: number[]; scratchPinfall: number;
  matches: number;
  first5: number; last5: number; bigOpening: number; bigFinish: number;
  clutchMarks: number; clutchOpportunities: number;
}
function emptyRoster(): RosterFrameStats {
  return {
    strikes: 0, spares: 0, opens: 0, framesRolled: 0, openPinsLeft: 0,
    gameScores: [], scratchPinfall: 0, matches: 0,
    first5: 0, last5: 0, bigOpening: 0, bigFinish: 0,
    clutchMarks: 0, clutchOpportunities: 0,
  };
}

export function buildSnapshot(input: {
  bowlers: Bowler[];
  weeks: WeekSummary[];
  matchesByWeek: Record<number, Match[]>;
}): PublicSnapshot {
  // Deep-clone bowlers so we can mutate aggregate fields without touching the
  // raw db.
  const bowlers = input.bowlers.map((b) => ({ ...b,
    scratchAverage: 0, points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0, actualScratchPinfall: 0,
  }));
  const bowlersById: Record<BowlerId, Bowler> = Object.fromEntries(bowlers.map((b) => [b.id, b]));
  const weeks = input.weeks;
  const matchesByWeek = input.matchesByWeek;

  // 1) Bowler season totals from completed matches.
  const allCompleted: Match[] = [];
  for (const w of weeks) {
    if (!w.completed) continue;
    for (const m of matchesByWeek[w.week] ?? []) if (m.result) allCompleted.push(m);
  }
  for (const m of allCompleted) {
    const r = m.result!;
    const a = bowlersById[m.bowlerA];
    const b = bowlersById[m.bowlerB];
    if (!a || !b) continue; // scheduled bowler archived+removed from db
    const awarded = getAwardedPoints(r);

    a.matchesPlayed += 1; a.gamesPlayed += 3;
    a.gamePoints += r.gamePointsA; a.setPoints += r.setPointA;
    a.points += awarded.pointsA;
    a.pointsLost += awarded.pointsB;
    a.handicapPinfall += r.handicapTotalA;

    b.matchesPlayed += 1; b.gamesPlayed += 3;
    b.gamePoints += r.gamePointsB; b.setPoints += r.setPointB;
    b.points += awarded.pointsB;
    b.pointsLost += awarded.pointsA;
    b.handicapPinfall += r.handicapTotalB;

    const lsA = r.linescoreA;
    if (lsA && !lsA.isSub && r.participationA.status !== "absent") {
      a.actualGamesRolled += 3;
      a.actualScratchPinfall += r.scratchTotalA;
      a.scratchPinfall += r.scratchTotalA;
      for (const g of r.gamesA) if (g > a.highGame) a.highGame = g;
      if (r.scratchTotalA > a.highSet) a.highSet = r.scratchTotalA;
    }
    const lsB = r.linescoreB;
    if (lsB && !lsB.isSub && r.participationB.status !== "absent") {
      b.actualGamesRolled += 3;
      b.actualScratchPinfall += r.scratchTotalB;
      b.scratchPinfall += r.scratchTotalB;
      for (const g of r.gamesB) if (g > b.highGame) b.highGame = g;
      if (r.scratchTotalB > b.highSet) b.highSet = r.scratchTotalB;
    }
  }
  for (const bowler of bowlers) {
    bowler.scratchAverage = bowler.actualGamesRolled > 0
      ? Number((bowler.actualScratchPinfall / bowler.actualGamesRolled).toFixed(3))
      : bowler.entryAverage;
  }

  // 2) Standings
  const sorted = [...bowlers].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.handicapPinfall - a.handicapPinfall;
  });
  const standings: StandingsRow[] = sorted.map((b, i) => ({
    rank: i + 1, bowler: b, movement: b.movement,
  }));

  // 3) History per bowler
  const history: Record<BowlerId, BowlerHistoryRow[]> = {};
  for (const b of bowlers) history[b.id] = [];
  for (const w of weeks) {
    if (!w.completed) continue;
    for (const m of matchesByWeek[w.week] ?? []) {
      const res = m.result;
      if (!res) continue;
      for (const isA of [true, false]) {
        const selfId = isA ? m.bowlerA : m.bowlerB;
        const self = bowlersById[selfId];
        if (!self) continue;
        const oppId = isA ? m.bowlerB : m.bowlerA;
        const opp = bowlersById[oppId];
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
        if (!ls || participation.status === "absent") continue;
        const poaSet = scratchTotal - 3 * self.entryAverage;
        const poaBest = Math.max(...scores.map((g) => g - self.entryAverage));
        const frames = ls.framesRolled;
        const marks = ls.marks;
        const spareOpp = ls.spares + ls.opens;
        const clutchOpp = ls.segments.clutchOpportunities;
        history[selfId].push({
          week: w.week, matchId: m.id, lanePair: m.lanePair,
          opponent: opp?.name ?? "—", opponentId: oppId,
          actualBowler: isSub ? ls.actualName : self.name,
          isSub, scores, handicap: hdcp, handicapGames: hdcpGames,
          scratchTotal, handicapTotal: hdcpTotal,
          opponentScratchTotal: isA ? res.scratchTotalB : res.scratchTotalA,
          opponentHandicapTotal: isA ? res.handicapTotalB : res.handicapTotalA,
          gameAwards: awards, gamePoints: gp, setPoint: sp,
          totalPoints: tp, pointsLost: lostPts,
          pointsOverridden: awarded.overridden, overrideReason: awarded.reason,
          poaSet, poaBestGame: poaBest,
          result: res.winner === "T" ? "T" : (isA ? res.winner === "A" : res.winner === "B") ? "W" : "L",
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
  for (const b of bowlers) {
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
      if (!w.completed) continue;
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
        s.first5 += ls.segments.first5; s.last5 += ls.segments.last5;
        s.bigOpening += ls.segments.bigOpening; s.bigFinish += ls.segments.bigFinish;
        s.clutchMarks += ls.segments.clutchMarks;
        s.clutchOpportunities += ls.segments.clutchOpportunities;
        for (const g of ls.games) s.gameScores.push(g.scratchTotal);
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
      pinsLost: s.opens > 0 ? s.openPinsLeft / s.opens : 0,
      consistency: stdev(s.gameScores),
      matchesRostered: s.matches,
      first5PerMatch: s.matches > 0 ? s.first5 / s.matches : 0,
      last5PerMatch: s.matches > 0 ? s.last5 / s.matches : 0,
      bigOpeningPerMatch: s.matches > 0 ? s.bigOpening / s.matches : 0,
      bigFinishPerMatch: s.matches > 0 ? s.bigFinish / s.matches : 0,
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
      scratchHighGame: topN(scratchGames, (x) => x.scratch, 5),
      scratchHighSeries: topN(scratchSets, (x) => x.scratchSet, 5),
      topScratchAverages: topN(averages, (x) => x.scratchAverage, 10),
      hcpHighGame: topN(hcpGames, (x) => x.handicap, 5),
      hcpHighSeries: topN(hcpSets, (x) => x.handicapSet, 5),
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
        return {
          bowlerId: a.bowlerId, bowlerName: a.bowlerName,
          games: a.games, frames: a.frames, matches,
          strikes: a.strikes, spares: a.spares, opens: a.opens, marks,
          markPct: a.frames > 0 ? (marks / a.frames) * 100 : 0,
          strikePct: a.frames > 0 ? (a.strikes / a.frames) * 100 : 0,
          sparePct: a.frames > 0 ? (a.spares / a.frames) * 100 : 0,
          openPct: a.frames > 0 ? (a.opens / a.frames) * 100 : 0,
          spareConversionPct: spareOpp > 0 ? (a.spares / spareOpp) * 100 : 0,
          pinsLost: a.opens > 0 ? a.openPinsLeft / a.opens : 0,
          consistency: isSeason && a.games >= MIN_CONSISTENCY_SEASON ? stdev(a.gameScores) : 0,
          first5PerMatch: matches > 0 ? a.first5 / matches : 0,
          last5PerMatch: matches > 0 ? a.last5 / matches : 0,
          bigOpeningPerMatch: matches > 0 ? a.bigOpening / matches : 0,
          bigFinishPerMatch: matches > 0 ? a.bigFinish / matches : 0,
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
  const weekBoards: Record<number, { standard: StandardLeaderboards; advanced: AdvancedLeaderboards }> = {};
  for (const w of weeks) if (w.completed) weekBoards[w.week] = buildBoards(w.week);

  // 6) Lane data (derived from actual scratch scores by lane pair).
  const laneBucket = () => new Map<LanePair, { pins: number; games: number; poaSum: number; poaCount: number }>(
    LANE_PAIRS.map((lp) => [lp, { pins: 0, games: 0, poaSum: 0, poaCount: 0 }]),
  );
  const seasonLaneMap = laneBucket();
  const weekLaneMaps: Record<number, ReturnType<typeof laneBucket>> = {};
  for (const w of weeks) if (w.completed) weekLaneMaps[w.week] = laneBucket();
  for (const m of allCompleted) {
    const r = m.result!;
    const lb = seasonLaneMap.get(m.lanePair)!;
    const wb = weekLaneMaps[m.week]?.get(m.lanePair);
    for (const isA of [true, false]) {
      const ls = isA ? r.linescoreA : r.linescoreB;
      const schedId = isA ? m.bowlerA : m.bowlerB;
      const sched = bowlersById[schedId];
      if (!ls || !sched) continue;
      for (const g of ls.games) {
        lb.pins += g.scratchTotal; lb.games += 1;
        lb.poaSum += g.scratchTotal - sched.entryAverage; lb.poaCount += 1;
        if (wb) {
          wb.pins += g.scratchTotal; wb.games += 1;
          wb.poaSum += g.scratchTotal - sched.entryAverage; wb.poaCount += 1;
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

  // 7) Elimination (heuristic clinch/eliminated by rank)
  const weeksRemaining = weeks.length - weeks.filter((w) => w.completed).length;
  const rows: EliminationRow[] = standings.map((s, i) => {
    let status: EliminationStatus;
    if (i < 4) status = "clinched";
    else if (i < 10) status = "alive";
    else if (i > 28) status = "eliminated";
    else if (i > 22) status = "not_proven";
    else status = "alive";
    return { bowler: s.bowler, status };
  });
  const elimination: EliminationSnapshot = {
    lastCalculatedAt: new Date().toISOString(),
    weeksRemaining, rows,
  };

  return {
    builtAt: Date.now(),
    bowlers, bowlersById, weeks, matchesByWeek,
    standings, history, extras,
    seasonBoards, weekBoards,
    seasonLanes, weekLanes,
    elimination,
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
    spareConversionPct: 0, pinsLost: 0, consistency: 0, matchesRostered: 0,
    first5PerMatch: 0, last5PerMatch: 0, bigOpeningPerMatch: 0, bigFinishPerMatch: 0,
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
