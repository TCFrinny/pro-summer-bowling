/**
 * Deterministic tests for cross-season career-advanced aggregation and
 * contribution extractors. No DB, no globals.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateCareerAdvanced,
  extractCurrentRosterAdvancedContribution,
  extractCurrentSubstituteAdvancedContribution,
  extractHistoricalAdvancedContribution,
  mergeCareerAdvancedContributions,
  type CareerAdvancedContribution,
} from "../src/lib/career-advanced";

// ---------- helpers ----------
function almost(a: number, b: number, tol = 1e-6) {
  return Math.abs(a - b) < tol;
}
function makeLineGame(score: number, strikes = 0, spares = 0, opens = 0) {
  return {
    scratchTotal: score,
    strikes, spares, opens, openPinsLeft: opens * 5,
    segments: { first5: score * 0.55, last5: score * 0.45, bigOpening: 0, bigFinish: 0, clutchMarks: 0, clutchOpportunities: 2 },
  };
}

// 1. Rob-style rostered contribution (21 credited / 15 actual). ADVANCED
//    counters use full-linescore games only; per-game averages divide by
//    advGames, not credited games. Roster credit (points, pointsLost) is
//    read from bowlersById — INCLUDING weeks a substitute rolled, because
//    that credit still belongs to the scheduled rostered bowler.
{
  const games = [
    makeLineGame(140, 4, 3, 3),
    makeLineGame(160, 5, 3, 2),
    makeLineGame(150, 4, 4, 2),
  ];
  const snap = {
    bowlersById: {
      "r1": {
        entryAverage: 130, points: 42, pointsLost: 22, handicapPinfall: 3000,
        gamesPlayed: 21, actualGamesRolled: 15, scratchPinfall: 2110, actualScratchPinfall: 2110,
      },
    },
    history: {
      "r1": [
        // Week 1: bowler rolled themselves — 3 linescore games.
        { absent: false, isSub: false, linescore: { games }, result: "W" },
        // Week 2: substitute rolled. Roster credit still applies via
        // bowlersById, but personal advanced data / POA does not.
        { absent: false, isSub: true, linescore: null, result: "L" },
        // Week 3: absent — skipped entirely.
        { absent: true, isSub: false, linescore: null, result: "L" },
        // Week 4: score-only live scoring — POA contributes, frame data does not.
        {
          absent: false, isSub: false, scoreOnly: true,
          scores: [155, 145, 0], pairCompleted: [true, true, false], completedGameCount: 2,
          linescore: null, result: "T",
        },
      ],
    },
  };
  const c = extractCurrentRosterAdvancedContribution(snap, "r1", "2026");
  if (c.advGames !== 3) throw new Error(`advGames should be 3, got ${c.advGames}`);
  if (c.framesRolled !== 30) throw new Error("framesRolled 30");
  if (c.points !== 42 || c.pointsLost !== 22 || c.handicapPinfall !== 3000) {
    throw new Error("roster credit missing (roster credit must include sub weeks)");
  }
  // No wins/losses/ties field should exist anymore.
  if ("wins" in c || "losses" in c || "ties" in c) {
    throw new Error("W-L-T must be removed from career contribution");
  }
  if (c.scoreMomentsN !== 3) throw new Error("moments N (linescore only)");
  if (!almost(c.scoreMomentsSum!, 450)) throw new Error("moments sum");
  // POA sources: full linescore (140+160+150 vs 130) + score-only completed
  // pairs (155,145 vs 130) = 10+30+20 + 25+15 = 100 over 5 games.
  if (c.poaGames !== 5) throw new Error(`poaGames should include score-only pairs, got ${c.poaGames}`);
  if (!almost(c.poaSum!, 100)) throw new Error(`poaSum wrong: ${c.poaSum}`);

  const totals = aggregateCareerAdvanced([c]);
  if (!almost(totals.first5PerGame!, (140 * 0.55 + 160 * 0.55 + 150 * 0.55) / 3)) {
    throw new Error("first5/game wrong");
  }
  if (!almost(totals.careerPOA!, 20)) throw new Error("career POA wrong");
  if (totals.pointsCredited !== 42 || totals.pointsLost !== 22) {
    throw new Error("aggregate credit wrong");
  }
}

// 2. Roster + substitute career combine — personal stats include both,
//    roster credit does NOT include the substitute row.
{
  const rosterContrib: CareerAdvancedContribution = {
    seasonId: "s1", role: "rostered",
    advGames: 10, framesRolled: 100, strikes: 30, spares: 25, opens: 45, openPinsLeft: 90,
    first5Total: 800, last5Total: 700, bigOpeningTotal: 40, bigFinishTotal: 30,
    clutchMarks: 12, clutchOpportunities: 20,
    poaGames: 10, poaSum: 40,
    scoreMomentsN: 10, scoreMomentsSum: 1500, scoreMomentsSumSq: 227000,
    points: 40, pointsLost: 30, handicapPinfall: 2500,
  };
  const subContrib: CareerAdvancedContribution = {
    seasonId: "s2", role: "substitute",
    advGames: 6, framesRolled: 60, strikes: 10, spares: 15, opens: 35, openPinsLeft: 70,
    first5Total: 400, last5Total: 350, bigOpeningTotal: 10, bigFinishTotal: 10,
    clutchMarks: 5, clutchOpportunities: 12,
    poaGames: 6, poaSum: 12,
    scoreMomentsN: 6, scoreMomentsSum: 800, scoreMomentsSumSq: 108000,
    points: 999, pointsLost: 999, handicapPinfall: 999, // MUST be ignored (substitute)
  };
  const t = aggregateCareerAdvanced([rosterContrib, subContrib]);
  if (t.advGames !== 16 || t.framesRolled !== 160) throw new Error("games/frames combine");
  if (t.strikes !== 40 || t.spares !== 40 || t.opens !== 80) throw new Error("basic combine");
  if (t.pointsCredited !== 40 || t.pointsLost !== 30 || t.handicapPinfall !== 2500) {
    throw new Error("sub credit leaked into roster credit");
  }
  const marks = 40 + 40;
  if (!almost(t.markPct!, (marks / 160) * 100)) throw new Error("weighted mark% wrong");
  const spareOpp = 40 + 80;
  if (!almost(t.spareConversionPct!, (40 / spareOpp) * 100)) throw new Error("weighted spare% wrong");
  const N = 16, S = 2300, SS = 335000;
  const mean = S / N;
  const expected = Math.sqrt(SS / N - mean * mean);
  if (!t.consistencyAvailable || !almost(t.consistency!, expected))
    throw new Error(`exact consistency wrong: ${t.consistency}`);
  if (!almost(t.careerPOA!, (40 + 12) / 16)) throw new Error("career POA weighted wrong");
}

// 3. Consistency stays unavailable when any full-linescore season lacks moments.
{
  const advWithMoments: CareerAdvancedContribution = {
    seasonId: "a", role: "rostered",
    advGames: 3, framesRolled: 30, strikes: 5, spares: 5, opens: 20, openPinsLeft: 40,
    scoreMomentsN: 3, scoreMomentsSum: 400, scoreMomentsSumSq: 54200,
  };
  const advNoMoments: CareerAdvancedContribution = {
    seasonId: "b", role: "rostered",
    advGames: 3, framesRolled: 30, strikes: 5, spares: 5, opens: 20, openPinsLeft: 40,
  };
  const t = aggregateCareerAdvanced([advWithMoments, advNoMoments]);
  if (t.consistencyAvailable || t.consistency !== null) {
    throw new Error("consistency should be unavailable when any season lacks moments");
  }
  if (t.markPct == null || t.strikes !== 10) throw new Error("advanced still aggregates");
}

// 4. Contribution with no advanced games — every frame-derived field is
//    null. Consistency unavailable. Career POA null.
{
  const empty: CareerAdvancedContribution = { seasonId: "z", role: "substitute" };
  const t = aggregateCareerAdvanced([empty]);
  if (t.advGames !== null || t.strikes !== null || t.markPct !== null) {
    throw new Error("null preservation violated");
  }
  if (t.consistencyAvailable || t.consistency !== null) throw new Error("consistency null");
  if (t.careerPOA !== null) throw new Error("POA null");
}

// 5. Substitute snapshot extraction — no roster credit; score-only weeks
//    contribute POA but no frame data.
{
  const games = [makeLineGame(120, 2, 3, 5), makeLineGame(130, 3, 2, 5), makeLineGame(140, 4, 2, 4)];
  const snap = {
    substituteProfiles: {
      "sub-1": {
        weeks: [
          { startingAverageAtMatch: 125, linescore: { games } },
          {
            startingAverageAtMatch: 120, scoreOnly: true,
            scores: [140, 0, 0], pairCompleted: [true, false, false], completedGameCount: 1,
            linescore: null,
          },
        ],
      },
    },
  };
  const c = extractCurrentSubstituteAdvancedContribution(snap, "sub-1", "s");
  if (c.role !== "substitute" || c.points != null || c.handicapPinfall != null) {
    throw new Error("sub contribution leaked credit");
  }
  if (c.advGames !== 3 || c.scoreMomentsN !== 3) throw new Error("sub games missed");
  // POA: full linescore against 125 (-5+5+15=15) + score-only game against 120 (+20) = 35 over 4 games.
  if (c.poaGames !== 4 || !almost(c.poaSum!, 35)) {
    throw new Error(`sub POA wrong: ${c.poaGames}/${c.poaSum}`);
  }
}

// 6. Historical extractor: frame stats from linescore; POA from
//    participantStats projection (covers GAME_SCORES seasons). Roster
//    credit comes from standings only. No W-L tracking.
{
  const line = [makeLineGame(150), makeLineGame(160), makeLineGame(140)];
  const snap = {
    weeks: [
      {
        matches: [
          { actualA: "p1", actualB: "p2", absentA: false, absentB: false,
            entryAverageA: 140, entryAverageB: 130, linescoreA: line, linescoreB: null },
          { actualA: "p3", actualB: "p1", absentA: false, absentB: true,
            entryAverageA: 130, entryAverageB: 140, linescoreA: null, linescoreB: null },
        ],
      },
    ],
    standings: [{ participantRef: "p1", points: 5, pointsLost: 2, handicapPinfall: 500 }],
    participantStats: [{ participantRef: "p1", games: 3, seasonPOA: 10 }],
  };
  const c = extractHistoricalAdvancedContribution({
    seasonId: "h1", role: "rostered", participantRef: "p1",
    weeks: snap.weeks, standings: snap.standings, participantStats: snap.participantStats,
  });
  if (c.advGames !== 3) throw new Error("historical advGames");
  if (c.points !== 5 || c.pointsLost !== 2 || c.handicapPinfall !== 500) {
    throw new Error("historical roster credit missing");
  }
  if ("wins" in c) throw new Error("W-L must be removed");
  // POA comes from participantStats, not per-linescore: 10 * 3 = 30 over 3 games.
  if (c.poaGames !== 3 || !almost(c.poaSum!, 30)) {
    throw new Error(`historical POA projection wrong: ${c.poaGames}/${c.poaSum}`);
  }
}

// 7. Historical GAME_SCORES season with NO linescore rolls still produces
//    a POA contribution via participantStats (no advanced denominator
//    inflation — advGames stays null).
{
  const c = extractHistoricalAdvancedContribution({
    seasonId: "h-gs", role: "rostered", participantRef: "gs1",
    weeks: [{ matches: [{ actualA: "gs1", actualB: "gs2", linescoreA: null, linescoreB: null }] }],
    standings: [{ participantRef: "gs1", points: 12, pointsLost: 6, handicapPinfall: null }],
    participantStats: [{ participantRef: "gs1", games: 6, seasonPOA: -2.5 }],
  });
  if (c.advGames != null) throw new Error("GAME_SCORES must not inflate advGames");
  if (c.framesRolled != null || c.strikes != null) throw new Error("no frame data allowed");
  if (c.poaGames !== 6 || !almost(c.poaSum!, -15)) {
    throw new Error(`GAME_SCORES POA projection wrong: ${c.poaGames}/${c.poaSum}`);
  }
  const t = aggregateCareerAdvanced([c]);
  if (t.advGames !== null) throw new Error("aggregate advGames must remain null");
  if (!almost(t.careerPOA!, -2.5)) throw new Error("career POA from projection wrong");
}

// 8. Unpublished-week exclusion propagates: extractor operates on the
//    pre-filtered snap.weeks. Empty weeks[] plus no participantStats →
//    all-null advanced contribution.
{
  const c = extractHistoricalAdvancedContribution({
    seasonId: "h2", role: "rostered", participantRef: "p1",
    weeks: [], standings: [{ participantRef: "p1", points: null, pointsLost: null, handicapPinfall: null }],
  });
  if (c.advGames != null) throw new Error("unpublished weeks leaked advanced games");
  if (c.poaGames != null) throw new Error("unpublished weeks leaked POA");
}

// 9. Summary-only roster credit — a rostered summary contribution with
//    only { points, pointsLost } must feed pointsCredited/pointsLost in
//    the aggregate. Substitute summary rows must NOT contribute credit.
{
  const rosterSummary: CareerAdvancedContribution = {
    seasonId: "sum1", role: "rostered", points: 60, pointsLost: 20,
  };
  const subSummary: CareerAdvancedContribution = {
    seasonId: "sum2", role: "substitute", points: 999, pointsLost: 999,
  };
  const t = aggregateCareerAdvanced([rosterSummary, subSummary]);
  if (t.pointsCredited !== 60 || t.pointsLost !== 20) {
    throw new Error(`summary-only roster credit wrong: ${t.pointsCredited}/${t.pointsLost}`);
  }
  if (t.handicapPinfall !== null) throw new Error("summary hcp pinfall must stay null");
  if (t.advGames !== null) throw new Error("summary must not fabricate advanced games");
}

// 10. Merge dedupes by seasonId::role, preferring the source with more data.
{
  const primaryEmpty: CareerAdvancedContribution = { seasonId: "s", role: "rostered" };
  const histRich: CareerAdvancedContribution = {
    seasonId: "s", role: "rostered", advGames: 3, framesRolled: 30, strikes: 5,
    scoreMomentsN: 3, scoreMomentsSum: 400, scoreMomentsSumSq: 54200,
  };
  const merged = mergeCareerAdvancedContributions([primaryEmpty], [histRich]);
  if (merged.length !== 1 || merged[0]!.advGames !== 3) {
    throw new Error("merge: richer historical should beat empty primary");
  }
  const primaryRich: CareerAdvancedContribution = { ...histRich };
  const merged2 = mergeCareerAdvancedContributions([primaryRich], [{ seasonId: "s", role: "rostered" }]);
  if (merged2.length !== 1 || merged2[0]!.advGames !== 3) {
    throw new Error("merge: primary should stand when historical is empty");
  }
}

// 11. Extractor is safe on null / missing / legacy shapes.
{
  const c1 = extractCurrentRosterAdvancedContribution(null, "x", "s");
  const c2 = extractCurrentRosterAdvancedContribution({}, "x", "s");
  const c3 = extractCurrentRosterAdvancedContribution({ bowlersById: {} }, "x", "s");
  for (const c of [c1, c2, c3]) {
    if (c.advGames != null || c.points != null) throw new Error("legacy safety violated");
  }
}

// 12. Source-level formatting assertions on people.$personId.tsx — proves
//     the display rules survive future edits. This is a targeted string
//     search on the route file, not a DOM render.
{
  const src = readFileSync(join(process.cwd(), "src/routes/people.$personId.tsx"), "utf8");
  const need = [
    'toFixed(3)',                          // Career Scratch Avg
    'label="Mark %"',
    'label="Strike %"',
    'label="Spare Conv. %"',
    'label="Open %"',
    'label="Clutch % (Fr 9–10)"',
    'label="Pins Lost / Game"',
    'label="Consistency (σ)"',
    'label="First 5 / Game"',
    'label="Last 5 / Game"',
    'label="Big Opening / Game"',
    'label="Big Finish / Game"',
    'label="Career POA"',
    'label="Game W-L-T"',
    'label="Set W-L-T"',
    'label="Overall W-L"',

    'toLocaleString()',
  ];
  for (const s of need) {
    if (!src.includes(s)) throw new Error(`career page missing display token: ${s}`);
  }
  if (src.includes('totals.wins') || src.includes('totals.losses') || src.includes('totals.ties')) {
    throw new Error("career page must not read wins/losses/ties from totals");
  }
}

// 13. Summary-only server function selects points_lost (source assertion).
{
  const src = readFileSync(join(process.cwd(), "src/lib/historical-repo.functions.ts"), "utf8");
  if (!/historical_season_summary_records[\s\S]{0,600}points_lost/.test(src)) {
    throw new Error("historical summary query must include points_lost");
  }
  if (!/role === "rostered"[\s\S]{0,300}advancedContributions\.push\(/.test(src)) {
    throw new Error("summary loop must push a roster-credit advanced contribution");
  }
}

// eslint-disable-next-line no-console
console.log("career-advanced tests passed");
