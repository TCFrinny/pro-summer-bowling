/**
 * Deterministic tests for Phase D — historical data system.
 *
 * These cover the PURE logic paths: point calculators (4- vs 7-point),
 * detail-mode aggregation (full/game-score/summary-only), standings
 * builder, career dedupe across snapshot + summary sources, and the
 * "unavailable never means zero" guarantee.
 *
 * DB-touching server functions enforce their own privacy/season-scope
 * guards; those are covered by RLS in the migration.
 */

import {
  computeHistoricalMatch,
  aggregateAcrossModes,
  supportsAdvancedStats,
  supportsPerGameScores,
} from "../src/lib/historical-scoring";
import {
  buildHistoricalStandings,
  dedupeHistoricalContributions,
  type HistoricalMatch,
  type HistoricalParticipantMeta,
  type HistoricalWeekSummary,
} from "../src/lib/historical-snapshot";
import { compareLanePairSlotCamel } from "../src/lib/lane-pair-order";

function eq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`);
  }
}
function truthy(v: unknown, msg: string) { if (!v) throw new Error(msg); }

// ----- Detail mode caps ---------------------------------------------------
truthy(supportsAdvancedStats("full_linescore"), "advanced ok for full");
truthy(!supportsAdvancedStats("game_scores"), "advanced NOT available for game-scores");
truthy(!supportsAdvancedStats("summary_only"), "advanced NOT available for summary");
truthy(supportsPerGameScores("full_linescore") && supportsPerGameScores("game_scores"),
  "per-game scores available in full+game_scores");
truthy(!supportsPerGameScores("summary_only"), "no per-game scores in summary-only");

// ----- 7-point: standard win + set --------------------------------------
{
  const r = computeHistoricalMatch({
    pointSystem: 7,
    sideA: { gameScores: [180, 175, 190], handicap: 20, participation: { status: "rostered" } },
    sideB: { gameScores: [150, 160, 170], handicap: 30, participation: { status: "rostered" } },
  });
  // A hcp: 200,195,210 vs B hcp: 180,190,200 → A sweeps + set = 7.
  eq(r.finalPointsA, 7, "7-point A wins all + set = 7");
  eq(r.finalPointsB, 0, "7-point B loses all = 0");
  eq(r.winner, "A", "winner A");
}

// ----- 7-point: one tied game -------------------------------------------
{
  const r = computeHistoricalMatch({
    pointSystem: 7,
    sideA: { gameScores: [200, 150, 180], handicap: 0, participation: { status: "rostered" } },
    sideB: { gameScores: [200, 200, 100], handicap: 0, participation: { status: "rostered" } },
  });
  // g1 tie 1-1, g2 B wins 2-0, g3 A wins 2-0. Sets: A=530 B=500 -> A gets set.
  eq(r.a.gamePoints, 3, "A 1+0+2 = 3");
  eq(r.b.gamePoints, 3, "B 1+2+0 = 3");
  eq(r.a.setPoint, 1, "A set");
  eq(r.finalPointsA, 4, "A total 4"); eq(r.finalPointsB, 3, "B total 3");
}

// ----- 7-point: set tie halves ------------------------------------------
{
  const r = computeHistoricalMatch({
    pointSystem: 7,
    sideA: { gameScores: [180, 170, 150], handicap: 0, participation: { status: "rostered" } },
    sideB: { gameScores: [170, 180, 150], handicap: 0, participation: { status: "rostered" } },
  });
  // Sets equal at 500 -> 0.5/0.5. g1 A, g2 B, g3 tie.
  eq(r.a.setPoint, 0.5, "set tie A"); eq(r.b.setPoint, 0.5, "set tie B");
  eq(r.finalPointsA, 3.5, "A 2+0+1+0.5 = 3.5");
  eq(r.finalPointsB, 3.5, "B 0+2+1+0.5 = 3.5");
  eq(r.winner, "T", "tie");
}

// ----- 4-point mode: per-game halved -------------------------------------
{
  const r = computeHistoricalMatch({
    pointSystem: 4,
    sideA: { gameScores: [200, 150, 180], handicap: 0, participation: { status: "rostered" } },
    sideB: { gameScores: [150, 200, 180], handicap: 0, participation: { status: "rostered" } },
  });
  // g1 A wins 1-0, g2 B wins 1-0, g3 tie 0.5-0.5. Set equal 530=530 -> 0.5/0.5.
  eq(r.a.gamePoints, 1.5, "A 4pt game total");
  eq(r.b.gamePoints, 1.5, "B 4pt game total");
  eq(r.a.setPoint, 0.5, "4pt set tie");
  eq(r.finalPointsA, 2.0, "A 2/4");
  eq(r.finalPointsB, 2.0, "B 2/4");
}

// ----- Override wins ------------------------------------------------------
{
  const r = computeHistoricalMatch({
    pointSystem: 7,
    sideA: { gameScores: [100, 100, 100], handicap: 0, participation: { status: "rostered" } },
    sideB: { gameScores: [200, 200, 200], handicap: 0, participation: { status: "rostered" } },
    override: { pointsA: 7, pointsB: 0, reason: "forfeit reversal" },
  });
  eq(r.finalPointsA, 7, "override A"); eq(r.finalPointsB, 0, "override B");
  eq(r.winner, "A", "override winner");
}

// ----- Substitute: personal stats to sub, points to scheduled ------------
{
  // Two-week season, one match, side A scheduled=P1 substitute=X, side B=P2
  const weeks: HistoricalWeekSummary[] = [{
    weekNumber: 1, date: null, published: true, completed: true,
    matches: [{
      slotId: "m1", weekNumber: 1, lanePair: "1-2", slot: 1,
      detailMode: "game_scores",
      scheduledA: "P1", scheduledB: "P2",
      actualA: "X", actualB: "P2",
      actualNameA: "X", actualNameB: "P2",
      isSubA: true, isSubB: false, absentA: false, absentB: false,
      entryAverageA: 100, entryAverageB: 120,
      handicapA: 40, handicapB: 30,
      scratchGamesA: [150, 160, 170], scratchGamesB: [130, 140, 150],
      handicapGamesA: [190, 200, 210], handicapGamesB: [160, 170, 180],
      scratchTotalA: 480, scratchTotalB: 420,
      handicapTotalA: 600, handicapTotalB: 510,
      gameAwardsA: [2, 2, 2], gameAwardsB: [0, 0, 0],
      gamePointsA: 6, gamePointsB: 0,
      setPointA: 1, setPointB: 0,
      totalPointsA: 7, totalPointsB: 0,
      finalPointsA: 7, finalPointsB: 0,
      overrideEnabled: false, winner: "A",
    } as HistoricalMatch],
  }];
  const participants: HistoricalParticipantMeta[] = [
    { ref: "P1", displayName: "P1", role: "rostered", personId: null },
    { ref: "P2", displayName: "P2", role: "rostered", personId: null },
    { ref: "X",  displayName: "X",  role: "substitute", personId: null },
  ];
  const standings = buildHistoricalStandings({ participants, weeks, summaryRecords: [], pointSystem: 7 });
  const p1 = standings.find((r) => r.participantRef === "P1")!;
  const p2 = standings.find((r) => r.participantRef === "P2")!;
  const x  = standings.find((r) => r.participantRef === "X");
  truthy(!x, "substitute must not appear in standings");
  eq(p1.points, 7, "scheduled gets points");
  eq(p2.points, 0, "opponent gets zero");
  // P1 games/pinfall stay null — she did not personally bowl.
  eq(p1.games, null, "sub rolled, scheduled personal stats stay unavailable");
  eq(p1.scratchPinfall, null, "no fabricated pinfall on scheduled");
  eq(p2.games, 3, "opponent personal games count normally");
}

// ----- Absent side: opponent still gets full points ----------------------
{
  const r = computeHistoricalMatch({
    pointSystem: 7,
    sideA: { gameScores: [null, null, null], handicap: 20,
      participation: { status: "absent" } },
    sideB: { gameScores: [150, 160, 170], handicap: 20,
      participation: { status: "rostered" } },
  });
  // No comparison happens when one side has no scores → both zero. Real
  // seasons handle absent-side scores via absentScores; verify that path:
  eq(r.finalPointsA, 0, "absent no-scores A = 0");
  eq(r.finalPointsB, 0, "no comparison → B also 0 unless absentScores present");

  const r2 = computeHistoricalMatch({
    pointSystem: 7,
    sideA: { gameScores: [null, null, null], handicap: 20,
      participation: { status: "absent", absentScores: [80, 80, 80] } },
    sideB: { gameScores: [150, 160, 170], handicap: 20,
      participation: { status: "rostered" } },
  });
  // A hcp=[100,100,100]; B hcp=[170,180,190]. B sweeps + set → 7.
  eq(r2.finalPointsA, 0, "absent with scores gets 0 game points"); // hcpA<hcpB all games
  eq(r2.finalPointsB, 7, "opponent gets 7");
}

// ----- Detail-mode aggregation: unavailable ≠ zero -----------------------
{
  const a = aggregateAcrossModes({
    perMatch: [
      { mode: "full_linescore", scratchGames: [180, 170, 190] },
      { mode: "game_scores",    scratchGames: [150, 160, 170] },
      { mode: "summary_only" }, // contributes nothing
    ],
    summary: null,
  });
  eq(a.games, 6, "6 games from two contributing matches");
  eq(a.scratchPinfall, 180+170+190+150+160+170, "pinfall summed");
  truthy(a.advancedAvailable, "advanced when any full");

  const b = aggregateAcrossModes({
    perMatch: [{ mode: "summary_only" }],
    summary: { games: 30, scratchPinfall: 3300, highGame: 200, highSet: 550 },
  });
  eq(b.games, 30, "summary fallback games");
  eq(b.average, 110, "summary avg");
  truthy(!b.advancedAvailable, "summary-only → no advanced");

  const c = aggregateAcrossModes({ perMatch: [], summary: null });
  eq(c.games, null, "empty → null, never zero");
  eq(c.average, null, "empty avg null");
  eq(c.highGame, null, "empty high null");
}

// ----- Standings uses summary-only fallback when no weekly data ---------
{
  const standings = buildHistoricalStandings({
    participants: [{ ref: "P1", displayName: "Legacy Champ", role: "rostered", personId: "person-1" }],
    weeks: [],
    summaryRecords: [{
      participantRef: "P1", personId: "person-1", role: "rostered",
      displayName: "Legacy Champ", bowlerNumber: "1",
      games: 45, scratchPinfall: 5000, average: 111.1, highGame: 210, highSet: 580,
      points: 210, pointsLost: 105, finalFinish: 1, isChampion: true,
    }],
  });
  eq(standings.length, 1, "one row");
  truthy(standings[0].fromSummaryOnly, "flagged summary-only");
  eq(standings[0].games, 45, "summary games surfaced");
  eq(standings[0].points, 210, "summary points surfaced");
}

// ----- Dedupe: snapshot beats summary for same (season, role) -----------
{
  const deduped = dedupeHistoricalContributions([
    { seasonId: "s", seasonLabel: "s", role: "rostered", displayName: "n",
      bowlerNumber: null, startingAverage: null, handicap: null,
      games: 30, scratchPinfall: 3300, average: 110, highGame: 180, highSet: 500,
      points: 42, finalFinish: 3, isChampion: false, hasGameData: true,
      source: "historical_snapshot" },
    { seasonId: "s", seasonLabel: "s", role: "rostered", displayName: "n",
      bowlerNumber: null, startingAverage: null, handicap: null,
      games: 30, scratchPinfall: 3200, average: 106.6, highGame: 170, highSet: 490,
      points: 40, finalFinish: 3, isChampion: false, hasGameData: true,
      source: "historical_summary" },
    { seasonId: "s", seasonLabel: "s", role: "substitute", displayName: "n",
      bowlerNumber: null, startingAverage: null, handicap: null,
      games: 6, scratchPinfall: 660, average: 110, highGame: 130, highSet: 350,
      points: null, finalFinish: null, isChampion: false, hasGameData: true,
      source: "historical_snapshot" },
  ]);
  eq(deduped.length, 2, "one per (season, role)");
  const rost = deduped.find((r) => r.role === "rostered")!;
  eq(rost.source, "historical_snapshot", "snapshot beat summary");
  eq(rost.scratchPinfall, 3300, "snapshot value kept");
}

// ----- Lane ordering across weekly-results style rows -------------------
{
  const rows = [
    { lanePair: "11-12", slot: 1 },
    { lanePair: "9-10", slot: 2 },
    { lanePair: "1-2", slot: 1 },
  ];
  rows.sort(compareLanePairSlotCamel);
  eq(rows.map((r) => r.lanePair), ["1-2", "9-10", "11-12"], "11-12 sorts last");
}

// eslint-disable-next-line no-console
console.log("historical-phase tests passed");
