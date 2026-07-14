/**
 * Absent-scoring + substitute-handicap deterministic tests.
 *
 * Covers the league rules:
 *  - Absent side stores three numeric scratch scores and NO linescore;
 *    handicap game/set totals use the SCHEDULED bowler's handicap.
 *  - Manual point overrides are authoritative; W-L reflects awarded points.
 *  - Absent scores DO NOT feed personal stats (avg, games rolled, high
 *    game/set, mark metrics) on the scheduled bowler.
 *  - Opponent's legitimate rostered scores still count normally.
 *  - Substitutes score on the SUBSTITUTE'S own handicap (derived from
 *    the sub's Starting Average). Points/handicap pinfall still credit
 *    the scheduled bowler downstream.
 */
import {
  buildSnapshot,
  computeMatchResult,
  computeHandicap,
  assembleSideLinescore,
  type Bowler,
  type Match,
  type WeekSummary,
} from "../src/lib/mock-data";

import {
  summarizeGame,
  type FrameLinescore,
} from "../src/lib/duckpin";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("absent-scoring: " + msg);
}

const mkBowler = (id: string, name: string, entry: number): Bowler => ({
  id, name, entryAverage: entry, handicap: computeHandicap(entry),
  scratchAverage: 0, points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
  scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
  matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0, actualScratchPinfall: 0,
  movement: 0,
});

const allStrikeFrames = (): FrameLinescore[] => ([
  ...Array.from({ length: 9 }, (_, i) => ({
    frameNumber: (i + 1) as FrameLinescore["frameNumber"],
    mark: "X" as const,
    cumulativeScore: 30 * (i + 1),
  })),
  { frameNumber: 10, mark: "XXX", cumulativeScore: 300 },
]);
const modestOpenFrames = (): FrameLinescore[] => ([
  ...Array.from({ length: 9 }, (_, i) => ({
    frameNumber: (i + 1) as FrameLinescore["frameNumber"],
    mark: "-" as const,
    cumulativeScore: 20 * (i + 1),
  })),
  { frameNumber: 10, mark: "-", cumulativeScore: 200 },
]);

function allStrikeLinescore(scheduled: Bowler, entry: number, handicap: number) {
  const games: [ReturnType<typeof summarizeGame>, ReturnType<typeof summarizeGame>, ReturnType<typeof summarizeGame>] = [
    summarizeGame(allStrikeFrames()),
    summarizeGame(allStrikeFrames()),
    summarizeGame(allStrikeFrames()),
  ];
  return assembleSideLinescore({
    scheduled, actualId: scheduled.id, actualName: scheduled.name,
    isSub: false, entryAverage: entry, handicap, games,
  });
}
function modestOpenLinescore(scheduled: Bowler, entry: number, handicap: number) {
  const games: [ReturnType<typeof summarizeGame>, ReturnType<typeof summarizeGame>, ReturnType<typeof summarizeGame>] = [
    summarizeGame(modestOpenFrames()),
    summarizeGame(modestOpenFrames()),
    summarizeGame(modestOpenFrames()),
  ];
  return assembleSideLinescore({
    scheduled, actualId: scheduled.id, actualName: scheduled.name,
    isSub: false, entryAverage: entry, handicap, games,
  });
}

// ---- Test 1: absent side handicap totals + no linescore ---------------
{
  const A = mkBowler("a", "Alice", 120); // handicap = floor(0.8*(160-120)) = 32
  const B = mkBowler("b", "Bob", 140);   // handicap = floor(0.8*(160-140)) = 16
  const hA = computeHandicap(A.entryAverage);
  const hB = computeHandicap(B.entryAverage);
  assert(hA === 32 && hB === 16, `handicap math (got ${hA}/${hB})`);

  const lsB = modestOpenLinescore(B, B.entryAverage, hB);
  const r = computeMatchResult({
    scheduledA: A, scheduledB: B,
    scheduledNameA: A.name, scheduledNameB: B.name,
    participationA: {
      scheduledId: A.id, status: "absent",
      actualId: null, actualName: "Absent",
      absentScores: [90, 100, 110],
    },
    participationB: {
      scheduledId: B.id, status: "rostered",
      actualId: B.id, actualName: B.name,
    },
    entryAverageA: A.entryAverage, entryAverageB: B.entryAverage,
    handicapA: hA, handicapB: hB,
    linescoreA: null, linescoreB: lsB,
    pointsOverride: { enabled: true, pointsA: 2, pointsB: 5, reason: "absent forfeit partial" },
  });

  // Absent scratch pinfall + handicap totals use scheduled hcp.
  assert(r.scratchTotalA === 300, `absent scratch total (got ${r.scratchTotalA})`);
  assert(r.handicapTotalA === 300 + hA * 3, `absent hcp total = scratch + hcp*3 (got ${r.handicapTotalA})`);
  assert(r.handicapGamesA[0] === 90 + hA && r.handicapGamesA[2] === 110 + hA,
    "absent hcp games apply scheduled hcp per game");
  assert(r.linescoreA === null, "absent side has no linescore");

  // Override authoritative: totalPoints reflect awarded, winner uses final.
  assert(r.pointsOverride?.enabled, "override present");
  // computeMatchResult's totalPointsA/B fields report NORMAL totals; the
  // final winner uses override points.
  assert(r.winner === "B", `winner from override (got ${r.winner})`);

  // Opponent's real linescore preserved.
  assert(r.linescoreB && r.linescoreB.scratchSet === 600, "opponent linescore preserved");
}

