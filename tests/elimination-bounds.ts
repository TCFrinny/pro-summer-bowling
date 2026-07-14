/**
 * Deterministic tests for the bounds-only elimination pass and the
 * admin save-full merge helper.
 */

import { readFileSync } from "node:fs";
import { computeEliminationBounds } from "../src/lib/elimination-bounds";
import { validateAndMergeFullElimination } from "../src/lib/elimination-repo.functions";
import { buildSnapshot, type Bowler, type Match, type MatchResult, type PublicSnapshot, type WeekSummary } from "../src/lib/mock-data";

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error("elimination-bounds test failed: " + msg);
}
function bowler(id: string, points: number, name?: string): Bowler {
  return {
    id, name: name ?? id.toUpperCase(), entryAverage: 150, handicap: 8,
    scratchAverage: 0, points, pointsLost: 0, gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0,
    actualScratchPinfall: 0, movement: 0,
  };
}
let mid = 0;
function completed(w: number, a: string, b: string): Match {
  return {
    id: `m${++mid}`, week: w, lanePair: "1-2", slot: 0,
    status: "completed", bowlerA: a, bowlerB: b,
    result: {} as unknown as MatchResult,
  };
}
function week(n: number, opts: Partial<WeekSummary> = {}): WeekSummary {
  return { week: n, date: "", completed: true, published: true, ...opts };
}

// --- 1. Strict clinch with 1 remaining match: 7.5 lead clinches; 7.0 not.
{
  // A leads B by 7.5, only week 2 remaining.
  const bs = [bowler("a", 7.5), bowler("b", 0)];
  const snap = computeEliminationBounds({
    activeBowlers: bs, weeks: [week(1)], matchesByWeek: { 1: [completed(1, "a", "b")] }, totalWeeks: 2,
  });
  const a = snap.rows.find((r) => r.bowler.id === "a")!;
  expect(a.status === "clinched", `7.5 lead 1 remaining should clinch; got ${a.status}`);
  expect(snap.calculationMode === "bounds_only", "mode bounds_only");

  // 7.0 lead — opp absMax = 0 + 7 = 7.0 units? Wait we work in half-points.
  // 7.0 pts = 14 units. opp curr 0 units, remaining 1 match → 14 units absMax.
  // target curr 14 units, 14 > 14 false → not clinched.
  const bs2 = [bowler("a", 7), bowler("b", 0)];
  const snap2 = computeEliminationBounds({
    activeBowlers: bs2, weeks: [week(1)], matchesByWeek: { 1: [completed(1, "a", "b")] }, totalWeeks: 2,
  });
  const a2 = snap2.rows.find((r) => r.bowler.id === "a")!;
  expect(a2.status !== "clinched", `7.0 lead 1 remaining must NOT clinch; got ${a2.status}`);
  expect(a2.status === "not_proven", "7.0 lead 1 remaining should be not_proven");
}

// --- 2. Strict clinch with 2 remaining: 14.5 clinches; 14.0 does not.
{
  const bs = [bowler("a", 14.5), bowler("b", 0)];
  const snap = computeEliminationBounds({
    activeBowlers: bs, weeks: [], matchesByWeek: {}, totalWeeks: 2,
  });
  const a = snap.rows.find((r) => r.bowler.id === "a")!;
  expect(a.status === "clinched", `14.5 lead 2 remaining should clinch; got ${a.status}`);

  const bs2 = [bowler("a", 14), bowler("b", 0)];
  const snap2 = computeEliminationBounds({
    activeBowlers: bs2, weeks: [], matchesByWeek: {}, totalWeeks: 2,
  });
  const a2 = snap2.rows.find((r) => r.bowler.id === "a")!;
  expect(a2.status !== "clinched", `14.0 lead 2 remaining must NOT clinch; got ${a2.status}`);
}

// --- 3. Obvious single-opponent elimination proven cheaply. -----------
{
  // A: 0 pts, 0 remaining. B: 20 pts. tFinal=0, oCurr=40 units > 0.
  const bs = [
    bowler("a", 0),
    bowler("b", 20),
  ];
  const snap = computeEliminationBounds({
    activeBowlers: bs, weeks: [week(1)],
    matchesByWeek: { 1: [completed(1, "a", "b")] }, totalWeeks: 1,
  });
  const a = snap.rows.find((r) => r.bowler.id === "a")!;
  expect(a.status === "eliminated", `single-opp elim; got ${a.status}`);
}

// --- 4. Unresolved case: never guessed Alive / Tiebreaker. -------------
{
  const bs = [bowler("a", 0), bowler("b", 0), bowler("c", 0), bowler("d", 0)];
  const snap = computeEliminationBounds({
    activeBowlers: bs, weeks: [], matchesByWeek: {}, totalWeeks: 3,
  });
  for (const r of snap.rows) {
    expect(r.status !== "alive" && r.status !== "tiebreaker_only",
      `bounds-only must never guess ${r.status}`);
  }
}

