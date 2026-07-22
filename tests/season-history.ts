/**
 * Deterministic tests for the multi-season history / permanent-people
 * helpers. Pure — no DB, no network.
 */

import {
  aggregateCareerTotals,
  compareSeasonsChronological,
  filterPublicSeasons,
  normalizeName,
  parseSnapshotBackwardCompat,
  planPersonMerge,
  seasonSortYear,
  sortSeasonsChronological,
  summarizeCapacityList,
  summarizeLanePairs,
  withPersonId,
  type CareerSeasonRow,
  type LanePairConfig,
  type PersonLink,
  type SeasonRecord,
} from "../src/lib/season-history";

// 1. Uneven capacity 4,3,4,4,3,4 → 22 matchups / 44 bowlers
{
  const t = summarizeCapacityList([4, 3, 4, 4, 3, 4]);
  if (t.totalMatchups !== 22 || t.bowlerCapacity !== 44 || t.activePairs !== 6) {
    throw new Error(`uneven capacity: ${JSON.stringify(t)}`);
  }
  const withInactive: LanePairConfig[] = [
    { label: "1-2", displayOrder: 0, matchupCapacity: 4, active: true },
    { label: "3-4", displayOrder: 1, matchupCapacity: 3, active: false },
    { label: "5-6", displayOrder: 2, matchupCapacity: 4, active: true },
  ];
  const t2 = summarizeLanePairs(withInactive);
  if (t2.totalMatchups !== 8 || t2.activePairs !== 2) {
    throw new Error(`inactive pair math wrong: ${JSON.stringify(t2)}`);
  }
}

// 2. Current-season default: current stays first, drafts hidden, archived
//    surface only when public — and iterating the filter never mutates the
//    input array (proxy for "reading an archived season does not mutate the
//    current one").
{
  const seasons: SeasonRecord[] = [
    { id: "cur", label: "2026 Summer", status: "current", publicVisible: true },
    { id: "old-public", label: "2025 W", status: "archived", publicVisible: true, startDate: "2025-01-01" },
    { id: "old-private", label: "2024 W", status: "archived", publicVisible: false },
    { id: "draft-1", label: "2027 planning", status: "draft", publicVisible: true },
  ];
  const frozen = JSON.stringify(seasons);
  const pub = filterPublicSeasons(seasons);
  if (JSON.stringify(seasons) !== frozen) {
    throw new Error("filterPublicSeasons mutated its input");
  }
  if (pub.map((s) => s.id).join(",") !== "cur,old-public") {
    throw new Error(`public filter wrong: ${pub.map((s) => s.id).join(",")}`);
  }
}

// 3. Same person can hold both a rostered and a substitute row in different
//    seasons — career rows must remain separate, not collapsed.
{
  const rows: CareerSeasonRow[] = [
    { seasonId: "s1", seasonLabel: "S1", role: "rostered", seasonalName: "Doe", hasGameData: true, games: 30, scratchPinfall: 3300 },
    { seasonId: "s2", seasonLabel: "S2", role: "substitute", seasonalName: "J. Doe", hasGameData: true, games: 6, scratchPinfall: 660 },
  ];
  const totals = aggregateCareerTotals(rows);
  if (totals.seasonsCount !== 2 || totals.seasonsWithGameData !== 2) {
    throw new Error(`multi-role rows collapsed: ${JSON.stringify(totals)}`);
  }
  if (totals.totalGames !== 36 || totals.totalScratchPinfall !== 3960) {
    throw new Error(`multi-role totals wrong: ${JSON.stringify(totals)}`);
  }
}

// 4. Career aggregation ignores unavailable stats; never treats them as 0.
{
  const totals = aggregateCareerTotals([
    { seasonId: "a", seasonLabel: "A", role: "rostered", seasonalName: "n", hasGameData: false },
    { seasonId: "b", seasonLabel: "B", role: "rostered", seasonalName: "n", hasGameData: true, games: 10, scratchPinfall: 1200, highGame: 190 },
  ]);
  if (totals.totalGames !== 10 || totals.totalScratchPinfall !== 1200) {
    throw new Error(`unavailable-as-zero leaked: ${JSON.stringify(totals)}`);
  }
  if (!totals.average || Math.abs(totals.average - 120) > 1e-9) {
    throw new Error(`avg wrong: ${totals.average}`);
  }
  if (totals.highGame !== 190) throw new Error("highGame carry wrong");
  const empty = aggregateCareerTotals([
    { seasonId: "x", seasonLabel: "X", role: "substitute", seasonalName: "n", hasGameData: false },
  ]);
  if (empty.average !== null || empty.highGame !== null || empty.highSet !== null) {
    throw new Error("empty rows must produce null aggregates");
  }
}

// 5. Current snapshot without personId remains backward-compatible.
{
  const oldSnap = parseSnapshotBackwardCompat({ builtAt: 1, bowlers: [{ id: "b00", name: "n" }] });
  if (!oldSnap) throw new Error("legacy snapshot rejected");
  const bowlers = oldSnap.bowlers as Array<Record<string, unknown>>;
  if ("personId" in bowlers[0]) throw new Error("legacy snapshot fabricated personId");
  const attached = withPersonId(bowlers[0], "p-1");
  if (attached.personId !== "p-1") throw new Error("withPersonId attach failed");
  // Original must be untouched.
  if ("personId" in bowlers[0]) throw new Error("withPersonId mutated input");
}

// 6. Person merge repoints all linked seasonal records; never proposes
//    deleting a seasonal row.
{
  const links: PersonLink[] = [
    { table: "rostered_bowlers", id: "b00", column: "person_id" },
    { table: "rostered_bowlers", id: "b12", column: "person_id" },
    { table: "substitutes", id: "s3", column: "person_id" },
    { table: "seasons", id: "season-99", column: "champion_person_id" },
  ];
  const plan = planPersonMerge("keep", "remove", links);
  if (plan.repoints.length !== 4) throw new Error("plan dropped links");
  const summary = plan.summary.join(" ").toLowerCase();
  if (summary.includes("delete row") || summary.includes("delete seasonal")) {
    throw new Error("plan proposed deleting a seasonal record");
  }
  let threw = false;
  try { planPersonMerge("a", "a", []); } catch { threw = true; }
  if (!threw) throw new Error("self-merge must throw");
}

// 7. Name normalization is deterministic — needed so migration backfill
//    would pair current-season roster+sub rows with the same person.
{
  if (normalizeName("  Jane  Doe ") !== normalizeName("Jane Doe")) {
    throw new Error("normalizeName not idempotent");
  }
  if (normalizeName("JANE DOE") !== "jane doe") throw new Error("normalize case");
}

// 8. Missing-table backward safety marker: the parse helper never throws
//    on the empty-object we surface to public pages when the new schema is
//    absent. Public current-season pages continue to work.
{
  if (parseSnapshotBackwardCompat({}) === null) throw new Error("parse empty rejected");
  if (parseSnapshotBackwardCompat(null) !== null) throw new Error("null must yield null");
  if (parseSnapshotBackwardCompat("nope") !== null) throw new Error("string must yield null");
}

// eslint-disable-next-line no-console
console.log("season-history tests passed");
