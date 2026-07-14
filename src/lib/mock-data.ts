/**
 * Pro Summer Singles — Phase 1 mock data layer.
 *
 * SOURCE OF TRUTH: full ball-by-ball, frame-by-frame duckpin linescores.
 * Every completed match stores two `BowlerMatchLinescore` objects (three
 * `GameLinescore` each). All game totals, scratch sets, handicap totals,
 * per-game and set awards, standings, statistics, and leaderboards are
 * DERIVED from those frame records at module load. Nothing is hand-entered.
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
 *   - Scratch performance, averages, strikes/spares/opens, and advanced
 *     percentages belong to the ACTUAL bowler who rolled.
 *   - Roster-only boards exclude off-roster substitute performances.
 *
 * PERFORMANCE RULE:
 *   Public pages must NEVER trigger season-wide recalculation on render.
 *   Aggregation (season + per-week leaderboard caches) runs ONCE at module
 *   load. Public route navigation is O(1) map lookup against cached data.
 */

import {
  rollDuckpinGame,
  scoreGame,
  stdev,
  validateGame,
  type Frame,
  type GameLinescore,
  type Roll,
} from "./duckpin";

export { type Frame, type GameLinescore, type Roll };

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
  /**
   * Actual games rolled by the ROSTER member (subs excluded). Feeds scratch
   * average and roster-only boards. May be less than gamesPlayed when the
   * bowler had a sub roll a match on their behalf.
   */
  actualGamesRolled: number;
  actualScratchPinfall: number;
  movement: number;
}

export const LANE_PAIRS = [
  "1-2", "3-4", "5-6", "7-8", "9-10", "11-12",
] as const;
export type LanePair = (typeof LANE_PAIRS)[number];

export type MatchStatus = "scheduled" | "completed";

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

/** Frame-level linescore for one bowler in one match. */
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
  framesRolled: number;
}

/**
 * Full two-bowler linescore for a completed match. The `games*` and
 * `*Total` fields are DERIVED from `linescoreA/B.games[i].scratchTotal`
 * and kept for compatibility with existing consumers.
 */
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
  entryAverageA: number;
  entryAverageB: number;
  handicapA: number;
  handicapB: number;
  linescoreA: BowlerMatchLinescore;
  linescoreB: BowlerMatchLinescore;
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
  winner: "A" | "B" | "T";
}

