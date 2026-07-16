/**
 * Server functions for the multi-season history / permanent-people phase.
 *
 * PRIVACY MODEL
 * ─────────────
 * • `listPublicSeasons` / `getPublicSeasonDetail` / `getCareerProfile` are
 *   unauthenticated. Each one filters draft and archived-but-private seasons
 *   on the SERVER via `publicVisibleSeasons` before returning anything. An
 *   arbitrary UUID never leaks a draft or private season.
 * • Every `admin*` function requires the authenticated user to hold the
 *   'admin' role (verified through `current_user_is_admin()` RPC).
 *
 * BACKWARD SAFETY
 * ───────────────
 * • When the pending migration is not yet applied the additive columns are
 *   missing (Postgres 42703). We retry the query using the legacy shape so
 *   the current 2026 season still surfaces on the public Seasons page.
 * • When the new tables (`people`, `season_lane_pairs`) are missing (42P01)
 *   the corresponding admin/public pages render an "historical setup not
 *   available yet" message — the CURRENT-SEASON app is never affected.
 *
 * NO current-season snapshot, standings, elimination, schedule, or
 * live-scoring code is touched by any function in this file.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  extractRosteredSeasonRow,
  extractSubstituteSeasonRow,
  normalizeName,
  parseSnapshotBackwardCompat,
  planPersonMerge,
  publicVisibleSeasons,
  type CareerSeasonRow,
  type PersonLink,
  type SeasonRecord,
} from "@/lib/season-history";

type Sb = SupabaseClient<Database>;
type AuthedCtx = { supabase: Sb; userId: string };

const MISSING_TABLE = "42P01";
const MISSING_COLUMN = "42703";

function isMissingTable(code: string | undefined | null): boolean {
  return code === MISSING_TABLE;
}
function isMissingColumn(code: string | undefined | null): boolean {
  return code === MISSING_COLUMN;
}

async function ensureAdmin(context: AuthedCtx): Promise<void> {
  const { data, error } = await context.supabase.rpc("current_user_is_admin");
  if (error) throw new Error(`admin check failed: ${error.message}`);
  if (data !== true) throw new Error("Forbidden: admin role required");
}

// ---------------- Server-side publishable client (public reads) ----------------

// Cached across invocations on the same worker. Reads process.env at first
// use — never at module scope — so unset env doesn't crash the module.
let _publicClient: Sb | undefined;
function makePublicClient(): Sb {
  if (_publicClient) return _publicClient;
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL) ?? "";
  const key =
    (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY) ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not configured");
  _publicClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      // New sb_publishable_* keys are opaque, NOT JWTs. Strip the default
      // Bearer header PostgREST would otherwise reject as "Expected 3 parts
      // in JWT; got 1". Send them via `apikey` only.
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (
          (key.startsWith("sb_publishable_") || key.startsWith("sb_secret_")) &&
          headers.get("Authorization") === `Bearer ${key}`
        ) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
  return _publicClient;
}

// Generated types don't know about the new columns/tables yet.
type LooseFrom = (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------- Season fetch (shared) ----------------

export interface SeasonListResult {
  available: boolean;
  seasons: SeasonRecord[];
  bowlerCounts: Record<string, number>;
}

async function fetchSeasonsWide(sb: Sb): Promise<{ available: boolean; rows: SeasonRecord[] }> {
  const q = await (sb.from as unknown as LooseFrom)("seasons")
    .select(
      "id,label,is_current,status,public_visible,start_date,end_date,total_weeks,point_system,handicap_percent,handicap_base,champion_person_id,description",
    )
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("label", { ascending: false });

  if (!q.error) {
    return {
      available: true,
      rows: (q.data ?? []).map(mapWideSeason),
    };
  }
  // Table entirely missing — should be impossible (seasons always exists),
  // but fall through cleanly if it ever happens.
  if (isMissingTable(q.error.code)) return { available: false, rows: [] };
  // Missing new columns → retry legacy shape. Current 2026 season still shows.
  if (isMissingColumn(q.error.code)) {
    const legacy = await sb.from("seasons").select("id,label,is_current").order("label", { ascending: false });
    if (legacy.error) throw new Error(legacy.error.message);
    return {
      available: false,
      rows: (legacy.data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        status: r.is_current ? ("current" as const) : ("archived" as const),
        publicVisible: !!r.is_current,
        isCurrent: !!r.is_current,
      })),
    };
  }
  throw new Error(q.error.message);
}

function mapWideSeason(r: Record<string, unknown>): SeasonRecord {
  return {
    id: String(r.id),
    label: String(r.label ?? ""),
    status: (r.status as SeasonRecord["status"]) ?? (r.is_current ? "current" : "draft"),
    publicVisible: r.public_visible === true || (r.status == null && r.is_current === true),
    isCurrent: r.is_current === true,
    startDate: (r.start_date as string | null) ?? null,
    endDate: (r.end_date as string | null) ?? null,
    totalWeeks: (r.total_weeks as number | null) ?? null,
    pointSystem: (r.point_system as 4 | 7 | null) ?? null,
    handicapPercent: (r.handicap_percent as number | null) ?? null,
    handicapBase: (r.handicap_base as number | null) ?? null,
    championPersonId: (r.champion_person_id as string | null) ?? null,
    description: (r.description as string | null) ?? null,
  };
}

async function fetchBowlerCounts(sb: Sb, seasonIds: string[]): Promise<Record<string, number>> {
  if (seasonIds.length === 0) return {};
  const q = await sb
    .from("rostered_bowlers")
    .select("season_id")
    .in("season_id", seasonIds);
  if (q.error) return {};
  const counts: Record<string, number> = {};
  for (const row of q.data ?? []) {
    const id = String((row as { season_id: string }).season_id);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

// ---------------- PUBLIC: list seasons (privacy-filtered on server) --------

export const listPublicSeasons = createServerFn({ method: "GET" }).handler(async () => {
  const sb = makePublicClient();
  const { available, rows } = await fetchSeasonsWide(sb);
  // SERVER-SIDE PRIVACY: draft or archived-but-private seasons are never
  // returned to unauthenticated clients.
  const publicRows = publicVisibleSeasons(rows);
  const counts = available ? await fetchBowlerCounts(sb, publicRows.map((r) => r.id)) : {};
  return { available, seasons: publicRows, bowlerCounts: counts } as SeasonListResult;
});

// ---------------- PUBLIC: season detail (server-enforced visibility) -------

export interface SeasonLanePairRow {
  id: string;
  label: string;
  displayOrder: number;
  matchupCapacity: number;
  active: boolean;
}

export interface SeasonDetailResult {
  available: boolean;
  season: SeasonRecord | null;
  lanePairs: SeasonLanePairRow[];
  rosteredCount: number;
  substituteCount: number;
  champion: { id: string; displayName: string } | null;
  /** True when the season exists but is not publicly visible. Public route
   *  callers should render a "not available" state rather than any data. */
  forbidden?: boolean;
}

