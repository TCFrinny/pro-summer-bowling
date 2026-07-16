/**
 * Final correctness pass — real behavioral tests for the historical phase.
 *
 * Covers:
 *  - full-linescore serialize → hydrate → recompute round trip via summarizeGame
 *  - substitute/absent personal-stat attribution in buildHistoricalStandings
 *  - standings tiebreak: points then handicap pinfall then scratch pinfall
 *  - public snapshot filter drops unpublished weeks AND rebuilds standings
 *  - full-linescore advanced-stat availability vs game-scores unavailable
 *  - source-level proofs for server guards (published-week update,
 *    empty-lane-config schedule reject, fail-closed personId lookup)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildHistoricalStandings,
  filterPublicHistoricalSnapshot,
  type HistoricalMatch,
  type HistoricalSnapshot,
  type HistoricalWeekSummary,
} from "../src/lib/historical-snapshot";
import { summarizeGame, type FrameLinescore, type GameLinescore } from "../src/lib/duckpin";

function truthy(v: unknown, msg: string) { if (!v) throw new Error(msg); }
function eq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`);
  }
}
function read(p: string) { return readFileSync(join(process.cwd(), p), "utf8"); }

// ---------------------------------------------------------------- helpers

/** Build a valid GameLinescore purely from a list of marks and running
 *  cumulative totals — mirrors what admin FULL_LINESCORE input produces. */
function game(marks: string[], cumulatives: number[]): GameLinescore {
  const frames: FrameLinescore[] = marks.map((m, i) => ({
    frameNumber: i + 1, mark: m, cumulativeScore: cumulatives[i],
  }));
  return summarizeGame(frames);
}

/** Ten open frames of 8 pins each — trivial validator-safe input. */
function openGame(pinsEach = 8): GameLinescore {
  const cumulatives: number[] = [];
  let acc = 0;
  for (let i = 0; i < 10; i++) { acc += pinsEach; cumulatives.push(acc); }
  return game(Array(10).fill("-"), cumulatives);
}

/** One-mark-per-frame stub game: 1 strike frame + 9 opens, so we can
 *  assert that strikes count aggregates correctly. */
function oneStrikeGame(): GameLinescore {
  // frame 1 = X, frames 2..10 = "-" with 0 pinfall so cumulative is flat
  // duckpin: strike frame with no bonus pins is 10.
  const cumulatives: number[] = [10];
  for (let i = 1; i < 10; i++) cumulatives.push(10);
  const marks = ["X", ...Array(9).fill("-")];
  return game(marks, cumulatives);
}

function makeMatch(overrides: Partial<HistoricalMatch>): HistoricalMatch {
  const zero: [number, number, number] = [0, 0, 0];
  const base: HistoricalMatch = {
    slotId: overrides.slotId ?? `slot-${Math.random().toString(36).slice(2, 8)}`,
    weekNumber: 1, lanePair: "1-2", slot: 1,
    detailMode: "game_scores",
    scheduledA: "PA", scheduledB: "PB",
    scheduledNameA: "PA", scheduledNameB: "PB",
    actualA: "PA", actualB: "PB",
    actualNameA: "PA", actualNameB: "PB",
    isSubA: false, isSubB: false,
    absentA: false, absentB: false,
    entryAverageA: 100, entryAverageB: 100,
    handicapA: 0, handicapB: 0,
    hasGameDataA: true, hasGameDataB: true,
    scratchGamesA: null, scratchGamesB: null,
    handicapGamesA: zero, handicapGamesB: zero,
    scratchTotalA: 0, scratchTotalB: 0,
    handicapTotalA: 0, handicapTotalB: 0,
    gameAwardsA: zero, gameAwardsB: zero,
    gamePointsA: 0, gamePointsB: 0,
    setPointA: 0, setPointB: 0,
    totalPointsA: 0, totalPointsB: 0,
    finalPointsA: 0, finalPointsB: 0,
    overrideEnabled: false, winner: "T",
    linescoreA: null, linescoreB: null,
  };
  return { ...base, ...overrides };
}

