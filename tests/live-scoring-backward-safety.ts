/**
 * Backward-safety tests for live scoring.
 *
 * Scenarios covered (source-level, no live network I/O):
 *   1. `assembleWeeksAndMatches` called with NO `liveResults` field (old
 *      snapshot rebuilds pre-live) yields the same Match[] as before.
 *   2. `assembleWeeksAndMatches` with `liveResults: []` behaves identically.
 *   3. `buildSnapshot` can consume MatchResult rows that lack the new
 *      `scoreOnly` field (defaults to false → treated as full result).
 *   4. Full result present for a slot causes the live row for the same
 *      slot to be IGNORED (precedence rule).
 */
import { assembleWeeksAndMatches } from "../src/lib/snapshot-builder.server";
import { buildSnapshot, type Bowler, type MatchResult, type WeekSummary } from "../src/lib/mock-data";
import type { LiveMatchRow } from "../src/lib/live-scoring";

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error("live-scoring-backward-safety failed: " + msg);
}

// Minimal fake DB rows.
const weeks = [
  { id: "w1", week_number: 1, date: "2026-01-01", published: true, completed: true },
];
const slots = [
  { id: "s1", week_id: "w1", lane_pair: "1-2", slot: 0,
    bowler_a_id: "a", bowler_b_id: "b", name_a: "Alex", name_b: "Ben",
    bowler_number_a: "1", bowler_number_b: "2" },
];

// A pre-existing full result row. The assembler forwards `derived` (the
// precomputed MatchResult) straight through, so populate it.
const fullMatchResult: MatchResult = {
  scratchTotalA: 400, scratchTotalB: 380,
  handicapTotalA: 496, handicapTotalB: 476,
  gamePointsA: 3, gamePointsB: 3, setPointsA: 1, setPointsB: 0,
  totalPointsA: 4, totalPointsB: 3,
  winnerSide: "A",
  linescoreA: null, linescoreB: null,
  participationA: { scheduledId: "a", status: "rostered", actualId: "a", actualName: "Alex" },
  participationB: { scheduledId: "b", status: "rostered", actualId: "b", actualName: "Ben" },
  handicapA: 32, handicapB: 32,
};
const dummyResult = {
  schedule_slot_id: "s1", week_id: "w1",
  side_a: fullMatchResult.participationA,
  side_b: fullMatchResult.participationB,
  linescore_a: null, linescore_b: null,
  override: { enabled: true, pointsA: 4, pointsB: 3, reason: "seed" },
  derived: fullMatchResult,
};

// --- 1 & 2. Missing / empty liveResults must both work.
{
  const r1 = assembleWeeksAndMatches({ weeks, slots, results: [dummyResult] });
  const r2 = assembleWeeksAndMatches({ weeks, slots, results: [dummyResult], liveResults: [] });
  expect(r1.weeks.length === 1, "one week");
  expect(r2.weeks.length === 1, "one week (empty live)");
  expect(r1.matchesByWeek[1].length === 1, "one match without live");
  expect(r2.matchesByWeek[1].length === 1, "one match with empty live");
}

// --- 3. buildSnapshot tolerates old MatchResult without scoreOnly field.
{
  function bowler(id: string, name: string): Bowler {
    return {
      id, name, entryAverage: 120, handicap: 32,
      scratchAverage: 0, points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
      scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
      matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0,
      actualScratchPinfall: 0, movement: 0,
    };
  }
  const legacyResult: MatchResult = {
    scratchTotalA: 300, scratchTotalB: 280,
    handicapTotalA: 396, handicapTotalB: 376,
    gamePointsA: 4, gamePointsB: 2, setPointsA: 1, setPointsB: 0,
    totalPointsA: 5, totalPointsB: 2,
    winnerSide: "A",
    linescoreA: null, linescoreB: null,
    participationA: { scheduledId: "a", status: "rostered", actualId: "a", actualName: "Alex" },
    participationB: { scheduledId: "b", status: "rostered", actualId: "b", actualName: "Ben" },
    handicapA: 32, handicapB: 32,
    // scoreOnly intentionally omitted (undefined) → legacy shape.
  };
  const weeksSum: WeekSummary[] = [{ week: 1, date: "", completed: true, published: true }];
  const snap = buildSnapshot({
    bowlers: [bowler("a", "Alex"), bowler("b", "Ben")],
    weeks: weeksSum,
    matchesByWeek: {
      1: [{ id: "m1", week: 1, lanePair: "1-2", slot: 0, status: "completed",
            bowlerA: "a", bowlerB: "b", result: legacyResult }],
    },
  });
  const a = snap.bowlers.find((x) => x.id === "a")!;
  expect(a.points === 5, `legacy full result awards its points (got ${a.points})`);
  expect(a.matchesPlayed === 1, "legacy full result counted as a match");
}

// --- 4. Full result precedence: live row for same slot is dropped.
{
  const liveRow: LiveMatchRow = {
    id: "l1", schedule_slot_id: "s1", week_id: "w1", season_id: "sea",
    side_a: {
      scheduledId: "a", status: "rostered", actualId: "a",
      actualName: "Alex", scheduledName: "Alex", entryAverage: 120, handicap: 32,
    },
    side_b: {
      scheduledId: "b", status: "rostered", actualId: "b",
      actualName: "Ben", scheduledName: "Ben", entryAverage: 120, handicap: 32,
    },
    a_game1: 150, a_game2: 150, a_game3: 150,
    b_game1: 100, b_game2: 100, b_game3: 100,
  };
  const r = assembleWeeksAndMatches({
    weeks, slots, results: [dummyResult], liveResults: [liveRow],
  });
  const m = r.matchesByWeek[1][0];
  // Full result had a manual override 4-3; live would have been 7-0.
  expect(m.result.totalPointsA === 4 && m.result.totalPointsB === 3,
    `full result wins over live (got ${m.result.totalPointsA}-${m.result.totalPointsB})`);
  expect(m.result.scoreOnly !== true, "resolved as full, not scoreOnly");
}

// eslint-disable-next-line no-console
console.log("live-scoring backward-safety tests: OK");