async function loadLanePairs(sb: Sb, seasonId: string): Promise<SeasonLanePairRow[]> {
  const lp = await (sb.from as unknown as LooseFrom)("season_lane_pairs")
    .select("id,label,display_order,matchup_capacity,active")
    .eq("season_id", seasonId)
    .order("display_order", { ascending: true });
  if (lp.error) return [];
  return (lp.data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    label: String(r.label),
    displayOrder: Number(r.display_order ?? 0),
    matchupCapacity: Number(r.matchup_capacity ?? 0),
    active: r.active !== false,
  }));
}

async function loadChampion(sb: Sb, personId: string): Promise<SeasonDetailResult["champion"]> {
  const p = await (sb.from as unknown as LooseFrom)("people")
    .select("id,display_name")
    .eq("id", personId)
    .maybeSingle();
  if (p.error || !p.data) return null;
  return { id: String(p.data.id), displayName: String(p.data.display_name) };
}

async function loadCounts(sb: Sb, seasonId: string): Promise<{ roster: number; sub: number }> {
  const [rc, sc] = await Promise.all([
    sb.from("rostered_bowlers").select("id", { count: "exact", head: true }).eq("season_id", seasonId),
    sb.from("substitutes").select("id", { count: "exact", head: true }).eq("season_id", seasonId),
  ]);
  return { roster: rc.count ?? 0, sub: sc.count ?? 0 };
}

