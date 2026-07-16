/**
 * Server functions for the multi-season history / permanent-people phase.
 *
 * Backward-safe: every read tolerates the new tables/columns being absent
 * (Postgres 42P01 = undefined_table, 42703 = undefined_column). When the
 * migration is not yet applied these fns return an empty / degraded result
 * so the public Seasons page and admin history pages render an
 * "historical setup not available yet" message instead of crashing.
 *
 * Nothing here touches the current-season snapshot, standings, elimination,
 * schedule, or live-scoring code.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  normalizeName,
  planPersonMerge,
  type PersonLink,
  type SeasonRecord,
} from "@/lib/season-history";

type Sb = SupabaseClient<Database>;
type Ctx = { supabase: Sb; userId: string };

const MISSING_TABLE = "42P01";
const MISSING_COLUMN = "42703";

function isMissingSchema(code: string | undefined | null): boolean {
  return code === MISSING_TABLE || code === MISSING_COLUMN;
}

async function ensureAdmin(context: Ctx): Promise<void> {
  const { data, error } = await context.supabase.rpc("current_user_is_admin");
  if (error) throw new Error(`admin check failed: ${error.message}`);
  if (data !== true) throw new Error("Forbidden: admin role required");
}

// ---------------- Season list (public + admin) ----------------

export interface PublicSeasonListResult {
  available: boolean;
  seasons: SeasonRecord[];
  bowlerCounts: Record<string, number>;
}

// The generated types file does not yet know about the new columns, so we
// cast the query to `any` in a single narrow spot for each call.
type LooseFrom = (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function fetchSeasons(sb: Sb): Promise<{ available: boolean; rows: SeasonRecord[] }> {
  const q = await (sb.from as unknown as LooseFrom)("seasons")
    .select(
      "id,label,is_current,status,public_visible,start_date,end_date,total_weeks,point_system,champion_person_id,description",
    )
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("label", { ascending: false });

  if (q.error) {
    if (isMissingSchema(q.error.code)) return { available: false, rows: [] };
    // If the seasons table itself exists but the new columns don't, retry
    // with the legacy shape so the current season still surfaces.
    if (q.error.code === MISSING_COLUMN) {
      const legacy = await sb.from("seasons").select("id,label,is_current").order("label", { ascending: false });
      if (legacy.error) throw new Error(legacy.error.message);
      return {
        available: false,
        rows: (legacy.data ?? []).map((r) => ({
          id: r.id,
          label: r.label,
          status: r.is_current ? "current" : "archived",
          publicVisible: !!r.is_current,
        })),
      };
    }
    throw new Error(q.error.message);
  }

  const rows: SeasonRecord[] = (q.data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    label: String(r.label ?? ""),
    status: (r.status as SeasonRecord["status"]) ?? (r.is_current ? "current" : "draft"),
    publicVisible: r.public_visible === true || (r.status == null && r.is_current === true),
    startDate: (r.start_date as string | null) ?? null,
    endDate: (r.end_date as string | null) ?? null,
    totalWeeks: (r.total_weeks as number | null) ?? null,
    pointSystem: (r.point_system as 4 | 7 | null) ?? null,
    championPersonId: (r.champion_person_id as string | null) ?? null,
    description: (r.description as string | null) ?? null,
  }));
  return { available: true, rows };
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

function makePublicClient(): Sb {
  const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
  return createClient<Database>(
    (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)!,
    (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY)!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ) as unknown as Sb;
}

/** Public — anyone may call. Filters draft/private seasons on the client
 *  via `filterPublicSeasons` from `season-history.ts`. */
export const listSeasons = createServerFn({ method: "GET" }).handler(async () => {
  const sb = makePublicClient();
  const { available, rows } = await fetchSeasons(sb);
  const counts = available ? await fetchBowlerCounts(sb, rows.map((r) => r.id)) : {};
  const result: PublicSeasonListResult = { available, seasons: rows, bowlerCounts: counts };
  return result;
});


// ---------------- Season detail ----------------

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
}

