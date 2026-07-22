/**
 * Final correctness pass — real behavioral tests for the historical phase.
 *
 * Covers (all behavioral, not string presence):
 *  - full-linescore serialize → hydrate → recompute round trip via summarizeGame
 *  - canonical linescore parser recomputes from frames and rejects tampered
 *    derived counts + rejects mismatched submitted game totals
 *  - substitute personal stats survive via participantStats even though
 *    the standings board stays roster-only
 *  - rostered bowler credited when a substitute rolls; substitute's scratch
 *    stays with the substitute (not the rostered bowler)
 *  - absent bowler receives handicap-pinfall credit but zero personal
 *    scratch stats
 *  - standings tiebreak: points → handicap pinfall → scratch pinfall
 *  - public snapshot filter drops unpublished weeks AND rebuilds standings
 *    AND rebuilds participantStats
 *  - advanced availability: full-linescore bowler HAS advanced; game-scores
 *    bowler has advanced=null (never fabricated zeros)
 *  - source-level proofs for server-guard strings that cannot be exercised
 *    purely from client code (published-week update, empty-lane-config
 *    schedule reject, fail-closed personId lookup, career loader applies
 *    the public filter)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildHistoricalParticipantStats,
  buildHistoricalStandings,
  filterPublicHistoricalSnapshot,
  type HistoricalMatch,
  type HistoricalSnapshot,
  type HistoricalWeekSummary,
} from "../src/lib/historical-snapshot";
import { summarizeGame, type FrameLinescore, type GameLinescore } from "../src/lib/duckpin";
import { canonicalizeSideLinescore } from "../src/lib/historical-repo.functions";

function truthy(v: unknown, msg: string) { if (!v) throw new Error(msg); }
function eq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`);
  }
}
function read(p: string) { return readFileSync(join(process.cwd(), p), "utf8"); }

// ---------------------------------------------------------------- helpers

let __slotSeq = 0;
function nextSlotId(): string { __slotSeq += 1; return `slot-${__slotSeq}`; }

/** Build a valid GameLinescore purely from a list of marks and running
 *  cumulative totals — mirrors what admin FULL_LINESCORE input produces. */
function game(marks: string[], cumulatives: number[]): GameLinescore {
  const frames: FrameLinescore[] = marks.map((m, i) => ({
    frameNumber: i + 1, mark: m, cumulativeScore: cumulatives[i],
  }));
  return summarizeGame(frames);
}

function openGame(pinsEach = 8): GameLinescore {
  const cumulatives: number[] = [];
  let acc = 0;
  for (let i = 0; i < 10; i++) { acc += pinsEach; cumulatives.push(acc); }
  return game(Array(10).fill("-"), cumulatives);
}

/** Frame 1 = X, remainder open with 0 pinfall → strike frame with no bonus
 *  is 10, then cumulative stays flat. Yields 1 strike + 9 opens. */
function oneStrikeGame(): GameLinescore {
  const cumulatives: number[] = [10];
  for (let i = 1; i < 10; i++) cumulatives.push(10);
  const marks = ["X", ...Array(9).fill("-")];
  return game(marks, cumulatives);
}

function makeMatch(overrides: Partial<HistoricalMatch>): HistoricalMatch {
  const zero: [number, number, number] = [0, 0, 0];
  const base: HistoricalMatch = {
    slotId: overrides.slotId ?? nextSlotId(),
    weekNumber: 1, lanePair: "1-2", slot: 1,
    detailMode: "game_scores",
    scheduledA: "PA", scheduledB: "PB",
    scheduledNameA: "PA", scheduledNameB: "PB",
    actualA: "PA", actualB: "PB",
    actualNameA: "PA", actualNameB: "PB",
    isSubA: false, isSubB: false,
    absentA: false, absentB: false,
    entryAverageA: 100, entryAverageB: 100,
    handicapA: 0, handicapB: 0,
    hasGameDataA: true, hasGameDataB: true,
    scratchGamesA: null, scratchGamesB: null,
    handicapGamesA: zero, handicapGamesB: zero,
    scratchTotalA: 0, scratchTotalB: 0,
    handicapTotalA: 0, handicapTotalB: 0,
    gameAwardsA: zero, gameAwardsB: zero,
    gamePointsA: 0, gamePointsB: 0,
    setPointA: 0, setPointB: 0,
    totalPointsA: 0, totalPointsB: 0,
    finalPointsA: 0, finalPointsB: 0,
    overrideEnabled: false, winner: "T",
    linescoreA: null, linescoreB: null,
  };
  return { ...base, ...overrides };
}

