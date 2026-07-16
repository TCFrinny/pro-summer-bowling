/**
 * Final Week Live Scoring — pure types + merge logic.
 *
 * This module has ZERO Supabase imports so it can be reused by:
 *   - the server-side snapshot builder (`snapshot-builder.server.ts`),
 *   - the admin server functions (`live-scoring.functions.ts`),
 *   - the admin UI (`admin.live-scoring.tsx`), and
 *   - deterministic tests.
 *
 * Design contract:
 *   - Every `live_match_results` row is keyed uniquely on `schedule_slot_id`.
 *   - A full `match_results` row for the same slot ALWAYS takes precedence.
 *     Live rows for that slot are ignored on read AND deleted on convert.
 *   - A pair's game is "awarded" only when BOTH sides have a valid score.
 *     Handicap pinfall, scratch stats, and game points credit per-pair-
 *     completed. The 1-point set award is only granted when ALL 3 games
 *     for both sides exist.
 *   - Absent sides cannot participate in live scoring — that flow requires
 *     the admin to use the normal Results editor / manual override.
 *   - Frame-derived stats (Mark %, Strikes, Pins Lost, First 5, etc.) are
 *     NEVER fabricated from score-only rows. Down-stream code detects
 *     score-only via `MatchResult.scoreOnly === true` and skips them.
 */

import {
  computeHandicap,
  type BowlerId,
  type GameAward,
  type LanePair,
  type MatchResult,
  type SetAward,
  type SideParticipation,
} from "./mock-data";

// ---------------------------------------------------------------------------
// Row shape (as stored in Supabase after JSON round-trip)
// ---------------------------------------------------------------------------

export interface LiveSideJson {
  scheduledId: BowlerId;
  status: "rostered" | "substitute";
  actualId: BowlerId | null;
  actualName: string;
  scheduledName: string;
  entryAverage: number;
  handicap: number;
}