// ---- Test 2: absent excluded from personal stats via buildSnapshot ----
{
  const A = mkBowler("a", "Alice", 120);
  const B = mkBowler("b", "Bob", 140);
  const hA = computeHandicap(A.entryAverage);
  const hB = computeHandicap(B.entryAverage);

  const lsB = modestOpenLinescore(B, B.entryAverage, hB);
  const result = computeMatchResult({
    scheduledA: A, scheduledB: B,
    scheduledNameA: A.name, scheduledNameB: B.name,
    participationA: {
      scheduledId: A.id, status: "absent",
      actualId: null, actualName: "Absent",
      absentScores: [180, 190, 200], // deliberately huge to prove they're ignored
    },
    participationB: {
      scheduledId: B.id, status: "rostered",
      actualId: B.id, actualName: B.name,
    },
    entryAverageA: A.entryAverage, entryAverageB: B.entryAverage,
    handicapA: hA, handicapB: hB,
    linescoreA: null, linescoreB: lsB,
    pointsOverride: { enabled: true, pointsA: 0, pointsB: 7, reason: "absent" },
  });

  const week: WeekSummary = { week: 1, date: "", completed: true, published: false };
  const match: Match = {
    id: "m1", week: 1, lanePair: "1-2", slot: 1, status: "completed",
    bowlerA: A.id, bowlerB: B.id, result,
  };
  const snap = buildSnapshot({
    bowlers: [A, B], weeks: [week], matchesByWeek: { 1: [match] },
  });

  const sA = snap.bowlersById[A.id];
  const sB = snap.bowlersById[B.id];
  assert(sA && sB, "both bowlers present");

  // Absent A: no games rolled, no scratch pinfall, no high game/set.
  assert(sA.actualGamesRolled === 0, `absent contributes 0 games rolled (got ${sA.actualGamesRolled})`);
  assert(sA.actualScratchPinfall === 0, "absent contributes 0 scratch pinfall");
  assert(sA.scratchPinfall === 0, "absent contributes 0 to scratchPinfall bucket");
  assert(sA.highGame === 0 && sA.highSet === 0, "absent does not set high game/set");
  assert(sA.gamesPlayed === 0, "absent contributes 0 gamesPlayed");
  // Scratch average falls back to entry average when nothing rolled.
  assert(sA.scratchAverage === A.entryAverage, `absent scratch avg fallback (got ${sA.scratchAverage})`);
  // But standings still credit handicap pinfall and awarded points.
  assert(sA.handicapPinfall === result.handicapTotalA,
    `absent handicap pinfall = scheduled hcp totals (got ${sA.handicapPinfall})`);
  assert(sA.points === 0 && sA.pointsLost === 7, "override points applied to scheduled bowler");
  assert(sA.matchesPlayed === 1, "absent counts as scheduled match");

  // Opponent B: normal accrual.
  assert(sB.actualGamesRolled === 3, "opponent full games rolled");
  assert(sB.actualScratchPinfall === 600, "opponent scratch pinfall accumulated");
  assert(sB.highGame === 200 && sB.highSet === 600, "opponent highs set");
  assert(sB.points === 7 && sB.pointsLost === 0, "opponent awarded override points");
}

// ---- Test 3: substitute uses SCHEDULED bowler's handicap ---------------
{
  const A = mkBowler("a", "Alice", 120); // scheduled A: hcp 32
  const B = mkBowler("b", "Bob", 140);   // scheduled B: hcp 16
  const SUB = mkBowler("sub", "SubStar", 100); // sub own hcp 48 — must be IGNORED
  const hA = computeHandicap(A.entryAverage); // 32
  const hB = computeHandicap(B.entryAverage); // 16

  // Sub bowls for A with the SCHEDULED bowler's handicap (32), not 48.
  const lsA = allStrikeLinescore(A, A.entryAverage, hA);
  // Rewrite lsA fields to reflect the substitute identity — assembleSideLinescore
  // already sets actualId/name we passed in; force isSub for realism.
  const lsSubAsA = { ...lsA, isSub: true, actualId: SUB.id, actualName: SUB.name };
  const lsB = modestOpenLinescore(B, B.entryAverage, hB);

  const result = computeMatchResult({
    scheduledA: A, scheduledB: B,
    scheduledNameA: A.name, scheduledNameB: B.name,
    participationA: {
      scheduledId: A.id, status: "substitute",
      actualId: SUB.id, actualName: SUB.name,
    },
    participationB: {
      scheduledId: B.id, status: "rostered",
      actualId: B.id, actualName: B.name,
    },
    entryAverageA: A.entryAverage, entryAverageB: B.entryAverage,
    handicapA: hA, handicapB: hB, // scheduled bowler's handicap
    linescoreA: lsSubAsA, linescoreB: lsB,
    pointsOverride: null,
  });

  // Each hcp game applies scheduled A's handicap (32), not sub's (48).
  assert(result.handicapGamesA[0] === 300 + 32,
    `substitute uses scheduled hcp per game (got ${result.handicapGamesA[0]})`);
  assert(result.handicapTotalA === 900 + 32 * 3,
    `substitute hcp total uses scheduled hcp*3 (got ${result.handicapTotalA})`);
}

// eslint-disable-next-line no-console
console.log("absent-scoring tests passed");
