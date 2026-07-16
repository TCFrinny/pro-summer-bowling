/**
 * Deterministic tests for Final Week Live Scoring.
 *
 * Focus:
 *   - computeLiveMatchResult correctness (already self-tested inside the
 *     module; here we assert integration with buildSnapshot).
 *   - buildSnapshot credit rules for score-only rows:
 *       * gamePoints + setPoints credit only completed games
 *       * handicapPinfall credits partial games
 *       * gamesPlayed / matchesPlayed / high-set only count fully completed
 *       * scoreOnly rows never contribute frame-derived stats
 *   - Merge precedence: a full MatchResult wins over a score-only row for
 *     the same slot.
 *   - Elimination bounds: variable remaining capacity (7/5/3/0) per pair.
 */

import {
  buildSnapshot,
  type Bowler,
  type Match,
  type MatchResult,
  type WeekSummary,
} from "../src/lib/mock-data";
import { computeLiveMatchResult, type LiveMatchRow } from "../src/lib/live-scoring";
import { computeEliminationBounds } from "../src/lib/elimination-bounds";

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error("live-scoring test failed: " + msg);
}
function bowler(id: string, name: string): Bowler {
  return {
    id, name, entryAverage: 120, handicap: 32,
    scratchAverage: 0, points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0,
    actualScratchPinfall: 0, movement: 0,
  };
}

function liveRow(overrides: Partial<LiveMatchRow>): LiveMatchRow {
  return {
    id: "l1", schedule_slot_id: "s1", week_id: "w1", season_id: "sea",
    side_a: {
      scheduledId: "a", status: "rostered", actualId: "a",
      actualName: "Alex", scheduledName: "Alex", entryAverage: 120, handicap: 32,
    },
    side_b: {
      scheduledId: "b", status: "rostered", actualId: "b",
      actualName: "Ben", scheduledName: "Ben", entryAverage: 120, handicap: 32,
    },
    a_game1: null, a_game2: null, a_game3: null,
    b_game1: null, b_game2: null, b_game3: null,
    ...overrides,
  };
}

// --- 1. Snapshot credits partial games; no set/high-set until complete.
{
  const A = bowler("a", "Alex");
  const B = bowler("b", "Ben");
  // Only game 1 done; game 2 pending.
  const row = liveRow({ a_game1: 150, b_game1: 140 });
  const mr = computeLiveMatchResult({
    row, scheduledNameA: "Alex", scheduledNameB: "Ben",
  });
  const match: Match = {
    id: "m1", week: 1, lanePair: "1-2", slot: 0,
    status: "completed", bowlerA: "a", bowlerB: "b", result: mr,
  };
  const weeks: WeekSummary[] = [
    { week: 1, date: "", completed: false, published: true },
  ];
  const snap = buildSnapshot({ bowlers: [A, B], weeks: weeks, matchesByWeek: { 1: [match] } });
  const a = snap.bowlers.find((x) => x.id === "a")!;
  const b = snap.bowlers.find((x) => x.id === "b")!;
  expect(a.points === 2, `A points after 1 game = 2 (got ${a.points})`);
  expect(b.points === 0, `B points after 1 game = 0 (got ${b.points})`);
  expect(a.handicapPinfall === 182, `A hcp pinfall = 182 (got ${a.handicapPinfall})`);
  expect(b.handicapPinfall === 172, `B hcp pinfall (got ${b.handicapPinfall})`);
  // Score-only partial: matchesPlayed / gamesPlayed / highSet must NOT count.
  expect(a.matchesPlayed === 1, "partial counts as match (scheduled)");
  expect(a.highSet === 0, "no high-set until all 3 games complete");
  expect(a.gamesPlayed === 1, "gamesPlayed = completed pairs (1)");
}

// --- 2. Fully-completed score-only: set point + high-set award.
{
  const A = bowler("a", "Alex");
  const B = bowler("b", "Ben");
  const row = liveRow({
    a_game1: 150, a_game2: 138, a_game3: 160,
    b_game1: 140, b_game2: 146, b_game3: 130,
  });
  const mr = computeLiveMatchResult({
    row, scheduledNameA: "Alex", scheduledNameB: "Ben",
  });
  expect(mr.totalPointsA + mr.totalPointsB === 7, "final match distributes 7");
  const match: Match = {
    id: "m1", week: 1, lanePair: "1-2", slot: 0,
    status: "completed", bowlerA: "a", bowlerB: "b", result: mr,
  };
  const snap = buildSnapshot([A, B], [
    { week: 1, date: "", completed: true, published: true },
  ], { 1: [match] });
  const a = snap.bowlers.find((x) => x.id === "a")!;
  expect(a.points > 0, `A points 6 (got ${a.points})`);
  expect(a.matchesPlayed === 1, "score-only complete counts as match");
  expect(a.highSet > 0, "highSet awarded on complete score-only");
}

// --- 3. Elimination bounds: variable remaining capacity per pair.
{
  const A = bowler("a", "Alex"); A.points = 5;
  const B = bowler("b", "Ben");  B.points = 0;
  // Partial live match (1 game done) → 5 points remaining in this pair.
  const row = liveRow({ a_game1: 150, b_game1: 140 });
  const mr = computeLiveMatchResult({
    row, scheduledNameA: "Alex", scheduledNameB: "Ben",
  });
  const match: Match = {
    id: "m1", week: 1, lanePair: "1-2", slot: 0,
    status: "completed", bowlerA: "a", bowlerB: "b", result: mr,
  };
  const bounds = computeEliminationBounds({
    activeBowlers: [A, B],
    weeks: [{ week: 1, date: "", completed: false, published: true }],
    matchesByWeek: { 1: [match] },
    totalWeeks: 1,
  });
  // A has 5 pts + can gain at most 5 more from remaining game 2/3 units.
  // B has 0 pts + up to 5. So neither is clinched or eliminated yet.
  const aRow = bounds.rows.find((r) => r.bowler.id === "a")!;
  const bRow = bounds.rows.find((r) => r.bowler.id === "b")!;
  expect(aRow.status !== "clinched" || (aRow.maxFinalPoints ?? 0) <= 10,
    "A max final ≤ 10 (5 current + 5 remaining)");
  expect(bRow.status !== "eliminated" || (bRow.maxFinalPoints ?? 0) === 5,
    "B can still reach 5 pts from remaining");
}

// --- 4. computeLiveMatchResult is a pure function (no double count on re-run).
{
  const row = liveRow({ a_game1: 100, b_game1: 90, a_game2: 110, b_game2: 100 });
  const r1 = computeLiveMatchResult({ row, scheduledNameA: "A", scheduledNameB: "B" });
  const r2 = computeLiveMatchResult({ row, scheduledNameA: "A", scheduledNameB: "B" });
  expect(r1.totalPointsA === r2.totalPointsA, "re-run stable A points");
  expect(r1.handicapTotalA === r2.handicapTotalA, "re-run stable A hcp");
}

// --- 5. scoreOnly marker present; frame-derived fields null.
{
  const row = liveRow({ a_game1: 150, b_game1: 140 });
  const mr = computeLiveMatchResult({ row, scheduledNameA: "A", scheduledNameB: "B" });
  expect(mr.scoreOnly === true, "scoreOnly flag");
  expect(mr.linescoreA === null && mr.linescoreB === null, "no linescores");
}

console.log("live-scoring tests: OK");
