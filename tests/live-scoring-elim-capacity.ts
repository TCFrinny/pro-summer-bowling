/**
 * Deterministic tests for computeElimination under variable live-scoring
 * capacities (0/1/2/3 completed games → 14/10/6/0 half-point remaining units).
 *
 * We use a trivial 2-bowler / single-week season so the search terminates
 * instantly and we can reason about the exact remaining capacity.
 */
import { computeElimination } from "../src/lib/elimination";
import {
  computeLiveMatchResult,
  type LiveMatchRow,
} from "../src/lib/live-scoring";
import type { Bowler, Match, MatchResult, WeekSummary } from "../src/lib/mock-data";

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error("live-scoring-elim-capacity failed: " + msg);
}
function bowler(id: string, name: string, points = 0): Bowler {
  return {
    id, name, entryAverage: 120, handicap: 32,
    scratchAverage: 0, points, pointsLost: 0, gamePoints: 0, setPoints: 0,
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
function match(res: MatchResult): Match {
  return {
    id: "m1", week: 1, lanePair: "1-2", slot: 0, status: "completed",
    bowlerA: "a", bowlerB: "b", result: res,
  };
}
function weeks(): WeekSummary[] {
  return [{ week: 1, date: "", completed: false, published: true }];
}

const clock = () => new Date("2026-07-01T00:00:00Z");

// (0-games case is covered by the general elimination tests — a pair with
// no live row yet is treated as fully-remaining scheduled capacity.)


// --- 1 game completed (A wins 2-0) → 5 points remaining in pair.
{
  const mr = computeLiveMatchResult({
    row: liveRow({ a_game1: 150, b_game1: 140 }),
    scheduledNameA: "Alex", scheduledNameB: "Ben",
  });
  expect(mr.totalPointsA === 2 && mr.totalPointsB === 0, "after G1, A=2 B=0");
  const A = bowler("a", "Alex", 2);
  const B = bowler("b", "Ben", 0);
  const snap = computeElimination({
    activeBowlers: [A, B], weeks: weeks(),
    matchesByWeek: { 1: [match(mr)] }, totalWeeks: 1, now: clock, nodeBudget: 10000,
  });
  const aRow = snap.rows.find((r) => r.bowler.id === "a")!;
  const bRow = snap.rows.find((r) => r.bowler.id === "b")!;
  // A: 2 current + up to 5 remaining = 7 max.
  // B: 0 current + up to 5 remaining = 5 max.
  expect(aRow.maxFinalPoints === 7, `A max 7 after G1 (got ${aRow.maxFinalPoints})`);
  expect(bRow.maxFinalPoints === 5, `B max 5 after G1 (got ${bRow.maxFinalPoints})`);
}

// --- 2 games completed (A wins both) → 3 points remaining in pair.
{
  const mr = computeLiveMatchResult({
    row: liveRow({ a_game1: 150, b_game1: 140, a_game2: 155, b_game2: 130 }),
    scheduledNameA: "Alex", scheduledNameB: "Ben",
  });
  expect(mr.totalPointsA === 4 && mr.totalPointsB === 0, "after G2, A=4 B=0");
  const A = bowler("a", "Alex", 4);
  const B = bowler("b", "Ben", 0);
  const snap = computeElimination({
    activeBowlers: [A, B], weeks: weeks(),
    matchesByWeek: { 1: [match(mr)] }, totalWeeks: 1, now: clock, nodeBudget: 10000,
  });
  const aRow = snap.rows.find((r) => r.bowler.id === "a")!;
  const bRow = snap.rows.find((r) => r.bowler.id === "b")!;
  // A: 4 + up to 3 = 7 max. B: 0 + up to 3 = 3 max.
  expect(aRow.maxFinalPoints === 7, `A max 7 after G2 (got ${aRow.maxFinalPoints})`);
  expect(bRow.maxFinalPoints === 3, `B max 3 after G2 (got ${bRow.maxFinalPoints})`);
}

// --- 3 games completed → 0 remaining; results are final.
{
  const mr = computeLiveMatchResult({
    row: liveRow({
      a_game1: 150, b_game1: 140,
      a_game2: 155, b_game2: 130,
      a_game3: 160, b_game3: 120,
    }),
    scheduledNameA: "Alex", scheduledNameB: "Ben",
  });
  // 3 game points (2·3=6) + set point (1) = 7 for A.
  expect(mr.totalPointsA === 7 && mr.totalPointsB === 0, "after G3, A sweeps 7-0");
  const A = bowler("a", "Alex", 7);
  const B = bowler("b", "Ben", 0);
  const snap = computeElimination({
    activeBowlers: [A, B], weeks: weeks(),
    matchesByWeek: { 1: [match(mr)] }, totalWeeks: 1, now: clock, nodeBudget: 10000,
  });
  const aRow = snap.rows.find((r) => r.bowler.id === "a")!;
  const bRow = snap.rows.find((r) => r.bowler.id === "b")!;
  expect(aRow.maxFinalPoints === 7 && aRow.status === "clinched",
    `A clinched at 7 (status=${aRow.status}, max=${aRow.maxFinalPoints})`);
  expect(bRow.maxFinalPoints === 0 && bRow.status === "eliminated",
    `B eliminated at 0 (status=${bRow.status}, max=${bRow.maxFinalPoints})`);
}

// eslint-disable-next-line no-console
console.log("live-scoring elim-capacity tests: OK");
