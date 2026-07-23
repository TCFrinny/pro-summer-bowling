/**
 * Admin-only server functions for roster + substitute CRUD and snapshot
 * rebuild. Every handler:
 *   1. Requires an authenticated user (requireSupabaseAuth middleware)
 *   2. Re-checks admin role via SECURITY DEFINER RPC current_user_is_admin
 *   3. Ensures the current-season row exists (idempotent)
 *   4. Applies the mutation using the user-scoped Supabase client (RLS)
 *   5. Rebuilds the public snapshot for the current season on success
 *
 * The snapshot rebuild is the ONLY place PublicSnapshot is written, keeping
 * the "public reads never recompute" rule intact.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  nextRosterIdFrom,
  nextSubIdFrom,
  validateName,
  validateAverage,
  validateBowlerNumber,
  isDuplicateActive,
  ROSTER_MAX_ACTIVE,
  BOWLER_NUMBER_MAX_LEN,
  type RosteredRow,
  type SubRow,
} from "@/lib/roster-adapter";
import { comparePersonOptions } from "@/lib/person-sort";
import { computeHandicap } from "@/lib/mock-data";
import { rebuildAndSaveSnapshot } from "@/lib/snapshot-builder.server";


// ---------------------------------------------------------------------------
// Typed context
// ---------------------------------------------------------------------------

type AuthedSupabase = SupabaseClient<Database>;
type AuthedCtx = { supabase: AuthedSupabase; userId: string };

async function ensureAdmin(context: AuthedCtx): Promise<void> {
  const { data, error } = await context.supabase.rpc("current_user_is_admin");
  if (error) throw new Error(`admin check failed: ${error.message}`);
  if (data !== true) throw new Error("Forbidden: admin role required");
}

async function ensureCurrentSeasonId(context: AuthedCtx): Promise<string> {
  const existing = await context.supabase
    .from("seasons")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) return existing.data.id;
  const inserted = await context.supabase
    .from("seasons")
    .insert({ label: "2026 Summer", is_current: true })
    .select("id")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data.id;
}

async function loadRosterRows(context: AuthedCtx, seasonId: string): Promise<RosteredRow[]> {
  const res = await context.supabase
    .from("rostered_bowlers")
    .select("id, name, entry_average, handicap, active, archived, bowler_number, season_id")
    .eq("season_id", seasonId);
  if (res.error) throw new Error(res.error.message);
  // Coerce numeric column (comes back as number from PostgREST) to Number for safety.
  return (res.data ?? []).map((r) => ({
    ...r,
    entry_average: Number(r.entry_average),
  })) as RosteredRow[];
}
async function loadSubRows(context: AuthedCtx, seasonId: string): Promise<SubRow[]> {
  const res = await context.supabase
    .from("substitutes")
    .select("id, name, starting_average, handicap, active, archived, bowler_number, season_id")
    .eq("season_id", seasonId);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).map((r) => ({
    ...r,
    starting_average: r.starting_average != null ? Number(r.starting_average) : null,
  })) as SubRow[];
}

async function rebuildSnapshot(context: AuthedCtx, seasonId: string): Promise<void> {
  await rebuildAndSaveSnapshot(context.supabase, seasonId);
}


// ---------------------------------------------------------------------------
// Activation & reference-check guards
// ---------------------------------------------------------------------------

/** Verifies that setting `id`→active would not exceed max active roster
 *  size nor create a duplicate active name. Pass exceptId=id so the row's
 *  own current row does not count against itself. */
function guardRosterActivation(params: {
  rows: RosteredRow[];
  name: string;
  exceptId?: string;
}): void {
  const active = params.rows.filter(
    (r) => r.active && !r.archived && r.id !== params.exceptId,
  );
  if (active.length >= ROSTER_MAX_ACTIVE) {
    throw new Error(
      `Active roster is full (${ROSTER_MAX_ACTIVE} max). Archive or deactivate another bowler first.`,
    );
  }
  if (isDuplicateActive(params.name, params.rows, params.exceptId)) {
    throw new Error(
      `A bowler named "${params.name.trim()}" is already on the active roster.`,
    );
  }
}
function guardSubActivation(params: {
  rows: SubRow[];
  name: string;
  exceptId?: string;
}): void {
  if (isDuplicateActive(params.name, params.rows, params.exceptId)) {
    throw new Error(
      `A substitute named "${params.name.trim()}" is already active.`,
    );
  }
}

