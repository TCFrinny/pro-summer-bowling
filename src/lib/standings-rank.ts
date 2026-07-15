/**
 * Pure ranking helpers shared by the current-week standings and the
 * previous-week baseline used to compute the "Move" column.
 *
 * Official standings order: points DESC, then handicap pinfall DESC,
 * then a deterministic tiebreak on bowler id ASC to keep the sort stable
 * across recomputations.
 */
import { getAwardedPoints, type BowlerId, type Match } from "./mock-data";

export interface StandingsTotals {
  points: number;
  handicapPinfall: number;
}

export function emptyTotals(): StandingsTotals {
  return { points: 0, handicapPinfall: 0 };
}

/**
 * Compute per-bowler {points, handicapPinfall} contributions from a
 * subset of matches. Only matches with a saved `result` contribute.
 * Bowler ids missing from `ids` are ignored so archived bowlers never
 * bleed into public standings baselines.
 */
export function aggregateStandingsTotals(
  ids: ReadonlySet<BowlerId>,
  matches: readonly Match[],
): Map<BowlerId, StandingsTotals> {
  const out = new Map<BowlerId, StandingsTotals>();
  for (const id of ids) out.set(id, emptyTotals());
  for (const m of matches) {
    const r = m.result;
    if (!r) continue;
    const aw = getAwardedPoints(r);
    const a = out.get(m.bowlerA);
    if (a) {
      a.points += aw.pointsA;
      a.handicapPinfall += r.handicapTotalA;
    }
    const b = out.get(m.bowlerB);
    if (b) {
      b.points += aw.pointsB;
      b.handicapPinfall += r.handicapTotalB;
    }
  }
  return out;
}

/**
 * Rank a set of bowler ids by their standings totals using the official
 * comparator. Returns a Map from bowler id -> 1-based rank. Ids not
 * present in `totals` are omitted from the result.
 */
export function rankByStandings(
  ids: readonly BowlerId[],
  totals: Map<BowlerId, StandingsTotals>,
): Map<BowlerId, number> {
  const sorted = [...ids]
    .filter((id) => totals.has(id))
    .sort((x, y) => {
      const tx = totals.get(x)!;
      const ty = totals.get(y)!;
      if (ty.points !== tx.points) return ty.points - tx.points;
      if (ty.handicapPinfall !== tx.handicapPinfall)
        return ty.handicapPinfall - tx.handicapPinfall;
      return x.localeCompare(y);
    });
  const rank = new Map<BowlerId, number>();
  sorted.forEach((id, i) => rank.set(id, i + 1));
  return rank;
}

/**
 * Latest week that has at least one saved match result. Returns null
 * when no result exists anywhere in the schedule (Week 1 before any
 * entry). This is the standings "cutoff" week — the current standings
 * include it; the previous-week baseline excludes it.
 */
export function findLatestResultWeek(
  matchesByWeek: Record<number, Match[]>,
): number | null {
  let latest: number | null = null;
  for (const key of Object.keys(matchesByWeek)) {
    const wk = Number(key);
    if (!Number.isFinite(wk)) continue;
    const list = matchesByWeek[wk] ?? [];
    if (list.some((m) => !!m.result)) {
      if (latest === null || wk > latest) latest = wk;
    }
  }
  return latest;
}