export const getPublicSeasonDetail = createServerFn({ method: "GET" })
  .inputValidator((v) => z.object({ seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ data }) => {
    const sb = makePublicClient();
    const { rows } = await fetchSeasonsWide(sb);
    const season = rows.find((r) => r.id === data.seasonId) ?? null;

    // SERVER-SIDE VISIBILITY GUARD: refuse to return draft/private detail
    // to unauthenticated clients even if they hand us the raw UUID.
    if (season && !(season.status === "current" || (season.status === "archived" && season.publicVisible))) {
      return {
        available: true, season: null, lanePairs: [], rosteredCount: 0,
        substituteCount: 0, champion: null, forbidden: true,
      } as SeasonDetailResult;
    }
    if (!season) {
      return {
        available: false, season: null, lanePairs: [], rosteredCount: 0,
        substituteCount: 0, champion: null,
      } as SeasonDetailResult;
    }

    const [lanePairs, counts, champion] = await Promise.all([
      loadLanePairs(sb, data.seasonId),
      loadCounts(sb, data.seasonId),
      season.championPersonId ? loadChampion(sb, season.championPersonId) : Promise.resolve(null),
    ]);
    return {
      available: true, season, lanePairs,
      rosteredCount: counts.roster, substituteCount: counts.sub, champion,
    } as SeasonDetailResult;
  });

// ---------------- ADMIN: seasons (unfiltered) ------------------------------

export const adminListSeasons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { available, rows } = await fetchSeasonsWide(context.supabase);
    const counts = available ? await fetchBowlerCounts(context.supabase, rows.map((r) => r.id)) : {};
    return { available, seasons: rows, bowlerCounts: counts } as SeasonListResult;
  });

export const adminGetSeasonDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const sb = context.supabase;
    const { rows } = await fetchSeasonsWide(sb);
    const season = rows.find((r) => r.id === data.seasonId) ?? null;
    if (!season) {
      return {
        available: false, season: null, lanePairs: [], rosteredCount: 0,
        substituteCount: 0, champion: null,
      } as SeasonDetailResult;
    }
    const [lanePairs, counts, champion] = await Promise.all([
      loadLanePairs(sb, data.seasonId),
      loadCounts(sb, data.seasonId),
      season.championPersonId ? loadChampion(sb, season.championPersonId) : Promise.resolve(null),
    ]);
    return {
      available: true, season, lanePairs,
      rosteredCount: counts.roster, substituteCount: counts.sub, champion,
    } as SeasonDetailResult;
  });

// ---------------- ADMIN: create / update season ----------------------------

const seasonWriteSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(120),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  totalWeeks: z.number().int().min(1).max(60).nullable().optional(),
  pointSystem: z.union([z.literal(4), z.literal(7)]).nullable().optional(),
  handicapPercent: z.number().min(0).max(100).nullable().optional(),
  handicapBase: z.number().int().min(0).max(300).nullable().optional(),
  status: z.enum(["draft", "archived"]).optional(),
  publicVisible: z.boolean().optional(),
  description: z.string().max(4000).nullable().optional(),
  championPersonId: z.string().uuid().nullable().optional(),
});

export const adminUpsertSeason = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => seasonWriteSchema.parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      throw new Error("End date must be on or after the start date.");
    }
    const payload: Record<string, unknown> = {
      label: data.label.trim(),
      start_date: data.startDate ?? null,
      end_date: data.endDate ?? null,
      total_weeks: data.totalWeeks ?? null,
      point_system: data.pointSystem ?? null,
      handicap_percent: data.handicapPercent ?? null,
      handicap_base: data.handicapBase ?? null,
      description: data.description ?? null,
      champion_person_id: data.championPersonId ?? null,
    };
    // status/public_visible are NEVER 'current' via this path — dedicated
    // makeSeasonCurrent() with explicit confirmation is required.
    if (data.status !== undefined) payload.status = data.status;
    if (data.publicVisible !== undefined) payload.public_visible = data.publicVisible;

    if (data.id) {
      const upd = await (context.supabase.from as unknown as LooseFrom)("seasons")
        .update(payload).eq("id", data.id).select("id").single();
      if (upd.error) throw new Error(upd.error.message);
      return { id: String(upd.data.id), created: false };
    }
    // Always create as draft unless the caller explicitly said "archived".
    if (payload.status == null) payload.status = "draft";
    if (payload.public_visible == null) payload.public_visible = false;
    const ins = await (context.supabase.from as unknown as LooseFrom)("seasons")
      .insert(payload).select("id").single();
    if (ins.error) {
      if (isMissingColumn(ins.error.code)) {
        throw new Error("Season create requires the pending multi-season migration to be applied first.");
      }
      throw new Error(ins.error.message);
    }
    return { id: String(ins.data.id), created: true };
  });