export function assertMatchResult(m: Match, r: MatchResult): void {
  const id = m.id;
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`Match ${id}: ${msg}`);
  };
  for (let i = 0; i < 3; i++) {
    check(
      r.gameAwardsA[i] + r.gameAwardsB[i] === 2,
      `game ${i + 1} awards must sum to 2`,
    );
    check(
      r.handicapGamesA[i] === r.gamesA[i] + r.handicapA,
      `handicap game A${i + 1} mismatch`,
    );
    check(
      r.handicapGamesB[i] === r.gamesB[i] + r.handicapB,
      `handicap game B${i + 1} mismatch`,
    );
    check(
      r.linescoreA.games[i].scratchTotal === r.gamesA[i],
      `frame-derived A${i + 1} total ${r.linescoreA.games[i].scratchTotal} ≠ recorded ${r.gamesA[i]}`,
    );
    check(
      r.linescoreB.games[i].scratchTotal === r.gamesB[i],
      `frame-derived B${i + 1} total ${r.linescoreB.games[i].scratchTotal} ≠ recorded ${r.gamesB[i]}`,
    );
  }
  const scratchA = r.gamesA[0] + r.gamesA[1] + r.gamesA[2];
  const scratchB = r.gamesB[0] + r.gamesB[1] + r.gamesB[2];
  check(scratchA === r.scratchTotalA, "scratchTotalA mismatch");
  check(scratchB === r.scratchTotalB, "scratchTotalB mismatch");
  check(r.handicapTotalA === scratchA + r.handicapA * 3, "handicapTotalA mismatch");
  check(r.handicapTotalB === scratchB + r.handicapB * 3, "handicapTotalB mismatch");
  check(r.setPointA + r.setPointB === 1, "set points must sum to 1");
  check(
    r.totalPointsA + r.totalPointsB === 7,
    `match must distribute exactly 7 points (got ${r.totalPointsA}+${r.totalPointsB})`,
  );
  // Frame legality
  for (let i = 0; i < 3; i++) {
    validateGame(r.linescoreA.games[i], `${id} sideA game ${i + 1}`);
    validateGame(r.linescoreB.games[i], `${id} sideB game ${i + 1}`);
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
    entryAverage: entry,
    handicap,
    scratchAverage: 0,
    points: 0,
    pointsLost: 0,
    gamePoints: 0,
    setPoints: 0,
    scratchPinfall: 0,
    handicapPinfall: 0,
    highGame: 0,
    highSet: 0,
    matchesPlayed: 0,
    gamesPlayed: 0,
    actualGamesRolled: 0,
    actualScratchPinfall: 0,
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

function buildBowlerLinescore(
  scheduled: Bowler,
  isSub: boolean,
  subName: string | null,
  r: () => number,
): BowlerMatchLinescore {
  // Actual bowler's skill differs when a sub rolls.
  const actualEntry = isSub
    ? Math.round(100 + r() * 60)
    : scheduled.entryAverage;
  const skill = Math.max(0.1, Math.min(0.95, (actualEntry - 90) / 80));
  const games: [GameLinescore, GameLinescore, GameLinescore] = [
    rollDuckpinGame(r, skill),
    rollDuckpinGame(r, skill),
    rollDuckpinGame(r, skill),
  ];
  const handicap = scheduled.handicap; // handicap tied to SCHEDULED bowler
  const handicapGames: [number, number, number] = [
    games[0].scratchTotal + handicap,
    games[1].scratchTotal + handicap,
    games[2].scratchTotal + handicap,
  ];
  const scratchSet =
    games[0].scratchTotal + games[1].scratchTotal + games[2].scratchTotal;
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
    strikes,
    spares,
    opens,
    marks: strikes + spares,
    openPinsLeft,
    framesRolled: 30,
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
        week,
        lanePair: LANE_PAIRS[p],
        slot: m + 1,
        status: completed ? "completed" : "scheduled",
        bowlerA: a.id,
        bowlerB: b.id,
      };
      if (completed) {
        const isSubA = r() < 0.06;
        const isSubB = r() < 0.06;
        const subNameA = isSubA
          ? SUB_NAMES[Math.floor(r() * SUB_NAMES.length)]
          : null;
        const subNameB = isSubB
          ? SUB_NAMES[Math.floor(r() * SUB_NAMES.length)]
          : null;
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
          entryAverageA: a.entryAverage, entryAverageB: b.entryAverage,
          handicapA: a.handicap, handicapB: b.handicap,
          linescoreA: lsA, linescoreB: lsB,
          gamesA, gamesB,
          handicapGamesA: lsA.handicapGames,
          handicapGamesB: lsB.handicapGames,
          scratchTotalA: lsA.scratchSet,
          scratchTotalB: lsB.scratchSet,
          handicapTotalA: lsA.handicapSet,
          handicapTotalB: lsB.handicapSet,
          gameAwardsA, gameAwardsB,
          gamePointsA: gpA, gamePointsB: gpB,
          setPointA, setPointB,
          totalPointsA, totalPointsB,
          winner:
            totalPointsA > totalPointsB ? "A"
            : totalPointsB > totalPointsA ? "B" : "T",
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

      // League points and HANDICAP pinfall credited to SCHEDULED bowler.
      a.matchesPlayed += 1; a.gamesPlayed += 3;
      a.gamePoints += r.gamePointsA; a.setPoints += r.setPointA;
      a.points += r.totalPointsA; a.pointsLost += 7 - r.totalPointsA;
      a.handicapPinfall += r.handicapTotalA;

      b.matchesPlayed += 1; b.gamesPlayed += 3;
      b.gamePoints += r.gamePointsB; b.setPoints += r.setPointB;
      b.points += r.totalPointsB; b.pointsLost += 7 - r.totalPointsB;
      b.handicapPinfall += r.handicapTotalB;

      // Scratch pinfall / high game / high set / actual games are ROSTER-ONLY —
      // only games the roster member personally rolled contribute.
      if (!r.isSubA) {
        a.actualGamesRolled += 3;
        a.actualScratchPinfall += r.scratchTotalA;
        a.scratchPinfall += r.scratchTotalA;
        for (const g of r.gamesA) if (g > a.highGame) a.highGame = g;
        if (r.scratchTotalA > a.highSet) a.highSet = r.scratchTotalA;
      }
      if (!r.isSubB) {
        b.actualGamesRolled += 3;
        b.actualScratchPinfall += r.scratchTotalB;
        b.scratchPinfall += r.scratchTotalB;
        for (const g of r.gamesB) if (g > b.highGame) b.highGame = g;
        if (r.scratchTotalB > b.highSet) b.highSet = r.scratchTotalB;
      }
    }
  }
  for (const bowler of BOWLERS) {
    // Scratch average uses ROSTER-ONLY (actual) games; when a bowler never
    // rolled personally, fall back to entryAverage so display isn't blank.
    bowler.scratchAverage =
      bowler.actualGamesRolled > 0
        ? Number(
            (bowler.actualScratchPinfall / bowler.actualGamesRolled).toFixed(3),
          )
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

/** All completed matches, flat. */
function allCompletedMatches(): Match[] {
  const out: Match[] = [];
  for (const w of WEEKS) if (w.completed) out.push(...MATCHES_BY_WEEK[w.week]);
  return out;
}

// ---------------------------------------------------------------------------
// Bowler history + season extras (derived from frames).
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
  poaSet: number;
  poaBestGame: number;
  result: "W" | "L" | "T";
  linescore: BowlerMatchLinescore;
  opponentLinescore: BowlerMatchLinescore;
  weekStrikes: number;
  weekSpares: number;
  weekOpens: number;
  weekMarks: number;
  weekMarkPct: number;
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
      const tp = isA ? res.totalPointsA : res.totalPointsB;
      const awards = isA ? res.gameAwardsA : res.gameAwardsB;
      const isSub = isA ? res.isSubA : res.isSubB;
      const ls = isA ? res.linescoreA : res.linescoreB;
      const oppLs = isA ? res.linescoreB : res.linescoreA;
      const poaSet = scratchTotal - 3 * self.entryAverage;
      const poaBest = Math.max(...scores.map((g) => g - self.entryAverage));
      const wMarks = ls.marks;
      const wMarkPct = ls.framesRolled > 0 ? (wMarks / ls.framesRolled) * 100 : 0;
      rows.push({
        week: w.week,
        matchId: m.id,
        lanePair: m.lanePair,
        opponent: opp?.name ?? "—",
        opponentId: oppId,
        actualBowler: isSub ? ls.actualName : self.name,
        isSub,
        scores,
        handicap: hdcp,
        handicapGames: hdcpGames,
        scratchTotal,
        handicapTotal: hdcpTotal,
        opponentScratchTotal: isA ? res.scratchTotalB : res.scratchTotalA,
        opponentHandicapTotal: isA ? res.handicapTotalB : res.handicapTotalA,
        gameAwards: awards,
        gamePoints: gp,
        setPoint: sp,
        totalPoints: tp,
        pointsLost: 7 - tp,
        poaSet,
        poaBestGame: poaBest,
        result:
          res.winner === "T" ? "T"
          : (isA ? res.winner === "A" : res.winner === "B") ? "W" : "L",
        linescore: ls,
        opponentLinescore: oppLs,
        weekStrikes: ls.strikes,
        weekSpares: ls.spares,
        weekOpens: ls.opens,
        weekMarks: wMarks,
        weekMarkPct: wMarkPct,
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
  pinsLost: number; // avg pins standing on open frames
  consistency: number; // stdev of scratch game scores
}

/** Roster-only frame aggregation across a bowler's completed matches. */
function collectFrameStats(id: BowlerId, weekFilter?: number) {
  const self = getBowler(id);
  const empty = {
    strikes: 0, spares: 0, opens: 0, framesRolled: 0,
    openPinsLeft: 0, gameScores: [] as number[], scratchPinfall: 0,
  };
  if (!self) return empty;
  const out = { ...empty };
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
      // Roster-only: exclude when a sub rolled for this bowler.
      if (ls.isSub) continue;
      out.strikes += ls.strikes;
      out.spares += ls.spares;
      out.opens += ls.opens;
      out.framesRolled += ls.framesRolled;
      out.openPinsLeft += ls.openPinsLeft;
      out.scratchPinfall += ls.scratchSet;
      for (const g of ls.games) out.gameScores.push(g.scratchTotal);
    }
  }
  return out;
}