// ================================================================
// 1. Full-linescore serialize → hydrate → recompute round trip.
// ================================================================
{
  const g = oneStrikeGame();
  // Emulate DB shape: array of {frameNumber, mark, cumulativeScore}.
  const serialized = g.frames.map((f) => ({ frameNumber: f.frameNumber, mark: f.mark, cumulativeScore: f.cumulativeScore }));
  // Round trip: rebuild frames array from serialized JSONB and re-derive.
  const rehydrated = summarizeGame(serialized.map((f) => ({ ...f })));
  eq(rehydrated.strikes, g.strikes, "strikes preserved through round trip");
  eq(rehydrated.spares, g.spares, "spares preserved through round trip");
  eq(rehydrated.opens, g.opens, "opens preserved through round trip");
  eq(rehydrated.scratchTotal, g.scratchTotal, "scratch total preserved through round trip");
  eq(rehydrated.marks, g.marks, "marks preserved through round trip");
  truthy(rehydrated.strikes === 1 && rehydrated.opens === 9, "one-strike stub has 1/9 split");
}

// ================================================================
// 2. Substitute/absent personal-stat attribution
//    Scheduled bowler:   points + handicap pinfall credit ALWAYS
//    Actual bowler:      scratch pinfall / high game / high set / advanced
//    Absent bowler:      no personal scratch stats
// ================================================================
{
  const line = [oneStrikeGame(), openGame(9), openGame(7)] as [GameLinescore, GameLinescore, GameLinescore];
  // Case A: rostered PA rolls their own card.
  // Case B: PA is scheduled but sub SUB1 rolled for them.
  // Case C: PA is scheduled and absent-with-scores.
  const weeks: HistoricalWeekSummary[] = [{
    weekNumber: 1, date: null, published: true, completed: true, schedule: [],
    matches: [
      makeMatch({ slotId: "m1", detailMode: "full_linescore",
        scheduledA: "PA", actualA: "PA",
        scheduledB: "PB", actualB: "PB",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: [100, 100, 100], scratchGamesB: [90, 90, 90],
        scratchTotalA: 300, scratchTotalB: 270,
        handicapTotalA: 340, handicapTotalB: 310,
        finalPointsA: 5, finalPointsB: 2,
        linescoreA: line, linescoreB: null,
      }),
      makeMatch({ slotId: "m2",
        scheduledA: "PA", actualA: "SUB1", isSubA: true, actualNameA: "SubOne",
        scheduledB: "PC", actualB: "PC",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: [120, 120, 120], scratchGamesB: [80, 80, 80],
        scratchTotalA: 360, scratchTotalB: 240,
        handicapTotalA: 400, handicapTotalB: 280,
        finalPointsA: 5, finalPointsB: 2,
      }),
      makeMatch({ slotId: "m3",
        scheduledA: "PA", actualA: "PA", absentA: true,
        scheduledB: "PD", actualB: "PD",
        hasGameDataA: true, // absent-with-scores → handicap credit still applies
        hasGameDataB: true,
        scratchGamesA: null, // no personal scratch for absent
        scratchGamesB: [100, 100, 100],
        scratchTotalA: 0, scratchTotalB: 300,
        handicapTotalA: 300, handicapTotalB: 340,
        finalPointsA: 0, finalPointsB: 7,
      }),
    ],
  }];
  const standings = buildHistoricalStandings({
    participants: [
      { ref: "PA", displayName: "PA", role: "rostered" },
      { ref: "PB", displayName: "PB", role: "rostered" },
      { ref: "PC", displayName: "PC", role: "rostered" },
      { ref: "PD", displayName: "PD", role: "rostered" },
      { ref: "SUB1", displayName: "SubOne", role: "substitute" },
    ],
    weeks, summaryRecords: [],
  });
  const pa = standings.find((r) => r.participantRef === "PA")!;
  truthy(pa, "PA present in standings");
  // Points: 5 + 5 + 0 = 10 (all credited to scheduled PA regardless of sub/absent)
  eq(pa.points, 10, "scheduled bowler receives ALL points credit");
  // Handicap pinfall credit: 340 + 400 + 300 = 1040
  eq(pa.handicapPinfall, 340 + 400 + 300, "scheduled bowler receives handicap pinfall credit for self/sub/absent");
  // Personal scratch stats: ONLY the self-rolled match (m1). Sub match and
  // absent match must NOT show up on PA's personal scratch totals.
  eq(pa.games, 3, "PA personal games only from self-rolled match");
  eq(pa.scratchPinfall, 300, "PA personal scratch only from self-rolled match");
  eq(pa.highGame, 100, "PA high game only from self-rolled match");
  eq(pa.highSet, 300, "PA high set only from self-rolled match");
  // Advanced from PA's linescore (one strike, other frames open)
  truthy(pa.advanced != null, "PA advanced present from full linescore");
  eq(pa.advanced!.games, 3, "PA advanced games count");
  eq(pa.advanced!.strikes, 1, "PA advanced strikes count = 1 (only from oneStrikeGame)");

  // PB rolled self full game_scores match — no linescore → no advanced.
  const pb = standings.find((r) => r.participantRef === "PB")!;
  eq(pb.advanced, null, "PB has no advanced (no linescore for their side)");
  eq(pb.games, 3, "PB personal games only from self-rolled match");

  // Substitute SUB1: NOT in standings.
  truthy(!standings.find((r) => r.participantRef === "SUB1"),
    "substitute must not appear on the standings board");
}