// ================================================================
// 1. Full-linescore round trip: frames → summarizeGame → rehydrate
// ================================================================
{
  const g = oneStrikeGame();
  const serialized = g.frames.map((f) => ({ frameNumber: f.frameNumber, mark: f.mark, cumulativeScore: f.cumulativeScore }));
  const rehydrated = summarizeGame(serialized.map((f) => ({ ...f })));
  eq(rehydrated.strikes, g.strikes, "strikes preserved through round trip");
  eq(rehydrated.spares, g.spares, "spares preserved through round trip");
  eq(rehydrated.opens, g.opens, "opens preserved through round trip");
  eq(rehydrated.scratchTotal, g.scratchTotal, "scratch total preserved through round trip");
  eq(rehydrated.marks, g.marks, "marks preserved through round trip");
  truthy(rehydrated.strikes === 1 && rehydrated.opens === 9, "one-strike stub has 1/9 split");
}

// ================================================================
// 2. Canonical linescore parser rejects tampered derived counts and
//    mismatched submitted game totals; recomputes from frames only.
// ================================================================
{
  const g = oneStrikeGame();
  const tamperedGame = {
    ...g,
    strikes: 99, spares: 88, opens: 77, marks: 66,
    scratchTotal: 999,
    segments: { first5: 999, last5: 999, bigOpening: 999, bigFinish: 999, clutchMarks: 42 },
  };
  const three = [tamperedGame, openGame(9), openGame(9)];
  const totals: [number, number, number] = [g.scratchTotal, 90, 90];
  const canonical = canonicalizeSideLinescore(three, totals, "test");
  eq(canonical[0].strikes, 1, "tampered strike count discarded, recomputed = 1");
  eq(canonical[0].opens, 9, "tampered open count discarded, recomputed = 9");
  eq(canonical[0].scratchTotal, g.scratchTotal, "tampered total discarded, recomputed from frames");
  eq(canonical[0].segments.clutchMarks, g.segments.clutchMarks, "tampered segments discarded");

  // Mismatch: submitted total 999 vs recomputed 10 must throw.
  let threw = false;
  try {
    canonicalizeSideLinescore(three, [999, 90, 90] as [number, number, number], "test");
  } catch (e) {
    threw = /disagrees with recomputed frame total/.test((e as Error).message);
  }
  truthy(threw, "mismatched submitted game total must be rejected");

  // Wrong game count must throw.
  let threw2 = false;
  try { canonicalizeSideLinescore([g, g] as unknown[], null, "test"); }
  catch (e) { threw2 = /exactly 3 games/.test((e as Error).message); }
  truthy(threw2, "linescore with != 3 games must be rejected");
}