export const adminMakeSeasonCurrent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z.object({ seasonId: z.string().uuid(), confirmMakeCurrent: z.literal(true) }).parse(v),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const rpc = await (context.supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string; code?: string } | null }>)(
      "switch_current_season",
      { _season_id: data.seasonId, _confirm: true },
    );
    if (rpc.error) {
      if (isMissingTable(rpc.error.code) || /does not exist/i.test(rpc.error.message)) {
        throw new Error("switch_current_season RPC not available — apply the pending migration first.");
      }
      throw new Error(rpc.error.message);
    }
    return { ok: true };
  });

// ---------------- ADMIN: lane pairs ----------------------------------------

const lanePairSchema = z.object({
  id: z.string().uuid().optional(),
  seasonId: z.string().uuid(),
  label: z.string().min(1).max(20),
  displayOrder: z.number().int().min(0).max(999),
  matchupCapacity: z.number().int().min(0).max(64),
  active: z.boolean().optional(),
});

const UNIQUE_VIOLATION = "23505";

export const adminUpsertLanePair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => lanePairSchema.parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const payload: Record<string, unknown> = {
      season_id: data.seasonId,
      label: data.label.trim(),
      display_order: data.displayOrder,
      matchup_capacity: data.matchupCapacity,
      active: data.active ?? true,
    };
    if (data.id) {
      const upd = await (context.supabase.from as unknown as LooseFrom)("season_lane_pairs")
        .update(payload).eq("id", data.id).eq("season_id", data.seasonId).select("id").single();
      if (upd.error) {
        if (upd.error.code === UNIQUE_VIOLATION) {
          throw new Error(`A lane pair labeled "${data.label.trim()}" already exists in this season.`);
        }
        throw new Error(upd.error.message);
      }
      return { id: String(upd.data.id) };
    }
    const ins = await (context.supabase.from as unknown as LooseFrom)("season_lane_pairs")
      .insert(payload).select("id").single();
    if (ins.error) {
      if (isMissingTable(ins.error.code)) {
        throw new Error("Lane pair configuration requires the pending migration first.");
      }
      if (ins.error.code === UNIQUE_VIOLATION) {
        throw new Error(`A lane pair labeled "${data.label.trim()}" already exists in this season.`);
      }
      throw new Error(ins.error.message);
    }
    return { id: String(ins.data.id) };
  });

export const adminDeleteLanePair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid(), seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const del = await (context.supabase.from as unknown as LooseFrom)("season_lane_pairs")
      .delete().eq("id", data.id).eq("season_id", data.seasonId);
    if (del.error) throw new Error(del.error.message);
    return { ok: true };
  });

// ---------------- ADMIN: historical participants ---------------------------

export interface ParticipantRow {
  id: string;
  role: "rostered" | "substitute";
  name: string;
  bowlerNumber: string | null;
  average: number | null;
  handicap: number | null;
  active: boolean;
  archived: boolean;
  personId: string | null;
  personDisplayName?: string | null;
}

export const adminListParticipants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const sb = context.supabase;

    const rb = await (sb.from as unknown as LooseFrom)("rostered_bowlers")
      .select("id,name,bowler_number,entry_average,handicap,active,archived,person_id")
      .eq("season_id", data.seasonId);
    const sub = await (sb.from as unknown as LooseFrom)("substitutes")
      .select("id,name,bowler_number,starting_average,handicap,active,archived,person_id")
      .eq("season_id", data.seasonId);

    // Best-effort person-name enrichment.
    const personIds = new Set<string>();
    for (const r of ((rb.data as Array<Record<string, unknown>>) ?? [])) {
      if (r.person_id) personIds.add(String(r.person_id));
    }
    for (const r of ((sub.data as Array<Record<string, unknown>>) ?? [])) {
      if (r.person_id) personIds.add(String(r.person_id));
    }
    const nameById = new Map<string, string>();
    if (personIds.size > 0) {
      const pp = await (sb.from as unknown as LooseFrom)("people")
        .select("id,display_name").in("id", Array.from(personIds));
      if (!pp.error) {
        for (const p of (pp.data ?? []) as Array<{ id: string; display_name: string }>) {
          nameById.set(String(p.id), String(p.display_name));
        }
      }
    }

    const roster: ParticipantRow[] = ((rb.data as Array<Record<string, unknown>>) ?? []).map((r) => ({
      id: String(r.id),
      role: "rostered",
      name: String(r.name ?? ""),
      bowlerNumber: (r.bowler_number as string | null) ?? null,
      average: r.entry_average != null ? Number(r.entry_average) : null,
      handicap: r.handicap != null ? Number(r.handicap) : null,
      active: r.active !== false,
      archived: r.archived === true,
      personId: (r.person_id as string | null) ?? null,
      personDisplayName: r.person_id ? nameById.get(String(r.person_id)) ?? null : null,
    }));
    const subs: ParticipantRow[] = ((sub.data as Array<Record<string, unknown>>) ?? []).map((r) => ({
      id: String(r.id),
      role: "substitute",
      name: String(r.name ?? ""),
      bowlerNumber: (r.bowler_number as string | null) ?? null,
      average: r.starting_average != null ? Number(r.starting_average) : null,
      handicap: r.handicap != null ? Number(r.handicap) : null,
      active: r.active !== false,
      archived: r.archived === true,
      personId: (r.person_id as string | null) ?? null,
      personDisplayName: r.person_id ? nameById.get(String(r.person_id)) ?? null : null,
    }));
    return { roster, substitutes: subs };
  });

