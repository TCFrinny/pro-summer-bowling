/**
 * Pro Summer Singles — Phase 1 mock data layer.
 *
 * SOURCE OF TRUTH: 10-frame duckpin linescores stored as RESULT + CUMULATIVE
 * ONLY. Each frame carries a mark string (X / spare "/" / open "-", plus
 * valid tenth-frame combos) and the running cumulative scratch total. No
 * per-ball pin counts are stored, displayed, required, or validated. This
 * mirrors what an admin will actually enter: 10 marks + 10 cumulative totals
 * per game. All aggregates below are derived from that shape.
 *
 * SCORING (7-point duckpin singles):
 *   - 3 games per match. 2 pts / game win (1 / tie) via HANDICAP game score.
 *   - 1 set pt via total HANDICAP pinfall (0.5 / tie).
 *   - Exactly 7 pts distributed per match.
 *   - Handicap = floor(0.80 * (160 - entryAverage)), min 0.
 *   - Season = 11 weeks. Official standings: points DESC, then handicap pinfall DESC.
 *
 * SUBSTITUTES:
 *   - League points and handicap pinfall are credited to the SCHEDULED bowler.
 *   - Scratch performance, averages, strikes/spares/opens, segments, and
 *     advanced percentages belong to the ACTUAL bowler who rolled.
 *   - Roster-only boards exclude off-roster substitute performances.
 *
 * PERFORMANCE RULE:
 *   Public pages must NEVER trigger season-wide recalculation on render.
 *   Aggregation (season + per-week leaderboard caches) runs ONCE at module
 *   load. Public route navigation is O(1) map lookup against cached data.
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
  type FrameLinescore,
  type GameLinescore,
  type GameSegments,
} from "./duckpin";

export const LEAGUE_NAME = "Pro Summer Singles";
export const VENUE_NAME = "Mt. Airy Lanes";
export const SEASON_LABEL = "2026 Summer";

/** Handicap formula: floor(0.80 * (160 - entry)), minimum 0. */
export function computeHandicap(entryAverage: number): number {
  return Math.max(0, Math.floor(0.8 * (160 - entryAverage)));
}

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

export const LANE_PAIRS = [
  "1-2", "3-4", "5-6", "7-8", "9-10", "11-12",
] as const;
export type LanePair = (typeof LANE_PAIRS)[number];

export type MatchStatus = "scheduled" | "completed";

export type ParticipationStatus = "rostered" | "substitute" | "absent";

/**
 * Per-side participation record. `scheduledId` is the roster bowler slotted
 * on the schedule; `actualId` is the roster bowler who actually rolled (null
 * for an off-roster substitute or when absent). `actualName` supplies a
 * display label — for absent sides it is typically the scheduled bowler's
 * name; for subs it is the sub's display name.
 */
export interface SideParticipation {
  scheduledId: BowlerId;
  status: ParticipationStatus;
  actualId: BowlerId | null;
  actualName: string;
}

/**
 * Manual W-L override, applied per match. When enabled it REPLACES the
 * frame-derived W-L for standings and public display, while any real
 * linescore rolled by a side is preserved for scratch/advanced stats.
 * `pointsA` and `pointsB` must each be a multiple of 0.5 in [0, 7], and
 * their sum must be ≤ 7 (may be less for absence or exceptional rulings).
 */
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
  clutchMarks: number; // 0..6 across three games (frames 9-10)
  clutchOpportunities: number; // always 6
}

/** Linescore for one bowler in one match. */
export interface BowlerMatchLinescore {
  scheduledId: BowlerId;
  /** Roster bowler who rolled, or null for an off-roster sub. */
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
  framesRolled: number; // always 30
  segments: MatchSegments;
}

export interface MatchResult {
  scheduledA: BowlerId;
  scheduledB: BowlerId;
  actualA: BowlerId | null;
  actualB: BowlerId | null;
  actualNameA: string;
  actualNameB: string;
  isSubA: boolean;
  isSubB: boolean;
  subA?: string;
  subB?: string;
  /** Per-side participation (rostered / substitute / absent). */
  participationA: SideParticipation;
  participationB: SideParticipation;
  entryAverageA: number;
  entryAverageB: number;
  handicapA: number;
  handicapB: number;
  /** null when the side was absent (no linescore recorded). */
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
  /** Frame-derived W (before any override). */
  totalPointsA: number;
  totalPointsB: number;
  /** Optional manual override — replaces final W-L when enabled. */
  pointsOverride: PointsOverride | null;
  winner: "A" | "B" | "T";
}

/**
 * SHARED helper: single source of truth for a match's final awarded points.
 * Standings, weekly results, profiles, and leaderboards MUST call this — never
 * read `totalPointsA/B` directly for final points.
 */
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