/** True when any schedule_slot references this roster bowler in either slot. */
async function isRosterReferenced(
  context: AuthedCtx,
  bowlerId: string,
): Promise<boolean> {
  const refs = await context.supabase
    .from("schedule_slots")
    .select("id", { count: "exact", head: true })
    .or(`bowler_a_id.eq.${bowlerId},bowler_b_id.eq.${bowlerId}`);
  if (refs.error) throw new Error(refs.error.message);
  return (refs.count ?? 0) > 0;
}

/** True when the substitute id appears anywhere in any match_result's
 *  side_a, side_b, linescore_a, or linescore_b JSON — regardless of which
 *  key holds it (`subId`, `substituteId`, `actualId`, etc.). Delegates to
 *  the admin-only SECURITY DEFINER RPC `public.substitute_referenced`
 *  which uses parameterized jsonpath (`$.** ? (@ == $sub)`) so we don't
 *  depend on a single unconfirmed JSON key shape. */
async function isSubReferenced(
  context: AuthedCtx,
  subId: string,
): Promise<boolean> {
  const rpc = await context.supabase.rpc("substitute_referenced", { _sub_id: subId });
  if (rpc.error) throw new Error(`sub reference check failed: ${rpc.error.message}`);
  return rpc.data === true;
}


// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const bowlerNumberSchema = z
  .string({ required_error: "ID Number is required." })
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1, { message: "ID Number is required (1–10 characters)." })
  .refine((s) => s.length <= BOWLER_NUMBER_MAX_LEN, {
    message: "ID Number must be 1–10 characters.",
  });

const rosterInput = z.object({
  name: z.string(),
  entryAverage: z.number(),
  bowlerNumber: bowlerNumberSchema,
  active: z.boolean().optional(),
});
const subInput = z.object({
  name: z.string(),
  startingAverage: z.number(),
  bowlerNumber: bowlerNumberSchema,
  active: z.boolean().optional(),
});

function assertName(name: string) {
  const e = validateName(name);
  if (e) throw new Error(e);
}
function assertAverage(n: number) {
  const e = validateAverage(n);
  if (e) throw new Error(e);
}
function assertBowlerNumber(s: string) {
  const e = validateBowlerNumber(s);
  if (e) throw new Error(e);
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

export const listRosterAndSubs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    const [rostered, subs] = await Promise.all([
      loadRosterRows(context, seasonId),
      loadSubRows(context, seasonId),
    ]);
    rostered.sort((a, b) => a.id.localeCompare(b.id));
    subs.sort((a, b) => a.id.localeCompare(b.id));
    return { seasonId, rostered, subs };
  });

// ---------------------------------------------------------------------------
// ROSTER: create / update / activate / archive / delete
// ---------------------------------------------------------------------------

export const addRosterBowler = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rosterInput.parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    assertName(data.name);
    assertAverage(data.entryAverage);
    assertBowlerNumber(data.bowlerNumber);
    const seasonId = await ensureCurrentSeasonId(context);
    const existing = await loadRosterRows(context, seasonId);
    // New rows default to active — guard both max size and duplicates.
    if (data.active !== false) {
      guardRosterActivation({ rows: existing, name: data.name });
    }
    const id = nextRosterIdFrom(existing);
    const entryAverage = data.entryAverage; // decimals preserved
    const ins = await context.supabase.from("rostered_bowlers").insert({
      id,
      season_id: seasonId,
      name: data.name.trim(),
      entry_average: entryAverage,
      handicap: computeHandicap(entryAverage),
      active: data.active ?? true,
      archived: false,
      bowler_number: data.bowlerNumber,
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
    assertName(data.name);
    assertAverage(data.entryAverage);
    assertBowlerNumber(data.bowlerNumber);
    const seasonId = await ensureCurrentSeasonId(context);
    const existing = await loadRosterRows(context, seasonId);
    const current = existing.find((r) => r.id === data.id);
    if (!current) throw new Error(`Bowler ${data.id} not found in the current season.`);

    const willBeActive = data.active ?? current.active;
    const willBeArchived = current.archived; // update endpoint does not toggle archive
    if (willBeActive && !willBeArchived) {
      guardRosterActivation({ rows: existing, name: data.name, exceptId: data.id });
    }
    const entryAverage = data.entryAverage;
    const upd = await context.supabase
      .from("rostered_bowlers")
      .update({
        name: data.name.trim(),
        entry_average: entryAverage,
        handicap: computeHandicap(entryAverage),
        bowler_number: data.bowlerNumber,
        active: willBeActive,
      })
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (upd.error) throw new Error(upd.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true };
  });

