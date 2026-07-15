/**
 * Pure helper: pick the default week to show on the public Schedule page.
 *
 * Rule: highest-numbered week that is `published` AND has at least one
 * matchup in `matchesByWeek`. Falls back to the first week meeting the
 * matchup criterion, then to the first week overall, then to 1.
 */
import type { Match, WeekSummary } from "@/lib/mock-data";

export function pickDefaultScheduleWeek(
  weeks: ReadonlyArray<Pick<WeekSummary, "week" | "published">>,
  matchesByWeek: Readonly<Record<number, ReadonlyArray<Match> | undefined>>,
): number {
  const hasMatchups = (w: number) => (matchesByWeek[w]?.length ?? 0) > 0;

  const publishedWithMatches = weeks
    .filter((w) => w.published && hasMatchups(w.week))
    .map((w) => w.week);
  if (publishedWithMatches.length > 0) {
    return Math.max(...publishedWithMatches);
  }

  const anyWithMatches = weeks.find((w) => hasMatchups(w.week));
  if (anyWithMatches) return anyWithMatches.week;

  return weeks[0]?.week ?? 1;
}
