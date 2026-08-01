/**
 * Shared duckpin milestone policy for High Game / High Set leaderboards.
 *
 * Any leaderboard or leaderboard-style display that ranks High Game or
 * High Set MUST include every qualifying milestone entry, even when it
 * falls outside the normal top-N cap. The base top-N ordering is kept as
 * given; additional milestone rows that are not already present are
 * appended in descending value order.
 *
 * Thresholds are duckpin-specific:
 *   - High Game milestone: 200 or higher
 *   - High Set  milestone: 500 or higher
 *
 * Boundary rule: values exactly equal to the threshold DO qualify;
 * values strictly below do NOT qualify solely by this milestone rule.
 */

export const HIGH_GAME_MILESTONE = 200;
export const HIGH_SET_MILESTONE = 500;

/**
 * Merge milestone-qualifying rows into a base top-N list without
 * duplicates. `base` is preserved as-is (its ordering / tie rules are
 * left intact). Any row in `all` whose `value(row) >= threshold` that is
 * not already in `base` is appended, sorted by `value` descending.
 *
 * Row identity is reference-equality: pass the SAME row objects into
 * `base` and `all` so already-included rows are not duplicated.
 */
export function mergeMilestoneRows<T>(
  base: readonly T[],
  all: readonly T[],
  value: (r: T) => number,
  threshold: number,
): T[] {
  const included = new Set<T>(base);
  const extras: T[] = [];
  for (const r of all) {
    if (included.has(r)) continue;
    if (value(r) >= threshold) extras.push(r);
  }
  extras.sort((a, b) => value(b) - value(a));
  return [...base, ...extras];
}

/**
 * Top-N performance selection that keeps every row tied with the value
 * occupying the Nth (cutoff) place. Used for HANDICAP High Game / High Set
 * boards, which do NOT use the scratch 200+/500+ milestone expansion.
 *
 * `all` is sorted by `value` descending (stable within equal values, so the
 * caller's incoming order acts as a deterministic tie-break). If fewer than
 * `n` rows exist, all of them are returned.
 */
export function topNWithCutoffTies<T>(
  all: readonly T[],
  value: (r: T) => number,
  n: number,
): T[] {
  const sorted = [...all].sort((a, b) => value(b) - value(a));
  if (sorted.length <= n) return sorted;
  const cutoff = value(sorted[n - 1]!);
  let end = n;
  while (end < sorted.length && value(sorted[end]!) === cutoff) end++;
  return sorted.slice(0, end);
}
