/**
 * career-records tests — focused invariants for the three career records.
 */
import {
  aggregateCareerRecords,
  emptyContribution,
  extractCurrentRosterRecordContribution,
  extractHistoricalRecordContribution,
  extractHistoricalSummaryRecordContribution,
  formatWL,
  formatWLT,
  type CareerRecordContribution,
} from "../src/lib/career-records";
import type { Match, MatchResult, PublicSnapshot } from "../src/lib/mock-data";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("career-records: " + msg);
}

// 1. Empty aggregate → all null.
{
  const a = aggregateCareerRecords([]);
  assert(a.gameRecord === null && a.setRecord === null && a.overallRecord === null, "empty aggregates null");
  assert(formatWLT(null) === "—" && formatWL(null) === "—", "null formats as em-dash");
}

// 2. Historical override 0 / 2.5 in a 4-point season becomes 0-4 and 2.5-1.5
//    via standings.pointsLost — extractor uses standings directly.
{
  const cA = extractHistoricalSummaryRecordContribution({
    seasonId: "s", role: "rostered", participantRef: "A", points: 0, pointsLost: 4,
  });
  const cB = extractHistoricalSummaryRecordContribution({
    seasonId: "s", role: "rostered", participantRef: "B", points: 2.5, pointsLost: 1.5,
  });
  const aA = aggregateCareerRecords([cA]);
  const aB = aggregateCareerRecords([cB]);
  assert(formatWL(aA.overallRecord) === "0-4", "A override 0 → 0-4");
  assert(formatWL(aB.overallRecord) === "2.5-1.5", "B override 2.5 → 2.5-1.5");
  // Summary-only leaves personal unavailable.
  assert(aA.gameRecord === null && aA.setRecord === null, "summary leaves personal null");
}

// 3. Substitute-only summary contributes NO overall.
{
  const c = extractHistoricalSummaryRecordContribution({
    seasonId: "s", role: "substitute", participantRef: "X", points: 7, pointsLost: 0,
  });
  const a = aggregateCareerRecords([c]);
  assert(a.overallRecord === null, "substitute summary drops overall");
}

// 4. Historical GAME_SCORES-shaped weeks produce Game/Set W-L-T.
{
  const contrib = extractHistoricalRecordContribution({
    seasonId: "s", role: "rostered", participantRef: "A",
    weeks: [
      { matches: [
        { actualA: "A", actualB: "B", hasGameDataA: true, hasGameDataB: true,
          handicapGamesA: [200, 180, 210], handicapGamesB: [190, 190, 200],
          handicapTotalA: 590, handicapTotalB: 580 },
      ]},
      { matches: [
        // Absent — must not credit personal.
        { actualA: "A", actualB: "B", absentA: false, absentB: true,
          hasGameDataA: true, hasGameDataB: false,
          handicapGamesA: [200, 200, 200], handicapGamesB: [0, 0, 0],
          handicapTotalA: 600, handicapTotalB: 0 },
      ]},
    ],
    standings: [{ participantRef: "A", points: 4, pointsLost: 3 }],
  });
  const a = aggregateCareerRecords([contrib]);
  assert(formatWLT(a.gameRecord) === "2-1-0", `game record 2-1-0, got ${formatWLT(a.gameRecord)}`);
  assert(formatWLT(a.setRecord) === "1-0-0", `set record 1-0-0, got ${formatWLT(a.setRecord)}`);
  assert(formatWL(a.overallRecord) === "4-3", "overall 4-3 from standings");
}

// 5. Multi-alias aggregation across two rows — no double counting.
{
  const c1: CareerRecordContribution = { ...emptyContribution({ seasonId: "s1", role: "rostered" }),
    gameW: 10, gameL: 5, gameT: 1, pointsWon: 20, pointsLost: 8 };
  const c2: CareerRecordContribution = { ...emptyContribution({ seasonId: "s2", role: "substitute" }),
    gameW: 3, gameL: 6, gameT: 0 };
  const a = aggregateCareerRecords([c1, c2]);
  assert(a.gameRecord && a.gameRecord.wins === 13 && a.gameRecord.losses === 11 && a.gameRecord.ties === 1,
    "aggregated game record");
  assert(a.overallRecord && a.overallRecord.wins === 20 && a.overallRecord.losses === 8,
    "sub does not add to overall");
}

