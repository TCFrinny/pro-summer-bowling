/**
 * Deterministic tests for cross-season career-advanced aggregation and
 * contribution extractors. No DB, no globals.
 */

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

// 1. Rob-style rostered contribution (21 credited / 15 actual, personal
//    pinfall 2110) — but the ADVANCED contribution counts full-linescore
//    games only. Verify that per-game averages divide by advGames, not
//    credited games, and roster credit (points, pointsLost) is preserved.
{
  const games = [
    makeLineGame(140, 4, 3, 3),
    makeLineGame(160, 5, 3, 2),
    makeLineGame(150, 4, 4, 2),
  ];
  const snap = {
    bowlersById: {
      "r1": { entryAverage: 130, points: 42, pointsLost: 22, handicapPinfall: 3000, gamesPlayed: 21, actualGamesRolled: 15, scratchPinfall: 2110, actualScratchPinfall: 2110 },
    },
    history: {
      "r1": [
        // week 1: bowler rolled themselves — 3 linescore games
        { absent: false, isSub: false, linescore: { games }, result: "W" },
        // week 2: substitute rolled — counts for W-L, but no advanced games
        { absent: false, isSub: true, linescore: null, result: "L" },
        // week 3: absent — skipped entirely
        { absent: true, isSub: false, linescore: null, result: "L" },
        // week 4: score-only live scoring — no frame linescore, skip advanced
        { absent: false, isSub: false, scoreOnly: true, linescore: null, result: "T" },
      ],
    },
  };
  const c = extractCurrentRosterAdvancedContribution(snap, "r1", "2026");
  if (c.advGames !== 3) throw new Error(`advGames should be 3, got ${c.advGames}`);
  if (c.framesRolled !== 30) throw new Error("framesRolled 30");
  if (c.points !== 42 || c.pointsLost !== 22 || c.handicapPinfall !== 3000) {
    throw new Error("roster credit missing");
  }
  // W-L-T from non-absent history rows: W=1 (self), L=1 (sub row still counts as roster credit? — we exclude sub rows to attribute record to actual bowler)
  // Our impl skips isSub rows entirely for W-L. So W=1, L=0, T=1 (score-only).
  if (c.wins !== 1 || c.losses !== 0 || c.ties !== 1) {
    throw new Error(`unexpected W-L-T: ${c.wins}-${c.losses}-${c.ties}`);
  }
  if (c.scoreMomentsN !== 3) throw new Error("moments N");
  if (!almost(c.scoreMomentsSum!, 450)) throw new Error("moments sum");
  // Career-POA game-weighted: sum of (score - 130) = 10+30+20 = 60 over 3 games = 20
  if (!almost(c.poaSum!, 60) || c.poaGames !== 3) throw new Error("POA source wrong");

  const totals = aggregateCareerAdvanced([c]);
  if (!almost(totals.first5PerGame!, (140 * 0.55 + 160 * 0.55 + 150 * 0.55) / 3)) {
    throw new Error("first5/game wrong");
  }
  if (!almost(totals.careerPOA!, 20)) throw new Error("career POA wrong");
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
    points: 40, pointsLost: 30, handicapPinfall: 2500, wins: 8, losses: 2, ties: 0,
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
  if (t.wins !== 8 || t.losses !== 2) throw new Error("W-L from roster only");
  // 3. weighted rates
  const marks = 40 + 40;
  if (!almost(t.markPct!, (marks / 160) * 100)) throw new Error("weighted mark% wrong");
  const spareOpp = 40 + 80;
  if (!almost(t.spareConversionPct!, (40 / spareOpp) * 100)) throw new Error("weighted spare% wrong");
  // 4. exact consistency across two seasons via moments
  const N = 16, S = 2300, SS = 335000;
  const mean = S / N;
  const expected = Math.sqrt(SS / N - mean * mean);
  if (!t.consistencyAvailable || !almost(t.consistency!, expected))
    throw new Error(`exact consistency wrong: ${t.consistency}`);
  // 5. career POA game-weighted
  if (!almost(t.careerPOA!, (40 + 12) / 16)) throw new Error("career POA weighted wrong");
}

// 3. Game-score-only historical row contributes to basic pinfall via the
//    HistoricalCareerContribution path but NOT to advanced counters —
//    consistency remains unavailable when any advanced season lacks moments.
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
  // 4. advanced remains available for other stats
  if (t.markPct == null || t.strikes !== 10) throw new Error("advanced still aggregates");
}

