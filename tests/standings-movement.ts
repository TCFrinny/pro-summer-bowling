/**
 * Movement column: prior-week rank baseline correctness.
 *
 * Uses `buildSnapshot` directly with synthetic matches so we don't
 * depend on the seeded roster. Verifies:
 *   - Week 1 (no prior results): movement = 0 for everyone.
 *   - Two-week seasons: upward, downward, unchanged movement.
 *   - Newly active bowlers absent from prior baseline: movement = 0.
 *   - Partial current week: baseline stays at pre-cutoff-week standings.
 *   - Tie broken by handicap pinfall consistently in both baselines.
 */
import {
  buildSnapshot,
  computeHandicap,
  computeMatchResult,
  type Bowler,
  type Match,
  type SideParticipation,
  type WeekSummary,
} from "../src/lib/mock-data";

function mkBowler(id: string, name: string, entryAverage = 130): Bowler {
  return {
    id, name, entryAverage, handicap: computeHandicap(entryAverage),
    scratchAverage: 0, points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0, actualScratchPinfall: 0,
    movement: 0,
  };
}
function absentSide(id: string, name: string, scores: [number, number, number]): SideParticipation {
  return { scheduledId: id, status: "absent", actualId: null, actualName: name, absentScores: scores };
}

/** Build a match with an "absent-vs-absent" result whose winning side is
 *  forced by admin-entered scratch scores. Keeps points/handicap deterministic
 *  and avoids GameLinescore construction. Uses override for exact points. */
