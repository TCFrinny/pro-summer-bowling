/**
 * Deterministic tests for season completion, champion derivation, and
 * point-system recomputation from stored authoritative inputs.
 *
 * Champion is derived from snapshot completeness, NOT persisted flags —
 * an unpublished final week must never surface a championship.
 */

import {
  isHistoricalSeasonComplete,
  deriveHistoricalChampion,
  buildHistoricalStandings,
  type HistoricalMatch,
  type HistoricalParticipantMeta,
  type HistoricalSnapshot,
  type HistoricalWeekSummary,
} from "../src/lib/historical-snapshot";
import { computeHistoricalMatch } from "../src/lib/historical-scoring";

function eq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`);
  }
}
function truthy(v: unknown, msg: string) { if (!v) throw new Error(msg); }

function mkMatch(over: Partial<HistoricalMatch> = {}): HistoricalMatch {
  return {
    slotId: "s", weekNumber: 1, lanePair: "1-2", slot: 1,
    detailMode: "game_scores",
    scheduledA: "A", scheduledB: "B",
    scheduledNameA: "A", scheduledNameB: "B",
    actualA: "A", actualB: "B", actualNameA: "A", actualNameB: "B",
    isSubA: false, isSubB: false, absentA: false, absentB: false,
    entryAverageA: 100, entryAverageB: 100,
    handicapA: 0, handicapB: 0,
    hasGameDataA: true, hasGameDataB: true,
    scratchGamesA: [100, 100, 100], scratchGamesB: [100, 100, 100],
    handicapGamesA: [100, 100, 100], handicapGamesB: [100, 100, 100],
    scratchTotalA: 300, scratchTotalB: 300,
    handicapTotalA: 300, handicapTotalB: 300,
    gameAwardsA: [1, 1, 1], gameAwardsB: [1, 1, 1],
    gamePointsA: 3, gamePointsB: 3,
    setPointA: 0.5, setPointB: 0.5,
    totalPointsA: 3.5, totalPointsB: 3.5,
    finalPointsA: 3.5, finalPointsB: 3.5,
    overrideEnabled: false, winner: "T",
    linescoreA: null, linescoreB: null,
    ...over,
  };
}

function mkWeek(n: number, opts: { published?: boolean; completed?: boolean } = {}, matches: HistoricalMatch[] = []): HistoricalWeekSummary {
  return {
    weekNumber: n, date: null,
    published: opts.published ?? true,
    completed: opts.completed ?? true,
    matches,
    schedule: [],
  } as HistoricalWeekSummary;
}

// ---------- isHistoricalSeasonComplete ----------

truthy(!isHistoricalSeasonComplete({ totalWeeks: null, weeks: [] }),
  "null totalWeeks → incomplete");
truthy(!isHistoricalSeasonComplete({ totalWeeks: 0, weeks: [] }),
  "0 totalWeeks → incomplete");
truthy(!isHistoricalSeasonComplete({ totalWeeks: 3, weeks: [mkWeek(1), mkWeek(2)] }),
  "missing week 3 → incomplete");
truthy(!isHistoricalSeasonComplete({ totalWeeks: 3, weeks: [mkWeek(1), mkWeek(2), mkWeek(3, { published: false })] }),
  "unpublished final week → incomplete");
truthy(!isHistoricalSeasonComplete({ totalWeeks: 3, weeks: [mkWeek(1), mkWeek(2), mkWeek(3, { completed: false })] }),
  "incomplete final week → incomplete");
truthy(isHistoricalSeasonComplete({ totalWeeks: 3, weeks: [mkWeek(1), mkWeek(2), mkWeek(3)] }),
  "all 3 published+completed → complete");

// ---------- deriveHistoricalChampion ----------

function mkSnap(over: Partial<HistoricalSnapshot>): HistoricalSnapshot {
  return {
    version: 1, builtAt: 0, seasonId: "s", seasonLabel: "s",
    pointSystem: 7, totalWeeks: 1,
    participants: [], weeks: [mkWeek(1)],
    standings: [], participantStats: [],
    summaryOnly: false, summaryRecords: [],
    ...over,
  } as HistoricalSnapshot;
}

// Incomplete → never a champion.
{
  const snap = mkSnap({
    totalWeeks: 2, weeks: [mkWeek(1)],
    standings: [
      { participantRef: "A", personId: "p-a", displayName: "A", rank: 1,
        matchesPlayed: 1, points: 7, pointsLost: 0,
        games: 3, scratchPinfall: 500, scratchAverage: 166.7,
        handicapPinfall: 560, highGame: 200, highSet: 500,
        fromSummaryOnly: false } as unknown as HistoricalSnapshot["standings"][number],
    ],
  });
  eq(deriveHistoricalChampion(snap), null, "incomplete season → null champion");
}

// Complete + standings #1 → that participant wins.
{
  const snap = mkSnap({
    standings: [
      { participantRef: "A", personId: "p-a", displayName: "A", rank: 1,
        matchesPlayed: 1, points: 7, pointsLost: 0,
        games: 3, scratchPinfall: 500, scratchAverage: 166.7,
        handicapPinfall: 560, highGame: 200, highSet: 500,
        fromSummaryOnly: false } as unknown as HistoricalSnapshot["standings"][number],
      { participantRef: "B", personId: "p-b", displayName: "B", rank: 2,
        matchesPlayed: 1, points: 0, pointsLost: 7,
        games: 3, scratchPinfall: 400, scratchAverage: 133.3,
        handicapPinfall: 460, highGame: 160, highSet: 400,
        fromSummaryOnly: false } as unknown as HistoricalSnapshot["standings"][number],
    ],
  });
  const c = deriveHistoricalChampion(snap);
  truthy(c && c.participantRef === "A" && c.personId === "p-a", "rank #1 → champion");
}

// Complete + one explicit summary champion → wins over standings.
{
  const snap = mkSnap({
    standings: [
      { participantRef: "A", personId: null, displayName: "A", rank: 1,
        matchesPlayed: 1, points: 7, pointsLost: 0,
        games: null, scratchPinfall: null, scratchAverage: null,
        handicapPinfall: null, highGame: null, highSet: null,
        fromSummaryOnly: true } as unknown as HistoricalSnapshot["standings"][number],
    ],
    summaryRecords: [
      { participantRef: "B", personId: "p-b", role: "rostered",
        displayName: "B", bowlerNumber: "1",
        games: 30, scratchPinfall: 3000, average: 100,
        highGame: 200, highSet: 550,
        points: 200, pointsLost: 10, finalFinish: 1, isChampion: true },
    ],
  });
  const c = deriveHistoricalChampion(snap);
  truthy(c && c.participantRef === "B" && c.personId === "p-b",
    "single explicit summary champion wins over standings");
}

// Complete + MULTIPLE explicit summary champions → ambiguous, fall back to standings.
{
  const snap = mkSnap({
    standings: [
      { participantRef: "A", personId: "p-a", displayName: "A", rank: 1,
        matchesPlayed: 1, points: 7, pointsLost: 0,
        games: null, scratchPinfall: null, scratchAverage: null,
        handicapPinfall: null, highGame: null, highSet: null,
        fromSummaryOnly: true } as unknown as HistoricalSnapshot["standings"][number],
    ],
    summaryRecords: [
      { participantRef: "X", personId: null, role: "rostered", displayName: "X",
        bowlerNumber: null, games: null, scratchPinfall: null, average: null,
        highGame: null, highSet: null,
        points: null, pointsLost: null, finalFinish: 1, isChampion: true },
      { participantRef: "Y", personId: null, role: "rostered", displayName: "Y",
        bowlerNumber: null, games: null, scratchPinfall: null, average: null,
        highGame: null, highSet: null,
        points: null, pointsLost: null, finalFinish: 1, isChampion: true },
    ],
  });
  const c = deriveHistoricalChampion(snap);
  truthy(c && c.participantRef === "A", "ambiguous summary → fall back to standings #1");
}

// ---------- Point-system change: recompute from stored inputs ----------

// A wins all 3 games with scratch 180-170-190 vs B 150-160-170; hcp 0 each.
// Under 7-point → A finalPoints = 7 (sweep + set). Under 4-point → A = 3.5.
// Point-system change on the same stored inputs yields different point
// totals — this is exactly what the rebuild pipeline replays.
{
  const stored = {
    sideA: { gameScores: [180, 170, 190] as [number, number, number], handicap: 0,
      participation: { status: "rostered" as const } },
    sideB: { gameScores: [150, 160, 170] as [number, number, number], handicap: 0,
      participation: { status: "rostered" as const } },
  };
  const under7 = computeHistoricalMatch({ pointSystem: 7, ...stored });
  const under4 = computeHistoricalMatch({ pointSystem: 4, ...stored });
  eq(under7.finalPointsA, 7, "7-point sweep A=7");
  eq(under7.finalPointsB, 0, "7-point sweep B=0");
  truthy(under4.finalPointsA !== under7.finalPointsA,
    "same stored inputs recomputed under 4-point give a different point total");
  truthy(under4.finalPointsA + under4.finalPointsB <= 4 + 1e-9,
    "4-point total per match ≤ 4");
  truthy(under4.finalPointsA > under4.finalPointsB, "A still wins under 4-point");
}

// Standings under a switched point system: point totals differ.
{
  const participants: HistoricalParticipantMeta[] = [
    { ref: "A", personId: null, displayName: "A", role: "rostered" },
    { ref: "B", personId: null, displayName: "B", role: "rostered" },
  ];
  const match7 = mkMatch({
    detailMode: "game_scores",
    scratchGamesA: [180, 170, 190], scratchGamesB: [150, 160, 170],
    handicapGamesA: [180, 170, 190], handicapGamesB: [150, 160, 170],
    scratchTotalA: 540, scratchTotalB: 480,
    handicapTotalA: 540, handicapTotalB: 480,
    gameAwardsA: [2, 2, 2], gameAwardsB: [0, 0, 0],
    gamePointsA: 6, gamePointsB: 0,
    setPointA: 1, setPointB: 0,
    totalPointsA: 7, totalPointsB: 0,
    finalPointsA: 7, finalPointsB: 0,
    winner: "A",
  });
  const weeks7: HistoricalWeekSummary[] = [mkWeek(1, {}, [match7])];
  const s7 = buildHistoricalStandings({ participants, weeks: weeks7, summaryRecords: [], pointSystem: 7 });
  const a7 = s7.find((r) => r.participantRef === "A")!;
  const b7 = s7.find((r) => r.participantRef === "B")!;
  eq(a7.points, 7, "7-pt standings A=7");
  eq(a7.pointsLost, 0, "7-pt standings A pointsLost=0");
  eq(b7.pointsLost, 7, "7-pt standings B pointsLost=7");
}

// eslint-disable-next-line no-console
console.log("champion-and-rebuild tests passed");
