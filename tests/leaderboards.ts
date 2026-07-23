/**
 * All-Time Leaderboards — deterministic tests for the pure aggregator
 * and ranking module. No Supabase; no random data.
 */
import {
  aggregateSeasonContributions,
  buildLeaderboard,
  type SeasonContribution,
  type LeaderboardIdentity,
} from "../src/lib/leaderboards";
import { readFileSync } from "node:fs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("leaderboards: " + msg);
}

const idPerson = (personId: string, name: string): LeaderboardIdentity => ({
  key: `person:${personId}`, displayName: name, personId,
  unlinkedSeasonId: null, unlinkedParticipantRef: null,
});
const idUnlinked = (season: string, ref: string, name: string): LeaderboardIdentity => ({
  key: `unlinked:${season}:${ref}`, displayName: name, personId: null,
  unlinkedSeasonId: season, unlinkedParticipantRef: ref,
});

function base(identity: LeaderboardIdentity, over: Partial<SeasonContribution> = {}): SeasonContribution {
  return {
    identityKey: identity.key, identity, championship: false,
    gameWins: 0, setWins: 0, overallWins: 0,
    games: 0, scratchPinfall: 0, highGame: null, highSet: null,
    poaSum: null, poaGames: null,
    strikes: null, spares: null, opens: null,
    framesRolled: null, openPinsLeft: null,
    clutchMarks: null, clutchOpportunities: null,
    offense: null, defense: null,
    actualRatingGames: 0, opponentRatingGames: 0, fullLinescoreGames: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Cross-season aggregation by personId (linked identity spans seasons).
// ---------------------------------------------------------------------------
{
  const alice = idPerson("p-alice", "Alice");
  const contribs: SeasonContribution[] = [
    base(alice, { games: 20, scratchPinfall: 3000, gameWins: 12, setWins: 4 }),
    base(alice, { games: 15, scratchPinfall: 2400, gameWins: 8, setWins: 3 }),
  ];
  const rows = aggregateSeasonContributions(contribs);
  assert(rows.length === 1, "linked identity dedupes across seasons");
  const r = rows[0];
  assert(r.games === 35 && r.scratchPinfall === 5400, "games+pinfall sum");
  assert(r.gameWins === 20 && r.setWins === 7, "personal wins sum");
  assert(r.scratchAverage != null && Math.abs(r.scratchAverage - 154.286) < 0.01, "avg 3-dec");
}

// ---------------------------------------------------------------------------
// 2. Roster + sub aliases merged by personId; unlinked names kept separate
//    even when identical.
// ---------------------------------------------------------------------------
{
  const bob = idPerson("p-bob", "Bob");
  const uA = idUnlinked("2024", "part-1", "John Doe");
  const uB = idUnlinked("2025", "part-9", "John Doe");
  const contribs = [
    base(bob, { games: 10, gameWins: 4 }),       // as rostered
    base(bob, { games: 3, gameWins: 1 }),        // as sub, same person → merged
    base(uA, { games: 5, gameWins: 2 }),
    base(uB, { games: 6, gameWins: 3 }),
  ];
  const rows = aggregateSeasonContributions(contribs);
  const keys = new Set(rows.map((r) => r.identity.key));
  assert(keys.size === 3, "linked person merges roster+sub; identical unlinked names stay separate");
  const bobRow = rows.find((r) => r.identity.key === "person:p-bob")!;
  assert(bobRow.games === 13 && bobRow.gameWins === 5, "linked merge sums");
}

// ---------------------------------------------------------------------------
// 3. Eligibility thresholds — average/POA, frame rates, clutch.
// ---------------------------------------------------------------------------
{
  const a = base(idPerson("a", "A"), { games: 8, scratchPinfall: 1600, poaGames: 8, poaSum: 40 });
  const b = base(idPerson("b", "B"), { games: 9, scratchPinfall: 1800, poaGames: 9, poaSum: 45 });
  const rows = aggregateSeasonContributions([a, b]);
  const avg = buildLeaderboard(rows, "scratchAverage");
  assert(avg.entries.length === 1 && avg.entries[0].identity.key === "person:b",
    "average requires >=9 games");
  const poa = buildLeaderboard(rows, "careerPOA");
  assert(poa.entries.length === 1 && poa.entries[0].identity.key === "person:b",
    "POA requires >=9 games");

  const frameLow = base(idPerson("f1", "F1"), { framesRolled: 89, strikes: 30, spares: 20, opens: 39 });
  const frameHi = base(idPerson("f2", "F2"), { framesRolled: 90, strikes: 30, spares: 20, opens: 40 });
  const fRows = aggregateSeasonContributions([frameLow, frameHi]);
  const marks = buildLeaderboard(fRows, "markPct");
  assert(marks.entries.length === 1 && marks.entries[0].identity.key === "person:f2",
    "mark% requires >=90 frames");

  const clutchLow = base(idPerson("c1", "C1"), { clutchMarks: 10, clutchOpportunities: 19 });
  const clutchHi = base(idPerson("c2", "C2"), { clutchMarks: 15, clutchOpportunities: 20 });
  const cRows = aggregateSeasonContributions([clutchLow, clutchHi]);
  const cl = buildLeaderboard(cRows, "clutchPct");
  assert(cl.entries.length === 1 && cl.entries[0].identity.key === "person:c2",
    "clutch requires >=20 opportunities");
}

// ---------------------------------------------------------------------------
// 4. Sort direction — desc and lower-is-better (asc).
// ---------------------------------------------------------------------------
{
  const rows = aggregateSeasonContributions([
    base(idPerson("a", "A"), { framesRolled: 100, opens: 30, strikes: 30, spares: 40 }),
    base(idPerson("b", "B"), { framesRolled: 100, opens: 10, strikes: 50, spares: 40 }),
  ]);
  const openLow = buildLeaderboard(rows, "openPct");
  assert(openLow.entries[0].identity.key === "person:b", "open% ascending — lower first");
  const strikes = buildLeaderboard(rows, "strikes");
  assert(strikes.entries[0].identity.key === "person:b", "strikes descending — higher first");
}

// ---------------------------------------------------------------------------
// 5. Sample tie-break (larger sample wins) then alphabetical.
// ---------------------------------------------------------------------------
{
  // Two bowlers both average 200 exactly, different games.
  const rows = aggregateSeasonContributions([
    base(idPerson("a", "Zed"),  { games: 10, scratchPinfall: 2000, poaGames: 10, poaSum: 0 }),
    base(idPerson("b", "Anna"), { games: 20, scratchPinfall: 4000, poaGames: 20, poaSum: 0 }),
    base(idPerson("c", "Bob"),  { games: 20, scratchPinfall: 4000, poaGames: 20, poaSum: 0 }),
  ]);
  const avg = buildLeaderboard(rows, "scratchAverage");
  assert(avg.entries[0].identity.displayName === "Anna", "larger sample wins tie-break");
  assert(avg.entries[1].identity.displayName === "Bob", "alphabetical breaks equal sample");
  assert(avg.entries[2].identity.displayName === "Zed", "smaller sample last");
}

// ---------------------------------------------------------------------------
// 6. Competition ranking — ties share rank; every row tied at rank <=10
//    is included even when it exceeds the raw limit.
// ---------------------------------------------------------------------------
{
  const contribs: SeasonContribution[] = [];
  for (let i = 0; i < 9; i++) {
    contribs.push(base(idPerson(`p${i}`, `P${String.fromCharCode(65 + i)}`), { games: 100, scratchPinfall: 20_000 + i }));
  }
  // Three bowlers tied at 10th (identical primary + sample).
  for (let i = 0; i < 3; i++) {
    contribs.push(base(idPerson(`t${i}`, `T${String.fromCharCode(65 + i)}`), { games: 50, scratchPinfall: 5000 }));
  }
  const rows = aggregateSeasonContributions(contribs);
  const board = buildLeaderboard(rows, "scratchPinfall", 10);
  const rank10 = board.entries.filter((e) => e.rank === 10);
  assert(rank10.length === 3, "every rank-10 tie is included");
  assert(board.entries.length === 12, "9 unique + 3 tied at 10 = 12 rows");
}

// ---------------------------------------------------------------------------
// 7. Missing values excluded, not converted to 0.
// ---------------------------------------------------------------------------
{
  const rows = aggregateSeasonContributions([
    base(idPerson("a", "A"), { games: 15, scratchPinfall: 3000, poaGames: 15, poaSum: 45 }),
    base(idPerson("b", "B"), { games: 0 /* no personal games */ }),
  ]);
  const avg = buildLeaderboard(rows, "scratchAverage");
  assert(avg.entries.length === 1 && avg.entries[0].identity.key === "person:a",
    "bowlers with no games are excluded, not zero-ranked");
}

// ---------------------------------------------------------------------------
// 8. Compact response shape — the leaderboard row type must not carry raw
//    snapshot / weeks / matches / linescore fields. Static source check on
//    the aggregate row type ensures no future regression.
// ---------------------------------------------------------------------------
{
  const src = readFileSync("src/lib/leaderboards.ts", "utf8");
  const m = src.match(/export interface AllTimeRow \{([\s\S]*?)\n\}/);
  assert(m, "AllTimeRow interface must exist");
  const body = m![1];
  for (const f of ["snapshot", "matchesByWeek", "linescoreA", "linescoreB", "weeks:", "history:"]) {
    assert(!body.toLowerCase().includes(f.toLowerCase()),
      `AllTimeRow must not expose ${f}`);
  }
}

// ---------------------------------------------------------------------------
// 9. Isolation — current-scoring modules must not import the leaderboards
//    module (server-only aggregation cannot leak into the client bundle
//    of scoring / snapshot builders / standings).
// ---------------------------------------------------------------------------
{
  const guarded = [
    "src/lib/mock-data.ts",
    "src/lib/live-scoring.ts",
    "src/lib/league-store.ts",
    "src/lib/historical-snapshot.ts",
  ];
  for (const path of guarded) {
    const src = readFileSync(path, "utf8");
    assert(!/from ["']@\/lib\/leaderboards(-repo\.functions)?["']/.test(src),
      `${path} must not import leaderboards module`);
  }
}

// ---------------------------------------------------------------------------
// 10. Competition ranking must key on PRIMARY value only. Two rows with
//     identical primary but different samples share a rank; larger sample
//     sorts first within the rank; tied-at-rank-10 inclusion keeps every
//     row equal on primary even when their samples differ.
// ---------------------------------------------------------------------------
{
  // A and B both average 200 exactly with different game samples. They
  // MUST share rank 1.
  const rows = aggregateSeasonContributions([
    base(idPerson("a", "Anna"), { games: 20, scratchPinfall: 4000, poaGames: 20, poaSum: 0 }),
    base(idPerson("b", "Bob"),  { games: 10, scratchPinfall: 2000, poaGames: 10, poaSum: 0 }),
  ]);
  const avg = buildLeaderboard(rows, "scratchAverage");
  assert(avg.entries[0].rank === 1 && avg.entries[1].rank === 1,
    "equal primary → same rank regardless of sample");
  assert(avg.entries[0].identity.key === "person:a", "larger sample sorts first within rank");
}
{
  // Nine unique leaders (200, 199, …, 192). Three at 10th share exact
  // primary but have DIFFERENT samples — all three must still appear at
  // rank 10.
  const contribs: SeasonContribution[] = [];
  for (let i = 0; i < 9; i++) {
    contribs.push(base(idPerson(`p${i}`, `P${String.fromCharCode(65 + i)}`),
      { framesRolled: 100, opens: 10 + i, strikes: 20, spares: 30 }));
  }
  contribs.push(base(idPerson("t1", "TA"), { framesRolled: 100, opens: 30, strikes: 20, spares: 30 }));
  contribs.push(base(idPerson("t2", "TB"), { framesRolled: 120, opens: 36, strikes: 24, spares: 36 }));
  contribs.push(base(idPerson("t3", "TC"), { framesRolled: 200, opens: 60, strikes: 40, spares: 60 }));
  const rows = aggregateSeasonContributions(contribs);
  const board = buildLeaderboard(rows, "openPct", 10);
  const tied = board.entries.filter((e) => e.rank === 10);
  assert(tied.length === 3, `tied-at-10 inclusion regardless of sample; got ${tied.length}`);
}

// ---------------------------------------------------------------------------
// 11. Aggregate ratings equal `computeCareerRatings` for the same
//     contributions (game-weighted per-season with the shared helper).
// ---------------------------------------------------------------------------
{
  const { computeCareerRatings } = await import("../src/lib/ratings");
  const p = idPerson("r1", "R1");
  const rows = aggregateSeasonContributions([
    base(p, { offense: 105.0, defense: 98.0, actualRatingGames: 20, opponentRatingGames: 20, fullLinescoreGames: 15 }),
    base(p, { offense: 112.4, defense: 101.7, actualRatingGames: 30, opponentRatingGames: 25, fullLinescoreGames: 30 }),
  ]);
  assert(rows.length === 1, "single identity");
  const cr = computeCareerRatings("r1", [
    { seasonId: "s1", offense: 105.0, defense: 98.0, actualGames: 20, opponentGames: 20, fullLinescoreGames: 15 },
    { seasonId: "s2", offense: 112.4, defense: 101.7, actualGames: 30, opponentGames: 25, fullLinescoreGames: 30 },
  ]);
  assert(rows[0].offense === cr.offensiveRating, `offense parity ${rows[0].offense} vs ${cr.offensiveRating}`);
  assert(rows[0].defense === cr.matchupDefense, `defense parity ${rows[0].defense} vs ${cr.matchupDefense}`);
  assert(rows[0].twoWay === cr.twoWayRating, `two-way parity ${rows[0].twoWay} vs ${cr.twoWayRating}`);
  assert(rows[0].actualRatingGames === cr.totals.actualGames, "actual games parity");
  assert(rows[0].opponentRatingGames === cr.totals.opponentGames, "opponent games parity");
}

// ---------------------------------------------------------------------------
// 12. Identity routing (hrefKind) — current-roster / current-sub / historical
//     / permanent-person all map to the correct public route.
// ---------------------------------------------------------------------------
{
  const {
    idPerson: idP, idCurrentRoster, idCurrentSub, idHistorical,
  } = await import("../src/lib/leaderboards-contrib");
  const person = idP("p-1", "P");
  const roster = idCurrentRoster("b07", "R");
  const sub = idCurrentSub("s03", "S");
  const hist = idHistorical("2024", "part-1", "H");
  assert(person.hrefKind === "person" && person.personId === "p-1", "person identity kind");
  assert(roster.hrefKind === "current-roster" && roster.unlinkedParticipantRef === "b07"
    && roster.unlinkedSeasonId === null, "current-roster carries bowler id, no season");
  assert(sub.hrefKind === "current-sub" && sub.unlinkedParticipantRef === "s03"
    && sub.unlinkedSeasonId === null, "current-sub carries substitute id, no season");
  assert(hist.hrefKind === "historical" && hist.unlinkedSeasonId === "2024"
    && hist.unlinkedParticipantRef === "part-1", "historical carries season + ref");
}

// ---------------------------------------------------------------------------
// 13. Current-season builder walks ONLY published `matchesByWeek`. A
//     bowler and a substitute each rolled twice — once in a published
//     week, once in an unpublished week. Every current contribution
//     (personal games, POA, high game, frames, overall points, ratings
//     sample) must reflect the published week only.
// ---------------------------------------------------------------------------
{
  const { buildCurrentSeasonContribs } = await import("../src/lib/leaderboards-contrib");
  // Minimal synthetic PublicSnapshot with two weeks. Only week 1 is
  // published.
  const b = {
    id: "b01", name: "Rostered", entryAverage: 160, handicap: 0, scratchAverage: 0,
    points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0, scratchPinfall: 0,
    handicapPinfall: 0, highGame: 999, highSet: 999, matchesPlayed: 0, gamesPlayed: 0,
    actualGamesRolled: 6, actualScratchPinfall: 1200, movement: 0,
  };
  const s = { id: "s01", name: "Sub", entryAverage: 150, handicap: 0, personId: null };
  function ls(scores: [number, number, number], entryAverage: number) {
    return {
      scheduledId: b.id, actualId: null, actualName: "", isSub: false,
      entryAverage, handicap: 0,
      games: [0, 1, 2].map((i) => ({
        frames: [], strikes: 2, spares: 3, opens: 5, openPinsLeft: 20,
        scratchTotal: scores[i], scratchByFrame: [], marks: 5,
        segments: { first5: 100, last5: 100, bigOpening: 0, bigFinish: 0,
          clutchMarks: 1, clutchOpportunities: 2 },
      })) as any,
      scratchSet: scores[0] + scores[1] + scores[2],
      handicapGames: scores, handicapSet: scores[0] + scores[1] + scores[2],
      strikes: 6, spares: 9, opens: 15, marks: 15, openPinsLeft: 60, framesRolled: 30,
      segments: { first5: 300, last5: 300, bigOpening: 0, bigFinish: 0,
        clutchMarks: 3, clutchOpportunities: 6 },
    };
  }
  function makeMatch(week: number, sideAisSub: boolean, scoresA: [number, number, number], scoresB: [number, number, number]) {
    return {
      id: `m-${week}`, week, lanePair: "1-2" as const, slot: 1, status: "completed" as const,
      bowlerA: b.id, bowlerB: "b02",
      result: {
        scheduledA: b.id, scheduledB: "b02",
        scheduledNameA: b.name, scheduledNameB: "Opp",
        actualA: sideAisSub ? s.id : b.id, actualB: "b02",
        actualNameA: sideAisSub ? s.name : b.name, actualNameB: "Opp",
        isSubA: sideAisSub, isSubB: false,
        participationA: {
          scheduledId: b.id,
          status: sideAisSub ? "substitute" : "rostered",
          actualId: sideAisSub ? s.id : b.id, actualName: sideAisSub ? s.name : b.name,
        },
        participationB: { scheduledId: "b02", status: "rostered", actualId: "b02", actualName: "Opp" },
        entryAverageA: sideAisSub ? s.entryAverage : b.entryAverage, entryAverageB: 160,
        handicapA: 0, handicapB: 0,
        linescoreA: ls(scoresA, sideAisSub ? s.entryAverage : b.entryAverage) as any,
        linescoreB: ls(scoresB, 160) as any,
        gamesA: scoresA, gamesB: scoresB,
        handicapGamesA: scoresA, handicapGamesB: scoresB,
        scratchTotalA: scoresA[0] + scoresA[1] + scoresA[2],
        scratchTotalB: scoresB[0] + scoresB[1] + scoresB[2],
        handicapTotalA: scoresA[0] + scoresA[1] + scoresA[2],
        handicapTotalB: scoresB[0] + scoresB[1] + scoresB[2],
        gameAwardsA: [2, 2, 2] as any, gameAwardsB: [0, 0, 0] as any,
        gamePointsA: 6, gamePointsB: 0, setPointA: 1 as any, setPointB: 0 as any,
        totalPointsA: 7, totalPointsB: 0, pointsOverride: null,
        winner: "A" as const,
      },
    };
  }
  // Week 1: rostered rolls scores [200,200,200]; opp [100,100,100].
  const w1 = makeMatch(1, false, [200, 200, 200], [100, 100, 100]);
  // Week 2 (UNPUBLISHED): substitute rolls for scheduled bowler with
  // extreme scores that would leak into personal/high/POA if not gated.
  const w2 = makeMatch(2, true, [280, 280, 280], [100, 100, 100]);
  const snapshot = {
    builtAt: 0,
    bowlers: [b as any],
    bowlersById: { [b.id]: b as any, b02: { ...b, id: "b02", name: "Opp" } as any },
    weeks: [
      { week: 1, date: "", completed: true, published: true },
      { week: 2, date: "", completed: true, published: false },
    ],
    matchesByWeek: { 1: [w1 as any], 2: [w2 as any] },
    standings: [], history: {}, extras: {},
    seasonBoards: { standard: {}, advanced: {} } as any,
    weekBoards: {}, seasonLanes: [], weekLanes: {},
    elimination: {} as any,
    substitutes: [s as any],
    substituteProfiles: {
      [s.id]: { gamesRolled: 3, scratchPinfall: 840, highGame: 280, highSet: 840, weeks: [] } as any,
    },
  } as any;
  const rows = buildCurrentSeasonContribs({ seasonId: "cur", seasonLabel: "2026 Summer", seasonSortYear: 2026, championPersonId: null, snapshot });
  const bRow = rows.find((r) => r.identity.key === "current-roster:b01")!;
  assert(bRow, "rostered contribution present");
  assert(bRow.games === 3, `rostered games must equal published-week games only (got ${bRow.games})`);
  assert(bRow.scratchPinfall === 600, `rostered pinfall (got ${bRow.scratchPinfall})`);
  assert(bRow.highGame === 200, `rostered high game excludes unpublished 280 (got ${bRow.highGame})`);
  assert(bRow.highSet === 600, `rostered high set excludes unpublished 840 (got ${bRow.highSet})`);
  assert(bRow.framesRolled === 30, `rostered frames from week 1 only (got ${bRow.framesRolled})`);
  assert(bRow.poaGames === 3 && bRow.poaSum === (200 - 160) * 3,
    `rostered POA covers only published games (got ${bRow.poaGames}/${bRow.poaSum})`);
  // Substitute personal must ONLY reflect the unpublished week -> empty.
  const sRow = rows.find((r) => r.identity.key === "current-sub:s01");
  assert(!sRow || sRow.games === 0, "substitute personal excluded because their only week was unpublished");
  // Overall roster credit — 7 pts (week 1) only. Unpublished week 2 also
  // awarded 7 to A, but that must NOT be counted.
  assert(bRow.overallWins === 7, `overall points from published matches only (got ${bRow.overallWins})`);
  // Ratings sample only counts published games.
  assert(bRow.actualRatingGames === 3, `rating games from published only (got ${bRow.actualRatingGames})`);
}

// ---------------------------------------------------------------------------
// 14. Public season selector — only archived + public_visible seasons pass.
// ---------------------------------------------------------------------------
{
  const { selectPublicHistoricalSeasonIds } = await import("../src/lib/leaderboards-contrib");
  const ids = selectPublicHistoricalSeasonIds([
    { id: "cur", status: "current", isCurrent: true, publicVisible: true },
    { id: "arch-pub", status: "archived", isCurrent: false, publicVisible: true },
    { id: "arch-priv", status: "archived", isCurrent: false, publicVisible: false },
    { id: "draft", status: "draft", isCurrent: false, publicVisible: true },
  ]);
  assert(ids.length === 1 && ids[0] === "arch-pub",
    "only archived+public_visible seasons appear on the public leaderboard");
}

// ---------------------------------------------------------------------------
// 15. Historical builder consumes an already-filtered snapshot. Feeding a
//     snapshot with unpublished weeks through `filterPublicHistoricalSnapshot`
//     first strips them, so no unpublished data reaches contributions.
// ---------------------------------------------------------------------------
{
  const {
    buildHistoricalSeasonContribs,
  } = await import("../src/lib/leaderboards-contrib");
  const { filterPublicHistoricalSnapshot } = await import("../src/lib/historical-snapshot");
  const snap = {
    version: 1, builtAt: 0, seasonId: "2024", seasonLabel: "2024",
    pointSystem: 7 as const, totalWeeks: 2,
    participants: [
      { ref: "p1", displayName: "H1", role: "rostered" as const, personId: null },
    ],
    weeks: [
      { weekNumber: 1, date: null, published: true, completed: true, matches: [], schedule: [] },
      { weekNumber: 2, date: null, published: false, completed: true, matches: [], schedule: [] },
    ],
    standings: [], summaryOnly: false, summaryRecords: [],
    participantStats: [],
  } as any;
  const filtered = filterPublicHistoricalSnapshot(snap);
  assert(filtered.weeks.length === 1 && filtered.weeks[0].published === true,
    "filter strips unpublished weeks before contribution build");
  const rows = buildHistoricalSeasonContribs("2024", filtered);
  // Nothing to aggregate (no matches); participant appears with zeros.
  assert(rows.length === 1 && rows[0].games === 0, "no leaked unpublished data");
}

// ---------------------------------------------------------------------------
// 16. Duckpin High Game / High Set milestone rule — every 200+ game and
//     every 500+ set is always displayed, even when it falls outside the
//     top-10 rank cap. Non-milestone categories remain capped. Boundary
//     values 200/500 qualify; 199/499 do not qualify by the milestone
//     rule alone. Merging keeps existing top-10 order and never duplicates
//     rows that are already inside the cap.
// ---------------------------------------------------------------------------
{
  const {
    HIGH_GAME_MILESTONE, HIGH_SET_MILESTONE, mergeMilestoneRows,
  } = await import("../src/lib/leaderboard-milestone");
  assert(HIGH_GAME_MILESTONE === 200 && HIGH_SET_MILESTONE === 500,
    "duckpin milestone thresholds fixed at 200 / 500");

  // (1) More than 10 bowlers with 200+ games → all qualifying rows show.
  {
    const contribs: SeasonContribution[] = [];
    // 15 unique bowlers with high games from 214 down to 200.
    for (let i = 0; i < 15; i++) {
      contribs.push(base(idPerson(`p${i}`, `P${String.fromCharCode(65 + i)}`),
        { games: 30, scratchPinfall: 30 * (150 + i), highGame: 214 - i, highSet: 400 }));
    }
    // Two below-milestone rows that would normally take rank 11+.
    contribs.push(base(idPerson("lo1", "Lo1"), { games: 30, highGame: 190 }));
    contribs.push(base(idPerson("lo2", "Lo2"), { games: 30, highGame: 180 }));
    const rows = aggregateSeasonContributions(contribs);
    const board = buildLeaderboard(rows, "highGame", 10);
    // Every 200+ row is present (15 of them), sub-200 excluded.
    assert(board.entries.length === 15,
      `all 200+ high game rows displayed (got ${board.entries.length})`);
    assert(board.entries.every((e) => e.primary >= 200), "no sub-200 leaks past top 10");
    assert(board.entries[0].primary === 214 && board.entries[14].primary === 200,
      "existing descending order preserved");
  }
  // (2) More than 10 bowlers with 500+ sets → all qualifying rows show.
  {
    const contribs: SeasonContribution[] = [];
    for (let i = 0; i < 13; i++) {
      contribs.push(base(idPerson(`s${i}`, `S${String.fromCharCode(65 + i)}`),
        { games: 30, highSet: 520 - i }));
    }
    contribs.push(base(idPerson("lo", "Lo"), { games: 30, highSet: 480 }));
    const rows = aggregateSeasonContributions(contribs);
    const board = buildLeaderboard(rows, "highSet", 10);
    assert(board.entries.length === 13,
      `all 500+ high set rows displayed (got ${board.entries.length})`);
    assert(board.entries.every((e) => e.primary >= 500), "sub-500 excluded from milestone board");
  }
  // (3) Normal top-10 plus milestone qualifiers outside the top-10 merge
  //     without duplicates and remain correctly sorted.
  {
    const contribs: SeasonContribution[] = [];
    // Top 9 non-milestone rows (highGame 190..182).
    for (let i = 0; i < 9; i++) {
      contribs.push(base(idPerson(`n${i}`, `N${String.fromCharCode(65 + i)}`),
        { games: 30, highGame: 190 - i }));
    }
    // 10th slot at 181, then five 200+ rows tied on samples but low
    // enough (in raw order) that they would fall outside the top-10 if
    // NOT resorted by the leaderboard's descending order.
    contribs.push(base(idPerson("n9", "NJ"), { games: 30, highGame: 181 }));
    for (let i = 0; i < 5; i++) {
      contribs.push(base(idPerson(`m${i}`, `M${String.fromCharCode(65 + i)}`),
        { games: 30, highGame: 200 + i }));
    }
    const rows = aggregateSeasonContributions(contribs);
    const board = buildLeaderboard(rows, "highGame", 10);
    // buildLeaderboard already sorts desc, so the 5 milestone rows take
    // ranks 1..5, then non-milestone 190..181 at 6..10. All rows appear;
    // no duplicates.
    const keys = board.entries.map((e) => e.identity.key);
    assert(new Set(keys).size === keys.length, "no duplicate rows after milestone merge");
    // First 5 are the 200+ rows (204, 203, 202, 201, 200).
    assert(board.entries.slice(0, 5).every((e) => e.primary >= 200),
      "200+ rows take the top ranks by natural desc sort");
    // 5 milestone rows + top 5 non-milestone (rank 6..10). Rows 11..15
    // (highGame 185..181) are below both the cap AND the milestone.
    assert(board.entries.length === 10,
      `cap holds when all extras fit inside top 10 (got ${board.entries.length})`);
    // Confirm the sub-milestone tail is correctly excluded and no dup.
    assert(!keys.includes("person:n9"),
      "sub-milestone rank-11+ rows are excluded when non-qualifying");
  }
  // (4) A non-milestone category (scratchPinfall) remains capped at 10.
  {
    const contribs: SeasonContribution[] = [];
    for (let i = 0; i < 15; i++) {
      contribs.push(base(idPerson(`p${i}`, `P${String.fromCharCode(65 + i)}`),
        { games: 30, scratchPinfall: 10_000 - i }));
    }
    const rows = aggregateSeasonContributions(contribs);
    const board = buildLeaderboard(rows, "scratchPinfall", 10);
    assert(board.entries.length === 10,
      `non-milestone board stays capped at 10 (got ${board.entries.length})`);
  }
  // (5) Boundary values — 200/500 qualify; 199/499 do not by the milestone
  //     rule alone.
  {
    const contribs: SeasonContribution[] = [];
    for (let i = 0; i < 10; i++) {
      contribs.push(base(idPerson(`p${i}`, `P${String.fromCharCode(65 + i)}`),
        { games: 30, highGame: 300 - i, highSet: 600 - i }));
    }
    // Ranks 11+: 200 exactly (qualifies), 199 exactly (does not).
    contribs.push(base(idPerson("edge200", "Edge200"), { games: 30, highGame: 200 }));
    contribs.push(base(idPerson("edge199", "Edge199"), { games: 30, highGame: 199 }));
    contribs.push(base(idPerson("edge500", "Edge500"), { games: 30, highSet: 500 }));
    contribs.push(base(idPerson("edge499", "Edge499"), { games: 30, highSet: 499 }));
    const rows = aggregateSeasonContributions(contribs);
    const g = buildLeaderboard(rows, "highGame", 10);
    const gKeys = new Set(g.entries.map((e) => e.identity.key));
    assert(gKeys.has("person:edge200"), "200 exactly qualifies via milestone");
    assert(!gKeys.has("person:edge199"), "199 excluded by milestone boundary");
    const s = buildLeaderboard(rows, "highSet", 10);
    const sKeys = new Set(s.entries.map((e) => e.identity.key));
    assert(sKeys.has("person:edge500"), "500 exactly qualifies via milestone");
    assert(!sKeys.has("person:edge499"), "499 excluded by milestone boundary");
  }
  // (6) mergeMilestoneRows — dedup + append + descending order of extras;
  //     base list is left in its given order.
  {
    type R = { name: string; v: number };
    const all: R[] = [
      { name: "A", v: 260 }, { name: "B", v: 240 }, { name: "C", v: 230 },
      { name: "D", v: 220 }, { name: "E", v: 210 }, { name: "F", v: 205 },
      { name: "G", v: 199 }, { name: "H", v: 150 },
    ];
    const base = all.slice(0, 3); // A, B, C — normal top 3
    const merged = mergeMilestoneRows(base, all, (r) => r.v, HIGH_GAME_MILESTONE);
    // No duplicates: A/B/C only appear once even though they are 200+.
    assert(merged.length === 6, `expected 6 merged rows, got ${merged.length}`);
    assert(merged.slice(0, 3).map((r) => r.name).join("") === "ABC",
      "base order preserved");
    assert(merged.slice(3).map((r) => r.name).join("") === "DEF",
      "milestone extras appended in descending order");
    assert(!merged.some((r) => r.name === "G"), "199 excluded from milestone extras");
  }
}

// -----------------------------------------------------------------------
// Provenance for High Game / High Set — season + week attribution.
// -----------------------------------------------------------------------
{
  const p = (id: string, name: string) => idPerson(id, name);
  const alice = p("alice", "Alice");
  const bob = p("bob", "Bob");
  // Alice: 240 in season 2024 week 5, and 240 again in season 2025 week 2
  // -> earliest documented is 2024 wk 5.
  // Bob: 260 in season 2025 (unknown week; summary-only) -> Week unavailable.
  const contribs: SeasonContribution[] = [
    base(alice, {
      highGame: 240, highSet: 620,
      highGameProvenance: { seasonId: "s24", seasonLabel: "2024", seasonSortYear: 2024, week: 5, value: 240 },
      highSetProvenance: { seasonId: "s24", seasonLabel: "2024", seasonSortYear: 2024, week: 5, value: 620 },
      games: 30,
    }),
    base(alice, {
      highGame: 240, highSet: 620,
      highGameProvenance: { seasonId: "s25", seasonLabel: "2025", seasonSortYear: 2025, week: 2, value: 240 },
      highSetProvenance: { seasonId: "s25", seasonLabel: "2025", seasonSortYear: 2025, week: 2, value: 620 },
      games: 30,
    }),
    base(bob, {
      highGame: 260, highSet: 700,
      highGameProvenance: { seasonId: "s25", seasonLabel: "2025", seasonSortYear: 2025, week: null, value: 260 },
      highSetProvenance: { seasonId: "s25", seasonLabel: "2025", seasonSortYear: 2025, week: null, value: 700 },
      games: 15,
    }),
  ];
  const rows = aggregateSeasonContributions(contribs);
  const aRow = rows.find((r) => r.identity.personId === "alice");
  const bRow = rows.find((r) => r.identity.personId === "bob");
  assert(aRow?.highGameProvenance?.seasonId === "s24", "Alice ties on 240 → earliest season");
  assert(aRow?.highGameProvenance?.week === 5, "Alice ties → earliest week 5");
  assert(aRow?.highSetProvenance?.seasonId === "s24", "Alice hi-set ties → earliest season");
  assert(bRow?.highGameProvenance?.seasonId === "s25", "Bob single occurrence season");
  assert(bRow?.highGameProvenance?.week === null, "Bob has undocumented week");

  // buildLeaderboard exposes provenance on highGame/highSet entries only.
  const hg = buildLeaderboard(rows, "highGame", 10);
  const bobHG = hg.entries.find((e) => e.identity.personId === "bob");
  assert(bobHG?.provenance?.week === null, "Bob HG entry has null week provenance");
  const games = buildLeaderboard(rows, "games", 10);
  assert(games.entries.every((e) => e.provenance === undefined), "non-HG categories omit provenance");
}

console.log("leaderboards milestone tests OK");