export function getBowlerSeasonExtras(id: BowlerId): BowlerSeasonExtras {
  const self = getBowler(id);
  const rows = getBowlerHistory(id);
  if (!self) {
    return {
      bestGamePOA: 0, bestSetPOA: 0, seasonPOA: 0,
      lanePairUsage: LANE_PAIRS.map((lp) => ({ lanePair: lp, count: 0 })),
      strikes: 0, spares: 0, opens: 0, marks: 0, framesRolled: 0,
      markPct: 0, strikePct: 0, sparePct: 0, openPct: 0,
      spareConversionPct: 0, pinsLost: 0, consistency: 0,
    };
  }
  let bestGame = 0, bestSet = 0;
  const usage = new Map<LanePair, number>(LANE_PAIRS.map((lp) => [lp, 0]));
  for (const r of rows) {
    if (r.poaBestGame > bestGame || bestGame === 0) bestGame = r.poaBestGame;
    if (r.poaSet > bestSet || bestSet === 0) bestSet = r.poaSet;
    usage.set(r.lanePair, (usage.get(r.lanePair) ?? 0) + 1);
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
    lanePairUsage: LANE_PAIRS.map((lp) => ({
      lanePair: lp,
      count: usage.get(lp) ?? 0,
    })),
    strikes: s.strikes,
    spares: s.spares,
    opens: s.opens,
    marks,
    framesRolled,
    markPct: framesRolled > 0 ? (marks / framesRolled) * 100 : 0,
    strikePct: framesRolled > 0 ? (s.strikes / framesRolled) * 100 : 0,
    sparePct: framesRolled > 0 ? (s.spares / framesRolled) * 100 : 0,
    openPct: framesRolled > 0 ? (s.opens / framesRolled) * 100 : 0,
    spareConversionPct: spareOpp > 0 ? (s.spares / spareOpp) * 100 : 0,
    pinsLost: s.opens > 0 ? s.openPinsLeft / s.opens : 0,
    consistency: stdev(s.gameScores),
  };
}