const participantWriteSchema = z.object({
  seasonId: z.string().uuid(),
  role: z.enum(["rostered", "substitute"]),
  personId: z.string().uuid(),
  name: z.string().min(1).max(80),
  bowlerNumber: z.string().min(1).max(10),
  average: z.number().min(0).max(300).nullable(),
  active: z.boolean().optional(),
});

function computeHandicapWithSeason(avg: number | null, percent: number | null, base: number | null): number | null {
  if (avg == null) return null;
  // Fall back to the current-season formula (80% deficit from 160) when the
  // configured percent/base are absent. Matches the existing invariant used
  // by rosteredRowToBowler().
  const p = (percent ?? 80) / 100;
  const b = base ?? 160;
  return Math.max(0, Math.floor(p * (b - avg)));
}

async function loadSeasonHandicapConfig(sb: Sb, seasonId: string) {
  const q = await (sb.from as unknown as LooseFrom)("seasons")
    .select("handicap_percent,handicap_base").eq("id", seasonId).maybeSingle();
  if (q.error) return { percent: null as number | null, base: null as number | null };
  return {
    percent: (q.data?.handicap_percent as number | null) ?? null,
    base: (q.data?.handicap_base as number | null) ?? null,
  };
}

export const adminAddParticipant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => participantWriteSchema.parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const sb = context.supabase;

    // DUPLICATE GUARD: forbid same (season, person, role) more than once.
    const table = data.role === "rostered" ? "rostered_bowlers" : "substitutes";
    const dup = await (sb.from as unknown as LooseFrom)(table)
      .select("id").eq("season_id", data.seasonId).eq("person_id", data.personId).limit(1);
    if (!dup.error && dup.data && dup.data.length > 0) {
      throw new Error(`That person is already a ${data.role === "rostered" ? "rostered bowler" : "substitute"} in this season.`);
    }

    const cfg = await loadSeasonHandicapConfig(sb, data.seasonId);
    const handicap = computeHandicapWithSeason(data.average, cfg.percent, cfg.base);

    if (data.role === "rostered") {
      const ins = await (sb.from as unknown as LooseFrom)("rostered_bowlers").insert({
        // Historical rows: let Postgres mint a UUID; the deterministic
        // b01/b02 IDs are only used for the current-season roster where
        // schedule slots reference them by string id.
        id: crypto.randomUUID(),
        season_id: data.seasonId,
        person_id: data.personId,
        name: data.name.trim(),
        entry_average: data.average ?? 0,
        handicap: handicap ?? 0,
        active: data.active ?? true,
        archived: false,
        bowler_number: data.bowlerNumber.trim(),
      }).select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      return { id: String(ins.data.id) };
    }
    const ins = await (sb.from as unknown as LooseFrom)("substitutes").insert({
      id: crypto.randomUUID(),
      season_id: data.seasonId,
      person_id: data.personId,
      name: data.name.trim(),
      starting_average: data.average,
      handicap: handicap,
      active: data.active ?? true,
      archived: false,
      bowler_number: data.bowlerNumber.trim(),
    }).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    return { id: String(ins.data.id) };
  });

// ---------------- PEOPLE (admin) -------------------------------------------

export interface PersonRow {
  id: string;
  displayName: string;
  normalizedName: string | null;
  notes: string | null;
  rosterCount: number;
  substituteCount: number;
}

