/**
 * Deterministic tests for pickDefaultScheduleWeek.
 */
import { pickDefaultScheduleWeek } from "../src/lib/schedule-default-week";
import type { Match, WeekSummary } from "../src/lib/mock-data";

type WeekLite = Pick<WeekSummary, "week" | "published">;
type MBW = Record<number, Match[]>;

function m(id: string): Match {
  // Minimal stub — helper only cares about array length.
  return { id } as unknown as Match;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("schedule-default-week: " + msg);
}

// Build helpers
function weeks(spec: Array<[number, boolean]>): WeekLite[] {
  return spec.map(([week, published]) => ({ week, published }));
}
function mbw(withMatches: number[], count = 18): MBW {
  const out: MBW = {};
  for (const w of withMatches) {
    out[w] = Array.from({ length: count }, (_, i) => m(`w${w}-${i}`));
  }
  return out;
}

// 1. Weeks 1-3 completed, Week 4 published => default 4
{
  const w = weeks([[1, true], [2, true], [3, true], [4, true], [5, true]]);
  const matches = mbw([1, 2, 3, 4]); // 5 has no matchups yet
  assert(pickDefaultScheduleWeek(w, matches) === 4, "case 1: expected 4");
}

// 2. Week 4 partially has results => still default 4 (partial matches still present)
{
  const w = weeks([[1, true], [2, true], [3, true], [4, true]]);
  const matches = mbw([1, 2, 3, 4]);
  assert(pickDefaultScheduleWeek(w, matches) === 4, "case 2: expected 4");
}

// 3. Week 5 published with matches, Week 4 incomplete => default 5
{
  const w = weeks([[1, true], [2, true], [3, true], [4, true], [5, true]]);
  const matches = mbw([1, 2, 3, 4, 5]);
  assert(pickDefaultScheduleWeek(w, matches) === 5, "case 3: expected 5");
}

// 4. Week 5 draft/unpublished => default remains 4
{
  const w = weeks([[1, true], [2, true], [3, true], [4, true], [5, false]]);
  const matches = mbw([1, 2, 3, 4, 5]); // 5 has matchups but not published
  assert(pickDefaultScheduleWeek(w, matches) === 4, "case 4: expected 4");
}

// 5. Published week with zero matchups is skipped
{
  const w = weeks([[1, true], [2, true], [3, true], [4, true]]);
  const matches = mbw([1, 2, 3]); // 4 published but empty
  assert(pickDefaultScheduleWeek(w, matches) === 3, "case 5: expected 3");
}

// 6a. Fallback: no published weeks with matches, but some week has matches
{
  const w = weeks([[1, false], [2, false], [3, false]]);
  const matches = mbw([2, 3]);
  assert(pickDefaultScheduleWeek(w, matches) === 2, "case 6a: expected 2 (first with matches)");
}

// 6b. Fallback: no matches anywhere => first week
{
  const w = weeks([[1, true], [2, true]]);
  assert(pickDefaultScheduleWeek(w, {}) === 1, "case 6b: expected 1");
}

// 6c. Fallback: empty weeks array => 1
{
  assert(pickDefaultScheduleWeek([], {}) === 1, "case 6c: expected 1");
}

// eslint-disable-next-line no-console
console.log("schedule-default-week tests passed");