/** DB row for `public.live_match_results`. */
export interface LiveMatchRow {
  id: string;
  schedule_slot_id: string;
  week_id: string;
  season_id: string;
  side_a: LiveSideJson;
  side_b: LiveSideJson;
  a_game1: number | null;
  a_game2: number | null;
  a_game3: number | null;
  b_game1: number | null;
  b_game2: number | null;
  b_game3: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_AVG_MIN = 1;
const VALID_AVG_MAX = 300;

function validScore(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 300;
}

/** True when the given input describes a substitute row. Both submitted
 *  overrides and pool starting-averages are considered valid inputs. */
export function isValidStartingAverage(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= VALID_AVG_MIN && n <= VALID_AVG_MAX;
}

/** Which per-pair game slots (0/1/2) currently have both scores populated. */
export function pairCompletedMask(row: {
  a_game1: number | null; a_game2: number | null; a_game3: number | null;
  b_game1: number | null; b_game2: number | null; b_game3: number | null;
}): [boolean, boolean, boolean] {
  return [
    validScore(row.a_game1) && validScore(row.b_game1),
    validScore(row.a_game2) && validScore(row.b_game2),
    validScore(row.a_game3) && validScore(row.b_game3),
  ];
}

/** Awarded so far given a completion mask. */
export function completedGameCount(mask: [boolean, boolean, boolean]): 0 | 1 | 2 | 3 {
  return (mask.filter(Boolean).length) as 0 | 1 | 2 | 3;
}

/** Remaining unawarded points for one live matchup.
 *  Contract: 0 games → 7, 1 → 5, 2 → 3, 3 → 0 (set point awarded at 3). */
export function remainingPointsForLive(mask: [boolean, boolean, boolean]): 0 | 3 | 5 | 7 {
  const n = completedGameCount(mask);
  if (n === 0) return 7;
  if (n === 1) return 5;
  if (n === 2) return 3;
  return 0;
}

// ---------------------------------------------------------------------------
// Merge live row → MatchResult (score-only variant)
// ---------------------------------------------------------------------------

/** Build a score-only MatchResult from a live row + slot metadata. Called
 *  during snapshot rebuild ONLY when the same slot has no full result. */
export function computeLiveMatchResult(input: {
  row: LiveMatchRow;
  scheduledNameA: string;
  scheduledNameB: string;
}): MatchResult {
  const { row, scheduledNameA, scheduledNameB } = input;
  const { side_a: sa, side_b: sb } = row;

  const scoreA1 = validScore(row.a_game1) ? row.a_game1 : 0;
  const scoreA2 = validScore(row.a_game2) ? row.a_game2 : 0;
  const scoreA3 = validScore(row.a_game3) ? row.a_game3 : 0;
  const scoreB1 = validScore(row.b_game1) ? row.b_game1 : 0;
  const scoreB2 = validScore(row.b_game2) ? row.b_game2 : 0;
  const scoreB3 = validScore(row.b_game3) ? row.b_game3 : 0;

  const gamesA: [number, number, number] = [scoreA1, scoreA2, scoreA3];
  const gamesB: [number, number, number] = [scoreB1, scoreB2, scoreB3];
  const mask = pairCompletedMask(row);
  const completed = completedGameCount(mask);

  const hcpA = sa.handicap;
  const hcpB = sb.handicap;

  // Per-game handicap totals — 0 for pending pairs so downstream sums stay
  // consistent with the "completed pairs only" credit rule.
  const hcpGamesA: [number, number, number] = [
    mask[0] ? scoreA1 + hcpA : 0,
    mask[1] ? scoreA2 + hcpA : 0,
    mask[2] ? scoreA3 + hcpA : 0,
  ];
  const hcpGamesB: [number, number, number] = [
    mask[0] ? scoreB1 + hcpB : 0,
    mask[1] ? scoreB2 + hcpB : 0,
    mask[2] ? scoreB3 + hcpB : 0,
  ];

  // Scratch/handicap totals sum ONLY over completed pairs. This is what
  // credits into standings.handicapPinfall and (rostered path) scratchPinfall.
  const scratchTotalA = (mask[0] ? scoreA1 : 0) + (mask[1] ? scoreA2 : 0) + (mask[2] ? scoreA3 : 0);
  const scratchTotalB = (mask[0] ? scoreB1 : 0) + (mask[1] ? scoreB2 : 0) + (mask[2] ? scoreB3 : 0);
  const handicapTotalA =
    (mask[0] ? scoreA1 + hcpA : 0) + (mask[1] ? scoreA2 + hcpA : 0) + (mask[2] ? scoreA3 + hcpA : 0);
  const handicapTotalB =
    (mask[0] ? scoreB1 + hcpB : 0) + (mask[1] ? scoreB2 + hcpB : 0) + (mask[2] ? scoreB3 + hcpB : 0);

  // Per-game awards: only awarded on completed pairs (both sides scored).
  const gameAwardsA: [GameAward, GameAward, GameAward] = [0, 0, 0];
  const gameAwardsB: [GameAward, GameAward, GameAward] = [0, 0, 0];
  let gpA = 0, gpB = 0;
  for (let i = 0; i < 3; i++) {
    if (!mask[i]) continue;
    const sA = hcpGamesA[i];
    const sB = hcpGamesB[i];
    if (sA > sB) { gameAwardsA[i] = 2; gpA += 2; }
    else if (sB > sA) { gameAwardsB[i] = 2; gpB += 2; }
    else { gameAwardsA[i] = 1; gameAwardsB[i] = 1; gpA += 1; gpB += 1; }
  }
  // Set award: only when ALL 3 pairs complete.
  let setPointA: SetAward = 0, setPointB: SetAward = 0;
  if (completed === 3) {
    if (handicapTotalA > handicapTotalB) { setPointA = 1; setPointB = 0; }
    else if (handicapTotalB > handicapTotalA) { setPointA = 0; setPointB = 1; }
    else { setPointA = 0.5; setPointB = 0.5; }
  }
  const totalPointsA = gpA + setPointA;
  const totalPointsB = gpB + setPointB;
  const winner: "A" | "B" | "T" =
    totalPointsA > totalPointsB ? "A" : totalPointsB > totalPointsA ? "B" : "T";

  const participationA: SideParticipation = {
    scheduledId: sa.scheduledId,
    status: sa.status,
    actualId: sa.actualId,
    actualName: sa.actualName,
  };
  const participationB: SideParticipation = {
    scheduledId: sb.scheduledId,
    status: sb.status,
    actualId: sb.actualId,
    actualName: sb.actualName,
  };

  return {
    scheduledA: sa.scheduledId, scheduledB: sb.scheduledId,
    scheduledNameA, scheduledNameB,
    actualA: sa.actualId, actualB: sb.actualId,
    actualNameA: sa.actualName, actualNameB: sb.actualName,
    isSubA: sa.status === "substitute",
    isSubB: sb.status === "substitute",
    subA: sa.status === "substitute" ? sa.actualName : undefined,
    subB: sb.status === "substitute" ? sb.actualName : undefined,
    participationA, participationB,
    entryAverageA: sa.entryAverage, entryAverageB: sb.entryAverage,
    handicapA: hcpA, handicapB: hcpB,
    // No frame linescores exist for score-only rows.
    linescoreA: null, linescoreB: null,
    gamesA, gamesB,
    handicapGamesA: hcpGamesA, handicapGamesB: hcpGamesB,
    scratchTotalA, scratchTotalB,
    handicapTotalA, handicapTotalB,
    gameAwardsA, gameAwardsB,
    gamePointsA: gpA, gamePointsB: gpB,
    setPointA, setPointB,
    totalPointsA, totalPointsB,
    pointsOverride: null,
    winner,
    // Score-only markers — every downstream reader consults these fields
    // to skip frame-derived aggregation and to gate high-set / gamesPlayed.
    scoreOnly: true,
    completedGameCount: completed,
    pairCompleted: mask,
  };
}

// ---------------------------------------------------------------------------
// Build a frozen side JSON from a resolved effective scoring identity.
// Called from the admin server-fn save path.
// ---------------------------------------------------------------------------

export function buildLiveSideJson(input: {
  scheduledId: BowlerId;
  scheduledName: string;
  status: "rostered" | "substitute";
  actualId: BowlerId | null;
  actualName: string;
  entryAverage: number;
}): LiveSideJson {
  return {
    scheduledId: input.scheduledId,
    status: input.status,
    actualId: input.actualId,
    actualName: input.actualName,
    scheduledName: input.scheduledName,
    entryAverage: input.entryAverage,
    handicap: computeHandicap(input.entryAverage),
  };
}

// ---------------------------------------------------------------------------
// Public helpers used by UI + snapshot builder
// ---------------------------------------------------------------------------

/** Status pill copy for the public schedule / weekly-results screens. */
export function liveStatusLabel(mask: [boolean, boolean, boolean]): string {
  const n = completedGameCount(mask);
  if (n === 3) return "Final · scores only";
  return `Live · ${n}/3 games`;
}

/** Convenience: normalized lane pair (accepts LanePair or plain string). */
export function normalizeLanePair(lp: string): LanePair | null {
  const set = new Set<string>([
    "1-2", "3-4", "5-6", "7-8", "9-10", "11-12",
  ]);
  return set.has(lp) ? (lp as LanePair) : null;
}

// ---------------------------------------------------------------------------
// Deterministic self-tests (run on module load — same convention as
// substitute-handicap.ts).
// ---------------------------------------------------------------------------

(function selfTest() {
  const errs: string[] = [];
  const eq = (a: unknown, b: unknown, msg: string) => {
    if (a !== b) errs.push(`${msg}: expected ${String(b)} got ${String(a)}`);
  };

  const emptyMask: [boolean, boolean, boolean] = [false, false, false];
  eq(remainingPointsForLive(emptyMask), 7, "0 done → 7 remaining");
  eq(remainingPointsForLive([true, false, false]), 5, "1 done → 5 remaining");
  eq(remainingPointsForLive([true, true, false]), 3, "2 done → 3 remaining");
  eq(remainingPointsForLive([true, true, true]), 0, "3 done → 0 remaining");

  eq(completedGameCount(emptyMask), 0, "count 0");
  eq(completedGameCount([false, true, false]), 1, "count 1");

  eq(liveStatusLabel([true, false, false]), "Live · 1/3 games", "label 1/3");
  eq(liveStatusLabel([true, true, true]), "Final · scores only", "label final");

  // Score-only MatchResult synth — verify basic contract.
  const sideA: LiveSideJson = buildLiveSideJson({
    scheduledId: "b01", scheduledName: "Alex", status: "rostered",
    actualId: "b01", actualName: "Alex", entryAverage: 120,
  });
  const sideB: LiveSideJson = buildLiveSideJson({
    scheduledId: "b02", scheduledName: "Ben", status: "rostered",
    actualId: "b02", actualName: "Ben", entryAverage: 130,
  });
  eq(sideA.handicap, 32, "sideA hcp 32");
  eq(sideB.handicap, 24, "sideB hcp 24");

  // Game 1 only: A 150+32=182, B 140+24=164 → A wins 2 game points.
  const g1Row: LiveMatchRow = {
    id: "x", schedule_slot_id: "s1", week_id: "w", season_id: "sea",
    side_a: sideA, side_b: sideB,
    a_game1: 150, a_game2: null, a_game3: null,
    b_game1: 140, b_game2: null, b_game3: null,
  };
  const r1 = computeLiveMatchResult({ row: g1Row, scheduledNameA: "Alex", scheduledNameB: "Ben" });
  eq(r1.scoreOnly, true, "scoreOnly true");
  eq(r1.completedGameCount, 1, "completed = 1");
  eq(r1.gamePointsA, 2, "A gp1 = 2");
  eq(r1.gamePointsB, 0, "B gp1 = 0");
  eq(r1.setPointA, 0, "no set point after g1");
  eq(r1.totalPointsA, 2, "A total after g1 = 2");
  eq(r1.handicapTotalA, 182, "A hcp pinfall after g1");
  eq(r1.handicapTotalB, 164, "B hcp pinfall after g1");
  eq(r1.scratchTotalA, 150, "A scratch after g1");

  // Game 2 tie 170h-170h → 1/1. Game 3 not scored.
  const g2Row: LiveMatchRow = {
    ...g1Row,
    a_game2: 138, // 138+32=170
    b_game2: 146, // 146+24=170
  };
  const r2 = computeLiveMatchResult({ row: g2Row, scheduledNameA: "Alex", scheduledNameB: "Ben" });
  eq(r2.completedGameCount, 2, "completed 2");
  eq(r2.gamePointsA, 3, "A gp after g1(2)+g2(1)=3");
  eq(r2.gamePointsB, 1, "B gp after 0+1=1");
  eq(r2.setPointA, 0, "no set point after g2");
  eq(r2.totalPointsA + r2.totalPointsB, 4, "sum after 2 games = 4");

  // All three games; A wins set on handicap total.
  const g3Row: LiveMatchRow = {
    ...g2Row,
    a_game3: 160, // 160+32=192
    b_game3: 130, // 130+24=154
  };
  const r3 = computeLiveMatchResult({ row: g3Row, scheduledNameA: "Alex", scheduledNameB: "Ben" });
  eq(r3.completedGameCount, 3, "completed 3");
  eq(r3.gamePointsA, 5, "A gp3 = 5 (2+1+2)");
  eq(r3.gamePointsB, 1, "B gp3 = 1 (0+1+0)");
  eq(r3.setPointA, 1, "A wins set");
  eq(r3.totalPointsA + r3.totalPointsB, 7, "final match distributes exactly 7 points");
  eq(r3.totalPointsA, 6, "A total 6");
  eq(r3.totalPointsB, 1, "B total 1");
  eq(r3.handicapTotalA, 182 + 170 + 192, "A hcp set total 544");
  eq(r3.handicapTotalB, 164 + 170 + 154, "B hcp set total 488");

  // Out-of-order save: only game 2 has both scores.
  const oooRow: LiveMatchRow = {
    ...g1Row,
    a_game1: null, b_game1: null,
    a_game2: 138, b_game2: 146,
  };
  const rOoo = computeLiveMatchResult({ row: oooRow, scheduledNameA: "Alex", scheduledNameB: "Ben" });
  eq(rOoo.completedGameCount, 1, "ooo count 1");
  eq(rOoo.gamePointsA + rOoo.gamePointsB, 2, "ooo sum awarded = 2");

  // Correction / replace: same input twice must produce identical result
  // (no accumulation) — verifies computeLiveMatchResult is pure.
  const rAgain = computeLiveMatchResult({ row: g3Row, scheduledNameA: "Alex", scheduledNameB: "Ben" });
  eq(rAgain.gamePointsA, r3.gamePointsA, "recompute is deterministic (no double-count)");
  eq(rAgain.handicapTotalA, r3.handicapTotalA, "recompute hcp deterministic");

  if (errs.length) throw new Error("live-scoring self-test failed:\n" + errs.join("\n"));
})();
