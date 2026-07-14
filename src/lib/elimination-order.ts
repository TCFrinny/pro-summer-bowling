/**
 * Pure helper to sort elimination rows to match the current standings order.
 *
 * IMPORTANT: does NOT mutate the input array or its rows. Elimination rows
 * whose bowler id is not present in the standings order fall to the end,
 * broken deterministically by name then id.
 */
import type { EliminationRow, StandingsRow } from "./mock-data";

export function buildStandingsOrder(standings: StandingsRow[]): Map<string, number> {
  const m = new Map<string, number>();
  standings.forEach((s, i) => m.set(s.bowler.id, i));
  return m;
}

export function sortEliminationRowsByStandings(
  rows: readonly EliminationRow[],
  standings: StandingsRow[],
): EliminationRow[] {
  const order = buildStandingsOrder(standings);
  const missing = Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => {
    const ra = order.get(a.bowler.id) ?? missing;
    const rb = order.get(b.bowler.id) ?? missing;
    if (ra !== rb) return ra - rb;
    const na = a.bowler.name.localeCompare(b.bowler.name);
    if (na !== 0) return na;
    return a.bowler.id.localeCompare(b.bowler.id);
  });
}

// ---- Deterministic self-test (runs on import) ----
(function selfTest() {
  const mk = (id: string, name = id.toUpperCase()) =>
    ({ bowler: { id, name }, status: "alive" } as unknown as EliminationRow);
  const mkS = (id: string, name = id.toUpperCase()) =>
    ({ rank: 0, movement: 0, bowler: { id, name } } as unknown as StandingsRow);

  const standings = [mkS("c"), mkS("a"), mkS("b")];
  const rows = [mk("a"), mk("b"), mk("c"), mk("z"), mk("y")];
  const out = sortEliminationRowsByStandings(rows, standings);
  const ids = out.map((r) => r.bowler.id).join(",");
  if (ids !== "c,a,b,y,z") throw new Error("elimination-order sort failed: " + ids);
  // No mutation of input
  if (rows.map((r) => r.bowler.id).join(",") !== "a,b,c,z,y")
    throw new Error("elimination-order mutated input");
})();