/** Half-point increment check used by override validation. */
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
    const lsA = r.linescoreA;
    for (let i = 0; i < 3; i++) {
      check(r.handicapGamesA[i] === r.gamesA[i] + r.handicapA, `handicap game A${i + 1} mismatch`);
      check(lsA.games[i].scratchTotal === r.gamesA[i],
        `frame-derived A${i + 1} total ${lsA.games[i].scratchTotal} ≠ recorded ${r.gamesA[i]}`);
      validateGame(lsA.games[i], `${id} sideA game ${i + 1}`);
    }
    const scratchA = r.gamesA[0] + r.gamesA[1] + r.gamesA[2];
    check(scratchA === r.scratchTotalA, "scratchTotalA mismatch");
    check(r.handicapTotalA === scratchA + r.handicapA * 3, "handicapTotalA mismatch");
    const sA = lsA.segments;
    const gsA = lsA.games;
    const sum = (fn: (g: GameLinescore) => number, arr: GameLinescore[]) => arr.reduce((s, g) => s + fn(g), 0);
    check(sA.first5 === sum((g) => g.segments.first5, gsA), "A First5 mismatch");
    check(sA.last5 === sum((g) => g.segments.last5, gsA), "A Last5 mismatch");
    check(sA.bigOpening === sum((g) => g.segments.bigOpening, gsA), "A BigOpening mismatch");
    check(sA.bigFinish === sum((g) => g.segments.bigFinish, gsA), "A BigFinish mismatch");
    check(sA.clutchMarks === sum((g) => g.segments.clutchMarks, gsA), "A Clutch marks mismatch");
  }
  if (bowledB && r.linescoreB) {
    const lsB = r.linescoreB;
    for (let i = 0; i < 3; i++) {
      check(r.handicapGamesB[i] === r.gamesB[i] + r.handicapB, `handicap game B${i + 1} mismatch`);
      check(lsB.games[i].scratchTotal === r.gamesB[i],
        `frame-derived B${i + 1} total ${lsB.games[i].scratchTotal} ≠ recorded ${r.gamesB[i]}`);
      validateGame(lsB.games[i], `${id} sideB game ${i + 1}`);
    }
    const scratchB = r.gamesB[0] + r.gamesB[1] + r.gamesB[2];
    check(scratchB === r.scratchTotalB, "scratchTotalB mismatch");
    check(r.handicapTotalB === scratchB + r.handicapB * 3, "handicapTotalB mismatch");
    const sB = lsB.segments;
    const gsB = lsB.games;
    const sum = (fn: (g: GameLinescore) => number, arr: GameLinescore[]) => arr.reduce((s, g) => s + fn(g), 0);
    check(sB.first5 === sum((g) => g.segments.first5, gsB), "B First5 mismatch");
    check(sB.last5 === sum((g) => g.segments.last5, gsB), "B Last5 mismatch");
    check(sB.bigOpening === sum((g) => g.segments.bigOpening, gsB), "B BigOpening mismatch");
    check(sB.bigFinish === sum((g) => g.segments.bigFinish, gsB), "B BigFinish mismatch");
    check(sB.clutchMarks === sum((g) => g.segments.clutchMarks, gsB), "B Clutch marks mismatch");
  }

  if (r.pointsOverride) {
    const chk = validatePointsOverride(r.pointsOverride);
    check(chk.ok, chk.ok ? "" : chk.error);
  }
}

export interface WeekSummary {
  week: number;
  date: string;
  completed: boolean;
}

// ---------------------------------------------------------------------------
// Bowlers (36)
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

