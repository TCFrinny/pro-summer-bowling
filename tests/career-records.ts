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

// eslint-disable-next-line no-console
console.log("career-records tests passed");