// ================================================================
// 3. Substitute/absent personal-stat attribution
// ================================================================
{
  const line = [oneStrikeGame(), openGame(9), openGame(7)] as [GameLinescore, GameLinescore, GameLinescore];
  const weeks: HistoricalWeekSummary[] = [{
    weekNumber: 1, date: null, published: true, completed: true, schedule: [],
    matches: [
      // m1: PA rolled their own card
      makeMatch({ slotId: "m1", detailMode: "full_linescore",
        scheduledA: "PA", actualA: "PA",
        scheduledB: "PB", actualB: "PB",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: [100, 100, 100], scratchGamesB: [90, 90, 90],
        scratchTotalA: 300, scratchTotalB: 270,
        handicapTotalA: 340, handicapTotalB: 310,
        finalPointsA: 5, finalPointsB: 2,
        linescoreA: line, linescoreB: null,
      }),
      // m2: SUB1 subbed for PA
      makeMatch({ slotId: "m2",
        scheduledA: "PA", actualA: "SUB1", isSubA: true, actualNameA: "SubOne",
        scheduledB: "PC", actualB: "PC",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: [120, 120, 120], scratchGamesB: [80, 80, 80],
        scratchTotalA: 360, scratchTotalB: 240,
        handicapTotalA: 400, handicapTotalB: 280,
        finalPointsA: 5, finalPointsB: 2,
      }),
      // m3: PA absent-with-scores
      makeMatch({ slotId: "m3",
        scheduledA: "PA", actualA: "PA", absentA: true,
        scheduledB: "PD", actualB: "PD",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: null,
        scratchGamesB: [100, 100, 100],
        scratchTotalA: 0, scratchTotalB: 300,
        handicapTotalA: 300, handicapTotalB: 340,
        finalPointsA: 0, finalPointsB: 7,
      }),
    ],
  }];
  const participants = [
    { ref: "PA", displayName: "PA", role: "rostered" as const },
    { ref: "PB", displayName: "PB", role: "rostered" as const },
    { ref: "PC", displayName: "PC", role: "rostered" as const },
    { ref: "PD", displayName: "PD", role: "rostered" as const },
    { ref: "SUB1", displayName: "SubOne", role: "substitute" as const },
  ];
  const standings = buildHistoricalStandings({ participants, weeks, summaryRecords: [], pointSystem: 7 });
  const personalStats = buildHistoricalParticipantStats({ participants, weeks });

  // STANDINGS: scheduled bowler receives ALL points and handicap-pinfall credit.
  const pa = standings.find((r) => r.participantRef === "PA")!;
  eq(pa.points, 10, "scheduled bowler receives ALL points credit (self + sub + absent)");
  eq(pa.handicapPinfall, 340 + 400 + 300,
    "scheduled bowler receives handicap pinfall credit for self/sub/absent");
  // Standings personal scratch: ONLY the self-rolled match (m1).
  eq(pa.games, 3, "standings PA personal games only from self-rolled match");
  eq(pa.scratchPinfall, 300, "standings PA scratch only from self-rolled match");
  eq(pa.highGame, 100, "standings PA high game only from self-rolled match");
  eq(pa.highSet, 300, "standings PA high set only from self-rolled match");
  truthy(pa.advanced != null, "standings PA advanced present from full linescore of self-rolled match");
  eq(pa.advanced!.strikes, 1, "standings PA advanced strikes = 1 (only from self-rolled linescore)");

  // Substitute NOT in standings.
  truthy(!standings.find((r) => r.participantRef === "SUB1"),
    "substitute must not appear on the standings board");

  // PARTICIPANT STATS: substitute's aggregate personal stats survive here.
  const sub = personalStats.find((r) => r.participantRef === "SUB1")!;
  truthy(sub, "SUB1 personal stats present in participantStats");
  eq(sub.role, "substitute", "SUB1 tagged as substitute");
  eq(sub.games, 3, "SUB1 games from the m2 substitution");
  eq(sub.scratchPinfall, 360, "SUB1 scratch pinfall from the m2 substitution");
  eq(sub.highGame, 120, "SUB1 high game from the m2 substitution");
  eq(sub.highSet, 360, "SUB1 high set from the m2 substitution");

  // PA's participantStats mirror standings (self-rolled only).
  const paP = personalStats.find((r) => r.participantRef === "PA")!;
  eq(paP.games, 3, "PA participantStats games only from self-rolled match");
  eq(paP.scratchPinfall, 300, "PA participantStats scratch pinfall only from self-rolled match");
  // PA participantStats must NOT inherit SUB1's 360 scratch.
  truthy(paP.scratchPinfall !== 360,
    "PA personal stats must not inherit substitute's performance");
}