const SUB_NAMES = [
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

const rand = mulberry32(20260615);

export const BOWLERS: Bowler[] = FIRST.map((f, i) => {
  const entry = 110 + Math.floor(rand() * 55);
  const handicap = computeHandicap(entry);
  return {
    id: `b${(i + 1).toString().padStart(2, "0")}`,
    name: `${f} ${LAST[i]}`,
    entryAverage: entry, handicap,
    scratchAverage: 0, points: 0, pointsLost: 0,
    gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0,
    highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0,
    actualGamesRolled: 0, actualScratchPinfall: 0,
    movement: Math.round((rand() - 0.5) * 6),
  };
});

const BOWLERS_BY_ID: Record<BowlerId, Bowler> = Object.fromEntries(
  BOWLERS.map((b) => [b.id, b]),
);
export function getBowler(id: BowlerId): Bowler | undefined {
  return BOWLERS_BY_ID[id];
}

// ---------------------------------------------------------------------------
// Weeks + matches
// ---------------------------------------------------------------------------

const TOTAL_WEEKS = 11;
const COMPLETED_WEEKS = 7;

export const WEEKS: WeekSummary[] = Array.from({ length: TOTAL_WEEKS }).map(
  (_, i) => ({
    week: i + 1,
    date: new Date(2026, 5, 4 + i * 7).toISOString(),
    completed: i < COMPLETED_WEEKS,
  }),
);

function matchSegmentsOf(games: [GameLinescore, GameLinescore, GameLinescore]): MatchSegments {
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

function buildBowlerLinescore(
  scheduled: Bowler,
  isSub: boolean,
  subName: string | null,
  r: () => number,
): BowlerMatchLinescore {
  const actualEntry = isSub ? Math.round(100 + r() * 60) : scheduled.entryAverage;
  const skill = Math.max(0.1, Math.min(0.95, (actualEntry - 90) / 80));
  const games: [GameLinescore, GameLinescore, GameLinescore] = [
    rollMockGame(r, skill), rollMockGame(r, skill), rollMockGame(r, skill),
  ];
  const handicap = scheduled.handicap; // handicap tied to SCHEDULED bowler
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
    actualId: isSub ? null : scheduled.id,
    actualName: isSub ? `Sub — ${subName}` : scheduled.name,
    isSub,
    entryAverage: actualEntry,
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

function buildWeekMatches(week: number): Match[] {
  const r = mulberry32(1000 + week);
  const shuffled = [...BOWLERS].sort(() => r() - 0.5);
  const matches: Match[] = [];
  const completed = week <= COMPLETED_WEEKS;
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
        const subNameA = isSubA ? SUB_NAMES[Math.floor(r() * SUB_NAMES.length)] : null;
        const subNameB = isSubB ? SUB_NAMES[Math.floor(r() * SUB_NAMES.length)] : null;
        const lsA = buildBowlerLinescore(a, isSubA, subNameA, r);
        const lsB = buildBowlerLinescore(b, isSubB, subNameB, r);
        const gamesA: [number, number, number] = [
          lsA.games[0].scratchTotal, lsA.games[1].scratchTotal, lsA.games[2].scratchTotal,
        ];
        const gamesB: [number, number, number] = [
          lsB.games[0].scratchTotal, lsB.games[1].scratchTotal, lsB.games[2].scratchTotal,
        ];
        const gameAwardsA: [GameAward, GameAward, GameAward] = [0, 0, 0];
        const gameAwardsB: [GameAward, GameAward, GameAward] = [0, 0, 0];
        let gpA = 0, gpB = 0;
        for (let i = 0; i < 3; i++) {
          const sa = lsA.handicapGames[i];
          const sb = lsB.handicapGames[i];
          if (sa > sb) { gameAwardsA[i] = 2; gpA += 2; }
          else if (sb > sa) { gameAwardsB[i] = 2; gpB += 2; }
          else { gameAwardsA[i] = 1; gameAwardsB[i] = 1; gpA += 1; gpB += 1; }
        }
        let setPointA: SetAward, setPointB: SetAward;
        if (lsA.handicapSet > lsB.handicapSet) { setPointA = 1; setPointB = 0; }
        else if (lsB.handicapSet > lsA.handicapSet) { setPointA = 0; setPointB = 1; }
        else { setPointA = 0.5; setPointB = 0.5; }
        const totalPointsA = gpA + setPointA;
        const totalPointsB = gpB + setPointB;
        match.result = {
          scheduledA: a.id, scheduledB: b.id,
          actualA: lsA.actualId, actualB: lsB.actualId,
          actualNameA: lsA.actualName, actualNameB: lsB.actualName,
          isSubA, isSubB,
          subA: subNameA ?? undefined, subB: subNameB ?? undefined,
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
          gamesA, gamesB,
          handicapGamesA: lsA.handicapGames, handicapGamesB: lsB.handicapGames,
          scratchTotalA: lsA.scratchSet, scratchTotalB: lsB.scratchSet,
          handicapTotalA: lsA.handicapSet, handicapTotalB: lsB.handicapSet,
          gameAwardsA, gameAwardsB,
          gamePointsA: gpA, gamePointsB: gpB,
          setPointA, setPointB,
          totalPointsA, totalPointsB,
          pointsOverride: null,
          winner: totalPointsA > totalPointsB ? "A" : totalPointsB > totalPointsA ? "B" : "T",
        };
        assertMatchResult(match, match.result);
      }
      matches.push(match);
    }
  }
  return matches;
}

const MATCHES_BY_WEEK: Record<number, Match[]> = Object.fromEntries(
  WEEKS.map((w) => [w.week, buildWeekMatches(w.week)]),
);

// ---------------------------------------------------------------------------
// Season aggregation (runs once).
// ---------------------------------------------------------------------------

