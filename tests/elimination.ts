/**
 * Deterministic tests for the proof-safe elimination solver.
 *
 * Real fixtures with even active rosters and valid published schedules.
 * Each test asserts the exact status the spec calls for, plus witness
 * diagnostics (schedule pairings, integer point allocation) where the
 * proof requires a constructive witness.
 */

import { readFileSync } from "node:fs";
import { computeElimination } from "../src/lib/elimination";
import type { Bowler, Match, MatchResult, WeekSummary } from "../src/lib/mock-data";
import { buildSnapshot } from "../src/lib/mock-data";

function bowler(id: string, points: number, name?: string): Bowler {
  return {
    id, name: name ?? id.toUpperCase(), entryAverage: 150, handicap: 8,
    scratchAverage: 0, points, pointsLost: 0, gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0,
    actualScratchPinfall: 0, movement: 0,
  };
}
function week(n: number, opts: Partial<WeekSummary> = {}): WeekSummary {
  return { week: n, date: "", completed: false, published: true, ...opts };
}
let mid = 0;
function completed(w: number, a: string, b: string): Match {
  return {
    id: `m${++mid}`, week: w, lanePair: "1-2", slot: 0,
    status: "completed", bowlerA: a, bowlerB: b,
    result: {} as unknown as MatchResult,
  };
}
function scheduled(w: number, a: string, b: string): Match {
  return {
    id: `m${++mid}`, week: w, lanePair: "1-2", slot: 0,
    status: "scheduled", bowlerA: a, bowlerB: b,
  };
}
function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error("elimination test failed: " + msg);
}
function pairSet(pairs: Array<[string, string]>): Set<string> {
  return new Set(pairs.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
}
function hasPair(witnessWeek: { pairs: Array<[string, string]> }, a: string, b: string): boolean {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  return pairSet(witnessWeek.pairs).has(key);
}

// ---- Round-robin helper for 4 bowlers (unique pair-sets in 3 weeks). ----
function rr4(a: string, b: string, c: string, d: string, weeks: number[]): Match[][] {
  return [
    [completed(weeks[0], a, b), completed(weeks[0], c, d)],
    [completed(weeks[1], a, c), completed(weeks[1], b, d)],
    [completed(weeks[2], a, d), completed(weeks[2], b, c)],
  ];
}

// --- 1. Two-bowler / 11-week roster → Not Proven (no legal schedule) -----
{
  const bs = [bowler("a", 0), bowler("b", 0)];
  const snap = computeElimination({
    activeBowlers: bs, weeks: [], matchesByWeek: {}, totalWeeks: 11,
  });
  for (const r of snap.rows) {
    expect(r.status === "not_proven",
      `two-bowler/11-week: ${r.bowler.name} got ${r.status}, note=${r.note}`);
    expect(r.status !== "clinched", "must not be clinched");
  }
}

// --- 2. Odd active roster → Not Proven -----------------------------------
{
  const bs = [bowler("a", 0), bowler("b", 0), bowler("c", 0)];
  const snap = computeElimination({
    activeBowlers: bs, weeks: [], matchesByWeek: {}, totalWeeks: 3,
  });
  for (const r of snap.rows) {
    expect(r.status === "not_proven", `odd roster: got ${r.status}`);
    expect((r.note ?? "").toLowerCase().includes("odd"), "note should mention odd");
  }
}

// --- 3. Obvious strict clinch (season complete) --------------------------
{
  const bs = [bowler("t", 21, "T"), bowler("x", 5, "X"), bowler("y", 5, "Y"), bowler("z", 5, "Z")];
  const rr = rr4("t", "x", "y", "z", [1, 2, 3]);
  const matches: Record<number, Match[]> = { 1: rr[0], 2: rr[1], 3: rr[2] };
  const weeks: WeekSummary[] = [
    week(1, { completed: true }), week(2, { completed: true }), week(3, { completed: true }),
  ];
  const snap = computeElimination({ activeBowlers: bs, weeks, matchesByWeek: matches, totalWeeks: 3 });
  const t = snap.rows.find((r) => r.bowler.id === "t")!;
  expect(t.status === "clinched", `strict clinch: got ${t.status}, note=${t.note}`);
  expect(t.maxFinalPoints === 21, `maxFinalPoints expected 21, got ${t.maxFinalPoints}`);
}

// --- 4. Points-bound elimination -----------------------------------------
{
  // 4 bowlers, 2 completed weeks, 1 remaining. Target max = 0 + 7 = 7 < 8.
  const bs = [bowler("t", 0, "T"), bowler("x", 8, "X"), bowler("y", 0, "Y"), bowler("z", 0, "Z")];
  const matches: Record<number, Match[]> = {
    1: [completed(1, "t", "x"), completed(1, "y", "z")],
    2: [completed(2, "t", "y"), completed(2, "x", "z")],
  };
  const weeks: WeekSummary[] = [
    week(1, { completed: true }), week(2, { completed: true }), week(3, { published: false }),
  ];
  const snap = computeElimination({ activeBowlers: bs, weeks, matchesByWeek: matches, totalWeeks: 3 });
  const t = snap.rows.find((r) => r.bowler.id === "t")!;
  expect(t.status === "eliminated", `points-bound elim: got ${t.status}, note=${t.note}`);
  expect((t.note ?? "").includes("X"), "note should reference opponent X");
}

// --- 5. Capacity-bound elimination (no single opp > tMax, but total does) --
{
  // 4 bowlers, 2 completed, 1 remaining. T=0, X=Y=Z=6.
  // tMax = 7. No opp above 7. Non-target match distributes 7 pts → sum tie
  // cap = 3*(7-6) = 3 < 7 → tie impossible → eliminated.
  const bs = [bowler("t", 0, "T"), bowler("x", 6, "X"), bowler("y", 6, "Y"), bowler("z", 6, "Z")];
  const matches: Record<number, Match[]> = {
    1: [completed(1, "t", "x"), completed(1, "y", "z")],
    2: [completed(2, "t", "y"), completed(2, "x", "z")],
  };
  const weeks: WeekSummary[] = [
    week(1, { completed: true }), week(2, { completed: true }), week(3),
  ];
  const snap = computeElimination({ activeBowlers: bs, weeks, matchesByWeek: matches, totalWeeks: 3 });
  const t = snap.rows.find((r) => r.bowler.id === "t")!;
  expect(t.status === "eliminated", `capacity elim: got ${t.status}, note=${t.note}`);
  expect((t.note ?? "").toLowerCase().includes("capacity"),
    `note should mention capacity, got: ${t.note}`);
}

// --- 6. Concrete alive scenario (constructed 3-week round-robin) --------
{
  const bs = [bowler("t", 0, "T"), bowler("x", 0, "X"), bowler("y", 0, "Y"), bowler("z", 0, "Z")];
  const snap = computeElimination({
    activeBowlers: bs, weeks: [week(1), week(2), week(3)], matchesByWeek: {}, totalWeeks: 3,
  });
  const t = snap.rows.find((r) => r.bowler.id === "t")!;
  expect(t.status === "alive", `alive: got ${t.status}, note=${t.note}`);
  expect(t.maxFinalPoints === 21, `maxFinalPoints=${t.maxFinalPoints}`);
  expect((t.bestMargin ?? 0) > 0, `bestMargin=${t.bestMargin}`);
  const d = t.diagnostics!;
  expect(!!d.witnessPairs && d.witnessPairs.length === 3, "witness has 3 unresolved weeks");
  // Every week's pairs cover all 4 bowlers exactly once.
  for (const w of d.witnessPairs!) {
    const covered = new Set<string>();
    for (const [a, b] of w.pairs) { covered.add(a); covered.add(b); }
    expect(covered.size === 4, `week ${w.week} coverage`);
  }
  // No pre-final repeats across witness.
  const seen = new Set<string>();
  for (const w of d.witnessPairs!.filter((w) => w.week !== 3)) {
    for (const [a, b] of w.pairs) {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      expect(!seen.has(k), `pre-final repeat ${k}`);
      seen.add(k);
    }
  }
  // Witness type strict, target ends at 21 pts (42 units).
  expect(d.witnessType === "strict", "witnessType strict");
  expect(d.witnessFinals!["t"] === 42, `t final units 42, got ${d.witnessFinals!["t"]}`);
}

// --- 7. Tiebreaker-only (season-end tie) ---------------------------------
{
  const bs = [bowler("t", 20, "T"), bowler("x", 20, "X"), bowler("y", 5, "Y"), bowler("z", 5, "Z")];
  const rr = rr4("t", "x", "y", "z", [1, 2, 3]);
  const matches: Record<number, Match[]> = { 1: rr[0], 2: rr[1], 3: rr[2] };
  const weeks: WeekSummary[] = [
    week(1, { completed: true }), week(2, { completed: true }), week(3, { completed: true }),
  ];
  const snap = computeElimination({ activeBowlers: bs, weeks, matchesByWeek: matches, totalWeeks: 3 });
  const t = snap.rows.find((r) => r.bowler.id === "t")!;
  expect(t.status === "tiebreaker_only", `tie: got ${t.status}, note=${t.note}`);
  expect(t.bestMargin === 0, `bestMargin=${t.bestMargin}`);
  expect(t.diagnostics?.witnessType === "tie", "witnessType tie");
}

// --- 8. Published next-week pair is locked into the witness schedule ----
{
  const bs = [bowler("t", 0, "T"), bowler("x", 0, "X"), bowler("y", 0, "Y"), bowler("z", 0, "Z")];
  const matches: Record<number, Match[]> = {
    1: [scheduled(1, "t", "y"), scheduled(1, "x", "z")],
  };
  const weeks: WeekSummary[] = [week(1, { published: true }), week(2), week(3)];
  const snap = computeElimination({ activeBowlers: bs, weeks, matchesByWeek: matches, totalWeeks: 3 });
  const t = snap.rows.find((r) => r.bowler.id === "t")!;
  expect(t.status === "alive", `next-fixed: got ${t.status}, note=${t.note}`);
  expect(t.nextOpponent === "Y", `nextOpponent=${t.nextOpponent}`);
  const w1 = t.diagnostics!.witnessPairs!.find((w) => w.week === 1)!;
  expect(hasPair(w1, "t", "y"), "witness week 1 must include fixed T-Y");
  expect(hasPair(w1, "x", "z"), "witness week 1 must include fixed X-Z");
}

// --- 9. Previously played pair never generated pre-final ----------------
{
  // Week 1 completed T-X. Week 2 pre-final, week 3 = final. Target's week-2
  // opponent must NOT be X.
  const bs = [bowler("t", 0, "T"), bowler("x", 0, "X"), bowler("y", 0, "Y"), bowler("z", 0, "Z")];
  const matches: Record<number, Match[]> = {
    1: [completed(1, "t", "x"), completed(1, "y", "z")],
  };
  const weeks: WeekSummary[] = [week(1, { completed: true }), week(2), week(3)];
  const snap = computeElimination({ activeBowlers: bs, weeks, matchesByWeek: matches, totalWeeks: 3 });
  const t = snap.rows.find((r) => r.bowler.id === "t")!;
  expect(t.status === "alive", `no-repeat: got ${t.status}, note=${t.note}`);
  const w2 = t.diagnostics!.witnessPairs!.find((w) => w.week === 2)!;
  expect(!hasPair(w2, "t", "x"), "week 2 must not repeat T-X (used in week 1)");
  expect(!hasPair(w2, "y", "z"), "week 2 must not repeat Y-Z (used in week 1)");
}

// --- 10. Repeat allowed in final week ----------------------------------
{
  // 2 bowlers, 2 weeks: week 1 completed T-X, week 2 = final. Only opponent
  // available is X — repeat legally forced.
  const bs = [bowler("t", 0, "T"), bowler("x", 0, "X")];
  const matches: Record<number, Match[]> = {
    1: [completed(1, "t", "x")],
  };
  const weeks: WeekSummary[] = [week(1, { completed: true }), week(2)];
  const snap = computeElimination({ activeBowlers: bs, weeks, matchesByWeek: matches, totalWeeks: 2 });
  const t = snap.rows.find((r) => r.bowler.id === "t")!;
  expect(t.status === "alive" || t.status === "tiebreaker_only",
    `final-week repeat: got ${t.status}, note=${t.note}`);
  const w2 = t.diagnostics!.witnessPairs!.find((w) => w.week === 2)!;
  expect(hasPair(w2, "t", "x"), "final-week schedule must include T-X repeat");
}

// --- 11. Partial published week: completed + fixed cover all active ----
{
  // Week 1 published: T-X completed, Y-Z fixed unresolved.
  // Weeks 2, 3 unpublished. Verify witness week 1 preserves Y-Z and does
  // not schedule T-X again.
  const bs = [bowler("t", 5, "T"), bowler("x", 0, "X"), bowler("y", 0, "Y"), bowler("z", 0, "Z")];
  const matches: Record<number, Match[]> = {
    1: [completed(1, "t", "x"), scheduled(1, "y", "z")],
  };
  const weeks: WeekSummary[] = [week(1, { published: true }), week(2), week(3)];
  const snap = computeElimination({ activeBowlers: bs, weeks, matchesByWeek: matches, totalWeeks: 3 });
  const t = snap.rows.find((r) => r.bowler.id === "t")!;
  expect(t.status === "alive", `partial-week: got ${t.status}, note=${t.note}`);
  const w1 = t.diagnostics!.witnessPairs!.find((w) => w.week === 1)!;
  expect(w1.pairs.length === 1, `week 1 unresolved pair count = 1, got ${w1.pairs.length}`);
  expect(hasPair(w1, "y", "z"), "week 1 unresolved fixed pair Y-Z must be preserved");
  expect(!hasPair(w1, "t", "x"), "T-X is completed in week 1, not re-scheduled");
  // Weeks 2 & 3 must cover all 4 active bowlers.
  for (const w of t.diagnostics!.witnessPairs!.filter((w) => w.week !== 1)) {
    const covered = new Set<string>();
    for (const [a, b] of w.pairs) { covered.add(a); covered.add(b); }
    expect(covered.size === 4, `week ${w.week} covers 4 bowlers`);
  }
}

// --- 12. Invalid published schedule → Not Proven ----------------------
{
  // Week 1 published but T and X have NO scheduled match; only Y-Z fixed.
  const bs = [bowler("t", 0, "T"), bowler("x", 0, "X"), bowler("y", 0, "Y"), bowler("z", 0, "Z")];
  const matches: Record<number, Match[]> = {
    1: [scheduled(1, "y", "z")],
  };
  const weeks: WeekSummary[] = [week(1, { published: true }), week(2), week(3)];
  const snap = computeElimination({ activeBowlers: bs, weeks, matchesByWeek: matches, totalWeeks: 3 });
  for (const r of snap.rows) {
    expect(r.status === "not_proven", `invalid published: got ${r.status}`);
    expect((r.note ?? "").toLowerCase().includes("published"),
      `note should mention published inconsistency: ${r.note}`);
  }
}

// --- 13. Budget exhaustion → Not Proven (never Eliminated) ------------
{
  const bs = [bowler("t", 0, "T"), bowler("x", 0, "X"), bowler("y", 0, "Y"), bowler("z", 0, "Z")];
  const snap = computeElimination({
    activeBowlers: bs, weeks: [week(1), week(2), week(3)],
    matchesByWeek: {}, totalWeeks: 3, nodeBudget: 0,
  });
  const t = snap.rows.find((r) => r.bowler.id === "t")!;
  expect(t.status === "not_proven", `budget-exhaust: got ${t.status}, note=${t.note}`);
  expect(t.diagnostics?.budgetExhausted === true, "budgetExhausted flag");
}

// --- 14. Public route reads snapshot only (no solver invocation) ------
{
  const src = readFileSync("src/routes/elimination.tsx", "utf8");
  expect(!src.includes("computeElimination"),
    "src/routes/elimination.tsx must not import/call computeElimination");
  expect(src.includes("getEliminationSnapshot"),
    "src/routes/elimination.tsx must read the stored snapshot");
}

// --- 15. No rank/index heuristic remains ------------------------------
{
  const src = readFileSync("src/lib/mock-data.ts", "utf8");
  // Ban the historical placeholder patterns (idx-based status assignment).
  expect(!/status:\s*idx\s*<\s*\d+\s*\?\s*"clinched"/.test(src),
    "index-based clinched heuristic must be removed");
  expect(!/rank\s*<\s*4.*clinched/i.test(src),
    "rank<4 clinched heuristic must be removed");
  // Snapshot must delegate to computeElimination.
  expect(src.includes("computeElimination"),
    "buildSnapshot must call computeElimination for elimination results");
}

// --- Snapshot integration sanity: sparse DB does NOT leak clinched ----
{
  const bs = [bowler("a", 0), bowler("b", 0)];
  const snap = buildSnapshot({
    bowlers: bs, weeks: [week(1)], matchesByWeek: {},
    activeBowlerIds: new Set(["a", "b"]),
  });
  for (const r of snap.elimination.rows) {
    expect(r.status !== "clinched", `sparse clinched leak ${r.bowler.name}`);
    expect(r.status !== "eliminated", `sparse elim leak ${r.bowler.name}`);
  }
  expect(typeof snap.elimination.lastCalculatedAt === "string", "lastCalculatedAt string");
}

// eslint-disable-next-line no-console
console.log("elimination tests passed");
