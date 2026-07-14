/**
 * Pro Summer Singles — Phase 1 mock data layer.
 *
 * SCORING (7-point duckpin singles):
 *   - 3 games per match.
 *   - Each game is worth 2 points. Win = 2, tie = 1 each, loss = 0
 *     (based on the handicap game score).
 *   - The 3-game set is worth 1 point, decided by TOTAL HANDICAP PINFALL.
 *     Win = 1, tie = 0.5 each, loss = 0.
 *   - Exactly 7 points are distributed per matchup (ties included).
 *   - Any bowler's match total can be 0, 0.5, 1, 1.5, ... up to 7.
 *   - Handicap = floor(0.80 * (160 - entryAverage)), minimum 0.
 *   - Season length = 11 weeks.
 *   - Official standings: total points won DESC, then handicap pinfall DESC.
 *   - Season averages are SCRATCH ONLY, displayed to 3 decimals.
 *
 * LINESCORES ARE THE SOURCE OF TRUTH:
 *   Every completed match stores a full two-bowler linescore (see
 *   `MatchResult`): scheduled + actual bowler per side, sub flag, entry
 *   average, handicap, three scratch games, three handicap games, scratch
 *   and handicap 3-game totals, per-game point awards, set point, and
 *   final match points. All season aggregates and leaderboards are
 *   derived once at module load from these linescores. There are no
 *   hand-entered aggregate numbers that can drift.
 *
 *   POA BASELINE (Phase 1): pins-over-average uses each bowler's
 *   ENTRY AVERAGE as the baseline (POA = scratch score − entry average).
 *   When the DB lands, this becomes a rolling scratch average per bowler.
 *
 * PERFORMANCE RULE (must remain true through every phase):
 *   Public pages must NEVER trigger season-wide recalculations at render
 *   time. Everything exported here represents *already-saved* records or
 *   pre-computed summaries. Aggregation runs ONCE at module load; public
 *   route navigation is O(bowlers) lookups against those cached maps.
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
  /** Season total game points only (0..6 per match). */
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
  /** Number of full 3-game sets rolled (== matches played, absent forfeits). */
  matchesPlayed: number;
  /** Total individual games rolled (== matchesPlayed * 3 in Phase 1). */
  gamesPlayed: number;
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

export type MatchStatus = "scheduled" | "completed";

export interface Match {
  id: string;
  week: number;
  lanePair: LanePair;
  /** Match number within the lane pair (1..3). */
  slot: number;
  status: MatchStatus;
  /** Scheduled bowler on side A / B (roster assignment). */
  bowlerA: BowlerId;
  bowlerB: BowlerId;
  /** Populated only when status === "completed". */
  result?: MatchResult;
}


/** Per-game awarded points: 2 (win), 1 (tie), or 0 (loss). */
export type GameAward = 0 | 1 | 2;
/** Set point award based on 3-game handicap pinfall total. */
export type SetAward = 0 | 0.5 | 1;

/**
 * Full two-bowler linescore for a completed match. This is the source of
 * truth — every standings, statistic, and profile total is derived from
 * these fields at module load. See `assertMatchResult` for the invariants
 * enforced on this data.
 */
export interface MatchResult {
  /** Scheduled (rostered) bowlers, mirroring `Match.bowlerA/B`. */
  scheduledA: BowlerId;
  scheduledB: BowlerId;
  /** Bowler who actually rolled that night (may differ if a sub filled in). */
  actualA: BowlerId;
  actualB: BowlerId;
  /** Sub flags for quick UI badges. */
  isSubA: boolean;
  isSubB: boolean;
  /** Optional short label for the substitute ("sub" for now). */
  subA?: string;
  subB?: string;
  /** Entry (book) averages used to compute the handicap for this match. */
  entryAverageA: number;
  entryAverageB: number;
  /** Weekly handicap applied to each game (constant across the 3 games). */
  handicapA: number;
  handicapB: number;
  /** Scratch (raw) game scores for the three games. */
  gamesA: [number, number, number];
  gamesB: [number, number, number];
  /** Handicap game scores — gamesX[i] + handicapX per game. */
  handicapGamesA: [number, number, number];
  handicapGamesB: [number, number, number];
  /** Sum of the three scratch games. */
  scratchTotalA: number;
  scratchTotalB: number;
  /** Sum of the three handicap games. */
  handicapTotalA: number;
  handicapTotalB: number;
  /** Awarded points per game for each side (each entry 0, 1, or 2). */
  gameAwardsA: [GameAward, GameAward, GameAward];
  gameAwardsB: [GameAward, GameAward, GameAward];
  /** Sum of gameAwards (0..6). */
  gamePointsA: number;
  gamePointsB: number;
  /** Set point award from total handicap pinfall (0, 0.5, or 1). */
  setPointA: SetAward;
  setPointB: SetAward;
  /** gamePoints + setPoint (0..7, always sums to 7 with opponent). */
  totalPointsA: number;
  totalPointsB: number;
  winner: "A" | "B" | "T";
}

