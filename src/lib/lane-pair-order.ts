/**
 * Lane-pair ordering helpers.
 *
 * Lane-pair labels look like "1-2", "3-4", ..., "11-12". Sorting them
 * with `String#localeCompare` produces the wrong order because it is
 * lexicographic: "11-12" sorts between "1-2" and "3-4".
 *
 * Prefer `season_lane_pairs.display_order` when it is available (that
 * is the admin-authored ordering). When only the label is available,
 * use `compareLanePairLabel` — a natural numeric comparator that
 * extracts the first integer from each label and compares numerically,
 * falling back to string compare when neither side has a leading
 * integer (defensive; not expected in real data).
 */

/** Parse the leading integer from a lane-pair label like "1-2" → 1.
 *  Returns null when no leading digits are present. */
export function laneNumberFromLabel(label: string): number | null {
  const m = /^\s*(\d+)/.exec(label);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Numeric comparator for lane-pair labels ("1-2" < "3-4" < "11-12"). */
export function compareLanePairLabel(a: string, b: string): number {
  const na = laneNumberFromLabel(a);
  const nb = laneNumberFromLabel(b);
  if (na != null && nb != null && na !== nb) return na - nb;
  if (na != null && nb == null) return -1;
  if (na == null && nb != null) return 1;
  return a.localeCompare(b);
}

/** Comparator over `{ lane_pair, slot }` — lane-pair natural order, then slot. */
export function compareLanePairSlotSnake<T extends { lane_pair: string; slot: number }>(
  a: T,
  b: T,
): number {
  const c = compareLanePairLabel(a.lane_pair, b.lane_pair);
  return c !== 0 ? c : a.slot - b.slot;
}

/** Comparator over `{ lanePair, slot }` — lane-pair natural order, then slot. */
export function compareLanePairSlotCamel<T extends { lanePair: string; slot: number }>(
  a: T,
  b: T,
): number {
  const c = compareLanePairLabel(a.lanePair, b.lanePair);
  return c !== 0 ? c : a.slot - b.slot;
}