function mkMatch(
  week: number, slot: number,
  a: Bowler, b: Bowler,
  pointsA: number, pointsB: number,
  handicapTotalHint: { a: number; b: number },
): Match {
  const result = computeMatchResult({
    scheduledA: a, scheduledB: b,
    scheduledNameA: a.name, scheduledNameB: b.name,
    participationA: absentSide(a.id, a.name, [handicapTotalHint.a - a.handicap * 3, 0, 0].map((n) => Math.max(0, n)) as [number, number, number]),
    participationB: absentSide(b.id, b.name, [handicapTotalHint.b - b.handicap * 3, 0, 0].map((n) => Math.max(0, n)) as [number, number, number]),
    entryAverageA: a.entryAverage, entryAverageB: b.entryAverage,
    handicapA: a.handicap, handicapB: b.handicap,
    linescoreA: null, linescoreB: null,
    pointsOverride: { enabled: true, pointsA, pointsB, reason: "test" },
  });
  return {
    id: `w${week}-s${slot}`, week, lanePair: "1-2", slot,
    status: "completed",
    bowlerA: a.id, bowlerB: b.id,
    result,
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("movement test failed: " + msg);
}

(function selfTest() {
  const b1 = mkBowler("b01", "A");
  const b2 = mkBowler("b02", "B");
  const b3 = mkBowler("b03", "C");
  const b4 = mkBowler("b04", "D");
  const bowlers = [b1, b2, b3, b4];
  const weeks: WeekSummary[] = [1, 2, 3].map((w) => ({
    week: w, date: new Date(2026, 5, 4 + (w - 1) * 7).toISOString(),
    completed: false, published: true,
  }));

  // ---- Week 1 only: baseline movement must be 0 for everyone ----
  {
    const m: Record<number, Match[]> = {
      1: [
        mkMatch(1, 1, b1, b2, 7, 0, { a: 700, b: 500 }),
        mkMatch(1, 2, b3, b4, 5, 2, { a: 650, b: 550 }),
      ],
      2: [], 3: [],
    };
    const snap = buildSnapshot({ bowlers, weeks, matchesByWeek: m });
    for (const r of snap.standings) assert(r.movement === 0, `week1 zero for ${r.bowler.id} got ${r.movement}`);
  }

  // ---- Two weeks: shuffle order in week 2 to force up/down/unchanged ----
  {
    // Week 1 standings by points DESC then hcp pinfall DESC:
    // b1=7, b3=5, b4=2, b2=0
    const m: Record<number, Match[]> = {
      1: [
        mkMatch(1, 1, b1, b2, 7, 0, { a: 700, b: 500 }),
        mkMatch(1, 2, b3, b4, 5, 2, { a: 650, b: 550 }),
      ],
      2: [
        // Week 2: b2 crushes b1 (b2 +7), b4 beats b3 (b4 +6)
        mkMatch(2, 1, b1, b2, 0, 7, { a: 500, b: 800 }),
        mkMatch(2, 2, b3, b4, 1, 6, { a: 550, b: 700 }),
      ],
      3: [],
    };
    const snap = buildSnapshot({ bowlers, weeks, matchesByWeek: m });
    // After W2 totals: b1=7,b2=7,b3=6,b4=8. Rank by points DESC / hcp DESC.
    // b1 hcp pinfall total = 700+500 = 1200. b2 = 500+800=1300. -> b2 above b1.
    // b4=8 first, then b2, then b1, then b3.
    const rankMap = new Map(snap.standings.map((r) => [r.bowler.id, r.rank]));
    assert(rankMap.get("b04") === 1, `current rank b04=${rankMap.get("b04")}`);
    assert(rankMap.get("b02") === 2, `current rank b02=${rankMap.get("b02")}`);
    assert(rankMap.get("b01") === 3, `current rank b01=${rankMap.get("b01")}`);
    assert(rankMap.get("b03") === 4, `current rank b03=${rankMap.get("b03")}`);
    // Prior baseline (W1 only) ranks: b01=1, b03=2, b04=3, b02=4.
    // Movement = prior − current:
    //   b01: 1 - 3 = -2 (down 2)
    //   b02: 4 - 2 = +2 (up 2)
    //   b03: 2 - 4 = -2 (down 2)
    //   b04: 3 - 1 = +2 (up 2)
    const mv = new Map(snap.standings.map((r) => [r.bowler.id, r.movement]));
    assert(mv.get("b01") === -2, `b01 mv=${mv.get("b01")}`);
    assert(mv.get("b02") === 2, `b02 mv=${mv.get("b02")}`);
    assert(mv.get("b03") === -2, `b03 mv=${mv.get("b03")}`);
    assert(mv.get("b04") === 2, `b04 mv=${mv.get("b04")}`);
  }

  // ---- Partial current week: adding a partial W2 result must still
  // baseline against W1-only standings, not against pre-that-single-match ----
  {
    const m: Record<number, Match[]> = {
      1: [
        mkMatch(1, 1, b1, b2, 7, 0, { a: 700, b: 500 }),
        mkMatch(1, 2, b3, b4, 5, 2, { a: 650, b: 550 }),
      ],
      2: [
        // Only one W2 match saved so far.
        mkMatch(2, 1, b1, b2, 0, 7, { a: 500, b: 800 }),
      ],
      3: [],
    };
    const snap = buildSnapshot({ bowlers, weeks, matchesByWeek: m });
    // Totals: b1=7, b2=7, b3=5, b4=2. Rank by points then hcp pinfall.
    // b1 hcp=1200, b2 hcp=1300 -> b2 rank1, b1 rank2, b3 rank3, b4 rank4.
    // Prior baseline (W1 only): b01=1, b03=2, b04=3, b02=4.
    // Movement: b02 4->1 = +3; b01 1->2 = -1; b03 2->3 = -1; b04 3->4 = -1.
    const mv = new Map(snap.standings.map((r) => [r.bowler.id, r.movement]));
    assert(mv.get("b02") === 3, `partial b02 mv=${mv.get("b02")}`);
    assert(mv.get("b01") === -1, `partial b01 mv=${mv.get("b01")}`);
    assert(mv.get("b03") === -1, `partial b03 mv=${mv.get("b03")}`);
    assert(mv.get("b04") === -1, `partial b04 mv=${mv.get("b04")}`);
  }

  // ---- Newly activated bowler missing from prior baseline: movement = 0 ----
  {
    const b5 = mkBowler("b05", "E");
    const bowlersPlus = [b1, b2, b3, b4, b5];
    const m: Record<number, Match[]> = {
      1: [
        mkMatch(1, 1, b1, b2, 7, 0, { a: 700, b: 500 }),
        mkMatch(1, 2, b3, b4, 5, 2, { a: 650, b: 550 }),
      ],
      2: [
        mkMatch(2, 1, b5, b1, 6, 1, { a: 700, b: 500 }),
      ],
      3: [],
    };
    // b5 present in active set but had no prior results.
    const snap = buildSnapshot({
      bowlers: bowlersPlus, weeks, matchesByWeek: m,
      activeBowlerIds: new Set(["b01", "b02", "b03", "b04", "b05"]),
    });
    const mv = new Map(snap.standings.map((r) => [r.bowler.id, r.movement]));
    // b5 wasn't ranked in prior baseline → movement must be exactly 0.
    assert(mv.get("b05") === 0, `new bowler mv=${mv.get("b05")}`);
  }

  // ---- Tie resolved by handicap pinfall consistently ----
  {
    // Two bowlers tied on points with different handicap pinfall in both
    // current AND prior baselines. Ordering must be stable in both.
    const m: Record<number, Match[]> = {
      1: [
        // Both bowlers get 3.5 points each but different hcp pinfall.
        mkMatch(1, 1, b1, b2, 3.5, 3.5, { a: 800, b: 600 }),
        mkMatch(1, 2, b3, b4, 3.5, 3.5, { a: 700, b: 700 }),
      ],
      2: [
        mkMatch(2, 1, b1, b2, 3.5, 3.5, { a: 800, b: 600 }),
      ],
      3: [],
    };
    const snap = buildSnapshot({ bowlers, weeks, matchesByWeek: m });
    const rankMap = new Map(snap.standings.map((r) => [r.bowler.id, r.rank]));
    // Current totals: b1 points=7 hcp=1600; b2 points=7 hcp=1200; b3=3.5 hcp=700; b4=3.5 hcp=700.
    // b1 rank 1, b2 rank 2, then b3/b4 tied on both — stable id fallback puts b3 before b4.
    assert(rankMap.get("b01") === 1, `tie current b01 rank=${rankMap.get("b01")}`);
    assert(rankMap.get("b02") === 2, `tie current b02 rank=${rankMap.get("b02")}`);
    assert(rankMap.get("b03") === 3, `tie current b03 rank=${rankMap.get("b03")}`);
    assert(rankMap.get("b04") === 4, `tie current b04 rank=${rankMap.get("b04")}`);
    // Prior (W1 only): b1 hcp=800 rank1, b3 hcp=700 rank2, b4 hcp=700 rank3, b2 hcp=600 rank4.
    // Current after W2: b1 rank1, b2 rank2 (added +600 hcp), b3 rank3, b4 rank4.
    // Movement: b01 0, b02 +2, b03 -1, b04 -1. Tie fallback is stable/deterministic.
    const mvT = new Map(snap.standings.map((r) => [r.bowler.id, r.movement]));
    assert(mvT.get("b01") === 0, `tie b01 mv=${mvT.get("b01")}`);
    assert(mvT.get("b02") === 2, `tie b02 mv=${mvT.get("b02")}`);
    assert(mvT.get("b03") === -1, `tie b03 mv=${mvT.get("b03")}`);
    assert(mvT.get("b04") === -1, `tie b04 mv=${mvT.get("b04")}`);
  }
})();

// eslint-disable-next-line no-console
console.log("movement tests passed");