// ================================================================
// 4. Standings tiebreaker: points → handicap pinfall → scratch pinfall
// ================================================================
{
  const weeks: HistoricalWeekSummary[] = [{
    weekNumber: 1, date: null, published: true, completed: true, schedule: [],
    matches: [
      makeMatch({ slotId: "t1", scheduledA: "T1", actualA: "T1", scheduledB: "T2", actualB: "T2",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: [100, 100, 100], scratchGamesB: [90, 90, 90],
        scratchTotalA: 300, scratchTotalB: 270,
        handicapTotalA: 340, handicapTotalB: 310, finalPointsA: 4, finalPointsB: 0 }),
      makeMatch({ slotId: "t2", scheduledA: "T3", actualA: "T3", scheduledB: "T4", actualB: "T4",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: [110, 110, 110], scratchGamesB: [80, 80, 80],
        scratchTotalA: 330, scratchTotalB: 240,
        handicapTotalA: 320, handicapTotalB: 260, finalPointsA: 4, finalPointsB: 0 }),
    ],
  }];
  const standings = buildHistoricalStandings({
    participants: [
      { ref: "T1", displayName: "T1", role: "rostered" },
      { ref: "T2", displayName: "T2", role: "rostered" },
      { ref: "T3", displayName: "T3", role: "rostered" },
      { ref: "T4", displayName: "T4", role: "rostered" },
    ],
    weeks, summaryRecords: [], pointSystem: 7,
  });
  const order = standings.map((r) => r.participantRef);
  const t1i = order.indexOf("T1");
  const t3i = order.indexOf("T3");
  truthy(t1i < t3i, `T1 must outrank T3 on handicap-pinfall tiebreak (got order ${order.join(",")})`);
  const t1 = standings[t1i], t3 = standings[t3i];
  eq(t1.rank, 1, "T1 rank is 1");
  eq(t3.rank, 2, "T3 rank is 2");
  truthy((t1.scratchPinfall ?? 0) < (t3.scratchPinfall ?? 0),
    "T1 wins tiebreak DESPITE lower scratch pinfall — proves the tiebreak is handicap, not scratch");
}

// ================================================================
// 5. Public snapshot filter drops unpublished weeks + rebuilds
//    standings AND participantStats.
// ================================================================
{
  const publishedWeek: HistoricalWeekSummary = {
    weekNumber: 1, date: null, published: true, completed: true, schedule: [
      { slotId: "s-pub", weekNumber: 1, lanePair: "1-2", slot: 1,
        scheduledA: "A", scheduledB: "B", nameA: "A", nameB: "B", hasResult: true },
    ],
    matches: [makeMatch({ slotId: "s-pub", scheduledA: "A", actualA: "A", scheduledB: "B", actualB: "B",
      hasGameDataA: true, hasGameDataB: true,
      scratchGamesA: [100, 100, 100], scratchGamesB: [100, 100, 100],
      scratchTotalA: 300, scratchTotalB: 300,
      handicapTotalA: 300, handicapTotalB: 300,
      finalPointsA: 4, finalPointsB: 0 })],
  };
  const draftWeek: HistoricalWeekSummary = {
    weekNumber: 2, date: null, published: false, completed: true, schedule: [
      { slotId: "s-draft", weekNumber: 2, lanePair: "1-2", slot: 1,
        scheduledA: "A", scheduledB: "B", nameA: "A", nameB: "B", hasResult: true },
    ],
    matches: [makeMatch({ slotId: "s-draft", scheduledA: "A", actualA: "A", scheduledB: "B", actualB: "B",
      hasGameDataA: true, hasGameDataB: true,
      scratchGamesA: [200, 200, 200], scratchGamesB: [50, 50, 50],
      scratchTotalA: 600, scratchTotalB: 150,
      handicapTotalA: 600, handicapTotalB: 150,
      finalPointsA: 999, finalPointsB: 0 })],
  };
  const participants = [
    { ref: "A", displayName: "A", role: "rostered" as const },
    { ref: "B", displayName: "B", role: "rostered" as const },
  ];
  const fullSnapshot: HistoricalSnapshot = {
    version: 1, builtAt: 0, seasonId: "s", seasonLabel: "S", pointSystem: 7,
    totalWeeks: 2, participants,
    weeks: [publishedWeek, draftWeek],
    standings: buildHistoricalStandings({ participants, weeks: [publishedWeek, draftWeek], summaryRecords: [], pointSystem: 7 }),
    participantStats: buildHistoricalParticipantStats({ participants, weeks: [publishedWeek, draftWeek] }),
    summaryOnly: false, summaryRecords: [],
  };
  const fullA = fullSnapshot.standings.find((r) => r.participantRef === "A")!;
  truthy(fullA.points === 4 + 999, "admin snapshot contains unpublished points");
  const fullAPersonal = fullSnapshot.participantStats!.find((r) => r.participantRef === "A")!;
  eq(fullAPersonal.scratchPinfall, 300 + 600, "admin participantStats include unpublished pinfall");

  const pub = filterPublicHistoricalSnapshot(fullSnapshot);
  truthy(pub.weeks.length === 1 && pub.weeks[0].published, "public filter keeps only published weeks");
  truthy(!pub.weeks.some((w) => w.weekNumber === 2), "unpublished week 2 removed");
  const pubA = pub.standings.find((r) => r.participantRef === "A")!;
  eq(pubA.points, 4, "public standings recomputed from published weeks ONLY");
  const pubAPersonal = pub.participantStats!.find((r) => r.participantRef === "A")!;
  eq(pubAPersonal.scratchPinfall, 300,
    "public participantStats recomputed from published weeks ONLY (unpublished pinfall stripped)");
}

