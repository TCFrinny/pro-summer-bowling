/**
 * Source-level regression tests for the pending historical data phase
 * migration and the two public historical server readers.
 *
 * These are static/source assertions — the pending migration is not
 * applied here, so we cannot execute SQL. What we CAN verify is that
 * the SQL text and the server-fn source enforce the privacy contract:
 *
 *   • public week policy requires published = true
 *   • public slot/result policies join to a published historical week
 *   • no anon SELECT policy / grant remains on historical_season_snapshots
 *   • getPublicHistoricalSnapshot / getHistoricalCareerContributions load
 *     via supabaseAdmin (service role) and still call ensurePublicArchive
 *     + filterPublicHistoricalSnapshot before returning any data
 *   • admin policies and 2026 pipeline files remain unchanged
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migPath = resolve(__dirname, "../db/applied-migrations/20260717_100000_historical_data_phase.sql");
const repoPath = resolve(__dirname, "../src/lib/historical-repo.functions.ts");
const sql = readFileSync(migPath, "utf8");
const repo = readFileSync(repoPath, "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`historical-privacy: ${msg}`);
}

// Helper: pull the CREATE POLICY block for a given policy name.
function policyBlock(name: string): string {
  const re = new RegExp(
    `create policy "${name}"[^;]*;`,
    "i",
  );
  const m = sql.match(re);
  if (!m) throw new Error(`policy not found: ${name}`);
  return m[0];
}

// -------- (A) historical_weeks public policy requires published = true.
const weeksPub = policyBlock("public reads historical weeks");
assert(/season_is_public_archive\(season_id\)/.test(weeksPub),
  "weeks public policy must still gate on season_is_public_archive");
assert(/published\s*=\s*true/.test(weeksPub),
  "weeks public policy must require published = true");
// Idempotent recreation: drop-if-exists appears before the create.
assert(/drop policy if exists "public reads historical weeks" on public\.historical_weeks;\s*create policy "public reads historical weeks"/i.test(sql),
  "weeks public policy must be dropped+recreated for idempotence");

// -------- (B) historical_schedule_slots public policy joins to published week.
const slotsPub = policyBlock("public reads historical slots");
assert(/season_is_public_archive\(season_id\)/.test(slotsPub),
  "slots public policy must still gate on season_is_public_archive");
assert(/exists\s*\(\s*select 1 from public\.historical_weeks w[\s\S]*w\.id\s*=\s*historical_schedule_slots\.week_id[\s\S]*w\.season_id\s*=\s*historical_schedule_slots\.season_id[\s\S]*w\.published\s*=\s*true/i.test(slotsPub),
  "slots public policy must EXISTS-join to a published historical_weeks row");
assert(/drop policy if exists "public reads historical slots" on public\.historical_schedule_slots;/i.test(sql),
  "slots public policy must be dropped+recreated for idempotence");

// -------- (C) historical_match_results public policy joins to published week.
const resultsPub = policyBlock("public reads historical results");
assert(/season_is_public_archive\(season_id\)/.test(resultsPub),
  "results public policy must still gate on season_is_public_archive");
assert(/exists\s*\(\s*select 1 from public\.historical_weeks w[\s\S]*w\.id\s*=\s*historical_match_results\.week_id[\s\S]*w\.season_id\s*=\s*historical_match_results\.season_id[\s\S]*w\.published\s*=\s*true/i.test(resultsPub),
  "results public policy must EXISTS-join to a published historical_weeks row");
assert(/drop policy if exists "public reads historical results" on public\.historical_match_results;/i.test(sql),
  "results public policy must be dropped+recreated for idempotence");

// -------- (D) historical_season_snapshots: no anon SELECT policy or grant.
assert(!/create policy "public reads historical snapshot"/i.test(sql),
  "no public SELECT policy may remain on historical_season_snapshots");
assert(/drop policy if exists "public reads historical snapshot" on public\.historical_season_snapshots;/i.test(sql),
  "prior public snapshot policy must be dropped defensively");
assert(/revoke select on public\.historical_season_snapshots from anon/i.test(sql),
  "anon SELECT grant must be revoked from historical_season_snapshots");
assert(!/grant select\s+on public\.historical_season_snapshots to anon/i.test(sql),
  "no residual anon SELECT grant on historical_season_snapshots");
// Admin policies stay in place.
assert(/create policy "admin reads all historical snapshot"[\s\S]*has_role\(auth\.uid\(\), 'admin'\)/i.test(sql),
  "admin read policy on snapshots must be preserved");
assert(/create policy "admin writes historical snapshot"[\s\S]*season_is_historical_writable/i.test(sql),
  "admin write policy on snapshots must be preserved");

// -------- Admin read/write policies on weeks/slots/results untouched.
for (const t of ["weeks", "slots", "results"] as const) {
  assert(new RegExp(`create policy "admin reads all historical ${t}"[\\s\\S]*has_role\\(auth\\.uid\\(\\), 'admin'\\)`, "i").test(sql),
    `admin read policy on ${t} must be preserved`);
  assert(new RegExp(`create policy "admin writes historical ${t}"[\\s\\S]*season_is_historical_writable`, "i").test(sql),
    `admin write policy on ${t} must be preserved`);
}

// -------- (E) server readers use service-role client and still filter.
function funcBody(name: string): string {
  const idx = repo.indexOf(`export const ${name}`);
  if (idx < 0) throw new Error(`server fn not found: ${name}`);
  // Grab until the next top-level `export const` or EOF.
  const nextIdx = repo.indexOf("\nexport const ", idx + name.length);
  return repo.slice(idx, nextIdx === -1 ? undefined : nextIdx);
}

for (const fn of ["getPublicHistoricalSnapshot", "getHistoricalCareerContributions"] as const) {
  const body = funcBody(fn);
  assert(/await import\("@\/integrations\/supabase\/client\.server"\)/.test(body),
    `${fn} must lazy-import supabaseAdmin from client.server`);
  assert(/supabaseAdmin/.test(body),
    `${fn} must use supabaseAdmin (service-role)`);
  assert(!/makePublicClient\(\)/.test(body),
    `${fn} must not use the publishable/anon client`);
  assert(/filterPublicHistoricalSnapshot\(/.test(body),
    `${fn} must call filterPublicHistoricalSnapshot before returning data`);
}
// getPublicHistoricalSnapshot must gate on ensurePublicArchive; the career
// loader gates per-season via archived + public_visible filtering of seasonMeta.
assert(/ensurePublicArchive\(sb, data\.seasonId\)/.test(funcBody("getPublicHistoricalSnapshot")),
  "getPublicHistoricalSnapshot must call ensurePublicArchive");
assert(/status === "archived" && s\.public_visible/.test(funcBody("getHistoricalCareerContributions")),
  "getHistoricalCareerContributions must restrict to archived + public_visible seasons");

// -------- top-level import of client.server would leak into client bundle.
assert(!/^import[^\n]*client\.server/m.test(repo),
  "client.server must be lazy-imported inside handlers, never at module scope");

// -------- 2026 pipeline files are untouched — spot-check by presence.
for (const path of [
  "../src/lib/snapshot-builder.server.ts",
  "../src/lib/public-snapshot.tsx",
] as const) {
  const p = resolve(__dirname, path);
  const src = readFileSync(p, "utf8");
  assert(!/historical_season_snapshots/.test(src),
    `${path} must not reference historical snapshot storage`);
}

// eslint-disable-next-line no-console
console.log("historical-privacy migration + reader tests passed");