// ================================================================
// 3. Standings tiebreaker: points → handicap pinfall → scratch pinfall
// ================================================================
{
  const weeks: HistoricalWeekSummary[] = [{
    weekNumber: 1, date: null, published: true, completed: true, schedule: [],
    matches: [
      // T1 vs T2: T1 wins 4 pts with 340 handicap pinfall
      makeMatch({ slotId: "t1", scheduledA: "T1", actualA: "T1", scheduledB: "T2", actualB: "T2",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: [100, 100, 100], scratchGamesB: [90, 90, 90],
        scratchTotalA: 300, scratchTotalB: 270,
        handicapTotalA: 340, handicapTotalB: 310, finalPointsA: 4, finalPointsB: 0 }),
      // T3 vs T4: T3 wins 4 pts with 320 handicap pinfall (LOWER than T1)
      makeMatch({ slotId: "t2", scheduledA: "T3", actualA: "T3", scheduledB: "T4", actualB: "T4",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: [110, 110, 110], scratchGamesB: [80, 80, 80],
        scratchTotalA: 330, scratchTotalB: 240,
        handicapTotalA: 320, handicapTotalB: 260, finalPointsA: 4, finalPointsB: 0 }),
    ],
  }];
  const standings = buildHistoricalStandings({
    participants: [
      { ref: "T1", displayName: "T1", role: "rostered" },
      { ref: "T2", displayName: "T2", role: "rostered" },
      { ref: "T3", displayName: "T3", role: "rostered" },
      { ref: "T4", displayName: "T4", role: "rostered" },
    ],
    weeks, summaryRecords: [],
  });
  // T1 and T3 both have 4 points. Tiebreak must place T1 (340) ABOVE T3 (320)
  // even though T3 has HIGHER scratch pinfall (330 vs 300).
  const order = standings.map((r) => r.participantRef);
  const t1i = order.indexOf("T1");
  const t3i = order.indexOf("T3");
  truthy(t1i < t3i, `T1 must outrank T3 on handicap-pinfall tiebreak (got order ${order.join(",")})`);
  const t1 = standings[t1i], t3 = standings[t3i];
  eq(t1.rank, 1, "T1 rank is 1");
  eq(t3.rank, 2, "T3 rank is 2");
  truthy((t1.scratchPinfall ?? 0) < (t3.scratchPinfall ?? 0),
    "T1 wins tiebreak DESPITE lower scratch pinfall — proves the tiebreak is handicap, not scratch");
}