/**
 * Runtime validator for a linescore. Throws in dev if a match's
 * per-game or per-side numbers don't add up. Kept dependency-free so
 * it runs at module load in every environment.
 */
export function assertMatchResult(m: Match, r: MatchResult): void {
  const id = m.id;
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`Match ${id}: ${msg}`);
  };
  // Per-game awards must sum to exactly 2 (2+0 for a win, 1+1 for a tie).
  for (let i = 0; i < 3; i++) {
    check(
      r.gameAwardsA[i] + r.gameAwardsB[i] === 2,
      `game ${i + 1} awards must sum to 2 (got ${r.gameAwardsA[i]}+${r.gameAwardsB[i]})`,
    );
    check(
      r.handicapGamesA[i] === r.gamesA[i] + r.handicapA,
      `handicap game A${i + 1} mismatch`,
    );
    check(
      r.handicapGamesB[i] === r.gamesB[i] + r.handicapB,
      `handicap game B${i + 1} mismatch`,
    );
  }
  const scratchA = r.gamesA[0] + r.gamesA[1] + r.gamesA[2];
  const scratchB = r.gamesB[0] + r.gamesB[1] + r.gamesB[2];
  check(scratchA === r.scratchTotalA, "scratchTotalA mismatch");
  check(scratchB === r.scratchTotalB, "scratchTotalB mismatch");
  check(
    r.handicapTotalA === scratchA + r.handicapA * 3,
    "handicapTotalA mismatch",
  );
  check(
    r.handicapTotalB === scratchB + r.handicapB * 3,
    "handicapTotalB mismatch",
  );
  check(
    r.gamePointsA === (r.gameAwardsA as number[]).reduce((s, x) => s + x, 0),
    "gamePointsA mismatch",
  );
  check(
    r.gamePointsB === (r.gameAwardsB as number[]).reduce((s, x) => s + x, 0),
    "gamePointsB mismatch",
  );
  check(r.setPointA + r.setPointB === 1, "set points must sum to 1");
  check(
    r.totalPointsA === r.gamePointsA + r.setPointA,
    "totalPointsA mismatch",
  );
  check(
    r.totalPointsB === r.gamePointsB + r.setPointB,
    "totalPointsB mismatch",
  );
  check(
    r.totalPointsA + r.totalPointsB === 7,
    `match must distribute exactly 7 points (got ${r.totalPointsA}+${r.totalPointsB})`,
  );
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
    matchesPlayed: 0,
    gamesPlayed: 0,
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
        slot: m + 1,
        status: completed ? "completed" : "scheduled",
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
        const scratchTotalA = gamesA[0] + gamesA[1] + gamesA[2];
        const scratchTotalB = gamesB[0] + gamesB[1] + gamesB[2];
        const handicapGamesA: [number, number, number] = [
          gamesA[0] + a.handicap,
          gamesA[1] + a.handicap,
          gamesA[2] + a.handicap,
        ];
        const handicapGamesB: [number, number, number] = [
          gamesB[0] + b.handicap,
          gamesB[1] + b.handicap,
          gamesB[2] + b.handicap,
        ];
        const handicapTotalA = scratchTotalA + a.handicap * 3;
        const handicapTotalB = scratchTotalB + b.handicap * 3;

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
        const isSubA = r() < 0.06;
        const isSubB = r() < 0.06;

        match.result = {
          scheduledA: a.id,
          scheduledB: b.id,
          // Phase 1: substitutes aren't modeled yet — actual = scheduled
          // even when the sub flag is set (a real name arrives with the DB).
          actualA: a.id,
          actualB: b.id,
          isSubA,
          isSubB,
          subA: isSubA ? "sub" : undefined,
          subB: isSubB ? "sub" : undefined,
          entryAverageA: a.entryAverage,
          entryAverageB: b.entryAverage,
          handicapA: a.handicap,
          handicapB: b.handicap,
          gamesA,
          gamesB,
          handicapGamesA,
          handicapGamesB,
          scratchTotalA,
          scratchTotalB,
          handicapTotalA,
          handicapTotalB,
          gameAwardsA,
          gameAwardsB,
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
// Aggregate season totals into each bowler (once, at module load).
// ---------------------------------------------------------------------------

/**
 * Season-total aggregation. Runs once at module load. Every field in
 * every `Bowler` — points won, points lost, pinfall, high game/set,
 * matches/games played, scratch average — is derived here from the
 * linescores. There are no hand-entered aggregates.
 */
(function aggregateSeasonTotals() {
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
        gp: number,
        sp: number,
        total: number,
        scratchTotal: number,
        hdcpTotal: number,
      ) => {
        bowler.matchesPlayed += 1;
        bowler.gamesPlayed += 3;
        bowler.gamePoints += gp;
        bowler.setPoints += sp;
        bowler.points += total;
        // Each match distributes exactly 7 points; the opponent's share is
        // this bowler's "points lost" for W-L record purposes.
        bowler.pointsLost += 7 - total;
        bowler.scratchPinfall += scratchTotal;
        bowler.handicapPinfall += hdcpTotal;
        for (const g of games) {
          if (g > bowler.highGame) bowler.highGame = g;
        }
        if (scratchTotal > bowler.highSet) bowler.highSet = scratchTotal;
      };

      applySide(
        a, r.gamesA, r.gamePointsA, r.setPointA,
        r.totalPointsA, r.scratchTotalA, r.handicapTotalA,
      );
      applySide(
        b, r.gamesB, r.gamePointsB, r.setPointB,
        r.totalPointsB, r.scratchTotalB, r.handicapTotalB,
      );
    }
  }
  for (const bowler of BOWLERS) {
    bowler.scratchAverage =
      bowler.gamesPlayed > 0
        ? Number((bowler.scratchPinfall / bowler.gamesPlayed).toFixed(3))
        : 0;
    // Invariant: W + L == 7 * matchesPlayed
    const expected = 7 * bowler.matchesPlayed;
    if (Math.abs(bowler.points + bowler.pointsLost - expected) > 1e-9) {
      throw new Error(
        `Bowler ${bowler.id} W+L (${bowler.points}+${bowler.pointsLost}) ≠ 7×matches (${expected})`,
      );
    }
  }
})();


