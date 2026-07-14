/**
 * Pro Summer Singles — Phase 1 mock data layer.
 *
 * SCORING (7-point duckpin singles):
 *   - 3 games per match.
 *   - Each game is worth 2 points. Win = 2, tie = 1 each, loss = 0.
 *   - The 3-game set is worth 1 point, decided by TOTAL HANDICAP PINFALL.
 *     Win = 1, tie = 0.5 each, loss = 0.
 *   - Exactly 7 points are distributed per matchup (ties included).
 *   - Any bowler's match total can be 0, 0.5, 1, 1.5, ... up to 7.
 *   - Handicap = floor(0.80 * (160 - entryAverage)), minimum 0.
 *   - Season length = 11 weeks.
 *   - Official standings: total points DESC, then handicap pinfall DESC.
 *   - Season averages are SCRATCH ONLY, displayed to 3 decimals.
 *
 * PERFORMANCE RULE (must remain true through every phase):
 *   Public pages must NEVER trigger season-wide recalculations at render
 *   time. Everything exported here represents *already-saved* records or
 *   pre-computed summaries. In Phase 2 these helpers are the seams that
 *   get swapped for database / materialized-view reads.
 */

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
  /** Season scratch average, pre-computed and stored (3 decimals). */
  scratchAverage: number;
  /** Season total match points WON (0..7 per match, half-points allowed). */
  points: number;
  /** Season total match points LOST — equals (7 * matchesPlayed) − points. */
  pointsLost: number;
  /** Season total game points only (0..6 per match, half-points allowed). */
  gamePoints: number;
  /**
   * Season total set-point contribution (0, 0.5, or 1 per match).
   * Retained internally because the set point still contributes to the
   * 7-point match total, but it is no longer displayed as a separate
   * standings statistic.
   */
  setPoints: number;
  scratchPinfall: number;
  handicapPinfall: number;
  highGame: number;
  highSet: number;
  /** +/- movement in standings since last week. */
  movement: number;
}

export const LANE_PAIRS = [
  "1-2",
  "3-4",
  "5-6",
  "7-8",
  "9-10",
  "11-12",
] as const;
export type LanePair = (typeof LANE_PAIRS)[number];

export interface Match {
  id: string;
  week: number;
  lanePair: LanePair;
  bowlerA: BowlerId;
  bowlerB: BowlerId;
  /** Populated only for completed weeks. */
  result?: MatchResult;
}

/** Per-game awarded points: 2 (win), 1 (tie), or 0 (loss). */
export type GameAward = 0 | 1 | 2;
/** Set point award based on 3-game handicap pinfall total. */
export type SetAward = 0 | 0.5 | 1;

export interface MatchResult {
  gamesA: [number, number, number];
  gamesB: [number, number, number];
  handicapA: number;
  handicapB: number;
  /** Awarded points per game for each side (each entry 0, 1, or 2). */
  gameAwardsA: [GameAward, GameAward, GameAward];
  gameAwardsB: [GameAward, GameAward, GameAward];
  /** Sum of gameAwards (0..6, half-steps possible only via ties -> integer). */
  gamePointsA: number;
  gamePointsB: number;
  /** Set point award from total handicap pinfall (0, 0.5, or 1). */
  setPointA: SetAward;
  setPointB: SetAward;
  /** gamePoints + setPoint (0..7, always sums to 7 with opponent). */
  totalPointsA: number;
  totalPointsB: number;
  /** Total handicap pinfall for the 3 games. */
  handicapTotalA: number;
  handicapTotalB: number;
  subA?: string;
  subB?: string;
  winner: "A" | "B" | "T";
}