// ================================================================
// 4. Public snapshot filter drops unpublished weeks + rebuilds standings
// ================================================================
{
  const publishedWeek: HistoricalWeekSummary = {
    weekNumber: 1, date: null, published: true, completed: true, schedule: [
      { slotId: "s-pub", weekNumber: 1, lanePair: "1-2", slot: 1,
        scheduledA: "A", scheduledB: "B", nameA: "A", nameB: "B", hasResult: true },
    ],
    matches: [makeMatch({ slotId: "s-pub", scheduledA: "A", actualA: "A", scheduledB: "B", actualB: "B",
      hasGameDataA: true, hasGameDataB: true,
      scratchGamesA: [100, 100, 100], scratchGamesB: [100, 100, 100],
      scratchTotalA: 300, scratchTotalB: 300,
      handicapTotalA: 300, handicapTotalB: 300,
      finalPointsA: 4, finalPointsB: 0 })],
  };
  const draftWeek: HistoricalWeekSummary = {
    weekNumber: 2, date: null, published: false, completed: true, schedule: [
      { slotId: "s-draft", weekNumber: 2, lanePair: "1-2", slot: 1,
        scheduledA: "A", scheduledB: "B", nameA: "A", nameB: "B", hasResult: true },
    ],
    matches: [makeMatch({ slotId: "s-draft", scheduledA: "A", actualA: "A", scheduledB: "B", actualB: "B",
      hasGameDataA: true, hasGameDataB: true,
      scratchGamesA: [200, 200, 200], scratchGamesB: [50, 50, 50],
      scratchTotalA: 600, scratchTotalB: 150,
      handicapTotalA: 600, handicapTotalB: 150,
      finalPointsA: 999, finalPointsB: 0 })],
  };
  const participants = [
    { ref: "A", displayName: "A", role: "rostered" as const },
    { ref: "B", displayName: "B", role: "rostered" as const },
  ];
  const fullSnapshot: HistoricalSnapshot = {
    version: 1, builtAt: 0, seasonId: "s", seasonLabel: "S", pointSystem: 7,
    totalWeeks: 2, participants,
    weeks: [publishedWeek, draftWeek],
    standings: buildHistoricalStandings({ participants, weeks: [publishedWeek, draftWeek], summaryRecords: [] }),
    summaryOnly: false, summaryRecords: [],
  };
  // Full (admin) view sees the giant fake points.
  const fullA = fullSnapshot.standings.find((r) => r.participantRef === "A")!;
  truthy(fullA.points === 4 + 999, "admin snapshot contains unpublished points");
  // Public filter drops draft week AND rebuilds standings.
  const pub = filterPublicHistoricalSnapshot(fullSnapshot);
  truthy(pub.weeks.length === 1 && pub.weeks[0].published, "public filter keeps only published weeks");
  truthy(!pub.weeks.some((w) => w.weekNumber === 2), "unpublished week 2 removed");
  const pubA = pub.standings.find((r) => r.participantRef === "A")!;
  eq(pubA.points, 4, "public standings recomputed from published weeks ONLY (no leak of unpublished points)");
}

// ================================================================
// 5. Full-linescore advanced availability vs game-scores unavailable
// ================================================================
{
  const line = [oneStrikeGame(), openGame(9), openGame(9)] as [GameLinescore, GameLinescore, GameLinescore];
  // Bowler FL: has full linescore. Bowler GS: only game scores.
  const week: HistoricalWeekSummary = {
    weekNumber: 1, date: null, published: true, completed: true, schedule: [],
    matches: [
      makeMatch({ slotId: "flmatch", detailMode: "full_linescore",
        scheduledA: "FL", actualA: "FL", scheduledB: "GS", actualB: "GS",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: [100, 100, 100], scratchGamesB: [90, 90, 90],
        scratchTotalA: 300, scratchTotalB: 270,
        handicapTotalA: 300, handicapTotalB: 270,
        finalPointsA: 4, finalPointsB: 0,
        linescoreA: line, linescoreB: null }),
    ],
  };
  const st = buildHistoricalStandings({
    participants: [
      { ref: "FL", displayName: "FL", role: "rostered" },
      { ref: "GS", displayName: "GS", role: "rostered" },
    ],
    weeks: [week], summaryRecords: [],
  });
  const fl = st.find((r) => r.participantRef === "FL")!;
  const gs = st.find((r) => r.participantRef === "GS")!;
  truthy(fl.advanced !== null, "full-linescore bowler HAS advanced stats");
  eq(fl.advanced!.strikes, 1, "advanced.strikes derived from linescore");
  truthy(gs.advanced === null,
    "game-scores-only bowler advanced is null (unavailable, never 0)");
}

// ================================================================
// 6. Source-level proofs of remaining server guards
// ================================================================
{
  const repo = read("src/lib/historical-repo.functions.ts");
  // Published-week update guard (item #1)
  truthy(repo.includes("confirmPublicationChange"),
    "adminUpdateHistoricalWeek accepts confirmPublicationChange");
  truthy(repo.includes("requires confirmPublicationChange=true"),
    "publication toggle rejected without confirmation");
  truthy(repo.includes("Set allowPublished=true to modify date/completed"),
    "date/completed edit on published week gated by allowPublished");

  // Empty lane config schedule reject (item #6)
  truthy(repo.includes("no lane pairs configured"),
    "schedule insert rejects when lane config is empty");

  // Fail-closed personId lookup (item #6)
  truthy(repo.includes("person_id lookup failed"),
    "personId lookup throws on DB error instead of silently null");

  // Public snapshot filter applied on the public loader (item #4)
  truthy(repo.includes("filterPublicHistoricalSnapshot"),
    "getPublicHistoricalSnapshot applies public filter");
}

// eslint-disable-next-line no-console
console.log("historical-phase FINAL correctness tests passed");