export const listPeople = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const q = await (context.supabase.from as unknown as LooseFrom)("people")
      .select("id,display_name,normalized_name,notes")
      .order("display_name", { ascending: true });
    if (q.error) {
      if (isMissingTable(q.error.code)) return { available: false, people: [] as PersonRow[] };
      throw new Error(q.error.message);
    }
    const ids = (q.data ?? []).map((p: Record<string, unknown>) => String(p.id));
    if (ids.length === 0) return { available: true, people: [] as PersonRow[] };
    const [rb, sub] = await Promise.all([
      (context.supabase.from as unknown as LooseFrom)("rostered_bowlers")
        .select("person_id").in("person_id", ids),
      (context.supabase.from as unknown as LooseFrom)("substitutes")
        .select("person_id").in("person_id", ids),
    ]);
    const rc: Record<string, number> = {};
    for (const r of (rb.error ? [] : rb.data ?? []) as { person_id: string | null }[]) {
      if (r.person_id) rc[r.person_id] = (rc[r.person_id] ?? 0) + 1;
    }
    const sc: Record<string, number> = {};
    for (const r of (sub.error ? [] : sub.data ?? []) as { person_id: string | null }[]) {
      if (r.person_id) sc[r.person_id] = (sc[r.person_id] ?? 0) + 1;
    }
    const people: PersonRow[] = (q.data ?? []).map((p: Record<string, unknown>) => ({
      id: String(p.id),
      displayName: String(p.display_name),
      normalizedName: (p.normalized_name as string | null) ?? null,
      notes: (p.notes as string | null) ?? null,
      rosterCount: rc[String(p.id)] ?? 0,
      substituteCount: sc[String(p.id)] ?? 0,
    }));
    return { available: true, people };
  });

export const createPerson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ displayName: z.string().min(1).max(120), notes: z.string().max(2000).optional() }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const ins = await (context.supabase.from as unknown as LooseFrom)("people")
      .insert({
        display_name: data.displayName.trim(),
        normalized_name: normalizeName(data.displayName),
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (ins.error) {
      if (isMissingTable(ins.error.code)) {
        throw new Error("Historical people table not available yet. Apply the pending migration first.");
      }
      throw new Error(ins.error.message);
    }
    return { id: String(ins.data.id) };
  });

// ---------------- ADMIN: link unlinked participant to person --------------

export interface UnlinkedParticipant {
  id: string;
  role: "rostered" | "substitute";
  seasonId: string;
  seasonLabel: string;
  name: string;
  bowlerNumber: string | null;
}

export const listUnlinkedParticipants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const sb = context.supabase;
    const [rb, sub] = await Promise.all([
      (sb.from as unknown as LooseFrom)("rostered_bowlers")
        .select("id,name,bowler_number,season_id").is("person_id", null),
      (sb.from as unknown as LooseFrom)("substitutes")
        .select("id,name,bowler_number,season_id").is("person_id", null),
    ]);
    // 42703 = person_id column missing (migration not applied yet).
    if (rb.error && isMissingColumn(rb.error.code)) {
      return { available: false, rows: [] as UnlinkedParticipant[] };
    }
    const seasonIds = new Set<string>();
    for (const r of ((rb.data as Array<Record<string, unknown>>) ?? [])) seasonIds.add(String(r.season_id));
    for (const r of ((sub.data as Array<Record<string, unknown>>) ?? [])) seasonIds.add(String(r.season_id));
    const labelById = new Map<string, string>();
    if (seasonIds.size > 0) {
      const ss = await sb.from("seasons").select("id,label").in("id", Array.from(seasonIds));
      for (const s of ss.data ?? []) labelById.set(s.id, s.label);
    }
    const rows: UnlinkedParticipant[] = [];
    for (const r of ((rb.data as Array<Record<string, unknown>>) ?? [])) {
      rows.push({
        id: String(r.id), role: "rostered",
        seasonId: String(r.season_id),
        seasonLabel: labelById.get(String(r.season_id)) ?? "—",
        name: String(r.name ?? ""),
        bowlerNumber: (r.bowler_number as string | null) ?? null,
      });
    }
    for (const r of ((sub.data as Array<Record<string, unknown>>) ?? [])) {
      rows.push({
        id: String(r.id), role: "substitute",
        seasonId: String(r.season_id),
        seasonLabel: labelById.get(String(r.season_id)) ?? "—",
        name: String(r.name ?? ""),
        bowlerNumber: (r.bowler_number as string | null) ?? null,
      });
    }
    return { available: true, rows };
  });