/** Dedicated active/inactive toggle. Does NOT touch `archived`. */
export const setRosterActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().min(1), active: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    const existing = await loadRosterRows(context, seasonId);
    const current = existing.find((r) => r.id === data.id);
    if (!current) throw new Error(`Bowler ${data.id} not found.`);
    if (data.active && !current.archived) {
      guardRosterActivation({ rows: existing, name: current.name, exceptId: data.id });
    }
    if (data.active && current.archived) {
      throw new Error("Restore from archive first, then activate.");
    }
    const upd = await context.supabase
      .from("rostered_bowlers")
      .update({ active: data.active })
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
    const existing = await loadRosterRows(context, seasonId);
    const current = existing.find((r) => r.id === data.id);
    if (!current) throw new Error(`Bowler ${data.id} not found.`);

    // Archive → also deactivate. Restore → stay INACTIVE by default so the
    // caller must explicitly re-activate (which re-runs max/dup guards).
    let nextActive = current.active;
    if (data.archived) nextActive = false;
    if (!data.archived) nextActive = false;

    const upd = await context.supabase
      .from("rostered_bowlers")
      .update({ archived: data.archived, active: nextActive })
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (upd.error) throw new Error(upd.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true, restoredInactive: !data.archived };
  });

export const deleteRosterBowler = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    if (await isRosterReferenced(context, data.id)) {
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

// ---------------------------------------------------------------------------
// SUBSTITUTES: create / update / activate / archive / delete
// ---------------------------------------------------------------------------

export const addSubstitute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => subInput.parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    assertName(data.name);
    assertAverage(data.startingAverage);
    assertBowlerNumber(data.bowlerNumber);
    const seasonId = await ensureCurrentSeasonId(context);
    const existing = await loadSubRows(context, seasonId);
    if (data.active !== false) {
      guardSubActivation({ rows: existing, name: data.name });
    }
    const id = nextSubIdFrom(existing);
    const startingAverage = data.startingAverage;
    const ins = await context.supabase.from("substitutes").insert({
      id,
      season_id: seasonId,
      name: data.name.trim(),
      starting_average: startingAverage,
      handicap: computeHandicap(startingAverage),
      active: data.active ?? true,
      archived: false,
      bowler_number: data.bowlerNumber,
    });
    if (ins.error) throw new Error(ins.error.message);
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
    assertName(data.name);
    assertAverage(data.startingAverage);
    assertBowlerNumber(data.bowlerNumber);
    const seasonId = await ensureCurrentSeasonId(context);
    const existing = await loadSubRows(context, seasonId);
    const current = existing.find((r) => r.id === data.id);
    if (!current) throw new Error(`Substitute ${data.id} not found.`);
    const willBeActive = data.active ?? current.active;
    if (willBeActive && !current.archived) {
      guardSubActivation({ rows: existing, name: data.name, exceptId: data.id });
    }
    const startingAverage = data.startingAverage;
    const upd = await context.supabase
      .from("substitutes")
      .update({
        name: data.name.trim(),
        starting_average: startingAverage,
        handicap: computeHandicap(startingAverage),
        bowler_number: data.bowlerNumber,
        active: willBeActive,
      })
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (upd.error) throw new Error(upd.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true };
  });

export const setSubstituteActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().min(1), active: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    const existing = await loadSubRows(context, seasonId);
    const current = existing.find((r) => r.id === data.id);
    if (!current) throw new Error(`Substitute ${data.id} not found.`);
    if (data.active && current.archived) {
      throw new Error("Restore from archive first, then activate.");
    }
    if (data.active) {
      guardSubActivation({ rows: existing, name: current.name, exceptId: data.id });
    }
    const upd = await context.supabase
      .from("substitutes")
      .update({ active: data.active })
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
    // Restore lands as INACTIVE so caller must explicitly re-activate.
    const nextActive = false;
    const upd = await context.supabase
      .from("substitutes")
      .update({ archived: data.archived, active: nextActive })
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (upd.error) throw new Error(upd.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true, restoredInactive: !data.archived };
  });

export const deleteSubstitute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    if (await isSubReferenced(context, data.id)) {
      throw new Error(
        "Cannot delete: this substitute is referenced by a saved match result. Archive instead.",
      );
    }
    const del = await context.supabase
      .from("substitutes")
      .delete()
      .eq("id", data.id)
      .eq("season_id", seasonId);
    if (del.error) throw new Error(del.error.message);
    await rebuildSnapshot(context, seasonId);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Manual snapshot rebuild (safety net)
// ---------------------------------------------------------------------------

export const rebuildCurrentSeasonSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const seasonId = await ensureCurrentSeasonId(context);
    await rebuildSnapshot(context, seasonId);
    return { ok: true, seasonId };
  });
