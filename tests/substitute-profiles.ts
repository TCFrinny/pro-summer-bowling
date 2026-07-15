/**
 * Deterministic tests for substitute aggregation.
 *
 *   - active unused sub → present with zero stats
 *   - archived used sub → present with history preserved
 *   - archived unused sub → OMITTED
 *   - used sub in multiple matches → correct aggregate + frozen values
 *   - scheduled bowler receives points; sub personal stats don't leak into
 *     scheduled bowler's scratch/roster totals
 *   - route source references present
 *   - snapshot missing substitute fields does not crash the getters
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assembleSideLinescore,
  buildSnapshot,
  computeHandicap,
  computeMatchResult,
  seedBowlers,
  seedWeeks,
  _installSnapshotProvider,
  getPublicSubstitutes,
  getSubstituteProfile,
  type Bowler,
  type Match,
  type PublicSnapshot,
} from "../src/lib/mock-data";
import type { SubstituteIdentity } from "../src/lib/substitute-profiles";
import { rollMockGame } from "../src/lib/duckpin";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`substitute-profiles: ${msg}`);
}

// ---------- Aggregation ----------
const bowlers = seedBowlers().slice(0, 4);
const [a, b, c, d] = bowlers;
const weeks = seedWeeks().slice(0, 3).map((w, i) => ({
  ...w, week: i + 1, completed: true, published: true,
}));

// Substitute pool: sub1 active+used, sub2 active+unused,
// sub3 archived+used, sub4 archived+unused (must be OMITTED).
const subs: SubstituteIdentity[] = [
  { id: "s01", name: "Sub One",   startingAverage: 130, handicap: computeHandicap(130), bowlerNumber: "9001", active: true,  archived: false },
  { id: "s02", name: "Sub Two",   startingAverage: 120, handicap: computeHandicap(120), bowlerNumber: "9002", active: true,  archived: false },
  { id: "s03", name: "Sub Three", startingAverage: 140, handicap: computeHandicap(140), bowlerNumber: "9003", active: false, archived: true  },
  { id: "s04", name: "Sub Four",  startingAverage: 125, handicap: computeHandicap(125), bowlerNumber: "9004", active: false, archived: true  },
];

function makeMatch(id: string, wk: number, lp: "1-2" | "3-4", scheduled: [Bowler, Bowler], sideASub: SubstituteIdentity | null, sideBSub: SubstituteIdentity | null, seed: number): Match {
  const [schedA, schedB] = scheduled;
  const rand = (() => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  const games = <T,>(fn: () => T) => [fn(), fn(), fn()] as [T, T, T];

  const buildSide = (sched: Bowler, sub: SubstituteIdentity | null) => {
    const entry = sub?.startingAverage ?? sched.entryAverage;
    const hdcp = computeHandicap(entry);
    const g = games(() => rollMockGame(rand, 0.4));
    const ls = assembleSideLinescore({
      scheduled: sched,
      actualId: sub ? sub.id : sched.id,
      actualName: sub ? sub.name : sched.name,
      isSub: !!sub,
      entryAverage: entry, handicap: hdcp,
      games: g,
    });
    return { part: {
      scheduledId: sched.id,
      status: sub ? "substitute" as const : "rostered" as const,
      actualId: sub ? sub.id : sched.id,
      actualName: sub ? sub.name : sched.name,
    }, entry, hdcp, ls };
  };
  const A = buildSide(schedA, sideASub);
  const B = buildSide(schedB, sideBSub);

  const result = computeMatchResult({
    scheduledA: schedA, scheduledB: schedB,
    scheduledNameA: schedA.name, scheduledNameB: schedB.name,
    participationA: A.part, participationB: B.part,
    entryAverageA: A.entry, entryAverageB: B.entry,
    handicapA: A.hdcp, handicapB: B.hdcp,
    linescoreA: A.ls, linescoreB: B.ls,
    pointsOverride: null,
  });
  return {
    id, week: wk, lanePair: lp, slot: 1, status: "completed",
    bowlerA: schedA.id, bowlerB: schedB.id, result,
  };
}

// Wk 1: sub1 subs for `a` on lanes 1-2
// Wk 2: sub1 subs for `b` on lanes 3-4 (multi-match aggregate)
// Wk 3: sub3 (archived) subs for `c` on lanes 1-2 (archived-used preserved)
const matchesByWeek: Record<number, Match[]> = {
  1: [makeMatch("m1", 1, "1-2", [a, b], subs[0], null, 111)],
  2: [makeMatch("m2", 2, "3-4", [b, c], subs[0], null, 222)],
  3: [makeMatch("m3", 3, "1-2", [c, d], subs[2], null, 333)],
};

const snapshot = buildSnapshot({
  bowlers, weeks, matchesByWeek,
  substitutes: subs,
});

// Install for the module-scope getter tests below.
_installSnapshotProvider(() => snapshot);

// -- Public list rules -------------------------------------------------
const publicSubs = snapshot.substitutes ?? [];
const publicIds = new Set(publicSubs.map((s) => s.id));
assert(publicIds.has("s01"), "active used sub must appear in public list");
assert(publicIds.has("s02"), "active unused sub must appear in public list");
assert(publicIds.has("s03"), "archived USED sub must remain in public list");
assert(!publicIds.has("s04"), "archived UNUSED sub must be omitted");

// -- Sub 2 zero-stat identity -----------------------------------------
const p2 = snapshot.substituteProfiles!["s02"];
assert(p2 && p2.matchesSubbed === 0 && p2.gamesRolled === 0,
  "unused active sub must be present with zero stats");
assert(p2.currentStartingAverage === 120, "unused sub keeps current starting avg");

// -- Sub 1 multi-match aggregation ------------------------------------
const p1 = snapshot.substituteProfiles!["s01"];
assert(p1.matchesSubbed === 2, `sub1 expected 2 matches, got ${p1.matchesSubbed}`);
assert(p1.gamesRolled === 6, `sub1 expected 6 games, got ${p1.gamesRolled}`);
// Pull the source linescores and verify the aggregation math.
const ls1a = matchesByWeek[1][0].result!.linescoreA!;
const ls1b = matchesByWeek[2][0].result!.linescoreA!;
const expectedPin = ls1a.scratchSet + ls1b.scratchSet;
assert(p1.scratchPinfall === expectedPin, `sub1 pinfall mismatch ${p1.scratchPinfall} != ${expectedPin}`);
const expectedHigh = Math.max(...ls1a.games.map((g) => g.scratchTotal), ...ls1b.games.map((g) => g.scratchTotal));
assert(p1.highGame === expectedHigh, "sub1 highGame mismatch");
assert(p1.highSet === Math.max(ls1a.scratchSet, ls1b.scratchSet), "sub1 highSet mismatch");
assert(p1.marks === ls1a.marks + ls1b.marks, "sub1 marks mismatch");
assert(p1.strikes === ls1a.strikes + ls1b.strikes, "sub1 strikes mismatch");
assert(p1.opens === ls1a.opens + ls1b.opens, "sub1 opens mismatch");
assert(p1.framesRolled === 60, "sub1 framesRolled must be 60 (2×3×10)");
// Weekly rows sorted by week; frozen values preserved.
assert(p1.weeks.length === 2, "sub1 must have 2 weekly rows");
assert(p1.weeks[0].week === 1 && p1.weeks[1].week === 2, "sub1 weeks sorted");
assert(p1.weeks[0].startingAverageAtMatch === 130, "frozen starting avg preserved");
assert(p1.weeks[0].handicapAtMatch === computeHandicap(130), "frozen handicap preserved");
assert(p1.weeks[0].scheduledForName === a.name, "week 1 scheduledForName is scheduled A");
assert(p1.weeks[0].opponentName === b.name, "week 1 opponent is scheduled B");
// Lane usage: one match on 1-2, one on 3-4.
const usageBy = new Map(p1.lanePairUsage.map((u) => [u.lanePair, u.count]));
assert(usageBy.get("1-2") === 1 && usageBy.get("3-4") === 1, "sub1 lane usage split 1/1");

// -- Frozen scoring: edit the pool's starting avg AFTER the fact and
//    verify the historical weekly row values are unchanged.
const mutatedSubs = subs.map((s) => s.id === "s01" ? { ...s, startingAverage: 90, handicap: computeHandicap(90) } : s);
const snap2 = buildSnapshot({ bowlers, weeks, matchesByWeek, substitutes: mutatedSubs });
const p1b = snap2.substituteProfiles!["s01"];
assert(p1b.currentStartingAverage === 90, "current identity reflects pool edit");
assert(p1b.weeks[0].startingAverageAtMatch === 130,
  "editing pool must NOT rewrite frozen per-match starting avg");
assert(p1b.weeks[0].handicapAtMatch === computeHandicap(130),
  "editing pool must NOT rewrite frozen per-match handicap");

// -- Scheduled bowler still gets points, sub stats don't leak ---------
// Scheduled bowler `a` played wk1 with sub1 rolling. `a` must have match/
// points credited but zero actualGamesRolled + zero scratchPinfall from
// that sub week.
const bowlerA = snapshot.bowlersById[a.id];
assert(bowlerA.matchesPlayed >= 1, "scheduled A must have match credit");
assert(bowlerA.actualGamesRolled === 0,
  "scheduled A must NOT get actualGamesRolled from sub performance");
assert(bowlerA.scratchPinfall === 0,
  "scheduled A must NOT accumulate scratchPinfall from sub performance");
// Points sum: for match 1 (all bowled) points should sum to 7 between A & B.
const m1 = matchesByWeek[1][0].result!;
assert(m1.totalPointsA + m1.totalPointsB === 7,
  "match must still distribute 7 points to scheduled bowlers");

// -- Old snapshot (missing substitute fields) does not crash ----------
const legacy = { ...snapshot } as PublicSnapshot;
delete (legacy as { substitutes?: unknown }).substitutes;
delete (legacy as { substituteProfiles?: unknown }).substituteProfiles;
_installSnapshotProvider(() => legacy);
assert(getPublicSubstitutes().length === 0,
  "legacy snapshot without substitutes must fall back to []");
assert(getSubstituteProfile("s01") === undefined,
  "legacy snapshot without profiles must return undefined");
// Restore for downstream tests.
_installSnapshotProvider(() => snapshot);

// -- Route/source assertions ------------------------------------------
const ROOT = new URL("..", import.meta.url).pathname;
const bowlersPage = readFileSync(join(ROOT, "src/routes/bowlers.tsx"), "utf8");
const subRoute = readFileSync(join(ROOT, "src/routes/bowlers.sub.$substituteId.tsx"), "utf8");

assert(/Substitutes/.test(bowlersPage), "bowlers.tsx must render a 'Substitutes' section heading");
assert(/getPublicSubstitutes/.test(bowlersPage), "bowlers.tsx must call getPublicSubstitutes()");
assert(/getSubstituteProfile\(s\.id\)/.test(bowlersPage),
  "bowlers.tsx must call getSubstituteProfile(s.id) inside each card");
assert(/\.toFixed\(3\)/.test(bowlersPage),
  "bowlers.tsx must format scratch average to 3 decimals");
assert(/matchesSubbed/.test(bowlersPage),
  "bowlers.tsx must display matches-subbed count");
assert(/to="\/bowlers\/sub\/\$substituteId"/.test(bowlersPage),
  "bowlers.tsx must link to the substitute profile route");
assert(/createFileRoute\("\/bowlers\/sub\/\$substituteId"\)/.test(subRoute),
  "substitute route file must use the correct createFileRoute path");
assert(/getSubstituteProfile/.test(subRoute),
  "substitute route must call getSubstituteProfile");
assert(/scheduled bowler/i.test(subRoute),
  "substitute route must include the note that points go to the scheduled bowler");

// eslint-disable-next-line no-console
console.log("substitute-profiles tests passed");