export const linkParticipantToPerson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z.object({
      role: z.enum(["rostered", "substitute"]),
      id: z.string().min(1),
      personId: z.string().uuid(),
    }).parse(v),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const table = data.role === "rostered" ? "rostered_bowlers" : "substitutes";
    // Duplicate guard: same person can't hold two rows in the same
    // (season, role). Reads the row's season_id then checks.
    const cur = await (context.supabase.from as unknown as LooseFrom)(table)
      .select("season_id").eq("id", data.id).maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    if (!cur.data) throw new Error("Participant row not found.");
    const seasonId = String(cur.data.season_id);
    const dup = await (context.supabase.from as unknown as LooseFrom)(table)
      .select("id").eq("season_id", seasonId).eq("person_id", data.personId).neq("id", data.id).limit(1);
    if (!dup.error && dup.data && dup.data.length > 0) {
      throw new Error("That person is already linked to another row in this season for the same role.");
    }
    const upd = await (context.supabase.from as unknown as LooseFrom)(table)
      .update({ person_id: data.personId }).eq("id", data.id);
    if (upd.error) throw new Error(upd.error.message);
    return { ok: true };
  });

// ---------------- ADMIN: person merge (preview + execute) ------------------

export const previewPersonMerge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z.object({ keepPersonId: z.string().uuid(), removePersonId: z.string().uuid() }).parse(v),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    if (data.keepPersonId === data.removePersonId) throw new Error("Cannot merge a person into itself.");
    const links: PersonLink[] = [];
    const rb = await (context.supabase.from as unknown as LooseFrom)("rostered_bowlers")
      .select("id").eq("person_id", data.removePersonId);
    for (const r of (rb.data ?? []) as { id: string }[]) {
      links.push({ table: "rostered_bowlers", id: r.id, column: "person_id" });
    }
    const subQ = await (context.supabase.from as unknown as LooseFrom)("substitutes")
      .select("id").eq("person_id", data.removePersonId);
    for (const r of (subQ.data ?? []) as { id: string }[]) {
      links.push({ table: "substitutes", id: r.id, column: "person_id" });
    }
    const ss = await (context.supabase.from as unknown as LooseFrom)("seasons")
      .select("id").eq("champion_person_id", data.removePersonId);
    for (const r of (ss.data ?? []) as { id: string }[]) {
      links.push({ table: "seasons", id: r.id, column: "champion_person_id" });
    }
    return planPersonMerge(data.keepPersonId, data.removePersonId, links);
  });

export const executePersonMerge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z.object({
      keepPersonId: z.string().uuid(),
      removePersonId: z.string().uuid(),
      /** Client MUST send `true`; any other value rejects. This is the
       *  explicit confirmation token demanded by the plan. */
      confirmMerge: z.literal(true),
    }).parse(v),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    if (data.keepPersonId === data.removePersonId) throw new Error("Cannot merge a person into itself.");
    // Atomic execution lives in the SQL function; it repoints every
    // reference then deletes only the duplicate person + its aliases.
    // Seasonal roster/substitute/result rows are NEVER deleted.
    const rpc = await (context.supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string; code?: string } | null }>)(
      "merge_people",
      { _keep: data.keepPersonId, _remove: data.removePersonId, _confirm: true },
    );
    if (rpc.error) {
      if (/does not exist/i.test(rpc.error.message)) {
        throw new Error("merge_people RPC not available — apply the pending migration first.");
      }
      throw new Error(rpc.error.message);
    }
    return { ok: true as const };
  });

// ---------------- PUBLIC: Career profile from saved snapshots -------------

export interface CareerProfileResult {
  available: boolean;
  person: { id: string; displayName: string; notes: string | null } | null;
  rows: CareerSeasonRow[];
}

