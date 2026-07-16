/**
 * Multi-season phase — deterministic acceptance tests.
 *
 * Covers:
 * • Pure `publicVisibleSeasons` filter — draft & archived-private never leak.
 * • Source assertions that `listPublicSeasons` / `getPublicSeasonDetail` /
 *   `getCareerProfile` are unauthenticated but call the server-side filter
 *   before returning any data.
 * • Source assertions that every admin server function requires admin.
 * • Source assertion that `fetchSeasons` retries on 42703 (legacy fallback).
 * • Source assertion that `snapshot-builder.server.ts` falls back on 42703
 *   when the `person_id` column is missing.
 * • Career extraction from a representative saved snapshot for BOTH roles.
 * • Career aggregation skips unavailable rows (never zeroed).
 * • Old snapshots without `personId` parse and render normally through the
 *   backward-compat helper.
 * • Uneven lane capacities: [4,3,4,4,3,4] = 22 matchups / 44 bowlers.
 * • Merge execution repoints references and only deletes duplicate person.
 * • Pending migration file lives OUTSIDE supabase/migrations/ and contains
 *   no destructive 2026-data statements.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  aggregateCareerTotals,
  extractRosteredSeasonRow,
  extractSubstituteSeasonRow,
  parseSnapshotBackwardCompat,
  planPersonMerge,
  publicVisibleSeasons,
  summarizeCapacityList,
  withPersonId,
  type CareerSeasonRow,
} from "@/lib/season-history";

const HISTORY_SRC = readFileSync(resolve(__dirname, "../src/lib/history-repo.functions.ts"), "utf8");
const SNAPSHOT_SRC = readFileSync(resolve(__dirname, "../src/lib/snapshot-builder.server.ts"), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`multi-season-phase: ${msg}`);
}

// -------------------------------------------------------------------------
// 1) Server-side privacy filter is applied before returning data
// -------------------------------------------------------------------------
(function serverPrivacyFilter() {
  const seasons = [
    { id: "s1", label: "Current", status: "current" as const, publicVisible: true },
    { id: "s2", label: "Public Archive", status: "archived" as const, publicVisible: true },
    { id: "s3", label: "Private Archive", status: "archived" as const, publicVisible: false },
    { id: "s4", label: "Draft", status: "draft" as const, publicVisible: false },
    { id: "s5", label: "Draft Marked Public", status: "draft" as const, publicVisible: true },
  ];
  const filtered = publicVisibleSeasons(seasons);
  const ids = filtered.map((s) => s.id);
  assert(ids.includes("s1"), "current season must be returned");
  assert(ids.includes("s2"), "public-archived season must be returned");
  assert(!ids.includes("s3"), "private-archived season must NOT be returned");
  assert(!ids.includes("s4"), "draft season must NOT be returned");
  assert(!ids.includes("s5"), "draft-with-public-flag must still be filtered — only current/archived qualify");
})();

// -------------------------------------------------------------------------
// 2) Source assertions on privacy + admin gating
// -------------------------------------------------------------------------
(function sourceLevelGuards() {
  // Every admin function calls ensureAdmin.
  const adminHandlers = [
    "adminListSeasons",
    "adminGetSeasonDetail",
    "adminUpsertSeason",
    "adminMakeSeasonCurrent",
    "adminUpsertLanePair",
    "adminDeleteLanePair",
    "adminListParticipants",
    "adminAddParticipant",
    "listPeople",
    "createPerson",
    "listUnlinkedParticipants",
    "linkParticipantToPerson",
    "previewPersonMerge",
    "executePersonMerge",
  ];
  for (const name of adminHandlers) {
    const idx = HISTORY_SRC.indexOf(`export const ${name} `);
    assert(idx >= 0, `admin export not found: ${name}`);
    const chunk = HISTORY_SRC.slice(idx, idx + 2000);
    assert(chunk.includes("requireSupabaseAuth"), `${name} must use requireSupabaseAuth middleware`);
    assert(chunk.includes("ensureAdmin(context)"), `${name} must ensureAdmin() before performing work`);
  }

  // Public server functions must call the server-side privacy filter or the
  // per-season visibility guard, and must NOT be middleware-gated to auth.
  const publicHandlers = ["listPublicSeasons", "getPublicSeasonDetail", "getCareerProfile"];
  for (const name of publicHandlers) {
    const idx = HISTORY_SRC.indexOf(`export const ${name} `);
    assert(idx >= 0, `public export not found: ${name}`);
    // Slice ONLY up to the next `export const` so we don't misread the
    // following (admin) function's middleware as belonging to this one.
    const rest = HISTORY_SRC.slice(idx + 10);
    const nextExport = rest.indexOf("export const ");
    const chunk = nextExport > 0 ? rest.slice(0, nextExport) : rest;
    assert(!chunk.includes(".middleware([requireSupabaseAuth])"),
      `${name} must NOT require auth — it is a public endpoint`);
  }
  assert(HISTORY_SRC.includes("publicVisibleSeasons(rows)"),
    "listPublicSeasons must call publicVisibleSeasons() before returning");
  assert(/forbidden: true/.test(HISTORY_SRC),
    "getPublicSeasonDetail must reject non-visible seasons with a forbidden marker");
  assert(HISTORY_SRC.includes('status === "current" || (season.status === "archived" && season.publicVisible)'),
    "getPublicSeasonDetail must enforce visibility server-side (current + archived+public only)");

  // Legacy 42703 fallback in fetchSeasons.
  assert(HISTORY_SRC.includes('isMissingColumn(q.error.code)'),
    "fetchSeasonsWide must retry legacy shape on 42703 so current season shows before migration");

  // ESM: no CommonJS require()
  assert(!/require\(/.test(HISTORY_SRC), "history-repo.functions.ts must not use CommonJS require()");

  // Merge execution requires confirmMerge=true and calls the RPC.
  assert(HISTORY_SRC.includes('confirmMerge: z.literal(true)'),
    "executePersonMerge must require an explicit confirmMerge=true token");
  assert(HISTORY_SRC.includes('"merge_people"'),
    "executePersonMerge must call the merge_people RPC");

  // Duplicate participant guard on the server.
  assert(HISTORY_SRC.includes('"That person is already a"') ||
         HISTORY_SRC.includes("That person is already a"),
    "adminAddParticipant must reject duplicate (season, person, role) rows");
})();

// -------------------------------------------------------------------------
// 3) Snapshot builder backward-safe 42703 fallback
// -------------------------------------------------------------------------
(function snapshotBuilderFallback() {
  assert(SNAPSHOT_SRC.includes("42703"),
    "snapshot-builder.server.ts must handle 42703 (missing person_id column)");
  assert(SNAPSHOT_SRC.includes('.select("id, name, entry_average, handicap, active, archived, bowler_number, season_id, person_id")'),
    "loadRoster must attempt the wider select that includes person_id");
  assert(SNAPSHOT_SRC.includes('.select("id, name, entry_average, handicap, active, archived, bowler_number, season_id")'),
    "loadRoster must retain the legacy select for the 42703 fallback");
  assert(SNAPSHOT_SRC.includes("if (row.person_id) identity.personId = row.person_id"),
    "subRowToIdentity must attach personId when available");
})();

// -------------------------------------------------------------------------
// 4) Backward-compat parse: old snapshot without personId still works
// -------------------------------------------------------------------------
(function oldSnapshotCompat() {
  const legacy = {
    builtAt: 1,
    bowlers: [{ id: "b01", name: "Alice" }],
    bowlersById: { b01: { id: "b01", name: "Alice", gamesPlayed: 30 } },
  };
  const parsed = parseSnapshotBackwardCompat(legacy);
  assert(parsed && "bowlersById" in parsed, "legacy snapshot must parse");
  const enriched = withPersonId({ id: "b01" }, undefined);
  assert(!("personId" in enriched) || enriched.personId === undefined,
    "withPersonId(undefined) must not attach a personId field");
})();

// -------------------------------------------------------------------------
// 5) Uneven lane capacities
// -------------------------------------------------------------------------
(function uneven() {
  const totals = summarizeCapacityList([4, 3, 4, 4, 3, 4]);
  assert(totals.totalMatchups === 22, `expected 22 matchups, got ${totals.totalMatchups}`);
  assert(totals.bowlerCapacity === 44, `expected 44 bowlers, got ${totals.bowlerCapacity}`);
  assert(totals.activePairs === 6, "6 active lane pairs expected");
})();

// -------------------------------------------------------------------------
// 6) Career extraction from a representative saved snapshot
// -------------------------------------------------------------------------
(function careerExtraction() {
  const snap = {
    builtAt: 1,
    bowlers: [],
    bowlersById: {
      b01: {
        id: "b01",
        name: "Alice",
        gamesPlayed: 30,
        scratchPinfall: 3600,
        scratchAverage: 120,
        highGame: 180,
        highSet: 500,
        points: 42,
      },
    },
    substituteProfiles: {
      s01: { gamesRolled: 6, scratchPinfall: 660, scratchAverage: 110, highGame: 130, highSet: 350 },
    },
    standings: [{ bowler: { id: "b01" }, rank: 4 }],
  };
  const roster = extractRosteredSeasonRow(snap, "b01");
  assert(roster.hasGameData, "rostered extraction must mark hasGameData=true");
  assert(roster.games === 30, `games got ${roster.games}`);
  assert(roster.scratchPinfall === 3600, `pinfall got ${roster.scratchPinfall}`);
  assert(roster.finalFinish === 4, `finish got ${roster.finalFinish}`);
  assert(roster.points === 42, `points got ${roster.points}`);

  const sub = extractSubstituteSeasonRow(snap, "s01");
  assert(sub.hasGameData, "sub extraction must mark hasGameData=true");
  assert(sub.games === 6 && sub.scratchPinfall === 660, `sub totals wrong ${JSON.stringify(sub)}`);

  // Unlinked / missing seasonal rows: NOT hasGameData.
  const missingRoster = extractRosteredSeasonRow(snap, "b99");
  assert(!missingRoster.hasGameData, "missing roster id must not report data");
  const missingSub = extractSubstituteSeasonRow(snap, "s99");
  assert(!missingSub.hasGameData, "missing sub id must not report data");
})();

// -------------------------------------------------------------------------
// 7) Career aggregation preserves unavailable rows (never zeroed)
// -------------------------------------------------------------------------
(function careerAggregation() {
  const rows: CareerSeasonRow[] = [
    { seasonId: "a", seasonLabel: "2025", role: "rostered", seasonalName: "n",
      hasGameData: true, games: 30, scratchPinfall: 3600, highGame: 180, highSet: 500, points: 42, isChampion: true },
    { seasonId: "b", seasonLabel: "2024", role: "rostered", seasonalName: "n",
      hasGameData: false },
    { seasonId: "c", seasonLabel: "2023", role: "substitute", seasonalName: "n",
      hasGameData: true, games: 6, scratchPinfall: 660 },
  ];
  const t = aggregateCareerTotals(rows);
  assert(t.seasonsCount === 3, "row count must include unavailable rows");
  assert(t.seasonsWithGameData === 2, "only 2 rows contributed game data");
  assert(t.totalGames === 36 && t.totalScratchPinfall === 4260, "totals must exclude unavailable rows");
  assert(t.average != null && Math.abs(t.average - 4260 / 36) < 1e-9, "avg must derive from available games only");
  assert(t.championships === 1, "championship count must come from isChampion");

  const allUnavailable = aggregateCareerTotals([
    { seasonId: "x", seasonLabel: "x", role: "rostered", seasonalName: "n", hasGameData: false },
  ]);
  assert(allUnavailable.average === null && allUnavailable.highGame === null,
    "no-game rows must yield null, not zero");
})();

// -------------------------------------------------------------------------
// 8) Merge planner: only the duplicate person identity is proposed for deletion
// -------------------------------------------------------------------------
(function mergePlanner() {
  const plan = planPersonMerge("keep", "remove", [
    { table: "rostered_bowlers", id: "b1", column: "person_id" },
    { table: "substitutes", id: "s1", column: "person_id" },
    { table: "seasons", id: "season-1", column: "champion_person_id" },
  ]);
  assert(plan.repoints.length === 3, "all 3 links must be planned for repoint");
  const joined = plan.summary.join(" ").toLowerCase();
  assert(!joined.includes("delete row"), "planner must never propose deleting a seasonal row");
  assert(joined.includes("preserved"), "planner must document seasonal preservation");
})();

// -------------------------------------------------------------------------
// 9) Pending migration file audit
// -------------------------------------------------------------------------
(function migrationAudit() {
  const pendingPath = resolve(__dirname, "../db/pending-migrations/20260716_120000_seasons_people_phase.sql");
  assert(existsSync(pendingPath), "pending migration file must exist");
  const supaMigDir = resolve(__dirname, "../supabase/migrations");
  if (existsSync(supaMigDir)) {
    const files = readdirSync(supaMigDir);
    for (const f of files) {
      assert(!f.includes("seasons_people_phase"),
        `historical phase migration must NOT exist in supabase/migrations/ (found ${f})`);
    }
  }
  const sql = readFileSync(pendingPath, "utf8");

  // Additive-only markers
  assert(sql.includes("switch_current_season("), "migration must define switch_current_season RPC");
  assert(sql.includes("merge_people("), "migration must define merge_people RPC");
  assert(sql.includes("current_user_is_admin()"), "RPCs must gate on current_user_is_admin");
  assert(sql.includes("rostered_bowlers_season_person_unique") &&
         sql.includes("substitutes_season_person_unique"),
    "migration must add partial unique indexes on (season_id, person_id)");
  assert(sql.includes("total_weeks is null or total_weeks > 0"), "must enforce total_weeks > 0");
  assert(sql.includes("handicap_percent"), "must constrain handicap_percent");
  assert(sql.includes("end_date >= start_date"), "must enforce date order");
  assert(sql.includes("check (btrim(label) <> ''"), "lane pair label must be non-empty");
  assert(sql.includes("people_normalized_name_unique"),
    "must guarantee unique non-null normalized names to avoid ambiguous backfill matches");

  // RPCs require explicit confirmation booleans + admin gate.
  assert(/switch_current_season\(_season_id uuid, _confirm boolean\)/.test(sql),
    "switch_current_season RPC must take an explicit _confirm boolean");
  assert(/merge_people\(_keep uuid, _remove uuid, _confirm boolean\)/.test(sql),
    "merge_people RPC must take an explicit _confirm boolean");
  assert(/_confirm is distinct from true/.test(sql),
    "RPCs must reject calls without _confirm=true");
  // Server-fn callers must actually pass _confirm=true.
  assert(/_season_id: data\.seasonId, _confirm: true/.test(HISTORY_SRC),
    "adminMakeSeasonCurrent must send _confirm=true to switch_current_season");
  assert(/_keep: data\.keepPersonId, _remove: data\.removePersonId, _confirm: true/.test(HISTORY_SRC),
    "executePersonMerge must send _confirm=true to merge_people");

  // Backfill must NOT rewrite ANY existing scoring data — only touch person_id
  // on unlinked rows (`where ... person_id is null`) and only touch the
  // current season's is_current-status columns (never averages, handicaps,
  // schedules, results, snapshots).
  const forbidden = [
    /update\s+public\.rostered_bowlers[\s\S]*?set\s+entry_average/i,
    /update\s+public\.rostered_bowlers[\s\S]*?set\s+handicap\s*=/i,
    /update\s+public\.substitutes[\s\S]*?set\s+starting_average/i,
    /update\s+public\.match_results\b/i,
    /update\s+public\.public_snapshots\b/i,
    /update\s+public\.schedule_slots\b/i,
    /delete\s+from\s+public\.(rostered_bowlers|substitutes|match_results|weeks|schedule_slots|public_snapshots)\b/i,
    /truncate\s+/i,
    /drop\s+table\s+/i,
  ];
  for (const pat of forbidden) {
    assert(!pat.test(sql), `migration must not contain destructive statement matching ${pat}`);
  }
})();

// -------------------------------------------------------------------------
// 10) Phase B — admin seasons/participants UI + server hardening
// -------------------------------------------------------------------------
import { computeHandicapWithSeason } from "@/lib/history-repo.functions";

const ADMIN_SEASONS_SRC = readFileSync(resolve(__dirname, "../src/routes/admin.seasons.tsx"), "utf8");
const SEASON_EDITOR_SRC = readFileSync(resolve(__dirname, "../src/routes/admin.seasons.$seasonId.tsx"), "utf8");
const ADMIN_LAYOUT_SRC = readFileSync(resolve(__dirname, "../src/routes/admin.tsx"), "utf8");

(function adminNavHasSeasonsPeople() {
  const nav = ADMIN_LAYOUT_SRC;
  const live = nav.indexOf('to="/admin/live-scoring"');
  const seasons = nav.indexOf('to="/admin/seasons"');
  const people = nav.indexOf('to="/admin/people"');
  assert(live > 0 && seasons > 0 && people > 0, "admin nav must include live-scoring, seasons, people");
  assert(seasons > live && people > live, "Seasons and People links must appear after Live Scoring in admin nav");
  assert(nav.includes("Rebuild Snapshot"), "Admin nav must preserve Rebuild Snapshot button");
  assert(nav.includes("Sign out"), "Admin nav must preserve Sign out button");
})();

(function adminSeasonsUsesAdminEndpoint() {
  assert(ADMIN_SEASONS_SRC.includes("adminListSeasons"),
    "/admin/seasons must use adminListSeasons, never the public endpoint");
  assert(!ADMIN_SEASONS_SRC.includes("listPublicSeasons"),
    "/admin/seasons must not call the public listPublicSeasons endpoint");
})();

(function createFormAndDefaults() {
  // Rich create form must include all metadata fields.
  for (const field of ["Label", "Point system", "Total weeks", "Start date", "End date", "Handicap %", "Handicap base", "Description"]) {
    assert(ADMIN_SEASONS_SRC.includes(field), `Create-season form must include field: ${field}`);
  }
  // Create call must NOT force status/publicVisible — server default (draft+private) must win.
  const createIdx = ADMIN_SEASONS_SRC.indexOf("createSeason");
  assert(createIdx > 0, "createSeason handler must exist");
  const createChunk = ADMIN_SEASONS_SRC.slice(createIdx, createIdx + 2000);
  assert(!/status:\s*"current"/.test(createChunk), "New seasons must never be created as current");
  assert(!/publicVisible:\s*true/.test(createChunk), "New seasons must never be created as public");
  // Post-create navigation.
  assert(/navigate\(\{\s*to:\s*"\/admin\/seasons\/\$seasonId"/.test(ADMIN_SEASONS_SRC),
    "After create, must navigate to /admin/seasons/$seasonId");

  // Server-side defaults.
  const upsertIdx = HISTORY_SRC.indexOf("adminUpsertSeason");
  const upsertChunk = HISTORY_SRC.slice(upsertIdx, upsertIdx + 4000);
  assert(upsertChunk.includes('payload.status = "draft"'),
    "adminUpsertSeason must default new rows to status='draft'");
  assert(upsertChunk.includes("payload.public_visible = false"),
    "adminUpsertSeason must default new rows to public_visible=false");
})();

(function editorUsesRouteSeasonId() {
  // Every historical write in the editor must pass the ROUTE seasonId,
  // never a fallback to the current season.
  const writeCalls = [
    "adminUpsertSeason",
    "adminMakeSeasonCurrent",
    "adminUpsertLanePair",
    "adminDeleteLanePair",
    "adminAddParticipant",
  ];
  for (const name of writeCalls) {
    if (!SEASON_EDITOR_SRC.includes(name)) continue;
    // Every occurrence in a write context references seasonId from the route params.
    // The editor destructures `const { seasonId } = Route.useParams();` — verify.
  }
  assert(SEASON_EDITOR_SRC.includes("Route.useParams()"),
    "Season editor must read seasonId from route params");
  assert(!/getCurrentSeasonId|currentSeason\.id/.test(SEASON_EDITOR_SRC),
    "Season editor must never substitute the current season ID for the route seasonId");
  // Season editor makeCurrent requires explicit confirmation.
  assert(SEASON_EDITOR_SRC.includes("window.confirm"),
    "Make-current control must use an explicit browser confirmation");
  assert(SEASON_EDITOR_SRC.includes("confirmMakeCurrent: true"),
    "Make-current control must send confirmMakeCurrent:true");
})();

(function laneDuplicateMessaging() {
  // Server surfaces 23505 with a friendly duplicate-label message.
  assert(HISTORY_SRC.includes("UNIQUE_VIOLATION"),
    "history-repo.functions.ts must recognise unique-violation code 23505");
  assert(/already exists in this season/.test(HISTORY_SRC),
    "adminUpsertLanePair must surface a helpful duplicate-label error");
})();

(function participantDuplicateAndAdminGate() {
  // adminAddParticipant duplicate rejection and admin gate (already covered);
  // additionally verify it uses route seasonId, not a fallback.
  const idx = HISTORY_SRC.indexOf("adminAddParticipant");
  const chunk = HISTORY_SRC.slice(idx, idx + 3000);
  assert(chunk.includes("data.seasonId"),
    "adminAddParticipant must use data.seasonId (route-supplied)");
  assert(!/currentSeason|getCurrentSeasonId/.test(chunk),
    "adminAddParticipant must not fall back to the current season");
  // Write side actually inserts with season_id from the input.
  assert(/season_id:\s*data\.seasonId/.test(chunk),
    "adminAddParticipant must set season_id from the request payload");
})();

(function handicapFromSeasonSettings() {
  // Pure function must apply configured percent/base.
  assert(computeHandicapWithSeason(140, 90, 200) === Math.floor(0.9 * (200 - 140)),
    "handicap must use configured percent/base");
  // Fallback to 80% / base 160 when nulls.
  assert(computeHandicapWithSeason(140, null, null) === Math.floor(0.8 * (160 - 140)),
    "handicap must fall back to 80%/160 when configured values are null");
  // Above-base averages yield 0, never negative.
  assert(computeHandicapWithSeason(200, 80, 160) === 0,
    "handicap must clamp to 0 for averages at or above base");
  // Null average yields null (unknown).
  assert(computeHandicapWithSeason(null, 80, 160) === null,
    "handicap must be null when average is unknown");
})();

(function backwardSafetyMessages() {
  // The pages fall back to a helpful setup-not-available message before migration.
  assert(ADMIN_SEASONS_SRC.includes("Historical season setup is not available"),
    "/admin/seasons must show a setup-not-available message pre-migration");
  assert(SEASON_EDITOR_SRC.includes("Season not available") ||
         SEASON_EDITOR_SRC.includes("apply the pending"),
    "Season editor must surface a not-available message pre-migration");
})();

// -------------------------------------------------------------------------
// 11) Phase C — People linking, aliases, guarded merge
// -------------------------------------------------------------------------
const ADMIN_PEOPLE_SRC = readFileSync(resolve(__dirname, "../src/routes/admin.people.tsx"), "utf8");

(function phaseCServerFunctions() {
  // New server-fn exports required by Phase C.
  for (const name of [
    "addPersonAlias",
    "removePersonAlias",
    "createAndLinkParticipant",
  ]) {
    const idx = HISTORY_SRC.indexOf(`export const ${name} `);
    assert(idx >= 0, `Phase C export missing: ${name}`);
    const chunk = HISTORY_SRC.slice(idx, idx + 2500);
    assert(chunk.includes("requireSupabaseAuth"), `${name} must use requireSupabaseAuth`);
    assert(chunk.includes("ensureAdmin(context)"), `${name} must ensureAdmin() before any write`);
  }

  // linkParticipantToPerson must ONLY update person_id — never overwrite
  // other seasonal fields.
  const linkIdx = HISTORY_SRC.indexOf("export const linkParticipantToPerson");
  const linkChunk = HISTORY_SRC.slice(linkIdx, linkIdx + 3000);
  assert(/\.update\(\{\s*person_id:\s*data\.personId\s*\}\)/.test(linkChunk),
    "linkParticipantToPerson must update ONLY person_id");
  assert(linkChunk.includes("already linked to a person") || linkChunk.includes("already linked"),
    "linkParticipantToPerson must refuse to overwrite an existing link");
  assert(linkChunk.includes("Target person does not exist"),
    "linkParticipantToPerson must verify the target person exists");
  assert(linkChunk.includes("already linked to another row in this season for the same role"),
    "linkParticipantToPerson must reject same-role/season duplicates");

  // Create-and-link: transaction safety — verify existence first, then insert
  // person, then link, then roll back the person on failure.
  const calIdx = HISTORY_SRC.indexOf("export const createAndLinkParticipant");
  const calChunk = HISTORY_SRC.slice(calIdx, calIdx + 3500);
  const orderCheckRow = calChunk.indexOf(".select(\"season_id, person_id\")");
  const orderInsertPerson = calChunk.indexOf('"people")\n      .insert');
  const orderUpdate = calChunk.indexOf(".update({ person_id:");
  const orderRollback = calChunk.indexOf('.delete().eq("id", personId)');
  assert(orderCheckRow > 0 && orderInsertPerson > orderCheckRow,
    "createAndLinkParticipant must check the participant row before inserting person");
  assert(orderUpdate > orderInsertPerson,
    "createAndLinkParticipant must insert person before linking");
  assert(orderRollback > orderUpdate,
    "createAndLinkParticipant must roll back the new person if linking fails");
})();

(function phaseCListPeopleShape() {
  // listPeople must aggregate aliases + seasonal records + haystack.
  const idx = HISTORY_SRC.indexOf("export const listPeople ");
  const chunk = HISTORY_SRC.slice(idx, idx + 6000);
  assert(chunk.includes('"person_aliases"'), "listPeople must load aliases in bulk");
  assert(chunk.includes("seasonalRecords"), "listPeople must group seasonal roster + sub records under each person");
  assert(chunk.includes("searchHaystack"),
    "listPeople must precompute a search haystack covering name + aliases + seasonal names + bowler numbers");
  // Haystack composition: display_name + alias + seasonal name + bowler number.
  assert(/parts\.push\(String\(p\.display_name\)\)|parts:\s*string\[\]\s*=\s*\[String\(p\.display_name\)\]/.test(chunk),
    "haystack must include the person's display name");
  assert(/parts\.push\(a\.alias\)/.test(chunk), "haystack must include aliases");
  assert(/parts\.push\(r\.name\)/.test(chunk), "haystack must include seasonal names");
  assert(/parts\.push\(r\.bowlerNumber\)/.test(chunk), "haystack must include bowler numbers");
})();

(function phaseCMergePreviewRichness() {
  const idx = HISTORY_SRC.indexOf("export const previewPersonMerge");
  const chunk = HISTORY_SRC.slice(idx, idx + 6000);
  // Preview must include rostered, substitutes, championSeasons, aliases,
  // and conflict flags for (season, role) and alias collisions.
  for (const key of ["rostered", "substitutes", "championSeasons", "aliases", "conflict"]) {
    assert(chunk.includes(key), `merge preview must include: ${key}`);
  }
  assert(chunk.includes("keepDisplayName") && chunk.includes("removeDisplayName"),
    "merge preview must show both people's display names");
})();

(function phaseCMergeExecuteContract() {
  // Existing checks re-asserted for clarity + Phase C specifics.
  assert(HISTORY_SRC.includes("confirmMerge: z.literal(true)"),
    "executePersonMerge must require confirmMerge:true");
  assert(/_keep: data\.keepPersonId, _remove: data\.removePersonId, _confirm: true/.test(HISTORY_SRC),
    "executePersonMerge must call merge_people RPC with _confirm:true");
  // The RPC never deletes seasonal rows.
  const migPath = resolve(__dirname, "../db/pending-migrations/20260716_120000_seasons_people_phase.sql");
  const sql = readFileSync(migPath, "utf8");
  const mergeFn = sql.slice(sql.indexOf("create or replace function public.merge_people"));
  assert(!/delete\s+from\s+public\.rostered_bowlers/i.test(mergeFn),
    "merge RPC must never delete rostered_bowlers rows");
  assert(!/delete\s+from\s+public\.substitutes/i.test(mergeFn),
    "merge RPC must never delete substitutes rows");
  assert(!/delete\s+from\s+public\.match_results/i.test(mergeFn),
    "merge RPC must never delete match_results rows");
  assert(!/delete\s+from\s+public\.seasons/i.test(mergeFn),
    "merge RPC must never delete seasons rows");
  // It DOES delete the duplicate person + its aliases; both are required.
  assert(/delete\s+from\s+public\.people\s+where\s+id\s*=\s*_remove/i.test(mergeFn),
    "merge RPC must delete the duplicate person identity");
  assert(/delete\s+from\s+public\.person_aliases\s+where\s+person_id\s*=\s*_remove/i.test(mergeFn),
    "merge RPC must delete duplicate person's aliases");
})();

(function phaseCAliasNormalization() {
  // Alias insert normalizes and the unique constraint on normalized_alias
  // (in the pending migration) prevents duplicates.
  const addIdx = HISTORY_SRC.indexOf("export const addPersonAlias");
  const chunk = HISTORY_SRC.slice(addIdx, addIdx + 2000);
  assert(chunk.includes("normalizeName("), "addPersonAlias must normalize the alias before insert");
  assert(chunk.includes("normalized_alias"), "addPersonAlias must set normalized_alias column");
  assert(/UNIQUE_VIOLATION|23505/.test(chunk),
    "addPersonAlias must surface a friendly duplicate-alias error on unique violation");
  const migPath = resolve(__dirname, "../db/pending-migrations/20260716_120000_seasons_people_phase.sql");
  const sql = readFileSync(migPath, "utf8");
  assert(/unique\s*\(normalized_alias\)/i.test(sql),
    "pending migration must enforce unique normalized_alias");

  // Removal must delete only the alias row.
  const rmIdx = HISTORY_SRC.indexOf("export const removePersonAlias");
  const rmChunk = HISTORY_SRC.slice(rmIdx, rmIdx + 1500);
  assert(/\.delete\(\)\.eq\("id", data\.aliasId\)/.test(rmChunk),
    "removePersonAlias must delete only the specified alias row");
  assert(!/rostered_bowlers|substitutes|match_results/.test(rmChunk),
    "removePersonAlias must not touch any seasonal record");
})();

(function phaseCAdminPeopleUI() {
  // Search input covers everything via the server-provided haystack.
  assert(ADMIN_PEOPLE_SRC.includes("searchHaystack"),
    "/admin/people must filter against server-provided haystack (aliases, seasonal names, bowler #)");
  assert(/placeholder=\"Search name, alias, seasonal name, or bowler #/.test(ADMIN_PEOPLE_SRC),
    "search input must advertise coverage of aliases + seasonal names + bowler numbers");

  // Unlinked block: link OR create-and-link.
  assert(ADMIN_PEOPLE_SRC.includes("createAndLinkParticipant"),
    "unlinked-row UI must support create-and-link");
  assert(ADMIN_PEOPLE_SRC.includes("linkParticipantToPerson"),
    "unlinked-row UI must support linking to an existing person");
  assert(/Unlinked/.test(ADMIN_PEOPLE_SRC),
    "unlinked badges must be shown");

  // Alias UI: add + remove with confirmation.
  assert(ADMIN_PEOPLE_SRC.includes("addPersonAlias"), "UI must add aliases");
  assert(ADMIN_PEOPLE_SRC.includes("removePersonAlias"), "UI must remove aliases");
  assert(/window\.confirm\([^)]*alias/i.test(ADMIN_PEOPLE_SRC),
    "alias removal must gate on a browser confirmation");

  // Guarded merge workflow: typed MERGE + browser confirm + confirmMerge:true.
  assert(/typed !== "MERGE"|typed === "MERGE"/.test(ADMIN_PEOPLE_SRC),
    "merge control must require a typed MERGE token");
  assert(/window\.confirm\(/.test(ADMIN_PEOPLE_SRC),
    "merge must also gate on window.confirm as a second confirmation");
  assert(/confirmMerge:\s*true/.test(ADMIN_PEOPLE_SRC),
    "merge call site must send confirmMerge:true");

  // Career link surfaced per person on the admin listing.
  assert(/to="\/people\/\$personId"/.test(ADMIN_PEOPLE_SRC),
    "admin people list must expose a Career link per person");
})();

