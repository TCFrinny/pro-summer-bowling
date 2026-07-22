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
  for (const f of ["snapshot", "matchesByWeek", "linescore", "weeks:", "history:"]) {
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

console.log("leaderboards tests OK");