(function aggregateSeasonTotals() {
  for (const w of WEEKS) {
    if (!w.completed) continue;
    for (const m of MATCHES_BY_WEEK[w.week]) {
      const r = m.result;
      if (!r) continue;
      const a = BOWLERS_BY_ID[m.bowlerA];
      const b = BOWLERS_BY_ID[m.bowlerB];
      const awarded = getAwardedPoints(r);

      a.matchesPlayed += 1; a.gamesPlayed += 3;
      a.gamePoints += r.gamePointsA; a.setPoints += r.setPointA;
      a.points += awarded.pointsA;
      // L = opponent's ACTUAL awarded points (not 7 - W), so override matches
      // may leave W + L < 7.
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
  }
  for (const bowler of BOWLERS) {
    bowler.scratchAverage =
      bowler.actualGamesRolled > 0
        ? Number((bowler.actualScratchPinfall / bowler.actualGamesRolled).toFixed(3))
        : bowler.entryAverage;
    const expected = 7 * bowler.matchesPlayed;
    if (Math.abs(bowler.points + bowler.pointsLost - expected) > 1e-9) {
      throw new Error(
        `Bowler ${bowler.id} W+L ≠ 7×matches (${bowler.points}+${bowler.pointsLost} vs ${expected})`,
      );
    }
  }
})();

export function getMatchesForWeek(week: number): Match[] {
  return MATCHES_BY_WEEK[week] ?? [];
}

function allCompletedMatches(): Match[] {
  const out: Match[] = [];
  for (const w of WEEKS) if (w.completed) out.push(...MATCHES_BY_WEEK[w.week]);
  return out;
}

// ---------------------------------------------------------------------------
// Bowler history + season extras (derived from frame linescores).
// ---------------------------------------------------------------------------

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

export function getBowlerHistory(id: BowlerId): BowlerHistoryRow[] {
  const rows: BowlerHistoryRow[] = [];
  const self = getBowler(id);
  if (!self) return rows;
  for (const w of WEEKS) {
    if (!w.completed) continue;
    for (const m of getMatchesForWeek(w.week)) {
      const res = m.result;
      if (!res) continue;
      const isA = m.bowlerA === id;
      const isB = m.bowlerB === id;
      if (!isA && !isB) continue;
      const oppId = isA ? m.bowlerB : m.bowlerA;
      const opp = getBowler(oppId);
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
      // Skip generating a full frame-derived row when this bowler was absent
      // (no linescore). Admin data may include absent sides; the UI treats
      // history rows as bowled-and-rolled events only.
      if (!ls || participation.status === "absent") continue;
      const poaSet = scratchTotal - 3 * self.entryAverage;
      const poaBest = Math.max(...scores.map((g) => g - self.entryAverage));
      const frames = ls.framesRolled;
      const marks = ls.marks;
      const spareOpp = ls.spares + ls.opens;
      const clutchOpp = ls.segments.clutchOpportunities;
      rows.push({
        week: w.week, matchId: m.id, lanePair: m.lanePair,
        opponent: opp?.name ?? "—", opponentId: oppId,
        actualBowler: isSub ? ls.actualName : self.name,
        isSub, scores,
        handicap: hdcp, handicapGames: hdcpGames,
        scratchTotal, handicapTotal: hdcpTotal,
        opponentScratchTotal: isA ? res.scratchTotalB : res.scratchTotalA,
        opponentHandicapTotal: isA ? res.handicapTotalB : res.handicapTotalA,
        gameAwards: awards, gamePoints: gp, setPoint: sp,
        totalPoints: tp, pointsLost: lostPts,
        pointsOverridden: awarded.overridden,
        overrideReason: awarded.reason,
        poaSet, poaBestGame: poaBest,
        result:
          res.winner === "T" ? "T"
          : (isA ? res.winner === "A" : res.winner === "B") ? "W" : "L",
        linescore: ls, opponentLinescore: oppLs,
        weekStrikes: ls.strikes,
        weekSpares: ls.spares,
        weekOpens: ls.opens,
        weekMarks: marks,
        weekMarkPct: frames > 0 ? (marks / frames) * 100 : 0,
        weekStrikePct: frames > 0 ? (ls.strikes / frames) * 100 : 0,
        weekSpareConversionPct: spareOpp > 0 ? (ls.spares / spareOpp) * 100 : 0,
        weekOpenPct: frames > 0 ? (ls.opens / frames) * 100 : 0,
        weekPinsLost: ls.opens > 0 ? ls.openPinsLeft / ls.opens : 0,
        weekFirst5: ls.segments.first5,
        weekLast5: ls.segments.last5,
        weekBigOpening: ls.segments.bigOpening,
        weekBigFinish: ls.segments.bigFinish,
        weekClutchMarks: ls.segments.clutchMarks,
        weekClutchOpportunities: clutchOpp,
        weekClutchPct: clutchOpp > 0 ? (ls.segments.clutchMarks / clutchOpp) * 100 : 0,
      });
    }
  }
  return rows;
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

function collectFrameStats(id: BowlerId, weekFilter?: number): RosterFrameStats {
  const out = emptyRoster();
  if (!getBowler(id)) return out;
  for (const w of WEEKS) {
    if (!w.completed) continue;
    if (weekFilter != null && w.week !== weekFilter) continue;
    for (const m of getMatchesForWeek(w.week)) {
      const res = m.result;
      if (!res) continue;
      const isA = m.bowlerA === id;
      const isB = m.bowlerB === id;
      if (!isA && !isB) continue;
      const ls = isA ? res.linescoreA : res.linescoreB;
      if (!ls || ls.isSub) continue; // roster-only, requires actual linescore
      out.strikes += ls.strikes;
      out.spares += ls.spares;
      out.opens += ls.opens;
      out.framesRolled += ls.framesRolled;
      out.openPinsLeft += ls.openPinsLeft;
      out.scratchPinfall += ls.scratchSet;
      out.matches += 1;
      out.first5 += ls.segments.first5;
      out.last5 += ls.segments.last5;
      out.bigOpening += ls.segments.bigOpening;
      out.bigFinish += ls.segments.bigFinish;
      out.clutchMarks += ls.segments.clutchMarks;
      out.clutchOpportunities += ls.segments.clutchOpportunities;
      for (const g of ls.games) out.gameScores.push(g.scratchTotal);
    }
  }
  return out;
}

export function getBowlerSeasonExtras(id: BowlerId): BowlerSeasonExtras {
  const self = getBowler(id);
  const rows = getBowlerHistory(id);
  const usage = new Map<LanePair, number>(LANE_PAIRS.map((lp) => [lp, 0]));
  let bestGame = 0, bestSet = 0;
  for (const r of rows) {
    if (r.poaBestGame > bestGame || bestGame === 0) bestGame = r.poaBestGame;
    if (r.poaSet > bestSet || bestSet === 0) bestSet = r.poaSet;
    usage.set(r.lanePair, (usage.get(r.lanePair) ?? 0) + 1);
  }
  if (!self) {
    return {
      bestGamePOA: 0, bestSetPOA: 0, seasonPOA: 0,
      lanePairUsage: LANE_PAIRS.map((lp) => ({ lanePair: lp, count: 0 })),
      strikes: 0, spares: 0, opens: 0, marks: 0, framesRolled: 0,
      markPct: 0, strikePct: 0, sparePct: 0, openPct: 0,
      spareConversionPct: 0, pinsLost: 0, consistency: 0,
      matchesRostered: 0,
      first5PerMatch: 0, last5PerMatch: 0,
      bigOpeningPerMatch: 0, bigFinishPerMatch: 0,
      clutchPct: 0, clutchMarks: 0, clutchOpportunities: 0,
    };
  }
  const seasonPOA =
    self.actualGamesRolled > 0
      ? Number(
          (self.actualScratchPinfall / self.actualGamesRolled - self.entryAverage).toFixed(3),
        )
      : 0;
  const s = collectFrameStats(id);
  const marks = s.strikes + s.spares;
  const framesRolled = s.framesRolled;
  const spareOpp = s.spares + s.opens;
  return {
    bestGamePOA: rows.length ? bestGame : 0,
    bestSetPOA: rows.length ? bestSet : 0,
    seasonPOA,
    lanePairUsage: LANE_PAIRS.map((lp) => ({ lanePair: lp, count: usage.get(lp) ?? 0 })),
    strikes: s.strikes, spares: s.spares, opens: s.opens, marks, framesRolled,
    markPct: framesRolled > 0 ? (marks / framesRolled) * 100 : 0,
    strikePct: framesRolled > 0 ? (s.strikes / framesRolled) * 100 : 0,
    sparePct: framesRolled > 0 ? (s.spares / framesRolled) * 100 : 0,
    openPct: framesRolled > 0 ? (s.opens / framesRolled) * 100 : 0,
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

// ---------------------------------------------------------------------------
// Leaderboard cache
// ---------------------------------------------------------------------------

export interface ScratchGameRow {
  bowlerId: BowlerId; bowlerName: string;
  week: number; matchId: string; opponent: string;
  scratch: number; handicap: number;
}
export interface ScratchSetRow {
  bowlerId: BowlerId; bowlerName: string;
  week: number; matchId: string; opponent: string;
  scratchSet: number; handicapSet: number;
}
export interface AverageRow {
  bowlerId: BowlerId; bowlerName: string;
  games: number; scratchAverage: number; scratchPinfall: number;
}
export interface CreditedSeasonRow {
  bowlerId: BowlerId; bowlerName: string;
  points: number; pointsLost: number; matches: number;
}
export interface VolumeRow {
  bowlerId: BowlerId; bowlerName: string;
  games: number; strikes: number; spares: number; opens: number;
}
export interface AdvancedRow {
  bowlerId: BowlerId; bowlerName: string;
  games: number; frames: number; matches: number;
  strikes: number; spares: number; opens: number; marks: number;
  markPct: number; strikePct: number; sparePct: number; openPct: number;
  spareConversionPct: number;
  pinsLost: number;
  consistency: number;
  // Segment aggregates (roster-only). "PerMatch" = pins per completed match.
  first5PerMatch: number;
  last5PerMatch: number;
  bigOpeningPerMatch: number;
  bigFinishPerMatch: number;
  first5Total: number;
  last5Total: number;
  bigOpeningTotal: number;
  bigFinishTotal: number;
  clutchMarks: number;
  clutchOpportunities: number;
  clutchPct: number;
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

function buildLeaderboardsForScope(
  scope: "season" | number,
): { standard: StandardLeaderboards; advanced: AdvancedLeaderboards } {
  const matches: Match[] =
    scope === "season"
      ? allCompletedMatches()
      : getMatchesForWeek(scope).filter((m) => m.result);

  const scratchGames: ScratchGameRow[] = [];
  const scratchSets: ScratchSetRow[] = [];
  const hcpGames: ScratchGameRow[] = [];
  const hcpSets: ScratchSetRow[] = [];

  interface Acc {
    bowlerId: BowlerId; bowlerName: string;
    games: number; frames: number; matches: number;
    strikes: number; spares: number; opens: number;
    openPinsLeft: number; scratchPinfall: number; gameScores: number[];
    first5: number; last5: number; bigOpening: number; bigFinish: number;
    clutchMarks: number; clutchOpportunities: number;
  }
  const acc = new Map<BowlerId, Acc>();
  const ensure = (id: BowlerId, name: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = {
        bowlerId: id, bowlerName: name,
        games: 0, frames: 0, matches: 0,
        strikes: 0, spares: 0, opens: 0,
        openPinsLeft: 0, scratchPinfall: 0, gameScores: [],
        first5: 0, last5: 0, bigOpening: 0, bigFinish: 0,
        clutchMarks: 0, clutchOpportunities: 0,
      };
      acc.set(id, a);
    }
    return a;
  };

  const creditedSeason = new Map<BowlerId, CreditedSeasonRow>();

  for (const m of matches) {
    const r = m.result;
    if (!r) continue;
    const schedA = getBowler(m.bowlerA);
    const schedB = getBowler(m.bowlerB);
    if (!schedA || !schedB) continue;
    const oppNameA = schedB.name;
    const oppNameB = schedA.name;

    const awarded = getAwardedPoints(r);
    for (const side of ["A", "B"] as const) {
      const isA = side === "A";
      const sched = isA ? schedA : schedB;
      const ls = isA ? r.linescoreA : r.linescoreB;
      const opp = isA ? oppNameA : oppNameB;
      const scratchTot = isA ? r.scratchTotalA : r.scratchTotalB;
      const hdcpTot = isA ? r.handicapTotalA : r.handicapTotalB;
      const hdcpGamesArr = isA ? r.handicapGamesA : r.handicapGamesB;
      const scratchGamesArr = isA ? r.gamesA : r.gamesB;
      const awardedForSide = isA ? awarded.pointsA : awarded.pointsB;
      const awardedForOpp = isA ? awarded.pointsB : awarded.pointsA;

      // CREDITED — scheduled bowler + actual scratch rolled + scheduled hdcp.
      for (let i = 0; i < 3; i++) {
        hcpGames.push({
          bowlerId: sched.id, bowlerName: sched.name,
          week: m.week, matchId: m.id, opponent: opp,
          scratch: scratchGamesArr[i], handicap: hdcpGamesArr[i],
        });
      }
      hcpSets.push({
        bowlerId: sched.id, bowlerName: sched.name,
        week: m.week, matchId: m.id, opponent: opp,
        scratchSet: scratchTot, handicapSet: hdcpTot,
      });
      let seasonRow = creditedSeason.get(sched.id);
      if (!seasonRow) {
        seasonRow = { bowlerId: sched.id, bowlerName: sched.name, points: 0, pointsLost: 0, matches: 0 };
        creditedSeason.set(sched.id, seasonRow);
      }
      seasonRow.points += awardedForSide;
      seasonRow.pointsLost += awardedForOpp;
      seasonRow.matches += 1;

      // ROSTER-ONLY — actual bowler, only if roster member.
      if (ls && !ls.isSub && ls.actualId) {
        const rosterId = ls.actualId;
        const rosterName = getBowler(rosterId)?.name ?? ls.actualName;
        for (let i = 0; i < 3; i++) {
          const g = ls.games[i];
          scratchGames.push({
            bowlerId: rosterId, bowlerName: rosterName,
            week: m.week, matchId: m.id, opponent: opp,
            scratch: g.scratchTotal, handicap: g.scratchTotal + ls.handicap,
          });
        }
        scratchSets.push({
          bowlerId: rosterId, bowlerName: rosterName,
          week: m.week, matchId: m.id, opponent: opp,
          scratchSet: ls.scratchSet, handicapSet: ls.handicapSet,
        });
        const a = ensure(rosterId, rosterName);
        a.games += 3;
        a.matches += 1;
        a.frames += ls.framesRolled;
        a.strikes += ls.strikes;
        a.spares += ls.spares;
        a.opens += ls.opens;
        a.openPinsLeft += ls.openPinsLeft;
        a.scratchPinfall += ls.scratchSet;
        a.first5 += ls.segments.first5;
        a.last5 += ls.segments.last5;
        a.bigOpening += ls.segments.bigOpening;
        a.bigFinish += ls.segments.bigFinish;
        a.clutchMarks += ls.segments.clutchMarks;
        a.clutchOpportunities += ls.segments.clutchOpportunities;
        for (const g of ls.games) a.gameScores.push(g.scratchTotal);
      }
    }
  }

  const topN = <T>(arr: T[], key: (x: T) => number, n: number, asc = false): T[] =>
    [...arr].sort((x, y) => (asc ? key(x) - key(y) : key(y) - key(x))).slice(0, n);

  const averages: AverageRow[] = [...acc.values()]
    .filter((a) => a.games >= 3)
    .map((a) => ({
      bowlerId: a.bowlerId, bowlerName: a.bowlerName,
      games: a.games,
      scratchAverage: Number((a.scratchPinfall / a.games).toFixed(3)),
      scratchPinfall: a.scratchPinfall,
    }));

  const volume: VolumeRow[] = [...acc.values()].map((a) => ({
    bowlerId: a.bowlerId, bowlerName: a.bowlerName,
    games: a.games, strikes: a.strikes, spares: a.spares, opens: a.opens,
  }));

  const creditedSeasonRows: CreditedSeasonRow[] = [...creditedSeason.values()];

  const standard: StandardLeaderboards = {
    scope,
    scratchHighGame: topN(scratchGames, (x) => x.scratch, 5),
    scratchHighSeries: topN(scratchSets, (x) => x.scratchSet, 5),
    topScratchAverages: topN(averages, (x) => x.scratchAverage, 10),
    hcpHighGame: topN(hcpGames, (x) => x.handicap, 5),
    hcpHighSeries: topN(hcpSets, (x) => x.handicapSet, 5),
    topTotalPoints: topN(creditedSeasonRows, (x) => x.points, 10),
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
        consistency:
          isSeason && a.games >= MIN_CONSISTENCY_SEASON ? stdev(a.gameScores) : 0,
        first5PerMatch: matches > 0 ? a.first5 / matches : 0,
        last5PerMatch: matches > 0 ? a.last5 / matches : 0,
        bigOpeningPerMatch: matches > 0 ? a.bigOpening / matches : 0,
        bigFinishPerMatch: matches > 0 ? a.bigFinish / matches : 0,
        first5Total: a.first5,
        last5Total: a.last5,
        bigOpeningTotal: a.bigOpening,
        bigFinishTotal: a.bigFinish,
        clutchMarks: a.clutchMarks,
        clutchOpportunities: a.clutchOpportunities,
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
}

const SEASON_BOARDS = buildLeaderboardsForScope("season");
const WEEK_BOARDS: Record<number, ReturnType<typeof buildLeaderboardsForScope>> =
  Object.fromEntries(
    WEEKS.filter((w) => w.completed).map((w) => [w.week, buildLeaderboardsForScope(w.week)]),
  );

// ---------------------------------------------------------------------------
// Synthetic sub validator (dev-time). Injects a fake off-roster sub game and
// asserts crediting split. Uses the result+cumulative-only frame shape.
// ---------------------------------------------------------------------------
(function validateSubCrediting() {
  const scheduled = BOWLERS[0];
  const opponent = BOWLERS[1];
  const fakeSubName = "SYNTH SUB — VERIFY";

  // Sub game: 10 open frames, cumulative scoring ≠ ball data. Contribution per
  // frame is 0 (all opens). Final scratchTotal = 0, but we'll override cumulative
  // for the last frame to a very high sentinel to prove roster-only exclusion.
  const openZeros: FrameLinescore[] = Array.from({ length: 9 }).map((_, i) => ({
    frameNumber: i + 1, mark: "-", cumulativeScore: 0,
  }));
  // Frame 10 open, contribution 9 → cumulative 9. Then we deliberately BYPASS
  // the standard summarize path (since we want to inject a sentinel high score)
  // by building the game manually.
  const subFrames: FrameLinescore[] = [
    ...openZeros,
    { frameNumber: 10, mark: "-", cumulativeScore: 9 },
  ];
  // Use summarize to get correct internal counts, then override scratchTotal.
  const baseSub = summarizeGame(subFrames);
  // Sentinel: pretend the actual scratchTotal is 999 for leak detection.
  const fakeGame: GameLinescore = { ...baseSub, scratchTotal: 999 };

  const subLs: BowlerMatchLinescore = {
    scheduledId: scheduled.id, actualId: null,
    actualName: `Sub — ${fakeSubName}`, isSub: true,
    entryAverage: 100, handicap: scheduled.handicap,
    games: [fakeGame, fakeGame, fakeGame],
    scratchSet: 999 * 3,
    handicapGames: [999 + scheduled.handicap, 999 + scheduled.handicap, 999 + scheduled.handicap],
    handicapSet: 999 * 3 + scheduled.handicap * 3,
    strikes: 0, spares: 0, opens: 30, marks: 0, openPinsLeft: 300, framesRolled: 30,
    segments: { first5: 0, last5: 0, bigOpening: 0, bigFinish: 0, clutchMarks: 0, clutchOpportunities: 6 },
  };

  const oppOpens: FrameLinescore[] = Array.from({ length: 10 }).map((_, i) => ({
    frameNumber: i + 1, mark: "-", cumulativeScore: (i + 1) * 5,
  }));
  const oppGame: GameLinescore = summarizeGame(oppOpens);
  const oppLs: BowlerMatchLinescore = {
    scheduledId: opponent.id, actualId: opponent.id, actualName: opponent.name,
    isSub: false, entryAverage: opponent.entryAverage, handicap: opponent.handicap,
    games: [oppGame, oppGame, oppGame],
    scratchSet: oppGame.scratchTotal * 3,
    handicapGames: [
      oppGame.scratchTotal + opponent.handicap,
      oppGame.scratchTotal + opponent.handicap,
      oppGame.scratchTotal + opponent.handicap,
    ],
    handicapSet: oppGame.scratchTotal * 3 + opponent.handicap * 3,
    strikes: 0, spares: 0, opens: 30, marks: 0, openPinsLeft: (10 - 5) * 30, framesRolled: 30,
    segments: matchSegmentsOf([oppGame, oppGame, oppGame]),
  };

  const synthMatch: Match = {
    id: "synth-sub-verify", week: 999, lanePair: "1-2", slot: 1, status: "completed",
    bowlerA: scheduled.id, bowlerB: opponent.id,
    result: {
      scheduledA: scheduled.id, scheduledB: opponent.id,
      actualA: null, actualB: opponent.id,
      actualNameA: subLs.actualName, actualNameB: opponent.name,
      isSubA: true, isSubB: false,
      subA: fakeSubName,
      participationA: {
        scheduledId: scheduled.id, status: "substitute",
        actualId: null, actualName: subLs.actualName,
      },
      participationB: {
        scheduledId: opponent.id, status: "rostered",
        actualId: opponent.id, actualName: opponent.name,
      },
      entryAverageA: 100, entryAverageB: opponent.entryAverage,
      handicapA: scheduled.handicap, handicapB: opponent.handicap,
      linescoreA: subLs, linescoreB: oppLs,
      gamesA: [999, 999, 999],
      gamesB: [oppGame.scratchTotal, oppGame.scratchTotal, oppGame.scratchTotal],
      handicapGamesA: subLs.handicapGames, handicapGamesB: oppLs.handicapGames,
      scratchTotalA: 999 * 3, scratchTotalB: oppGame.scratchTotal * 3,
      handicapTotalA: subLs.handicapSet, handicapTotalB: oppLs.handicapSet,
      gameAwardsA: [2, 2, 2], gameAwardsB: [0, 0, 0],
      gamePointsA: 6, gamePointsB: 0,
      setPointA: 1, setPointB: 0,
      totalPointsA: 7, totalPointsB: 0,
      pointsOverride: null,
      winner: "A",
    },
  };

  const prevWeek = MATCHES_BY_WEEK[999];
  MATCHES_BY_WEEK[999] = [synthMatch];
  WEEKS.push({ week: 999, date: new Date(2099, 0, 1).toISOString(), completed: true });
  try {
    const probe = buildLeaderboardsForScope(999);
    const rosterHasSubScratchGame = probe.standard.scratchHighGame.some(
      (r) => r.bowlerId === scheduled.id || r.scratch >= 999,
    );
    const rosterHasSubScratchSet = probe.standard.scratchHighSeries.some(
      (r) => r.bowlerId === scheduled.id || r.scratchSet >= 999 * 3,
    );
    if (rosterHasSubScratchGame || rosterHasSubScratchSet) {
      throw new Error("Sub crediting bug: sub scratch leaked into roster-only boards.");
    }
    const rosterHasSubAdvanced = probe.advanced.rows.some(
      (r) => r.bowlerId === scheduled.id && r.frames >= 30 && r.opens >= 30,
    );
    if (rosterHasSubAdvanced) {
      throw new Error("Sub crediting bug: sub frames leaked into scheduled bowler advanced row.");
    }
    const hcpGameEntry = probe.standard.hcpHighGame.find(
      (r) => r.matchId === synthMatch.id && r.bowlerId === scheduled.id,
    );
    const hcpSetEntry = probe.standard.hcpHighSeries.find(
      (r) => r.matchId === synthMatch.id && r.bowlerId === scheduled.id,
    );
    if (!hcpGameEntry || !hcpSetEntry) {
      throw new Error("Sub crediting bug: credited HCP not attributed to scheduled bowler.");
    }
    const expectedHcpGame = 999 + scheduled.handicap;
    const expectedHcpSet = 999 * 3 + scheduled.handicap * 3;
    if (hcpGameEntry.handicap !== expectedHcpGame) {
      throw new Error(`Sub crediting bug: credited HCP game = ${hcpGameEntry.handicap}, expected ${expectedHcpGame}.`);
    }
    if (hcpSetEntry.handicapSet !== expectedHcpSet) {
      throw new Error(`Sub crediting bug: credited HCP set = ${hcpSetEntry.handicapSet}, expected ${expectedHcpSet}.`);
    }
    const totalPointsRow = probe.standard.topTotalPoints.find(
      (r) => r.bowlerId === scheduled.id,
    );
    if (!totalPointsRow || totalPointsRow.points < 7) {
      throw new Error("Sub crediting bug: league points not credited to scheduled bowler.");
    }
  } finally {
    if (prevWeek) MATCHES_BY_WEEK[999] = prevWeek;
    else delete MATCHES_BY_WEEK[999];
    const idx = WEEKS.findIndex((w) => w.week === 999);
    if (idx >= 0) WEEKS.splice(idx, 1);
  }
})();

export function getStandardLeaderboards(scope: "season" | number): StandardLeaderboards {
  if (scope === "season") return SEASON_BOARDS.standard;
  return WEEK_BOARDS[scope]?.standard ?? SEASON_BOARDS.standard;
}
export function getAdvancedLeaderboards(scope: "season" | number): AdvancedLeaderboards {
  if (scope === "season") return SEASON_BOARDS.advanced;
  return WEEK_BOARDS[scope]?.advanced ?? SEASON_BOARDS.advanced;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface StandingsRow {
  rank: number;
  bowler: Bowler;
  movement: number;
}

export function getStandingsSnapshot(): StandingsRow[] {
  const sorted = [...BOWLERS].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.handicapPinfall - a.handicapPinfall;
  });
  return sorted.map((b, i) => ({ rank: i + 1, bowler: b, movement: b.movement }));
}

// ---------------------------------------------------------------------------
// Lane Data
// ---------------------------------------------------------------------------

export interface LanePairSummary {
  lanePair: LanePair; games: number; average: number; plusMinusPOA: number;
}
export function getSeasonLaneSummaries(): LanePairSummary[] {
  return LANE_PAIRS.map((lp, i) => ({
    lanePair: lp, games: 180 + i * 3,
    average: Number((138 + (i - 2) * 1.4).toFixed(3)),
    plusMinusPOA: Number(((i - 2) * 0.9 + 1.25).toFixed(2)),
  }));
}
export function getWeekLaneSummaries(week: number): LanePairSummary[] {
  const r = mulberry32(500 + week);
  return LANE_PAIRS.map((lp) => ({
    lanePair: lp, games: 18,
    average: Number((132 + r() * 12).toFixed(3)),
    plusMinusPOA: Number(((r() - 0.5) * 8).toFixed(2)),
  }));
}

// ---------------------------------------------------------------------------
// Elimination
// ---------------------------------------------------------------------------

export type EliminationStatus =
  | "calculating" | "clinched" | "eliminated" | "alive" | "not_proven";
export interface EliminationRow {
  bowler: Bowler; status: EliminationStatus; note?: string;
}
export interface EliminationSnapshot {
  lastCalculatedAt: string; weeksRemaining: number; rows: EliminationRow[];
}
export function getEliminationSnapshot(): EliminationSnapshot {
  const standings = getStandingsSnapshot();
  const rows: EliminationRow[] = standings.map((s, i) => {
    let status: EliminationStatus;
    if (i < 4) status = "clinched";
    else if (i < 10) status = "alive";
    else if (i > 28) status = "eliminated";
    else if (i > 22) status = "not_proven";
    else status = "alive";
    return { bowler: s.bowler, status };
  });
  return {
    lastCalculatedAt: new Date(2026, 6, 20, 21, 42).toISOString(),
    weeksRemaining: WEEKS.length - WEEKS.filter((w) => w.completed).length,
    rows,
  };
}

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
  const pb =
    ((leader.points - bowler.points) + (bowler.pointsLost - leader.pointsLost)) / 2;
  return pb < 0 ? 0 : pb;
}