// ---------------------------------------------------------------------------
// Leaderboard cache (season + per-week). Built ONCE at module load.
// ---------------------------------------------------------------------------

export interface ScratchGameRow {
  bowlerId: BowlerId;
  bowlerName: string;
  week: number;
  matchId: string;
  opponent: string;
  scratch: number;
  handicap: number; // scratch + weekly handicap
}
export interface ScratchSetRow {
  bowlerId: BowlerId;
  bowlerName: string;
  week: number;
  matchId: string;
  opponent: string;
  scratchSet: number;
  handicapSet: number;
}
export interface AverageRow {
  bowlerId: BowlerId;
  bowlerName: string;
  games: number;
  scratchAverage: number;
  scratchPinfall: number;
}
export interface CreditedRow {
  bowlerId: BowlerId;
  bowlerName: string;
  week: number;
  matchId: string;
  opponent: string;
  handicapScore: number;
}
export interface CreditedSeasonRow {
  bowlerId: BowlerId;
  bowlerName: string;
  points: number;
  pointsLost: number;
  matches: number;
}
export interface VolumeRow {
  bowlerId: BowlerId;
  bowlerName: string;
  games: number;
  strikes: number;
  spares: number;
  opens: number;
}
export interface AdvancedRow {
  bowlerId: BowlerId;
  bowlerName: string;
  games: number;
  frames: number;
  strikes: number;
  spares: number;
  opens: number;
  marks: number;
  markPct: number;
  strikePct: number;
  sparePct: number;
  openPct: number;
  spareConversionPct: number;
  pinsLost: number;
  consistency: number;
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
}

