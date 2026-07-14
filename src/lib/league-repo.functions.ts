/**
 * Admin-only server functions for roster + substitute CRUD and snapshot
 * rebuild. Every handler:
 *   1. Requires an authenticated user (requireSupabaseAuth middleware)
 *   2. Re-checks admin role via SECURITY DEFINER RPC current_user_is_admin
 *   3. Ensures the current-season row exists (idempotent)
 *   4. Applies the mutation using the user-scoped Supabase client (RLS)
 *   5. Rebuilds the public snapshot for the current season in the same call
 *
 * The snapshot rebuild is the ONLY place PublicSnapshot is written, keeping
 * the "public reads never recompute" rule intact.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildSnapshotFromRows,
  nextRosterIdFrom,
  nextSubIdFrom,
  validateName,
  validateAverage,
  validateBowlerNumber,
  isDuplicateActive,
  ROSTER_MAX_ACTIVE,
  type RosteredRow,
  type SubRow,
} from "@/lib/roster-adapter";
import { computeHandicap } from "@/lib/mock-data";

// -- Shared server helpers ----------------------------------------------

type Ctx = { supabase: ReturnType<typeof makeClient>; userId: string };
// A stand-in type so TS doesn't require pulling in the full Database generic
// at module scope. Actual client comes from requireSupabaseAuth context.
declare function makeClient(): {
  from: (t: string) => any;
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function ensureAdmin(context: { supabase: any }) {
  const { data, error } = await context.supabase.rpc("current_user_is_admin");
  if (error) throw new Error(`admin check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

async function ensureCurrentSeasonId(context: { supabase: any }): Promise<string> {
  const existing = await context.supabase
    .from("seasons")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) return existing.data.id as string;
  const inserted = await context.supabase
    .from("seasons")
    .insert({ label: "2026 Summer", is_current: true })
    .select("id")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data.id as string;
}

async function loadRosterRows(context: { supabase: any }, seasonId: string): Promise<RosteredRow[]> {
  const res = await context.supabase
    .from("rostered_bowlers")
    .select("id, name, entry_average, handicap, active, archived, bowler_number, season_id")
    .eq("season_id", seasonId);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as RosteredRow[];
}
async function loadSubRows(context: { supabase: any }, seasonId: string): Promise<SubRow[]> {
  const res = await context.supabase
    .from("substitutes")
    .select("id, name, starting_average, handicap, active, archived, bowler_number, season_id")
    .eq("season_id", seasonId);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as SubRow[];
}

async function rebuildSnapshot(context: { supabase: any }, seasonId: string): Promise<void> {
  const rostered = await loadRosterRows(context, seasonId);
  const snapshot = buildSnapshotFromRows({ rostered });
  const up = await context.supabase
    .from("public_snapshots")
    .upsert(
      { season_id: seasonId, snapshot: snapshot as unknown as Record<string, unknown> },
      { onConflict: "season_id" },
    );
  if (up.error) throw new Error(`snapshot upsert failed: ${up.error.message}`);
}

// -- READ ---------------------------------------------------------------

export const listRosterAndSubs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    const [rostered, subs] = await Promise.all([
      loadRosterRows(context, seasonId),
      loadSubRows(context, seasonId),
    ]);
    // Stable sort by id so the UI ordering is deterministic across renders.
    rostered.sort((a, b) => a.id.localeCompare(b.id));
    subs.sort((a, b) => a.id.localeCompare(b.id));
    return { seasonId, rostered, subs };
  });

// -- Shared input shapes -------------------------------------------------

const rosterInput = z.object({
  name: z.string(),
  entryAverage: z.number(),
  bowlerNumber: z.string().nullable().optional(),
  active: z.boolean().optional(),
});
const subInput = z.object({
  name: z.string(),
  startingAverage: z.number(),
  bowlerNumber: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

function normalizeBowlerNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length === 0 ? null : t;
}

function assertRosterInput(input: z.infer<typeof rosterInput>) {
  const eName = validateName(input.name);
  if (eName) throw new Error(eName);
  const eAvg = validateAverage(input.entryAverage);
  if (eAvg) throw new Error(eAvg);
  const eNum = validateBowlerNumber(input.bowlerNumber ?? null);
  if (eNum) throw new Error(eNum);
}
function assertSubInput(input: z.infer<typeof subInput>) {
  const eName = validateName(input.name);
  if (eName) throw new Error(eName);
  const eAvg = validateAverage(input.startingAverage);
  if (eAvg) throw new Error(eAvg);
  const eNum = validateBowlerNumber(input.bowlerNumber ?? null);
  if (eNum) throw new Error(eNum);
}

// -- ROSTER: create / update / archive / delete --------------------------

export const addRosterBowler = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rosterInput.parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    assertRosterInput(data);
    const seasonId = await ensureCurrentSeasonId(context);
    const existing = await loadRosterRows(context, seasonId);
    const activeCount = existing.filter((r) => r.active && !r.archived).length;
    if ((data.active ?? true) && activeCount >= ROSTER_MAX_ACTIVE) {
      throw new Error(`Active roster is full (${ROSTER_MAX_ACTIVE} max). Archive a bowler first.`);
    }
    if (isDuplicateActive(data.name, existing)) {
      throw new Error(`A bowler named "${data.name.trim()}" is already on the active roster.`);
    }
    const id = nextRosterIdFrom(existing);
    const entryAverage = Math.round(data.entryAverage);
    const ins = await context.supabase.from("rostered_bowlers").insert({
      id,
      season_id: seasonId,
      name: data.name.trim(),
      entry_average: entryAverage,
      handicap: computeHandicap(entryAverage),
      active: data.active ?? true,
      archived: false,
      bowler_number: normalizeBowlerNumber(data.bowlerNumber ?? null),
    });
    if (ins.error) throw new Error(ins.error.message);
    await rebuildSnapshot(context, seasonId);
    return { id };
  });

export const updateRosterBowler = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    rosterInput.extend({ id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    assertRosterInput(data);
    const seasonId = await ensureCurrentSeasonId(context);
    const existing = await loadRosterRows(context, seasonId);
    if (!existing.find((r) => r.id === data.id)) {
      throw new Error(`Bowler ${data.id} not found in the current season.`);
    }
    if (isDuplicateActive(data.name, existing, data.id)) {
      throw new Error(`A bowler named "${data.name.trim()}" is already on the active roster.`);
    }
    const entryAverage = Math.round(data.entryAverage);
    const upd = await context.supabase
      .from("rostered_bowlers")
      .update({
        name: data.name.trim(),
        entry_average: entryAverage,
        handicap: computeHandicap(entryAverage),
        bowler_number: normalizeBowlerNumber(data.bowlerNumber ?? null),
        ...(data.active !== undefined ? { active: data.active } : {}),
      })
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (upd.error) throw new Error(upd.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true };
  });

export const setRosterArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().min(1), archived: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    const upd = await context.supabase
      .from("rostered_bowlers")
      .update({ archived: data.archived, active: !data.archived })
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (upd.error) throw new Error(upd.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true };
  });

export const deleteRosterBowler = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    // Guard: refuse if any schedule_slot references this bowler.
    const refs = await context.supabase
      .from("schedule_slots")
      .select("id", { count: "exact", head: true })
      .eq("season_id", seasonId)
      .or(`bowler_a_id.eq.${data.id},bowler_b_id.eq.${data.id}`);
    if (refs.error) throw new Error(refs.error.message);
    if ((refs.count ?? 0) > 0) {
      throw new Error("Cannot delete: this bowler is on the schedule. Archive instead.");
    }
    const del = await context.supabase
      .from("rostered_bowlers")
      .delete()
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (del.error) throw new Error(del.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true };
  });

// -- SUBSTITUTES: create / update / archive / delete ---------------------

export const addSubstitute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => subInput.parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    assertSubInput(data);
    const seasonId = await ensureCurrentSeasonId(context);
    const existing = await loadSubRows(context, seasonId);
    if (isDuplicateActive(data.name, existing)) {
      throw new Error(`A substitute named "${data.name.trim()}" is already active.`);
    }
    const id = nextSubIdFrom(existing);
    const startingAverage = Math.round(data.startingAverage);
    const ins = await context.supabase.from("substitutes").insert({
      id,
      season_id: seasonId,
      name: data.name.trim(),
      starting_average: startingAverage,
      handicap: computeHandicap(startingAverage),
      active: data.active ?? true,
      archived: false,
      bowler_number: normalizeBowlerNumber(data.bowlerNumber ?? null),
    });
    if (ins.error) throw new Error(ins.error.message);
    // Snapshot rebuild not strictly required for subs (public snapshot
    // has no sub-only surface at 3A), but keeps upsert timestamps fresh
    // and future-proofs when subs enter public views.
    await rebuildSnapshot(context, seasonId);
    return { id };
  });

export const updateSubstitute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    subInput.extend({ id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    assertSubInput(data);
    const seasonId = await ensureCurrentSeasonId(context);
    const existing = await loadSubRows(context, seasonId);
    if (!existing.find((r) => r.id === data.id)) {
      throw new Error(`Substitute ${data.id} not found in the current season.`);
    }
    if (isDuplicateActive(data.name, existing, data.id)) {
      throw new Error(`A substitute named "${data.name.trim()}" is already active.`);
    }
    const startingAverage = Math.round(data.startingAverage);
    const upd = await context.supabase
      .from("substitutes")
      .update({
        name: data.name.trim(),
        starting_average: startingAverage,
        handicap: computeHandicap(startingAverage),
        bowler_number: normalizeBowlerNumber(data.bowlerNumber ?? null),
        ...(data.active !== undefined ? { active: data.active } : {}),
      })
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (upd.error) throw new Error(upd.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true };
  });

export const setSubstituteArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().min(1), archived: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    const upd = await context.supabase
      .from("substitutes")
      .update({ archived: data.archived, active: !data.archived })
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (upd.error) throw new Error(upd.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true };
  });

export const deleteSubstitute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    const del = await context.supabase
      .from("substitutes")
      .delete()
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (del.error) throw new Error(del.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true };
  });

// -- Manual snapshot rebuild (safety net for admins) ---------------------

export const rebuildCurrentSeasonSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    await rebuildSnapshot(context, seasonId);
    return { ok: true, seasonId };
  });
