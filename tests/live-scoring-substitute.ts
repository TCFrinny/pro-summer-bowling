/**
 * Deterministic tests for SCORE-ONLY substitute aggregation and
 * server-side identity-change enforcement.
 *
 * Covers:
 *   - `buildSubstituteData` aggregates score-only rows into the sub's
 *     personal games/pinfall/avg/high game/high set/POA/lane usage.
 *   - Frame-derived per-week stats (marks/strikes/opens/pins-lost/
 *     first5/last5/big-opening/big-finish/clutch) stay ZERO for
 *     score-only rows.
 *   - Scheduled bowler still receives points/handicap pinfall credit
 *     but their scratch/roster totals do NOT leak sub performance.
 *   - `isLiveIdentityChanged` (the exact predicate the server handler
 *     uses to gate `confirmIdentityChange`) rejects Starting Average /
 *     handicap changes without confirmation and accepts them with.
 *   - Source-level assertions on `live-scoring.functions.ts` prove the
 *     server actually calls the predicate, throws without the flag,
 *     and reuses the frozen JSON only when unchanged.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildSnapshot,
  computeHandicap,
  type Bowler,
  type Match,
  type WeekSummary,
} from "../src/lib/mock-data";
import {
  computeLiveMatchResult,
  isLiveIdentityChanged,
  type LiveMatchRow,
  type LiveSideJson,
} from "../src/lib/live-scoring";
import type { SubstituteIdentity } from "../src/lib/substitute-profiles";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("live-scoring-substitute: " + msg);
}

function mkBowler(id: string, name: string, entryAverage = 130): Bowler {
  return {
    id, name, entryAverage, handicap: computeHandicap(entryAverage),
    scratchAverage: 0, points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0,
    actualScratchPinfall: 0, movement: 0,
  };
}

// ---------------------------------------------------------------------------
// Score-only substitute aggregation
// ---------------------------------------------------------------------------

const a = mkBowler("b01", "Alex", 130);
const b = mkBowler("b02", "Ben", 120);
const c = mkBowler("b03", "Carl", 140);
const d = mkBowler("b04", "Dan", 110);
const bowlers = [a, b, c, d];

const subs: SubstituteIdentity[] = [
  { id: "sub-x", name: "Sub Ex", startingAverage: 125,
    handicap: computeHandicap(125), bowlerNumber: "9999",
    active: true, archived: false },
];

const weeks: WeekSummary[] = [
  { week: 1, date: "", completed: true, published: true },
];

// A live row where sub-x subs for scheduled `a`; two paired games completed.
// Third game is unpaired (only A side entered) → not credited.
const subSideA: LiveSideJson = {
  scheduledId: a.id, status: "substitute",
  actualId: "sub-x", actualName: "Sub Ex", scheduledName: a.name,
  entryAverage: 125, handicap: computeHandicap(125),
};
const oppSideB: LiveSideJson = {
  scheduledId: b.id, status: "rostered",
  actualId: b.id, actualName: b.name, scheduledName: b.name,
  entryAverage: b.entryAverage, handicap: b.handicap,
};
const liveRow: LiveMatchRow = {
  id: "L-sub", schedule_slot_id: "s-sub", week_id: "w1", season_id: "sea",
  side_a: subSideA, side_b: oppSideB,
  a_game1: 150, a_game2: 170, a_game3: 210,   // 3rd is UNPAIRED (opponent null)
  b_game1: 140, b_game2: 130, b_game3: null,
};
const mr = computeLiveMatchResult({
  row: liveRow, scheduledNameA: a.name, scheduledNameB: b.name,
});
assert(mr.scoreOnly === true, "score-only marker set");
assert(mr.linescoreA === null && mr.linescoreB === null, "no linescores on score-only");

const match: Match = {
  id: "m-sub", week: 1, lanePair: "1-2", slot: 0, status: "in-progress",
  bowlerA: a.id, bowlerB: b.id, result: mr,
};

const snap = buildSnapshot({
  bowlers, weeks, matchesByWeek: { 1: [match] },
  substitutes: subs,
});

// -- Substitute personal aggregation ----------------------------------
const profile = snap.substituteProfiles?.["sub-x"];
assert(profile, "sub-x profile must exist");
// Only the 2 paired games count as personal games.
assert(profile.matchesSubbed === 1,
  `sub matchesSubbed must be 1 (got ${profile.matchesSubbed})`);
assert(profile.gamesRolled === 2,
  `sub gamesRolled must equal paired games (got ${profile.gamesRolled})`);
// Pinfall / averages: 150+170=320 across 2 games.
assert(profile.scratchPinfall === 320,
  `sub scratchPinfall must be 320 (got ${profile.scratchPinfall})`);
const expectedAvg = 320 / 2;
assert(Math.abs(profile.scratchAverage - expectedAvg) < 1e-9,
  `sub scratchAverage must be ${expectedAvg} (got ${profile.scratchAverage})`);
// High game must be the max of paired scores.
assert(profile.highGame === 170,
  `sub highGame must be 170 — the unpaired 210 must NOT count (got ${profile.highGame})`);
// High set requires all 3 pairs — here only 2 completed, so 0.
assert(profile.highSet === 0,
  `sub highSet must be 0 for partial score-only (got ${profile.highSet})`);
// Lane usage recorded.
const usage = new Map(profile.lanePairUsage.map((u) => [u.lanePair, u.count]));
assert(usage.get("1-2") === 1, "sub lane usage must credit lanes 1-2 once");

// -- Frame-derived stats stay ZERO -----------------------------------
assert(profile.strikes === 0 && profile.spares === 0 && profile.opens === 0,
  "score-only: strikes/spares/opens must be 0");
assert(profile.marks === 0 && profile.framesRolled === 0,
  "score-only: marks/framesRolled must be 0");
assert(profile.pinsLost === 0, "score-only: pinsLost must be 0");

assert(profile.first5 === 0 && profile.last5 === 0,
  "score-only: first5/last5 must be 0");
assert(profile.bigOpening === 0 && profile.bigFinish === 0,
  "score-only: bigOpening/bigFinish must be 0");
assert(profile.clutchMarks === 0 && profile.clutchOpportunities === 0,
  "score-only: clutch stats must be 0");

// -- Per-week row for the sub reflects score-only shape --------------
assert(profile.weeks.length === 1, "sub must have exactly 1 week row");
const wk = profile.weeks[0];
assert(wk.scoreOnly === true, "week row must be marked scoreOnly");
assert(wk.completedGameCount === 2, "week row completedGameCount must be 2");
assert(wk.linescore === null, "week row linescore must be null");
assert(wk.weekStrikes === 0 && wk.weekSpares === 0 && wk.weekOpens === 0,
  "week row frame stats zero");
assert(wk.weekMarkPct === 0 && wk.weekStrikePct === 0,
  "week row rate stats zero");
// POA: (150 - 125) + (170 - 125) = 25 + 45 = 70 (only paired games).
assert(wk.poaSet === 70,
  `week POA (paired only) must be 70 (got ${wk.poaSet})`);
assert(wk.poaBestGame === 45,
  `week POA best game must be 45 (got ${wk.poaBestGame})`);
assert(wk.startingAverageAtMatch === 125, "week frozen starting avg");

// -- Scheduled bowler credit isolation --------------------------------
// `a` was the scheduled bowler. Points/handicap pinfall credit `a`; the
// sub's personal scratch pinfall / games rolled MUST NOT leak into `a`.
const scheduledA = snap.bowlers.find((x) => x.id === a.id)!;
assert(scheduledA.matchesPlayed === 1,
  "scheduled A must have match credit from the score-only week");
assert(scheduledA.actualGamesRolled === 0,
  `scheduled A actualGamesRolled must be 0 — sub rolled, not A ` +
  `(got ${scheduledA.actualGamesRolled})`);
assert(scheduledA.actualScratchPinfall === 0,
  `scheduled A actualScratchPinfall must be 0 — sub's pinfall must not leak ` +
  `(got ${scheduledA.actualScratchPinfall})`);
assert(scheduledA.scratchPinfall === 0,
  "scheduled A roster scratchPinfall must be 0 for a sub-covered match");
// But the handicap pinfall for the scheduled bowler must be credited using
// the SUB'S per-game scores + SUB'S handicap (frozen on the row).
// Handicap per game for sub-x = computeHandicap(125). Two paired games:
//   (150 + hcp) + (170 + hcp)
const subHcp = computeHandicap(125);
const expectedHcpPin = (150 + subHcp) + (170 + subHcp);
assert(scheduledA.handicapPinfall === expectedHcpPin,
  `scheduled A handicapPinfall must be ${expectedHcpPin} ` +
  `(got ${scheduledA.handicapPinfall})`);

// ---------------------------------------------------------------------------
// Server-side identity-change predicate (pure, extracted from the handler)
// ---------------------------------------------------------------------------

// Baseline frozen prior side: substitute sub-x with Starting Avg 125.
const priorSubSide: LiveSideJson = {
  scheduledId: a.id, status: "substitute",
  actualId: "sub-x", actualName: "Sub Ex", scheduledName: a.name,
  entryAverage: 125, handicap: computeHandicap(125),
};

// 1. Identical submission → no change.
{
  const sameSubmit: LiveSideJson = { ...priorSubSide };
  assert(isLiveIdentityChanged(priorSubSide, sameSubmit) === false,
    "unchanged identity must NOT be flagged");
}

// 2. Different Starting Average (drives handicap) → change.
{
  const changedAvg: LiveSideJson = {
    ...priorSubSide, entryAverage: 118, handicap: computeHandicap(118),
  };
  assert(isLiveIdentityChanged(priorSubSide, changedAvg) === true,
    "changed Starting Average must be flagged");
}

// 3. Different substitute id → change.
{
  const otherSub: LiveSideJson = {
    ...priorSubSide, actualId: "sub-y", actualName: "Sub Y",
  };
  assert(isLiveIdentityChanged(priorSubSide, otherSub) === true,
    "different substitute id must be flagged");
}

// 4. Status flip (substitute → rostered) → change.
{
  const rostered: LiveSideJson = {
    scheduledId: a.id, status: "rostered",
    actualId: a.id, actualName: a.name, scheduledName: a.name,
    entryAverage: a.entryAverage, handicap: a.handicap,
  };
  assert(isLiveIdentityChanged(priorSubSide, rostered) === true,
    "status flip must be flagged");
}

// 5. No prior side (fresh row) → never a change.
{
  const submitted: LiveSideJson = { ...priorSubSide, entryAverage: 90 };
  assert(isLiveIdentityChanged(undefined, submitted) === false,
    "no prior side means no change");
  assert(isLiveIdentityChanged(null, submitted) === false,
    "null prior side means no change");
}

// ---------------------------------------------------------------------------
// Source-level assertions: the handler wires the predicate correctly and
// enforces the three required conditions (change + missing confirm = reject,
// change + confirm = accept + adopt new frozen JSON, unchanged = reuse).
// ---------------------------------------------------------------------------
const ROOT = new URL("..", import.meta.url).pathname;
const handlerSrc = readFileSync(
  join(ROOT, "src/lib/live-scoring.functions.ts"),
  "utf8",
);

// Uses the shared predicate — not an ad-hoc inline check.
assert(/isLiveIdentityChanged\(prior\?\.side_a,\s*submittedA\)/.test(handlerSrc),
  "handler must call isLiveIdentityChanged for side A");
assert(/isLiveIdentityChanged\(prior\?\.side_b,\s*submittedB\)/.test(handlerSrc),
  "handler must call isLiveIdentityChanged for side B");
// Reads the explicit confirmation flag per side.
assert(/m\.confirmIdentityChange\?\.a\s*===\s*true/.test(handlerSrc),
  "handler must check confirmIdentityChange.a === true");
assert(/m\.confirmIdentityChange\?\.b\s*===\s*true/.test(handlerSrc),
  "handler must check confirmIdentityChange.b === true");
// Rejects (throws) when changed AND confirm is missing.
assert(/if\s*\(changedA\s*&&\s*!confirmA\)\s*\{[\s\S]*?throw new Error/.test(handlerSrc),
  "handler must throw when side A identity changed without confirmation");
assert(/if\s*\(changedB\s*&&\s*!confirmB\)\s*\{[\s\S]*?throw new Error/.test(handlerSrc),
  "handler must throw when side B identity changed without confirmation");
// Reuses frozen prior JSON when unchanged; adopts submitted when confirmed.
assert(/anyGameSaved\s*&&\s*!changedA[\s\S]*prior!\.side_a[\s\S]*:\s*submittedA/.test(handlerSrc),
  "handler must reuse frozen side_a when unchanged and adopt submittedA when confirmed");
assert(/anyGameSaved\s*&&\s*!changedB[\s\S]*prior!\.side_b[\s\S]*:\s*submittedB/.test(handlerSrc),
  "handler must reuse frozen side_b when unchanged and adopt submittedB when confirmed");
// Zod schema exposes the confirmation surface.
assert(/confirmIdentityChange:\s*z\.object\(\{\s*a:\s*z\.boolean\(\)\.optional\(\),\s*b:\s*z\.boolean\(\)\.optional\(\)/.test(handlerSrc),
  "handler input validator must expose confirmIdentityChange.{a,b} booleans");

console.log("live-scoring-substitute tests: OK");