export const getCareerProfile = createServerFn({ method: "GET" })
  .inputValidator((v) => z.object({ personId: z.string().uuid() }).parse(v))
  .handler(async ({ data }) => {
    const sb = makePublicClient();
    // Person lookup — nonexistent tables (42P01) degrade to "unavailable".
    const person = await (sb.from as unknown as LooseFrom)("people")
      .select("id,display_name,notes").eq("id", data.personId).maybeSingle();
    if (person.error) {
      if (isMissingTable(person.error.code)) {
        return { available: false, person: null, rows: [] } as CareerProfileResult;
      }
      throw new Error(person.error.message);
    }
    if (!person.data) {
      return { available: true, person: null, rows: [] } as CareerProfileResult;
    }

    // Linked roster + substitute rows.
    const rb = await (sb.from as unknown as LooseFrom)("rostered_bowlers")
      .select("id,name,bowler_number,entry_average,handicap,season_id")
      .eq("person_id", data.personId);
    if (rb.error && isMissingColumn(rb.error.code)) {
      return {
        available: false,
        person: { id: String(person.data.id), displayName: String(person.data.display_name), notes: (person.data as { notes: string | null }).notes ?? null },
        rows: [],
      };
    }
    const sub = await (sb.from as unknown as LooseFrom)("substitutes")
      .select("id,name,bowler_number,starting_average,handicap,season_id")
      .eq("person_id", data.personId);

    // Season labels + saved snapshots, keyed by season_id.
    const seasonIds = new Set<string>();
    for (const r of ((rb.data as Array<Record<string, unknown>>) ?? [])) seasonIds.add(String(r.season_id));
    for (const r of ((sub.data as Array<Record<string, unknown>>) ?? [])) seasonIds.add(String(r.season_id));
    const seasonMeta = new Map<string, { label: string; championPersonId: string | null; publicVisible: boolean; status: string }>();
    if (seasonIds.size > 0) {
      const ss = await (sb.from as unknown as LooseFrom)("seasons")
        .select("id,label,champion_person_id,public_visible,status,is_current")
        .in("id", Array.from(seasonIds));
      for (const s of ((ss.data as Array<Record<string, unknown>>) ?? [])) {
        // Also treat legacy rows (no status column) — is_current stands in.
        const status = (s.status as string | null) ?? (s.is_current ? "current" : "archived");
        const publicVisible = s.public_visible === true || s.is_current === true;
        seasonMeta.set(String(s.id), {
          label: String(s.label),
          championPersonId: (s.champion_person_id as string | null) ?? null,
          publicVisible,
          status,
        });
      }
    }

    // Load one saved snapshot per season (single round-trip via `in`).
    const snapshotsBySeason = new Map<string, unknown>();
    if (seasonIds.size > 0) {
      const snaps = await sb.from("public_snapshots").select("season_id,snapshot").in("season_id", Array.from(seasonIds));
      for (const s of snaps.data ?? []) {
        snapshotsBySeason.set(String(s.season_id), parseSnapshotBackwardCompat(s.snapshot));
      }
    }

    const rows: CareerSeasonRow[] = [];
    for (const r of ((rb.data as Array<Record<string, unknown>>) ?? [])) {
      const seasonId = String(r.season_id);
      const meta = seasonMeta.get(seasonId);
      // PRIVACY: skip career rows tied to draft / archived-private seasons.
      if (!meta || !(meta.status === "current" || (meta.status === "archived" && meta.publicVisible))) continue;
      const extracted = extractRosteredSeasonRow(snapshotsBySeason.get(seasonId), String(r.id));
      rows.push({
        seasonId,
        seasonLabel: meta.label,
        role: "rostered",
        seasonalName: String(r.name ?? ""),
        bowlerNumber: (r.bowler_number as string | null) ?? null,
        startingAverage: r.entry_average != null ? Number(r.entry_average) : null,
        handicap: r.handicap != null ? Number(r.handicap) : null,
        hasGameData: extracted.hasGameData,
        games: extracted.games,
        scratchPinfall: extracted.scratchPinfall,
        average: extracted.average,
        highGame: extracted.highGame,
        highSet: extracted.highSet,
        points: extracted.points,
        finalFinish: extracted.finalFinish,
        isChampion: meta.championPersonId === data.personId,
      });
    }
    for (const r of ((sub.data as Array<Record<string, unknown>>) ?? [])) {
      const seasonId = String(r.season_id);
      const meta = seasonMeta.get(seasonId);
      if (!meta || !(meta.status === "current" || (meta.status === "archived" && meta.publicVisible))) continue;
      const extracted = extractSubstituteSeasonRow(snapshotsBySeason.get(seasonId), String(r.id));
      rows.push({
        seasonId,
        seasonLabel: meta.label,
        role: "substitute",
        seasonalName: String(r.name ?? ""),
        bowlerNumber: (r.bowler_number as string | null) ?? null,
        startingAverage: r.starting_average != null ? Number(r.starting_average) : null,
        handicap: r.handicap != null ? Number(r.handicap) : null,
        hasGameData: extracted.hasGameData,
        games: extracted.games,
        scratchPinfall: extracted.scratchPinfall,
        average: extracted.average,
        highGame: extracted.highGame,
        highSet: extracted.highSet,
      });
    }
    // Sort: most recent season first (label desc as a stable heuristic).
    rows.sort((a, b) => (b.seasonLabel ?? "").localeCompare(a.seasonLabel ?? ""));
    return {
      available: true,
      person: { id: String(person.data.id), displayName: String(person.data.display_name), notes: (person.data as { notes: string | null }).notes ?? null },
      rows,
    };
  });
