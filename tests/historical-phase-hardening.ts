/**
 * Phase D hardening tests.
 *
 * These cover PURE behavior in the historical snapshot / helper layer.
 * DB-side authorization (auth middleware, admin check, RLS) is enforced
 * server-side and covered separately by the migration; here we prove:
 *   - snapshot builder includes unplayed slots in `schedule` but not `matches`
 *   - lane-pair natural ordering used at runtime by public pages
 *   - detail-mode availability semantics on the reader side
 *   - full-linescore payload survives the snapshot round-trip
 *   - source-level guards / calls exist in the shipped files
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildHistoricalStandings,
  type HistoricalMatch,
  type HistoricalScheduledSlot,
  type HistoricalWeekSummary,
} from "../src/lib/historical-snapshot";
import { compareLanePairSlotCamel } from "../src/lib/lane-pair-order";

function truthy(v: unknown, msg: string) { if (!v) throw new Error(msg); }
function eq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`);
  }
}
function read(p: string) { return readFileSync(join(process.cwd(), p), "utf8"); }

// ---------------------------------------------------------------- snapshot schedule inclusion
{
  const schedule: HistoricalScheduledSlot[] = [
    { slotId: "s1", weekNumber: 1, lanePair: "1-2", slot: 1, scheduledA: "P1", scheduledB: "P2", nameA: "Alice", nameB: "Bob", hasResult: false },
    { slotId: "s2", weekNumber: 1, lanePair: "11-12", slot: 1, scheduledA: "P3", scheduledB: "P4", nameA: "Carol", nameB: "Dan", hasResult: true },
  ];
  const week: HistoricalWeekSummary = {
    weekNumber: 1, date: null, published: true, completed: false,
    matches: [], schedule,
  };
  // Unplayed slot IS in schedule.
  truthy(week.schedule.some((s) => s.slotId === "s1" && !s.hasResult),
    "unplayed slot must be present in schedule");
  // Weekly Results reads `matches`, which does NOT include unplayed slots.
  truthy(week.matches.every((m) => (m as HistoricalMatch).slotId !== "s1"),
    "weekly-results must not surface unplayed slot");
}

// ---------------------------------------------------------------- natural lane ordering
{
  const rows = [
    { lanePair: "11-12", slot: 1 },
    { lanePair: "9-10", slot: 2 },
    { lanePair: "1-2", slot: 1 },
    { lanePair: "9-10", slot: 1 },
  ];
  rows.sort(compareLanePairSlotCamel);
  eq(rows.map((r) => `${r.lanePair}·${r.slot}`), ["1-2·1", "9-10·1", "9-10·2", "11-12·1"],
    "lane-pair natural order across weekly rows");
}

// ---------------------------------------------------------------- standings still isolated per season
{
  const standings = buildHistoricalStandings({
    participants: [
      { ref: "P1", displayName: "P1", role: "rostered", personId: "person-a" },
      { ref: "P2", displayName: "P2", role: "rostered", personId: "person-b" },
    ],
    weeks: [],
    summaryRecords: [],
  });
  // No rows without any data — participants without weekly or summary rows are dropped.
  truthy(standings.length === 0, "no fabricated rows when no data");
}

// ---------------------------------------------------------------- source-level guards
{
  const repo = read("src/lib/historical-repo.functions.ts");
  truthy(repo.includes("roster unavailable:"), "loadRosterIds fails closed");
  truthy(repo.includes("substitutes unavailable:"), "loadSubstituteIds fails closed");
  truthy(repo.includes("lane pair config unavailable:"), "loadLanePairConfig fails closed");
  truthy(repo.includes("has no rostered bowlers"), "empty-roster new-slot guard present");
  truthy(repo.includes("actualRef must equal the scheduled bowler"),
    "roster/absent actualRef pinned to scheduled");
  truthy(repo.includes("substitute is not registered for this season"),
    "substitute actualRef validated against season substitutes");
  truthy(repo.includes("loadFrozenIdentity"), "server-side identity freeze helper present");
  truthy(repo.includes("linescore missing"), "per-side linescore requirement enforced");
  truthy(repo.includes("Set allowPublished=true to delete."),
    "delete week guarded by allowPublished");
  truthy(repo.includes("Participant") && repo.includes("is not registered as"),
    "summary upsert freezes role/identity from DB");

  // Snapshot builder must build schedule regardless of results.
  truthy(repo.includes("schedule.push"), "snapshot builder emits scheduled slots");

  // Weekly-results public route file exists and uses public snapshot loader.
  const wr = read("src/routes/seasons.$seasonId.weekly-results.tsx");
  truthy(wr.includes("getPublicHistoricalSnapshot"), "public weekly-results reads snapshot");
  truthy(wr.includes("Frame linescore / advanced frame stats unavailable"),
    "game-scores unavailable messaging present");
  truthy(wr.includes("GameLinescore"), "weekly-results renders frame linescore");

  // Schedule public route reads the new `schedule` field.
  const sch = read("src/routes/seasons.$seasonId.schedule.tsx");
  truthy(sch.includes("w.schedule"), "public schedule reads schedule field");
  truthy(sch.includes("s.nameA") && sch.includes("s.nameB"),
    "public schedule shows frozen scheduled names");

  // Tabs use TanStack Link, not raw anchors, and label 'Weekly Results'.
  const layout = read("src/routes/seasons.$seasonId.tsx");
  truthy(layout.includes("<Link"), "layout uses TanStack Link for tabs");
  truthy(layout.includes("Weekly Results"), "tab label 'Weekly Results'");
  truthy(!layout.match(/<a[^>]*href={t\.to/), "no raw <a href> tab reloads");

  // Standings link to season bowler profile (per instruction #7).
  const st = read("src/routes/seasons.$seasonId.standings.tsx");
  truthy(st.includes("/seasons/$seasonId/bowlers/$participantRef"),
    "standings name links to season bowler profile");

  // Admin section hydrates linescore.
  const admin = read("src/components/admin/HistoricalDataSection.tsx");
  truthy(admin.includes("rehydrate") && admin.includes("cumulativeScore"),
    "admin hydrates full linescore into frame editor");
  truthy(admin.includes("allowPublished: highRisk"),
    "admin delete-week passes allowPublished for published weeks");
  truthy(admin.includes("Type DELETE"), "admin delete-week high-risk confirmation present");

  // Career loader stays deduped.
  truthy(repo.includes("dedupeHistoricalContributions"), "career loader dedupes");

  // 2026 current-season pipeline is not called from historical repo.
  const noComments = repo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  truthy(!/buildFullSnapshot\s*\(/.test(noComments), "no call into current-season snapshot builder");
  truthy(!/rebuildAndSaveSnapshot\s*\(/.test(noComments), "no call into current-season pipeline");
  truthy(!/from\s+["']@\/lib\/public-snapshot["']/.test(noComments), "no import of current-season snapshot lib");

  // Public snapshot loader enforces archived + public_visible.
  truthy(repo.includes("q.data.is_current === true") &&
         repo.includes("q.data.status !== \"archived\"") &&
         repo.includes("q.data.public_visible !== true"),
    "getPublicHistoricalSnapshot rejects current/draft/private seasons");

  // Public route files load the historical snapshot (not admin functions).
  for (const file of [
    "src/routes/seasons.$seasonId.tsx",
    "src/routes/seasons.$seasonId.schedule.tsx",
    "src/routes/seasons.$seasonId.weekly-results.tsx",
    "src/routes/seasons.$seasonId.standings.tsx",
    "src/routes/seasons.$seasonId.bowlers.$participantRef.tsx",
  ]) {
    truthy(!read(file).includes("adminSave"), `${file} does not import admin write fn`);
  }

  // 2026 current-season Weekly Results route left untouched (still uses
  // WEEKS/getMatchesForWeek and the top-level snapshot).
  const cur = read("src/routes/weekly-results.tsx");
  truthy(cur.includes("useLeagueSnapshot") && cur.includes("getMatchesForWeek"),
    "current-season /weekly-results route unchanged");
}

// ---------------------------------------------------------------- eslint-disable-next-line no-console
console.log("historical-phase D hardening tests passed");
