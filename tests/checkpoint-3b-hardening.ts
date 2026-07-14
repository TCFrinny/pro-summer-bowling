/**
 * Focused pure tests for Checkpoint 3B hardening.
 * - Historical bowler survival (inactive/archived kept in bowlersById,
 *   completed match + opponent stats intact, absent from public boards).
 * - Partial-week projections (leaderboards + lane data exist for a week
 *   that has at least one saved result even though completed === false).
 */
import {
  buildSnapshot,
  seedBowlers,
  seedMatchesByWeek,
  seedWeeks,
  SEEDED_COMPLETED_WEEKS,
} from "../src/lib/mock-data";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("assertion failed: " + msg);
}

// ---- Test 1: historical bowler survival --------------------------------
{
  const bowlers = seedBowlers();
  const weeks = seedWeeks();
  const matchesByWeek = seedMatchesByWeek(bowlers);

  // Find a completed match with two real rostered sides (not subs) so
  // both identities are genuine roster ids.
  let inactiveId: string | null = null;
  let opponentId: string | null = null;
  outer: for (let w = 1; w <= SEEDED_COMPLETED_WEEKS; w++) {
    for (const m of matchesByWeek[w] ?? []) {
      const r = m.result;
      if (!r) continue;
      if (r.participationA.status === "rostered" && r.participationB.status === "rostered") {
        inactiveId = m.bowlerA;
        opponentId = m.bowlerB;
        break outer;
      }
    }
  }
  assert(inactiveId && opponentId, "expected a completed rostered-vs-rostered match in the seed");

  const activeIds = new Set(bowlers.map((b) => b.id).filter((id) => id !== inactiveId));
  const snap = buildSnapshot({ bowlers, weeks, matchesByWeek, activeBowlerIds: activeIds });

  // Inactive bowler filtered from PUBLIC boards.
  assert(!snap.bowlers.some((b) => b.id === inactiveId), "inactive bowler must not appear in snapshot.bowlers");
  assert(!snap.standings.some((r) => r.bowler.id === inactiveId), "inactive bowler must not appear in standings");
  assert(!snap.elimination.rows?.some?.((r: { bowler?: { id?: string } }) => r.bowler?.id === inactiveId)
    ?? true, "inactive bowler must not appear in elimination");

  // But identity + aggregates still resolvable for history/opponent lookups.
  const historical = snap.bowlersById[inactiveId!];
  assert(historical, "inactive bowler must remain in bowlersById");
  assert(historical.matchesPlayed > 0, "inactive bowler must retain matchesPlayed aggregate");

  // Opponent stats survive on the public board.
  const opponent = snap.bowlersById[opponentId!];
  assert(opponent && opponent.matchesPlayed > 0, "opponent must retain aggregated matches");
  assert(opponent.points > 0 || opponent.pointsLost > 0, "opponent must retain awarded/lost points");
  assert(snap.bowlers.some((b) => b.id === opponentId), "active opponent stays on public roster");

  // Historical match still present in matchesByWeek under its week.
  const preserved = Object.values(snap.matchesByWeek)
    .flat()
    .some((m) => m.bowlerA === inactiveId && m.bowlerB === opponentId && m.result);
  assert(preserved, "completed match between historical and active bowler must survive");

  // Historical bowler still has history rows (opponent + result recorded).
  const hist = snap.history[inactiveId!] ?? [];
  assert(hist.length > 0, "historical bowler must keep per-week history rows");
}

// ---- Test 2: partial-week projections ----------------------------------
{
  const bowlers = seedBowlers();
  const weeks = seedWeeks();
  const matchesByWeek = seedMatchesByWeek(bowlers);

  // Pick an unfinished week — anything past SEEDED_COMPLETED_WEEKS is
  // fully scheduled with no results.
  const partialWeek = SEEDED_COMPLETED_WEEKS + 1;
  const partial = matchesByWeek[partialWeek];
  assert(partial && partial.length > 1, "expected multiple scheduled matches in partial week");

  // Steal a completed result from an earlier week and graft it onto one
  // slot of the partial week to create a "at least one saved result"
  // condition without changing the week's completed flag.
  let donor: { result: NonNullable<typeof partial[number]["result"]> } | null = null;
  outer: for (let w = 1; w <= SEEDED_COMPLETED_WEEKS; w++) {
    for (const m of matchesByWeek[w] ?? []) {
      if (m.result) { donor = { result: m.result }; break outer; }
    }
  }
  assert(donor, "expected a donor completed result");
  partial[0] = { ...partial[0], result: donor.result };

  // Week summary should still report completed=false (matches < 18).
  const wk = weeks.find((w) => w.week === partialWeek);
  assert(wk && wk.completed === false, "partial week must remain completed=false");

  const snap = buildSnapshot({ bowlers, weeks, matchesByWeek });

  // Week-scoped projections must exist even though the week is not completed.
  assert(snap.weekBoards?.[partialWeek], "weekBoards must be generated for a partial week");
  assert(snap.weekLanes?.[partialWeek], "weekLanes must be generated for a partial week");
}

// eslint-disable-next-line no-console
console.log("checkpoint-3b hardening tests passed");