/** Return already-saved matches for a given week. */
export function getMatchesForWeek(week: number): Match[] {
  return MATCHES_BY_WEEK[week] ?? [];
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
  /** Pins over (entry) average for this set: scratchTotal − 3 × entryAverage. */
  poaSet: number;
  /** Best single-game POA in this set. */
  poaBestGame: number;
  result: "W" | "L" | "T";
}

/** Return already-saved match rows for a bowler (history). */
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
      const poaSet = scratchTotal - 3 * self.entryAverage;
      const poaBest = Math.max(...scores.map((g) => g - self.entryAverage));
      rows.push({
        week: w.week,
        matchId: m.id,
        lanePair: m.lanePair,
        opponent: opp?.name ?? "—",
        opponentId: oppId,
        actualBowler: self.name,
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
        result: res.winner === "T" ? "T" : (isA ? res.winner === "A" : res.winner === "B") ? "W" : "L",
      });
    }
  }
  return rows;
}

/** Season POA/derived summary for a bowler. All from linescores. */
export interface BowlerSeasonExtras {
  bestGamePOA: number;
  bestSetPOA: number;
  seasonPOA: number;
  lanePairUsage: { lanePair: LanePair; count: number }[];
}

export function getBowlerSeasonExtras(id: BowlerId): BowlerSeasonExtras {
  const self = getBowler(id);
  const rows = getBowlerHistory(id);
  if (!self || rows.length === 0) {
    return {
      bestGamePOA: 0,
      bestSetPOA: 0,
      seasonPOA: 0,
      lanePairUsage: LANE_PAIRS.map((lp) => ({ lanePair: lp, count: 0 })),
    };
  }
  let bestGame = -Infinity;
  let bestSet = -Infinity;
  const usage = new Map<LanePair, number>(LANE_PAIRS.map((lp) => [lp, 0]));
  for (const r of rows) {
    if (r.poaBestGame > bestGame) bestGame = r.poaBestGame;
    if (r.poaSet > bestSet) bestSet = r.poaSet;
    usage.set(r.lanePair, (usage.get(r.lanePair) ?? 0) + 1);
  }
  const seasonPOA =
    self.gamesPlayed > 0
      ? Number(
          (self.scratchPinfall / self.gamesPlayed - self.entryAverage).toFixed(3),
        )
      : 0;
  return {
    bestGamePOA: bestGame,
    bestSetPOA: bestSet,
    seasonPOA,
    lanePairUsage: LANE_PAIRS.map((lp) => ({
      lanePair: lp,
      count: usage.get(lp) ?? 0,
    })),
  };
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