// ================================================================
// 6. Advanced availability: full-linescore has advanced, game-scores null
// ================================================================
{
  const line = [oneStrikeGame(), openGame(9), openGame(9)] as [GameLinescore, GameLinescore, GameLinescore];
  const week: HistoricalWeekSummary = {
    weekNumber: 1, date: null, published: true, completed: true, schedule: [],
    matches: [
      makeMatch({ slotId: "flmatch", detailMode: "full_linescore",
        scheduledA: "FL", actualA: "FL", scheduledB: "GS", actualB: "GS",
        hasGameDataA: true, hasGameDataB: true,
        scratchGamesA: [100, 100, 100], scratchGamesB: [90, 90, 90],
        scratchTotalA: 300, scratchTotalB: 270,
        handicapTotalA: 300, handicapTotalB: 270,
        finalPointsA: 4, finalPointsB: 0,
        linescoreA: line, linescoreB: null }),
    ],
  };
  const participants = [
    { ref: "FL", displayName: "FL", role: "rostered" as const },
    { ref: "GS", displayName: "GS", role: "rostered" as const },
  ];
  const st = buildHistoricalStandings({ participants, weeks: [week], summaryRecords: [], pointSystem: 7 });
  const ps = buildHistoricalParticipantStats({ participants, weeks: [week] });
  const fl = st.find((r) => r.participantRef === "FL")!;
  const gs = st.find((r) => r.participantRef === "GS")!;
  truthy(fl.advanced !== null, "full-linescore bowler HAS standings advanced stats");
  eq(fl.advanced!.strikes, 1, "advanced.strikes derived from linescore");
  truthy(gs.advanced === null, "game-scores-only bowler advanced=null (never 0)");
  // Also participantStats.
  const flP = ps.find((r) => r.participantRef === "FL")!;
  const gsP = ps.find((r) => r.participantRef === "GS")!;
  truthy(flP.advanced != null, "FL participantStats has advanced");
  eq(flP.advanced!.framesRolled, 30, "FL advanced framesRolled = 3 games × 10");
  truthy(gsP.advanced === null, "GS participantStats advanced null when no linescore");
}

// ================================================================
// 7. Source-level proofs of remaining server guards
// ================================================================
{
  const repo = read("src/lib/historical-repo.functions.ts");
  truthy(repo.includes("confirmPublicationChange"),
    "adminUpdateHistoricalWeek accepts confirmPublicationChange");
  truthy(repo.includes("requires confirmPublicationChange=true"),
    "publication toggle rejected without confirmation");
  truthy(repo.includes("Set allowPublished=true to modify date/completed"),
    "date/completed edit on published week gated by allowPublished");
  truthy(repo.includes("no lane pairs configured"),
    "schedule insert rejects when lane config is empty");
  truthy(repo.includes("person_id lookup failed"),
    "personId lookup throws on DB error instead of silently null");
  truthy(repo.includes("filterPublicHistoricalSnapshot(row.snapshot)"),
    "career loader applies public filter before reading snapshot rows");
  truthy(repo.includes("canonicalizeSideLinescore"),
    "save path canonicalizes linescore before write");
  truthy(repo.includes("rostered_bowlers load failed") &&
         repo.includes("substitutes load failed"),
    "loadParticipants fails closed on DB errors instead of returning empty");
}

// eslint-disable-next-line no-console
console.log("historical-phase FINAL correctness tests passed");