// 6. CURRENT roster Overall W-L is derived from PUBLISHED matches only and
//    uses `getAwardedPoints` so that overrides are honored. Points lost
//    equals 7 - own awarded per credited match. A future unpublished
//    match must not surface on the public career profile.
{
  function mkResult(
    scheduledA: string, scheduledB: string,
    ptsA: number, ptsB: number,
    over?: { pointsA: number; pointsB: number },
  ): MatchResult {
    const r: MatchResult = {
      scheduledA, scheduledB,
      scheduledNameA: scheduledA, scheduledNameB: scheduledB,
      actualA: scheduledA, actualB: scheduledB,
      actualNameA: scheduledA, actualNameB: scheduledB,
      isSubA: false, isSubB: false,
      participationA: { status: "rostered" },
      participationB: { status: "rostered" },
      entryAverageA: 100, entryAverageB: 100,
      handicapA: 0, handicapB: 0,
      linescoreA: null, linescoreB: null,
      gamesA: [150, 150, 150], gamesB: [140, 140, 140],
      handicapGamesA: [150, 150, 150], handicapGamesB: [140, 140, 140],
      scratchTotalA: 450, scratchTotalB: 420,
      handicapTotalA: 450, handicapTotalB: 420,
      gameAwardsA: [2, 2, 2], gameAwardsB: [0, 0, 0],
      gamePointsA: 6, gamePointsB: 0,
      setPointA: 1, setPointB: 0,
      totalPointsA: ptsA, totalPointsB: ptsB,
      pointsOverride: over ? { enabled: true, pointsA: over.pointsA, pointsB: over.pointsB, reason: "test" } : null,
      winner: ptsA > ptsB ? "A" : ptsB > ptsA ? "B" : "T",
    };
    return r;
  }
  function mkMatch(week: number, r: MatchResult): Match {
    return {
      id: `m-${week}`, week, lanePair: "1-2", slot: 1,
      status: "completed", bowlerA: r.scheduledA, bowlerB: r.scheduledB, result: r,
    };
  }
  const snap: PublicSnapshot = {
    weeks: [
      { week: 1, date: "", completed: true, published: true },
      { week: 2, date: "", completed: true, published: false }, // NOT published
    ],
    matchesByWeek: {
      1: [mkMatch(1, mkResult("A", "B", 7, 0))],                               // A: +7
      2: [mkMatch(2, mkResult("A", "B", 0, 7, { pointsA: 5.5, pointsB: 0 }))], // override; unpublished
    },
    bowlers: [], substitutes: [], bowlersById: {}, substituteProfiles: [],
  } as unknown as PublicSnapshot;
  const published = new Set<number>([1]);
  const contrib = extractCurrentRosterRecordContribution(snap, "A", published, "current");
  assert(contrib.pointsWon === 7, `pW ${contrib.pointsWon} expected 7 (only published)`);
  assert(contrib.pointsLost === 0, `pL ${contrib.pointsLost} expected 0`);
  assert(contrib.creditedMatches === 1, `credited ${contrib.creditedMatches} expected 1`);
  // Balance invariant against 7-point system per credited match.
  assert(contrib.pointsWon! + contrib.pointsLost! === 7 * contrib.creditedMatches!,
    "current 7-point per-match balance");
  // Now publish week 2 too — override applies (A=5.5, B=0), so A's L=1.5.
  const both = new Set<number>([1, 2]);
  const c2 = extractCurrentRosterRecordContribution(snap, "A", both, "current");
  assert(c2.pointsWon === 12.5, `pW with override ${c2.pointsWon} expected 12.5`);
  assert(c2.pointsLost === 1.5, `pL with override ${c2.pointsLost} expected 1.5`);
  assert(c2.creditedMatches === 2, `credited ${c2.creditedMatches} expected 2`);
  assert(c2.pointsWon! + c2.pointsLost! === 7 * c2.creditedMatches!, "override balance per match");
}

// eslint-disable-next-line no-console
console.log("career-records tests passed");