// 4. Contribution with no advanced games — every frame-derived field is
//    null, not zero. Career POA null, consistency unavailable.
{
  const empty: CareerAdvancedContribution = { seasonId: "z", role: "substitute" };
  const t = aggregateCareerAdvanced([empty]);
  if (t.advGames !== null || t.strikes !== null || t.markPct !== null) {
    throw new Error("null preservation violated");
  }
  if (t.consistencyAvailable || t.consistency !== null) throw new Error("consistency null");
  if (t.careerPOA !== null) throw new Error("POA null");
}

// 5. Substitute snapshot extraction — no roster credit, moments derived.
{
  const games = [makeLineGame(120, 2, 3, 5), makeLineGame(130, 3, 2, 5), makeLineGame(140, 4, 2, 4)];
  const snap = {
    substituteProfiles: {
      "sub-1": { weeks: [{ startingAverageAtMatch: 125, linescore: { games } }] },
    },
  };
  const c = extractCurrentSubstituteAdvancedContribution(snap, "sub-1", "s");
  if (c.role !== "substitute" || c.points != null || c.handicapPinfall != null) {
    throw new Error("sub contribution leaked credit");
  }
  if (c.advGames !== 3 || c.scoreMomentsN !== 3) throw new Error("sub games missed");
  if (!almost(c.poaSum!, (120 - 125) + (130 - 125) + (140 - 125))) throw new Error("sub POA wrong");
}

// 6. Historical extractor filters by participant ref, derives W-L-T and
//    excludes absent rows. Standings supplies roster credit.
{
  const line = [makeLineGame(150), makeLineGame(160), makeLineGame(140)];
  const snap = {
    weeks: [
      {
        matches: [
          { actualA: "p1", actualB: "p2", absentA: false, absentB: false, winner: "A" as const,
            entryAverageA: 140, entryAverageB: 130, linescoreA: line, linescoreB: null },
          { actualA: "p3", actualB: "p1", absentA: false, absentB: true, winner: "A" as const,
            entryAverageA: 130, entryAverageB: 140, linescoreA: null, linescoreB: null },
        ],
      },
    ],
    standings: [{ participantRef: "p1", points: 5, pointsLost: 2, handicapPinfall: 500 }],
  };
  const c = extractHistoricalAdvancedContribution({
    seasonId: "h1", role: "rostered", participantRef: "p1",
    weeks: snap.weeks, standings: snap.standings,
  });
  if (c.advGames !== 3) throw new Error("historical advGames");
  if (c.points !== 5 || c.pointsLost !== 2 || c.handicapPinfall !== 500) {
    throw new Error("historical roster credit missing");
  }
  // p1 was A in match 1 (winner A → W), absent B in match 2 (skipped).
  if (c.wins !== 1 || c.losses !== 0 || c.ties !== 0) {
    throw new Error(`historical W-L-T: ${c.wins}-${c.losses}-${c.ties}`);
  }
}

// 7. Unpublished-week exclusion propagates: historical extractor operates on
//    `snap.weeks`, which the server pre-filters with filterPublicHistoricalSnapshot.
//    Passing an empty weeks[] must produce an all-null advanced contribution.
{
  const c = extractHistoricalAdvancedContribution({
    seasonId: "h2", role: "rostered", participantRef: "p1",
    weeks: [], standings: [{ participantRef: "p1", points: null, pointsLost: null, handicapPinfall: null }],
  });
  if (c.advGames != null) throw new Error("unpublished weeks leaked advanced games");
  if (c.wins != null) throw new Error("unpublished weeks leaked wins");
}

// 8. Merge dedupes by seasonId::role, preferring the source with more data.
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

// 9. Extractor is safe on null / missing / legacy shapes.
{
  const c1 = extractCurrentRosterAdvancedContribution(null, "x", "s");
  const c2 = extractCurrentRosterAdvancedContribution({}, "x", "s");
  const c3 = extractCurrentRosterAdvancedContribution({ bowlersById: {} }, "x", "s");
  for (const c of [c1, c2, c3]) {
    if (c.advGames != null || c.points != null) throw new Error("legacy safety violated");
  }
}

// eslint-disable-next-line no-console
console.log("career-advanced tests passed");
