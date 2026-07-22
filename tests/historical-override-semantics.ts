/**
 * Deterministic tests: historical W-L semantics under normal and
 * independent-override results, plus source-level guards that current
 * 2026 scoring does not import the historical helper.
 */
import fs from "node:fs";
import {
  buildHistoricalStandings,
  type HistoricalMatch,
  type HistoricalWeekSummary,
  type HistoricalParticipantMeta,
} from "../src/lib/historical-snapshot";

function eq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n  expected ${JSON.stringify(b)}\n  got ${JSON.stringify(a)}`);
  }
}
function truthy(v: unknown, msg: string) { if (!v) throw new Error(msg); }

const participants: HistoricalParticipantMeta[] = [
  { ref: "A", displayName: "A", role: "rostered", personId: null },
  { ref: "B", displayName: "B", role: "rostered", personId: null },
];

function mkMatch(finalA: number, finalB: number): HistoricalMatch {
  return {
    slotId: "m", weekNumber: 1, lanePair: "1-2", slot: 1,
    detailMode: "game_scores",
    scheduledA: "A", scheduledB: "B",
    actualA: "A", actualB: "B",
    actualNameA: "A", actualNameB: "B",
    isSubA: false, isSubB: false, absentA: false, absentB: false,
    entryAverageA: 100, entryAverageB: 100,
    handicapA: 0, handicapB: 0,
    scratchGamesA: [150, 150, 150], scratchGamesB: [140, 140, 140],
    handicapGamesA: [150, 150, 150], handicapGamesB: [140, 140, 140],
    scratchTotalA: 450, scratchTotalB: 420,
    handicapTotalA: 450, handicapTotalB: 420,
    gameAwardsA: [0, 0, 0], gameAwardsB: [0, 0, 0],
    gamePointsA: 0, gamePointsB: 0,
    setPointA: 0, setPointB: 0,
    totalPointsA: finalA, totalPointsB: finalB,
    finalPointsA: finalA, finalPointsB: finalB,
    overrideEnabled: false, winner: finalA > finalB ? "A" : finalB > finalA ? "B" : "T",
  } as HistoricalMatch;
}

function wk(m: HistoricalMatch): HistoricalWeekSummary {
  return { weekNumber: 1, date: null, published: true, completed: true, matches: [m] };
}

// --- Normal 4-point 3-1 → 3-1 and 1-3 ----------------------------------
{
  const st = buildHistoricalStandings({
    participants, weeks: [wk(mkMatch(3, 1))], summaryRecords: [], pointSystem: 4,
  });
  const a = st.find((r) => r.participantRef === "A")!;
  const b = st.find((r) => r.participantRef === "B")!;
  eq([a.points, a.pointsLost], [3, 1], "A 3-1");
  eq([b.points, b.pointsLost], [1, 3], "B 1-3");
}

// --- 4-point independent override 0 / 2.5 → 0-4 and 2.5-1.5 -------------
{
  const st = buildHistoricalStandings({
    participants, weeks: [wk(mkMatch(0, 2.5))], summaryRecords: [], pointSystem: 4,
  });
  const a = st.find((r) => r.participantRef === "A")!;
  const b = st.find((r) => r.participantRef === "B")!;
  eq([a.points, a.pointsLost], [0, 4], "A 0-4 under override");
  eq([b.points, b.pointsLost], [2.5, 1.5], "B 2.5-1.5 under override");
}

// --- 7-point independent override 5.5 / 0 → 5.5-1.5 and 0-7 -------------
{
  const st = buildHistoricalStandings({
    participants, weeks: [wk(mkMatch(5.5, 0))], summaryRecords: [], pointSystem: 7,
  });
  const a = st.find((r) => r.participantRef === "A")!;
  const b = st.find((r) => r.participantRef === "B")!;
  eq([a.points, a.pointsLost], [5.5, 1.5], "A 5.5-1.5 under override");
  eq([b.points, b.pointsLost], [0, 7], "B 0-7 under override");
}

// --- Each side's own W+L equals pointSystem regardless of totals --------
{
  const cases: Array<[4 | 7, number, number]> = [
    [4, 0, 2.5], [4, 2.5, 2.5], [4, 3, 1],
    [7, 5.5, 0], [7, 3.5, 3.5], [7, 7, 0],
  ];
  for (const [ps, a, b] of cases) {
    const st = buildHistoricalStandings({
      participants, weeks: [wk(mkMatch(a, b))], summaryRecords: [], pointSystem: ps,
    });
    const A = st.find((r) => r.participantRef === "A")!;
    const B = st.find((r) => r.participantRef === "B")!;
    eq((A.points ?? 0) + (A.pointsLost ?? 0), ps, `A W+L=${ps} (${a}/${b})`);
    eq((B.points ?? 0) + (B.pointsLost ?? 0), ps, `B W+L=${ps} (${a}/${b})`);
  }
}

// --- Public snapshot filter uses the same corrected calculation ---------
{
  const { filterPublicHistoricalSnapshot } = require("../src/lib/historical-snapshot");
  const full = {
    version: 1 as const, builtAt: 0, seasonId: "s", seasonLabel: "s",
    pointSystem: 4 as const, totalWeeks: 1,
    participants, weeks: [wk(mkMatch(0, 2.5))],
    standings: [], summaryOnly: false, summaryRecords: [],
  };
  const pub = filterPublicHistoricalSnapshot(full);
  const a = pub.standings.find((r: { participantRef: string }) => r.participantRef === "A");
  const b = pub.standings.find((r: { participantRef: string }) => r.participantRef === "B");
  eq([a.points, a.pointsLost], [0, 4], "public A 0-4");
  eq([b.points, b.pointsLost], [2.5, 1.5], "public B 2.5-1.5");
}

// --- Server override validation rejects out-of-range and non-half values
{
  const src = fs.readFileSync("src/lib/historical-repo.functions.ts", "utf8");
  truthy(
    /Override points [AB] must be between 0 and \$\{ps\}/.test(src),
    "server enforces 0..pointSystem override range",
  );
  truthy(
    /must be in 0\.5 increments/.test(src),
    "server enforces 0.5-step override values",
  );
}

// --- Current 2026 scoring modules do NOT import historical helper -------
{
  const guardedFiles = [
    "src/lib/live-scoring.ts",
    "src/lib/live-scoring.functions.ts",
    "src/lib/snapshot-builder.server.ts",
    "src/lib/standings-rank.ts",
  ];
  for (const f of guardedFiles) {
    if (!fs.existsSync(f)) continue;
    const body = fs.readFileSync(f, "utf8");
    truthy(!/buildHistoricalStandings|filterPublicHistoricalSnapshot/.test(body),
      `${f} must not import historical helpers`);
  }
}

// eslint-disable-next-line no-console
console.log("historical-override-semantics tests passed");