// --- 5. Compact snapshot strips diagnostics on save. -------------------
{
  const bs = [bowler("a", 0), bowler("b", 0)];
  const current = buildSnapshot({
    bowlers: bs, weeks: [week(1)], matchesByWeek: {}, activeBowlerIds: new Set(["a", "b"]),
  });
  const merged = validateAndMergeFullElimination({
    currentSnapshot: current, builtAtToken: current.builtAt,
    incoming: {
      weeksRemaining: 0,
      rows: [
        { bowlerId: "a", status: "alive", note: "n", maxFinalPoints: 7, bestMargin: 0 },
        { bowlerId: "b", status: "alive", note: "n", maxFinalPoints: 7, bestMargin: 0 },
      ],
    },
  });
  expect(merged.ok, "merge ok");
  if (!merged.ok) throw new Error("unreachable");
  for (const r of merged.elimination.rows) {
    expect(!("diagnostics" in r) || r.diagnostics === undefined,
      `diagnostics must be stripped for ${r.bowler.id}`);
  }
  expect(merged.elimination.calculationMode === "full", "mode=full");
  expect(merged.elimination.sourceBuiltAt === current.builtAt, "sourceBuiltAt set");
}

// --- 6. Save validation: stale builtAt is rejected. --------------------
{
  const current = buildSnapshot({
    bowlers: [bowler("a", 0), bowler("b", 0)], weeks: [], matchesByWeek: {},
    activeBowlerIds: new Set(["a", "b"]),
  });
  const r = validateAndMergeFullElimination({
    currentSnapshot: current, builtAtToken: current.builtAt + 1,
    incoming: { weeksRemaining: 0, rows: [] },
  });
  expect(!r.ok && r.code === "stale", "stale rejection");
}

// --- 7. Save validation rejects duplicate / missing / unknown IDs. -----
{
  const current = buildSnapshot({
    bowlers: [bowler("a", 0), bowler("b", 0)], weeks: [], matchesByWeek: {},
    activeBowlerIds: new Set(["a", "b"]),
  });
  const dup = validateAndMergeFullElimination({
    currentSnapshot: current, builtAtToken: current.builtAt,
    incoming: { weeksRemaining: 0, rows: [
      { bowlerId: "a", status: "alive" },
      { bowlerId: "a", status: "alive" },
    ] },
  });
  expect(!dup.ok && dup.code === "invalid" && /duplicate/i.test(dup.error), "duplicate id rejected");

  const missing = validateAndMergeFullElimination({
    currentSnapshot: current, builtAtToken: current.builtAt,
    incoming: { weeksRemaining: 0, rows: [{ bowlerId: "a", status: "alive" }] },
  });
  expect(!missing.ok && /missing rows/i.test(missing.error), "missing id rejected");

  const unknown = validateAndMergeFullElimination({
    currentSnapshot: current, builtAtToken: current.builtAt,
    incoming: { weeksRemaining: 0, rows: [
      { bowlerId: "a", status: "alive" },
      { bowlerId: "b", status: "alive" },
      { bowlerId: "zz", status: "alive" },
    ] },
  });
  expect(!unknown.ok && /unknown/i.test(unknown.error), "unknown id rejected");
}

// --- 8. Save validation: invalid status + non-finite numbers rejected. -
{
  const current = buildSnapshot({
    bowlers: [bowler("a", 0), bowler("b", 0)], weeks: [], matchesByWeek: {},
    activeBowlerIds: new Set(["a", "b"]),
  });
  const badStatus = validateAndMergeFullElimination({
    currentSnapshot: current, builtAtToken: current.builtAt,
    incoming: { weeksRemaining: 0, rows: [
      { bowlerId: "a", status: "bogus" as never },
      { bowlerId: "b", status: "alive" },
    ] },
  });
  expect(!badStatus.ok && /invalid status/i.test(badStatus.error), "bad status rejected");

  const badNum = validateAndMergeFullElimination({
    currentSnapshot: current, builtAtToken: current.builtAt,
    incoming: { weeksRemaining: 0, rows: [
      { bowlerId: "a", status: "alive", maxFinalPoints: Number.NaN },
      { bowlerId: "b", status: "alive" },
    ] },
  });
  expect(!badNum.ok && /finite/i.test(badNum.error), "NaN rejected");
}

// --- 9. Save maps bowler objects from CURRENT snapshot, not payload. ---
{
  const current: PublicSnapshot = buildSnapshot({
    bowlers: [bowler("a", 0, "Alice"), bowler("b", 0, "Bob")],
    weeks: [], matchesByWeek: {}, activeBowlerIds: new Set(["a", "b"]),
  });
  // Client tries to pass a spoofed bowler object — our helper ignores it.
  const r = validateAndMergeFullElimination({
    currentSnapshot: current, builtAtToken: current.builtAt,
    incoming: { weeksRemaining: 0, rows: [
      { bowlerId: "a", status: "alive" },
      { bowlerId: "b", status: "alive" },
    ] },
  });
  expect(r.ok, "merge ok");
  if (!r.ok) throw new Error("unreachable");
  const a = r.elimination.rows.find((x) => x.bowler.id === "a")!;
  expect(a.bowler === current.bowlersById["a"],
    "bowler object must be rebuilt from current snapshot");
}

// --- 10. Public route does NOT invoke the full solver during render. ---
{
  const src = readFileSync("src/routes/elimination.tsx", "utf8");
  expect(!src.includes("computeElimination("),
    "elimination route must not invoke the full solver at render time");
}

// eslint-disable-next-line no-console
console.log("elimination-bounds tests passed");