/** Walk every completed match once and emit roster-only + credited rows. */
function buildLeaderboardsForScope(
  scope: "season" | number,
): { standard: StandardLeaderboards; advanced: AdvancedLeaderboards } {
  const matches: Match[] =
    scope === "season" ? allCompletedMatches() : getMatchesForWeek(scope).filter((m) => m.result);

  // Roster-only per-game and per-set rows (scratch performance stays with actual bowler).
  const scratchGames: ScratchGameRow[] = [];
  const scratchSets: ScratchSetRow[] = [];

  // Credited per-game and per-set rows — HCP boards credit the SCHEDULED bowler
  // and use the scratch actually rolled + that bowler's weekly handicap.
  const hcpGames: ScratchGameRow[] = [];
  const hcpSets: ScratchSetRow[] = [];

  // Roster-only per-bowler aggregates for averages, volume, advanced.
  interface Acc {
    bowlerId: BowlerId;
    bowlerName: string;
    games: number;
    frames: number;
    strikes: number;
    spares: number;
    opens: number;
    openPinsLeft: number;
    scratchPinfall: number;
    gameScores: number[];
  }
  const acc = new Map<BowlerId, Acc>();
  const ensure = (id: BowlerId, name: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = {
        bowlerId: id, bowlerName: name,
        games: 0, frames: 0, strikes: 0, spares: 0, opens: 0,
        openPinsLeft: 0, scratchPinfall: 0, gameScores: [],
      };
      acc.set(id, a);
    }
    return a;
  };

  // Credited season points/matches also tie to the SCHEDULED bowler.
  const creditedSeason = new Map<BowlerId, CreditedSeasonRow>();

  for (const m of matches) {
    const r = m.result;
    if (!r) continue;
    const schedA = getBowler(m.bowlerA);
    const schedB = getBowler(m.bowlerB);
    if (!schedA || !schedB) continue;
    const oppNameA = schedB.name;
    const oppNameB = schedA.name;

    for (const side of ["A", "B"] as const) {
      const isA = side === "A";
      const sched = isA ? schedA : schedB;
      const ls = isA ? r.linescoreA : r.linescoreB;
      const opp = isA ? oppNameA : oppNameB;
      const scratchTot = isA ? r.scratchTotalA : r.scratchTotalB;
      const hdcpTot = isA ? r.handicapTotalA : r.handicapTotalB;
      const hdcpGamesArr = isA ? r.handicapGamesA : r.handicapGamesB;
      const scratchGamesArr = isA ? r.gamesA : r.gamesB;
      const totalPts = isA ? r.totalPointsA : r.totalPointsB;

      // CREDITED (points/hcp always attributed to the SCHEDULED bowler,
      // using the scratch actually rolled + that bowler's weekly handicap).
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
        seasonRow = {
          bowlerId: sched.id, bowlerName: sched.name,
          points: 0, pointsLost: 0, matches: 0,
        };
        creditedSeason.set(sched.id, seasonRow);
      }
      seasonRow.points += totalPts;
      seasonRow.pointsLost += 7 - totalPts;
      seasonRow.matches += 1;

      // ROSTER-ONLY (actual bowler only, and only if roster member).
      // Scratch high game/series, averages, strikes/spares/opens, advanced.
      if (!ls.isSub && ls.actualId) {
        const rosterId = ls.actualId;
        const rosterName = getBowler(rosterId)?.name ?? ls.actualName;
        for (let i = 0; i < 3; i++) {
          const g = ls.games[i];
          scratchGames.push({
            bowlerId: rosterId, bowlerName: rosterName,
            week: m.week, matchId: m.id, opponent: opp,
            scratch: g.scratchTotal,
            handicap: g.scratchTotal + ls.handicap,
          });
        }
        scratchSets.push({
          bowlerId: rosterId, bowlerName: rosterName,
          week: m.week, matchId: m.id, opponent: opp,
          scratchSet: ls.scratchSet, handicapSet: ls.handicapSet,
        });
        const a = ensure(rosterId, rosterName);
        a.games += 3;
        a.frames += ls.framesRolled;
        a.strikes += ls.strikes;
        a.spares += ls.spares;
        a.opens += ls.opens;
        a.openPinsLeft += ls.openPinsLeft;
        a.scratchPinfall += ls.scratchSet;
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
    games: a.games,
    strikes: a.strikes, spares: a.spares, opens: a.opens,
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

  // Advanced (roster-only)
  const MIN_PCT = 3;
  const MIN_CONSISTENCY_SEASON = 6;
  const isSeason = scope === "season";
  const consistencyEligible = isSeason; // week view: skip consistency ranking
  const rows: AdvancedRow[] = [...acc.values()]
    .filter((a) => a.games >= MIN_PCT)
    .map((a) => {
      const marks = a.strikes + a.spares;
      const spareOpp = a.spares + a.opens;
      return {
        bowlerId: a.bowlerId, bowlerName: a.bowlerName,
        games: a.games, frames: a.frames,
        strikes: a.strikes, spares: a.spares, opens: a.opens, marks,
        markPct: a.frames > 0 ? (marks / a.frames) * 100 : 0,
        strikePct: a.frames > 0 ? (a.strikes / a.frames) * 100 : 0,
        sparePct: a.frames > 0 ? (a.spares / a.frames) * 100 : 0,
        openPct: a.frames > 0 ? (a.opens / a.frames) * 100 : 0,
        spareConversionPct: spareOpp > 0 ? (a.spares / spareOpp) * 100 : 0,
        pinsLost: a.opens > 0 ? a.openPinsLeft / a.opens : 0,
        consistency:
          consistencyEligible && a.games >= MIN_CONSISTENCY_SEASON
            ? stdev(a.gameScores)
            : 0,
      };
    });

  const advanced: AdvancedLeaderboards = {
    scope,
    rows,
    minGamesForPct: MIN_PCT,
    consistencyEligible,
    minGamesForConsistency: MIN_CONSISTENCY_SEASON,
  };
  return { standard, advanced };
}

const SEASON_BOARDS = buildLeaderboardsForScope("season");
const WEEK_BOARDS: Record<number, ReturnType<typeof buildLeaderboardsForScope>> =
  Object.fromEntries(
    WEEKS.filter((w) => w.completed).map((w) => [w.week, buildLeaderboardsForScope(w.week)]),
  );

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
  return sorted.map((b, i) => ({
    rank: i + 1, bowler: b, movement: b.movement,
  }));
}

// ---------------------------------------------------------------------------
// Lane Data
// ---------------------------------------------------------------------------

export interface LanePairSummary {
  lanePair: LanePair;
  games: number;
  average: number;
  plusMinusPOA: number;
}

export function getSeasonLaneSummaries(): LanePairSummary[] {
  return LANE_PAIRS.map((lp, i) => ({
    lanePair: lp,
    games: 180 + i * 3,
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

/** Force scoreGame to remain reachable (also used by tests). */
export { scoreGame };

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