async function fetchSeasonById(sb: Sb, id: string): Promise<SeasonRecord | null> {
  const { available, rows } = await fetchSeasons(sb);
  if (!available) {
    const legacy = rows.find((r) => r.id === id);
    return legacy ?? null;
  }
  return rows.find((r) => r.id === id) ?? null;
}

export const getSeasonDetail = createServerFn({ method: "GET" })
  .inputValidator((v) => z.object({ seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ data }) => {
    const sb = makePublicClient();


    const season = await fetchSeasonById(sb, data.seasonId);
    if (!season) {
      return {
        available: false,
        season: null,
        lanePairs: [],
        rosteredCount: 0,
        substituteCount: 0,
        champion: null,
      } as SeasonDetailResult;
    }
    let lanePairs: SeasonLanePairRow[] = [];
    const lp = await (sb.from as unknown as LooseFrom)("season_lane_pairs")
      .select("id,label,display_order,matchup_capacity,active")
      .eq("season_id", data.seasonId)
      .order("display_order", { ascending: true });
    if (!lp.error) {
      lanePairs = (lp.data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        label: String(r.label),
        displayOrder: Number(r.display_order ?? 0),
        matchupCapacity: Number(r.matchup_capacity ?? 0),
        active: r.active !== false,
      }));
    }
    const rc = await sb.from("rostered_bowlers").select("id", { count: "exact", head: true }).eq("season_id", data.seasonId);
    const sc = await sb.from("substitutes").select("id", { count: "exact", head: true }).eq("season_id", data.seasonId);
    let champion: SeasonDetailResult["champion"] = null;
    if (season.championPersonId) {
      const p = await (sb.from as unknown as LooseFrom)("people")
        .select("id,display_name")
        .eq("id", season.championPersonId)
        .maybeSingle();
      if (!p.error && p.data) {
        champion = { id: String(p.data.id), displayName: String(p.data.display_name) };
      }
    }
    return {
      available: true,
      season,
      lanePairs,
      rosteredCount: rc.count ?? 0,
      substituteCount: sc.count ?? 0,
      champion,
    } as SeasonDetailResult;
  });

// ---------------- People (admin) ----------------

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
      if (isMissingSchema(q.error.code)) return { available: false, people: [] as PersonRow[] };
      throw new Error(q.error.message);
    }
    const ids = (q.data ?? []).map((p: Record<string, unknown>) => String(p.id));
    const [rb, sub] = await Promise.all([
      (context.supabase.from as unknown as LooseFrom)("rostered_bowlers")
        .select("person_id")
        .in("person_id", ids),
      (context.supabase.from as unknown as LooseFrom)("substitutes")
        .select("person_id")
        .in("person_id", ids),
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
      if (isMissingSchema(ins.error.code)) {
        throw new Error("Historical people table not available yet. Apply the pending migration first.");
      }
      throw new Error(ins.error.message);
    }
    return { id: String(ins.data.id) };
  });

// ---------------- Person merge (guarded) ----------------

export const previewPersonMerge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z.object({ keepPersonId: z.string().uuid(), removePersonId: z.string().uuid() }).parse(v),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const links: PersonLink[] = [];
    const rb = await (context.supabase.from as unknown as LooseFrom)("rostered_bowlers")
      .select("id").eq("person_id", data.removePersonId);
    for (const r of (rb.data ?? []) as { id: string }[]) {
      links.push({ table: "rostered_bowlers", id: r.id, column: "person_id" });
    }
    const sb = await (context.supabase.from as unknown as LooseFrom)("substitutes")
      .select("id").eq("person_id", data.removePersonId);
    for (const r of (sb.data ?? []) as { id: string }[]) {
      links.push({ table: "substitutes", id: r.id, column: "person_id" });
    }
    const ss = await (context.supabase.from as unknown as LooseFrom)("seasons")
      .select("id").eq("champion_person_id", data.removePersonId);
    for (const r of (ss.data ?? []) as { id: string }[]) {
      links.push({ table: "seasons", id: r.id, column: "champion_person_id" });
    }
    return planPersonMerge(data.keepPersonId, data.removePersonId, links);
  });
