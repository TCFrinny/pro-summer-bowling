/**
 * Pro Summer Singles — Phase 1 mock data layer.
 *
 * PERFORMANCE RULE (must remain true through every phase):
 *   Public pages must NEVER trigger season-wide recalculations at render time.
 *   All data exposed from this module represents *already-saved* records or
 *   pre-computed summaries. When the Supabase backend is enabled in a later
 *   phase, the functions in this file are the exact seams that will be
 *   swapped over to database reads / cached materialized-view reads.
 *
 * Do not add solver logic, tournament simulations, or elimination proofs
 * here — those belong in admin-side jobs that write their results back to
 * storage. Public pages then just read what was saved.
 */

export const LEAGUE_NAME = "Pro Summer Singles";
export const VENUE_NAME = "Mt. Airy Lanes";
export const SEASON_LABEL = "2026 Summer";

export type BowlerId = string;

export interface Bowler {
  id: BowlerId;
  name: string;
  entryAverage: number;
  handicap: number;
  /** Season scratch average, pre-computed and stored (3 decimals). */
  scratchAverage: number;
  points: number;
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

export interface MatchResult {
  gamesA: [number, number, number];
  gamesB: [number, number, number];
  handicapA: number;
  handicapB: number;
  gamePointsA: number; // 0..3
  gamePointsB: number;
  setPointA: 0 | 1;
  setPointB: 0 | 1;
  totalPointsA: number; // gamePoints + setPoint
  totalPointsB: number;
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

export const BOWLERS: Bowler[] = FIRST.map((f, i) => {
  const entry = 110 + Math.floor(rand() * 55); // 110..164
  const handicap = Math.max(0, Math.round((175 - entry) * 0.8));
  const scratchAvg = entry + (rand() * 10 - 4);
  const games = 30; // ~10 weeks * 3 games
  const scratchPinfall = Math.round(scratchAvg * games);
  const handicapPinfall = scratchPinfall + handicap * games;
  const points = 20 + Math.floor(rand() * 25);
  const highGame = Math.round(scratchAvg + 30 + rand() * 40);
  const highSet = Math.round(scratchAvg * 3 + 40 + rand() * 60);
  const movement = Math.round((rand() - 0.5) * 6);
  return {
    id: `b${(i + 1).toString().padStart(2, "0")}`,
    name: `${f} ${LAST[i]}`,
    entryAverage: entry,
    handicap,
    scratchAverage: Number(scratchAvg.toFixed(3)),
    points,
    scratchPinfall,
    handicapPinfall,
    highGame,
    highSet,
    movement,
  };
});

export function getBowler(id: BowlerId): Bowler | undefined {
  return BOWLERS.find((b) => b.id === id);
}

// ---------------------------------------------------------------------------
// Weeks + matches (36 bowlers -> 18 matches per week, spread across 6 pairs)
// ---------------------------------------------------------------------------

export const WEEKS: WeekSummary[] = Array.from({ length: 10 }).map((_, i) => ({
  week: i + 1,
  date: new Date(2026, 5, 4 + i * 7).toISOString(),
  completed: i < 6,
}));

function buildWeekMatches(week: number): Match[] {
  const r = mulberry32(1000 + week);
  const shuffled = [...BOWLERS].sort(() => r() - 0.5);
  const matches: Match[] = [];
  // 18 matches -> 3 per lane pair, 6 pairs
  for (let p = 0; p < LANE_PAIRS.length; p++) {
    for (let m = 0; m < 3; m++) {
      const idx = p * 6 + m * 2;
      const a = shuffled[idx];
      const b = shuffled[idx + 1];
      const completed = week <= 6;
      const match: Match = {
        id: `w${week}-${LANE_PAIRS[p]}-${m + 1}`,
        week,
        lanePair: LANE_PAIRS[p],
        bowlerA: a.id,
        bowlerB: b.id,
      };
      if (completed) {
        const g = (bowler: Bowler): [number, number, number] => [
          Math.round(bowler.scratchAverage + (r() * 40 - 20)),
          Math.round(bowler.scratchAverage + (r() * 40 - 20)),
          Math.round(bowler.scratchAverage + (r() * 40 - 20)),
        ];
        const gamesA = g(a);
        const gamesB = g(b);
        let gpA = 0;
        let gpB = 0;
        for (let i = 0; i < 3; i++) {
          const sa = gamesA[i] + a.handicap;
          const sb = gamesB[i] + b.handicap;
          if (sa > sb) gpA++;
          else if (sb > sa) gpB++;
          else {
            gpA += 0.5;
            gpB += 0.5;
          }
        }
        const totalA =
          gamesA.reduce((s, x) => s + x, 0) + a.handicap * 3;
        const totalB =
          gamesB.reduce((s, x) => s + x, 0) + b.handicap * 3;
        const setPointA: 0 | 1 = totalA >= totalB ? 1 : 0;
        const setPointB: 0 | 1 = totalB > totalA ? 1 : 0;
        const totalPointsA = gpA + setPointA;
        const totalPointsB = gpB + setPointB;
        match.result = {
          gamesA,
          gamesB,
          handicapA: a.handicap,
          handicapB: b.handicap,
          gamePointsA: gpA,
          gamePointsB: gpB,
          setPointA,
          setPointB,
          totalPointsA,
          totalPointsB,
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

/** Return already-saved matches for a given week. */
export function getMatchesForWeek(week: number): Match[] {
  return MATCHES_BY_WEEK[week] ?? [];
}

/** Return already-saved matches for a bowler (history). */
export function getBowlerHistory(id: BowlerId) {
  const rows: {
    week: number;
    lanePair: LanePair;
    opponent: string;
    scores: [number, number, number];
    handicap: number;
    points: number;
  }[] = [];
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
          points: m.result.totalPointsA,
        });
      } else if (m.bowlerB === id) {
        rows.push({
          week: w.week,
          lanePair: m.lanePair,
          opponent: getBowler(m.bowlerA)?.name ?? "—",
          scores: m.result.gamesB,
          handicap: m.result.handicapB,
          points: m.result.totalPointsB,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Standings — served from a pre-saved snapshot, NOT computed on page load.
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