export interface WeekSummary {
  week: number;
  date: string; // ISO
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

// Bowlers start empty on the aggregate fields — they are filled in from the
// generated match data below so the season totals stay internally consistent.
export const BOWLERS: Bowler[] = FIRST.map((f, i) => {
  const entry = 110 + Math.floor(rand() * 55); // 110..164
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
// Weeks + matches (11 weeks; 7 completed to give a mid-season snapshot)
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
        bowlerA: a.id,
        bowlerB: b.id,
      };
      if (completed) {
        const rollGame = (bowler: Bowler): number => {
          // Draw around the entry average with realistic spread; keep in
          // reasonable duckpin bounds.
          const base = bowler.entryAverage + (r() * 40 - 20);
          return Math.max(60, Math.min(210, Math.round(base)));
        };
        const gamesA: [number, number, number] = [
          rollGame(a), rollGame(a), rollGame(a),
        ];
        const gamesB: [number, number, number] = [
          rollGame(b), rollGame(b), rollGame(b),
        ];

        const gameAwardsA: [GameAward, GameAward, GameAward] = [0, 0, 0];
        const gameAwardsB: [GameAward, GameAward, GameAward] = [0, 0, 0];
        let gpA = 0;
        let gpB = 0;
        for (let i = 0; i < 3; i++) {
          const sa = gamesA[i] + a.handicap;
          const sb = gamesB[i] + b.handicap;
          if (sa > sb) {
            gameAwardsA[i] = 2;
            gameAwardsB[i] = 0;
            gpA += 2;
          } else if (sb > sa) {
            gameAwardsA[i] = 0;
            gameAwardsB[i] = 2;
            gpB += 2;
          } else {
            gameAwardsA[i] = 1;
            gameAwardsB[i] = 1;
            gpA += 1;
            gpB += 1;
          }
        }
        const handicapTotalA =
          gamesA.reduce((s, x) => s + x, 0) + a.handicap * 3;
        const handicapTotalB =
          gamesB.reduce((s, x) => s + x, 0) + b.handicap * 3;

        let setPointA: SetAward;
        let setPointB: SetAward;
        if (handicapTotalA > handicapTotalB) {
          setPointA = 1;
          setPointB = 0;
        } else if (handicapTotalB > handicapTotalA) {
          setPointA = 0;
          setPointB = 1;
        } else {
          setPointA = 0.5;
          setPointB = 0.5;
        }

        const totalPointsA = gpA + setPointA;
        const totalPointsB = gpB + setPointB;

        match.result = {
          gamesA,
          gamesB,
          handicapA: a.handicap,
          handicapB: b.handicap,
          gameAwardsA,
          gameAwardsB,
          gamePointsA: gpA,
          gamePointsB: gpB,
          setPointA,
          setPointB,
          totalPointsA,
          totalPointsB,
          handicapTotalA,
          handicapTotalB,
          winner:
            totalPointsA > totalPointsB
              ? "A"
              : totalPointsB > totalPointsA
                ? "B"
                : "T",
          subA: r() < 0.06 ? "sub" : undefined,
          subB: r() < 0.06 ? "sub" : undefined,
        };
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
// Aggregate season totals into each bowler (once, at module load).
// ---------------------------------------------------------------------------

(function aggregateSeasonTotals() {
  const gamesPlayed: Record<BowlerId, number> = {};
  for (const w of WEEKS) {
    if (!w.completed) continue;
    for (const m of MATCHES_BY_WEEK[w.week]) {
      const r = m.result;
      if (!r) continue;
      const a = BOWLERS_BY_ID[m.bowlerA];
      const b = BOWLERS_BY_ID[m.bowlerB];

      const applySide = (
        bowler: Bowler,
        games: [number, number, number],
        hdcp: number,
        gp: number,
        sp: number,
        total: number,
        hdcpTotal: number,
      ) => {
        gamesPlayed[bowler.id] = (gamesPlayed[bowler.id] ?? 0) + 3;
        bowler.gamePoints += gp;
        bowler.setPoints += sp;
        bowler.points += total;
        // Each match distributes exactly 7 points; the opponent's share is
        // this bowler's "points lost" for W-L record purposes.
        bowler.pointsLost += 7 - total;
        bowler.scratchPinfall += games.reduce((s, x) => s + x, 0);
        bowler.handicapPinfall += hdcpTotal;
        for (const g of games) {
          if (g > bowler.highGame) bowler.highGame = g;
        }
        const scratchSet = games.reduce((s, x) => s + x, 0);
        if (scratchSet > bowler.highSet) bowler.highSet = scratchSet;
        void hdcp;
      };

      applySide(
        a, r.gamesA, r.handicapA, r.gamePointsA, r.setPointA,
        r.totalPointsA, r.handicapTotalA,
      );
      applySide(
        b, r.gamesB, r.handicapB, r.gamePointsB, r.setPointB,
        r.totalPointsB, r.handicapTotalB,
      );
    }
  }
  for (const bowler of BOWLERS) {
    const g = gamesPlayed[bowler.id] ?? 0;
    bowler.scratchAverage =
      g > 0 ? Number((bowler.scratchPinfall / g).toFixed(3)) : 0;
  }
})();

/** Return already-saved matches for a given week. */
export function getMatchesForWeek(week: number): Match[] {
  return MATCHES_BY_WEEK[week] ?? [];
}

export interface BowlerHistoryRow {
  week: number;
  lanePair: LanePair;
  opponent: string;
  scores: [number, number, number];
  handicap: number;
  gameAwards: [GameAward, GameAward, GameAward];
  gamePoints: number;
  setPoint: SetAward;
  totalPoints: number;
}

/** Return already-saved match rows for a bowler (history). */
export function getBowlerHistory(id: BowlerId): BowlerHistoryRow[] {
  const rows: BowlerHistoryRow[] = [];
  for (const w of WEEKS) {
    if (!w.completed) continue;
    for (const m of getMatchesForWeek(w.week)) {
      if (!m.result) continue;
      if (m.bowlerA === id) {
        rows.push({
          week: w.week,
          lanePair: m.lanePair,
          opponent: getBowler(m.bowlerB)?.name ?? "—",
          scores: m.result.gamesA,
          handicap: m.result.handicapA,
          gameAwards: m.result.gameAwardsA,
          gamePoints: m.result.gamePointsA,
          setPoint: m.result.setPointA,
          totalPoints: m.result.totalPointsA,
        });
      } else if (m.bowlerB === id) {
        rows.push({
          week: w.week,
          lanePair: m.lanePair,
          opponent: getBowler(m.bowlerA)?.name ?? "—",
          scores: m.result.gamesB,
          handicap: m.result.handicapB,
          gameAwards: m.result.gameAwardsB,
          gamePoints: m.result.gamePointsB,
          setPoint: m.result.setPointB,
          totalPoints: m.result.totalPointsB,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Standings — served from a pre-saved snapshot, NOT computed on page load.
// Official tiebreaker: points DESC, then handicap pinfall DESC.
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
    rank: i + 1,
    bowler: b,
    movement: b.movement,
  }));
}

// ---------------------------------------------------------------------------
// Lane Data — pre-computed lane-pair summaries.
// ---------------------------------------------------------------------------

export interface LanePairSummary {
  lanePair: LanePair;
  games: number;
  average: number;
  plusMinusPOA: number; // pins over average
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
    lanePair: lp,
    games: 18,
    average: Number((132 + r() * 12).toFixed(3)),
    plusMinusPOA: Number(((r() - 0.5) * 8).toFixed(2)),
  }));
}

// ---------------------------------------------------------------------------
// Elimination — reads already-saved proofs. Never solves on render.
// ---------------------------------------------------------------------------

export type EliminationStatus =
  | "calculating"
  | "clinched"
  | "eliminated"
  | "alive"
  | "not_proven";

export interface EliminationRow {
  bowler: Bowler;
  status: EliminationStatus;
  note?: string;
}

export interface EliminationSnapshot {
  lastCalculatedAt: string; // ISO timestamp of last admin publish
  weeksRemaining: number;
  rows: EliminationRow[];
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

/** Format a points value (may be a half-integer) as "5", "4.5", etc. */
export function formatPoints(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

/** Format a bowler's W-L record, e.g. "31 - 18" or "24.5 - 24.5". */
export function formatRecord(won: number, lost: number): string {
  return `${formatPoints(won)} - ${formatPoints(lost)}`;
}

/**
 * Standard games-behind formula applied to points won/lost. Works even if
 * bowlers have completed different numbers of matches.
 *   PB = ((leaderWon - bowlerWon) + (bowlerLost - leaderLost)) / 2
 * The leader returns 0; the caller decides how to display that (usually "—").
 */
export function computePointsBehind(
  leader: Pick<Bowler, "points" | "pointsLost">,
  bowler: Pick<Bowler, "points" | "pointsLost">,
): number {
  const pb =
    ((leader.points - bowler.points) + (bowler.pointsLost - leader.pointsLost)) /
    2;
  // Clamp tiny negatives from floating-point noise.
  return pb < 0 ? 0 : pb;
}

