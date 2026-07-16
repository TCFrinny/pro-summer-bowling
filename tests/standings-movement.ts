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
import { computeLiveMatchResult, type LiveMatchRow } from "../src/lib/live-scoring";


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

  // ---- Progressive partial FINAL-WEEK live-scoring movement ----
  // The Movement column MUST always compare against the pre-final-week
  // (W1-only) standings baseline. A common bug is to rebase after the
  // first live save so later saves compare against the post-first-save
  // ranks, which silently hides all subsequent movement. This test drives
  // TWO progressive snapshots (matchup A saved, then matchups A+B saved)
  // and asserts:
  //   (a) at least one bowler shows nonzero movement in each snapshot
  //   (b) both snapshots baseline against W1 (not against each other)
  {
    // W1 baseline: b1 sweeps b2 7-0 (b1 hcp=800), b3 beats b4 5-2 (b3 hcp=700).
    // W1 ranks by points DESC then hcp pinfall DESC:
    //   b01=1 (7 pts, hcp 800), b03=2 (5 pts, hcp 700),
    //   b04=3 (2 pts, hcp 500), b02=4 (0 pts, hcp 400).
    const w1: Match[] = [
      mkMatch(1, 1, b1, b2, 7, 0, { a: 800, b: 400 }),
      mkMatch(1, 2, b3, b4, 5, 2, { a: 700, b: 500 }),
    ];

    // W2 (final) live matchup A: b2 wins G1 with a big handicap set —
    // makes b02 leapfrog b04 in tie-break for a nonzero movement.
    const liveA1: LiveMatchRow = {
      id: "L1", schedule_slot_id: "s1", week_id: "w2", season_id: "sea",
      side_a: { scheduledId: b1.id, status: "rostered", actualId: b1.id, actualName: b1.name, scheduledName: b1.name, entryAverage: b1.entryAverage, handicap: b1.handicap },
      side_b: { scheduledId: b2.id, status: "rostered", actualId: b2.id, actualName: b2.name, scheduledName: b2.name, entryAverage: b2.entryAverage, handicap: b2.handicap },
      a_game1: 100, a_game2: null, a_game3: null,
      b_game1: 200, b_game2: null, b_game3: null,
    };
    const mrA1 = computeLiveMatchResult({ row: liveA1, scheduledNameA: b1.name, scheduledNameB: b2.name });
    const partialA: Match = {
      id: "w2-s1", week: 2, lanePair: "1-2", slot: 0, status: "in-progress",
      bowlerA: b1.id, bowlerB: b2.id, result: mrA1,
    };

    const snap1 = buildSnapshot({
      bowlers, weeks,
      matchesByWeek: { 1: w1, 2: [partialA], 3: [] },
    });
    const mv1 = new Map(snap1.standings.map((r) => [r.bowler.id, r.movement]));
    const rk1 = new Map(snap1.standings.map((r) => [r.bowler.id, r.rank]));
    const pts1 = new Map(snap1.standings.map((r) => [r.bowler.id, r.bowler.points]));
    // Sanity — live G1 credited: b02 +2, others unchanged from W1.
    assert(pts1.get("b02") === 2, `snap1 b02 pts should be 2 (got ${pts1.get("b02")})`);
    assert(pts1.get("b01") === 7 && pts1.get("b03") === 5 && pts1.get("b04") === 2,
      "snap1 other points must equal W1 totals");
    // Snap1 ranks: b01=1(7), b03=2(5), b02=3(2 pts, hcp=400+232=632),
    //              b04=4(2 pts, hcp=500). b02 > b04 on hcp pinfall.
    assert(rk1.get("b02") === 3, `snap1 b02 rank should be 3 (got ${rk1.get("b02")})`);
    assert(rk1.get("b04") === 4, `snap1 b04 rank should be 4 (got ${rk1.get("b04")})`);
    // Movement vs W1 baseline (b01=1,b03=2,b04=3,b02=4):
    //   b02 4→3 = +1  (nonzero — proves baseline isn't the current standings)
    //   b04 3→4 = −1  (nonzero)
    //   b01, b03 unchanged
    assert(mv1.get("b02") === 1, `snap1 b02 mv must be +1 (got ${mv1.get("b02")})`);
    assert(mv1.get("b04") === -1, `snap1 b04 mv must be -1 (got ${mv1.get("b04")})`);
    assert(mv1.get("b01") === 0 && mv1.get("b03") === 0,
      "snap1 unchanged bowlers must have zero movement");

    // Snapshot 2: additionally save matchup B where b3 wins G1 by a huge
    // handicap margin. b03 gains 2 pts (total 7) → leapfrogs b01 on
    // hcp pinfall (b03 = 700+232=932 vs b01 = 800+132=932 tie — force
    // separation by giving b3 a bigger G1). Use 210 vs 90 to make it clear.
    const liveB1: LiveMatchRow = {
      id: "L2", schedule_slot_id: "s2", week_id: "w2", season_id: "sea",
      side_a: { scheduledId: b3.id, status: "rostered", actualId: b3.id, actualName: b3.name, scheduledName: b3.name, entryAverage: b3.entryAverage, handicap: b3.handicap },
      side_b: { scheduledId: b4.id, status: "rostered", actualId: b4.id, actualName: b4.name, scheduledName: b4.name, entryAverage: b4.entryAverage, handicap: b4.handicap },
      a_game1: 210, a_game2: null, a_game3: null,
      b_game1: 90, b_game2: null, b_game3: null,
    };
    const mrB1 = computeLiveMatchResult({ row: liveB1, scheduledNameA: b3.name, scheduledNameB: b4.name });
    const partialB: Match = {
      id: "w2-s2", week: 2, lanePair: "3-4", slot: 1, status: "in-progress",
      bowlerA: b3.id, bowlerB: b4.id, result: mrB1,
    };
    const snap2 = buildSnapshot({
      bowlers, weeks,
      matchesByWeek: { 1: w1, 2: [partialA, partialB], 3: [] },
    });
    const mv2 = new Map(snap2.standings.map((r) => [r.bowler.id, r.movement]));
    const rk2 = new Map(snap2.standings.map((r) => [r.bowler.id, r.rank]));
    const pts2 = new Map(snap2.standings.map((r) => [r.bowler.id, r.bowler.points]));
    assert(pts2.get("b03") === 7, `snap2 b03 pts should be 7 (got ${pts2.get("b03")})`);
    assert(pts2.get("b01") === 7, "snap2 b01 still 7");
    // Snap2 ranks: b01=7 (hcp 800+132=932), b03=7 (hcp 700+242=942). b03 wins tie.
    // Then b02=2 (632), b04=2 (500).
    assert(rk2.get("b03") === 1, `snap2 b03 rank should be 1 (got ${rk2.get("b03")})`);
    assert(rk2.get("b01") === 2, `snap2 b01 rank should be 2 (got ${rk2.get("b01")})`);
    // Movement vs the SAME W1 baseline (b01=1,b03=2,b04=3,b02=4):
    //   b03 2→1 = +1, b01 1→2 = −1, b02 4→3 = +1, b04 3→4 = −1
    // If the implementation incorrectly rebaselined against snap1 (where
    // b03 was still rank 2, b02 was rank 3), the delta between snap1 and
    // snap2 movement for b02 would be 0 rather than remaining +1, and b03
    // would show as +1 in snap1 (it didn't) or 0 in snap2. These asserts
    // catch that class of bug directly.
    assert(mv2.get("b03") === 1, `snap2 b03 mv must be +1 (got ${mv2.get("b03")})`);
    assert(mv2.get("b01") === -1, `snap2 b01 mv must be -1 (got ${mv2.get("b01")})`);
    assert(mv2.get("b02") === 1, `snap2 b02 mv must be +1 (got ${mv2.get("b02")})`);
    assert(mv2.get("b04") === -1, `snap2 b04 mv must be -1 (got ${mv2.get("b04")})`);
    // Cross-snapshot invariant: b02 movement must be +1 in BOTH snapshots.
    // A rebase-after-first-save bug would make snap2's b02 movement 0
    // (because relative to snap1 b02 didn't move). Guard that directly.
    assert(mv1.get("b02") === mv2.get("b02"),
      `baseline drift: b02 movement changed between snapshots ` +
      `(snap1=${mv1.get("b02")}, snap2=${mv2.get("b02")})`);
    // b03 was ranked 2 in W1 AND in snap1 (0 movement in snap1). In snap2
    // it climbs to rank 1 → must be +1 against W1. A snap1-baselined
    // implementation would give the same +1 by coincidence, but the b02
    // invariant above disambiguates the two implementations.
    assert(mv1.get("b03") === 0 && mv2.get("b03") === 1,
      "b03 movement must be 0 in snap1 and +1 in snap2 against the W1 baseline");
  }
})();



// eslint-disable-next-line no-console
console.log("movement tests passed");
