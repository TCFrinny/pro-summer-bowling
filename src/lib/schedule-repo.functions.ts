/**
 * Admin server functions for schedule (weeks, slots) and match results.
 *
 * All mutations rebuild the full PublicSnapshot for the current season on
 * success. Public pages only ever read the snapshot — no runtime aggregation.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  computeHandicap,
  LANE_PAIRS,
  validatePointsOverride,
  type Bowler,
  type FrameLinescore,
  type GameLinescore,
  type LanePair,
  type ParticipationStatus,
  type PointsOverride,
  type SideParticipation,
} from "@/lib/mock-data";
import { summarizeGame } from "@/lib/duckpin";
import {
  buildMatchResultFromDraft,
  rebuildAndSaveSnapshot,
} from "@/lib/snapshot-builder.server";

type Sb = SupabaseClient<Database>;
type Ctx = { supabase: Sb; userId: string };

const MAX_WEEK = 11;
const LANE_SET = new Set<string>(LANE_PAIRS);

// ---------------- shared guards ----------------

async function ensureAdmin(context: Ctx): Promise<void> {
  const { data, error } = await context.supabase.rpc("current_user_is_admin");
  if (error) throw new Error(`admin check failed: ${error.message}`);
  if (data !== true) throw new Error("Forbidden: admin role required");
}

async function ensureSeasonId(context: Ctx): Promise<string> {
  const existing = await context.supabase
    .from("seasons").select("id").eq("is_current", true).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) return existing.data.id;
  const ins = await context.supabase
    .from("seasons").insert({ label: "2026 Summer", is_current: true }).select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  return ins.data.id;
}

/**
 * Upsert (season_id, week_number) → weeks row. Only fields present with a
 * NON-UNDEFINED value in `patch` are written. This preserves the existing
 * `published`, `date`, and `completed` values whenever a caller doesn't
 * intend to change them. Callers that want to explicitly clear `date` must
 * pass `date: null` (not `undefined`).
 */
async function upsertWeekRow(
  context: Ctx, seasonId: string, weekNumber: number,
  patch: { date?: string | null; published?: boolean; completed?: boolean },
): Promise<string> {
  const clean: { date?: string | null; published?: boolean; completed?: boolean } = {};
  if (patch.date !== undefined) clean.date = patch.date;
  if (patch.published !== undefined) clean.published = patch.published;
  if (patch.completed !== undefined) clean.completed = patch.completed;

  const found = await context.supabase
    .from("weeks").select("id")
    .eq("season_id", seasonId).eq("week_number", weekNumber).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  if (found.data) {
    if (Object.keys(clean).length === 0) return found.data.id;
    const upd = await context.supabase.from("weeks")
      .update(clean).eq("id", found.data.id);
    if (upd.error) throw new Error(upd.error.message);
    return found.data.id;
  }
  const ins = await context.supabase.from("weeks")
    .insert({ season_id: seasonId, week_number: weekNumber, ...clean })
    .select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  return ins.data.id;
}

/** Pure helper exposed for deterministic tests. Strips undefined keys so a
 *  weeks PATCH never touches an unrelated column (published/date/completed). */
export function __buildWeekPatchForTest(patch: {
  date?: string | null; published?: boolean; completed?: boolean;
}): { date?: string | null; published?: boolean; completed?: boolean } {
  const clean: { date?: string | null; published?: boolean; completed?: boolean } = {};
  if (patch.date !== undefined) clean.date = patch.date;
  if (patch.published !== undefined) clean.published = patch.published;
  if (patch.completed !== undefined) clean.completed = patch.completed;
  return clean;
}

async function loadActiveRoster(context: Ctx, seasonId: string) {
  const res = await context.supabase
    .from("rostered_bowlers")
    .select("id, name, entry_average, handicap, active, archived, bowler_number")
    .eq("season_id", seasonId);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).map((r) => ({ ...r, entry_average: Number(r.entry_average) }));
}
async function loadRosterAny(context: Ctx, seasonId: string, id: string) {
  const res = await context.supabase
    .from("rostered_bowlers")
    .select("id, name, entry_average, handicap, active, archived, bowler_number")
    .eq("season_id", seasonId).eq("id", id).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) return null;
  return { ...res.data, entry_average: Number(res.data.entry_average) };
}
async function loadSubs(context: Ctx, seasonId: string) {
  const res = await context.supabase
    .from("substitutes")
    .select("id, name, starting_average, handicap, active, archived, bowler_number")
    .eq("season_id", seasonId);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).map((r) => ({
    ...r,
    starting_average: r.starting_average != null ? Number(r.starting_average) : null,
  }));
}

// ---------------- READ (admin) ----------------

export const getAdminScheduleData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const seasonId = await ensureSeasonId(context);
    const [roster, subs, weeksRes] = await Promise.all([
      loadActiveRoster(context, seasonId),
      loadSubs(context, seasonId),
      context.supabase.from("weeks")
        .select("id, week_number, date, published, completed")
        .eq("season_id", seasonId).order("week_number"),
    ]);
    if (weeksRes.error) throw new Error(weeksRes.error.message);
    const weeks = weeksRes.data ?? [];
    const weekIds = weeks.map((w) => w.id);
    const [slotsRes, resultsRes] = await Promise.all([
      weekIds.length
        ? context.supabase.from("schedule_slots")
            .select("id, week_id, lane_pair, slot, bowler_a_id, bowler_b_id, name_a, name_b, bowler_number_a, bowler_number_b")
            .in("week_id", weekIds)
        : Promise.resolve({ data: [], error: null } as const),
      weekIds.length
        ? context.supabase.from("match_results")
            .select("schedule_slot_id, week_id, side_a, side_b, linescore_a, linescore_b, override, derived")
            .in("week_id", weekIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if (slotsRes.error) throw new Error(slotsRes.error.message);
    if (resultsRes.error) throw new Error(resultsRes.error.message);
    return {
      seasonId,
      roster,
      subs,
      weeks,
      slots: slotsRes.data ?? [],
      results: resultsRes.data ?? [],
    };
  });

// ---------------- SCHEDULE MUTATIONS ----------------

const slotInput = z.object({
  lanePair: z.string(),
  slot: z.number().int().min(1).max(3),
  bowlerA: z.string().min(1),
  bowlerB: z.string().min(1),
});

const saveWeekInput = z.object({
  weekNumber: z.number().int().min(1).max(MAX_WEEK),
  date: z.string().nullable().optional(),
  publish: z.boolean(),
  slots: z.array(slotInput),
});

/**
 * Replace the full slot set for a week. Historical name/ID freezing:
 * name_a/name_b/bowler_number_a/bowler_number_b are captured from the
 * current roster at save time. Slots already tied to a saved match_result
 * (via schedule_slots.id === match_results.schedule_slot_id) are preserved:
 * the delete-then-insert flow would break the FK, so we UPSERT by
 * (week_id, lane_pair, slot).
 */
export const saveWeekSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveWeekInput.parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureSeasonId(context);

    // Publishing a week requires a real date (non-empty string). We do
    // NOT synthesize `today` at snapshot time (see snapshot-builder), so
    // a published week without a date would render blank on the public
    // schedule.
    if (data.publish) {
      const d = (data.date ?? "").trim();
      if (!d) throw new Error("Cannot publish week: a valid date is required");
    }


    // Validate slots against active roster
    const roster = await loadActiveRoster(context, seasonId);
    const activeById = new Map(
      roster.filter((r) => r.active && !r.archived).map((r) => [r.id, r]),
    );

    const seen = new Set<string>();
    const slotKeys = new Set<string>();
    for (const s of data.slots) {
      if (!LANE_SET.has(s.lanePair)) throw new Error(`Invalid lane pair: ${s.lanePair}`);
      const k = `${s.lanePair}#${s.slot}`;
      if (slotKeys.has(k)) throw new Error(`Duplicate slot ${k}`);
      slotKeys.add(k);
      if (s.bowlerA === s.bowlerB) throw new Error(`Slot ${k}: bowler cannot face themself`);
      for (const bid of [s.bowlerA, s.bowlerB]) {
        if (!activeById.has(bid)) {
          throw new Error(`Slot ${k}: bowler ${bid} is not on the active roster`);
        }
        if (seen.has(bid)) throw new Error(`Bowler ${activeById.get(bid)!.name} appears more than once this week`);
        seen.add(bid);
      }
    }

    const weekId = await upsertWeekRow(context, seasonId, data.weekNumber, {
      date: data.date ?? null,
      published: data.publish ? true : undefined,
    });

    // Load existing slots for this week (need their IDs to preserve results)
    const existing = await context.supabase.from("schedule_slots")
      .select("id, lane_pair, slot").eq("week_id", weekId);
    if (existing.error) throw new Error(existing.error.message);
    const existingByKey = new Map(
      (existing.data ?? []).map((s) => [`${s.lane_pair}#${s.slot}`, s.id]),
    );

    // For each incoming slot: upsert. Delete existing slots that are not present.
    const incomingKeys = new Set(data.slots.map((s) => `${s.lanePair}#${s.slot}`));

    // Delete stale slots (RESTRICT FK to match_results will error if a
    // result exists on a slot being removed — surface that as a user error).
    const toDelete: string[] = [];
    for (const [key, id] of existingByKey.entries()) {
      if (!incomingKeys.has(key)) toDelete.push(id);
    }
    if (toDelete.length > 0) {
      const del = await context.supabase.from("schedule_slots").delete().in("id", toDelete);
      if (del.error) {
        throw new Error(
          `Cannot remove slot with a saved result. Delete the match result first. (${del.error.message})`,
        );
      }
    }

    // Upsert slots.
    for (const s of data.slots) {
      const a = activeById.get(s.bowlerA)!;
      const b = activeById.get(s.bowlerB)!;
      const key = `${s.lanePair}#${s.slot}`;
      const existingId = existingByKey.get(key);
      const patch = {
        week_id: weekId,
        lane_pair: s.lanePair,
        slot: s.slot,
        bowler_a_id: a.id, bowler_b_id: b.id,
        name_a: a.name, name_b: b.name,
        bowler_number_a: a.bowler_number, bowler_number_b: b.bowler_number,
      };
      if (existingId) {
        // Preserve slot id (so match_results FK stays valid). If the
        // bowler assignment CHANGED on a slot with a saved result, clear
        // the result so stats stay consistent.
        const hasResult = await context.supabase.from("match_results")
          .select("schedule_slot_id", { head: true, count: "exact" })
          .eq("schedule_slot_id", existingId);
        if (hasResult.error) throw new Error(hasResult.error.message);
        if ((hasResult.count ?? 0) > 0) {
          // Look up the actual current row to compare.
          const cur = await context.supabase.from("schedule_slots")
            .select("bowler_a_id, bowler_b_id").eq("id", existingId).single();
          if (cur.error) throw new Error(cur.error.message);
          if (cur.data.bowler_a_id !== patch.bowler_a_id || cur.data.bowler_b_id !== patch.bowler_b_id) {
            const delRes = await context.supabase.from("match_results")
              .delete().eq("schedule_slot_id", existingId);
            if (delRes.error) throw new Error(delRes.error.message);
          }
        }
        const upd = await context.supabase.from("schedule_slots").update(patch).eq("id", existingId);
        if (upd.error) throw new Error(upd.error.message);
      } else {
        const ins = await context.supabase.from("schedule_slots").insert(patch);
        if (ins.error) throw new Error(ins.error.message);
      }
    }

    await rebuildAndSaveSnapshot(context.supabase, seasonId);
    return { ok: true, weekId };
  });

export const setWeekPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ weekNumber: z.number().int().min(1).max(MAX_WEEK), published: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureSeasonId(context);
    if (data.published) {
      const wk = await context.supabase.from("weeks")
        .select("date").eq("season_id", seasonId).eq("week_number", data.weekNumber).maybeSingle();
      if (wk.error) throw new Error(wk.error.message);
      const d = (wk.data?.date ?? "").trim();
      if (!d) throw new Error("Cannot publish week: a valid date is required");
    }
    await upsertWeekRow(context, seasonId, data.weekNumber, { published: data.published });
    await rebuildAndSaveSnapshot(context.supabase, seasonId);
    return { ok: true };
  });


export const deleteWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ weekNumber: z.number().int().min(1).max(MAX_WEEK) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureSeasonId(context);
    const found = await context.supabase.from("weeks")
      .select("id").eq("season_id", seasonId).eq("week_number", data.weekNumber).maybeSingle();
    if (found.error) throw new Error(found.error.message);
    if (!found.data) return { ok: true };
    // Refuse if any slot has a saved result — historical results must not vanish silently.
    const slots = await context.supabase.from("schedule_slots")
      .select("id").eq("week_id", found.data.id);
    if (slots.error) throw new Error(slots.error.message);
    const slotIds = (slots.data ?? []).map((s) => s.id);
    if (slotIds.length > 0) {
      const anyResult = await context.supabase.from("match_results")
        .select("schedule_slot_id", { head: true, count: "exact" }).in("schedule_slot_id", slotIds);
      if (anyResult.error) throw new Error(anyResult.error.message);
      if ((anyResult.count ?? 0) > 0) {
        throw new Error("Cannot delete week — one or more matches have saved results. Delete those first.");
      }
      const delSlots = await context.supabase.from("schedule_slots").delete().in("id", slotIds);
      if (delSlots.error) throw new Error(delSlots.error.message);
    }
    const delW = await context.supabase.from("weeks").delete().eq("id", found.data.id);
    if (delW.error) throw new Error(delW.error.message);
    await rebuildAndSaveSnapshot(context.supabase, seasonId);
    return { ok: true };
  });

// ---------------- RESULT MUTATIONS ----------------

const frameSchema = z.object({
  frameNumber: z.number().int().min(1).max(10),
  mark: z.string(),
  cumulativeScore: z.number().int().min(0),
});

const gameSchema = z.object({
  frames: z.array(frameSchema).length(10),
});

const sideDraftSchema = z.object({
  status: z.enum(["rostered", "substitute", "absent"]),
  /** Required when status === "substitute". Free-form substitute names
   *  are NOT accepted: every sub used in a result must exist in the
   *  active substitute pool (with a required ID Number). */
  substituteId: z.string().optional(),
  /** Optional override of the pool's Starting Average for this specific
   *  match; falls back to the sub's stored starting_average. */
  substituteStartingAverage: z.number().optional(),
  games: z.array(gameSchema).length(3).optional(),
});


const overrideSchema = z.object({
  enabled: z.literal(true),
  pointsA: z.number(),
  pointsB: z.number(),
  reason: z.string(),
});

const saveResultInput = z.object({
  slotId: z.string().min(1),
  sideA: sideDraftSchema,
  sideB: sideDraftSchema,
  override: overrideSchema.nullable().optional(),
});

function rosteredToBowler(r: {
  id: string; name: string; entry_average: number; bowler_number: string | null;
}): Bowler {
  return {
    id: r.id, name: r.name,
    entryAverage: r.entry_average,
    handicap: computeHandicap(r.entry_average),
    scratchAverage: 0, points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0, actualScratchPinfall: 0,
    movement: 0,
  };
}

function toGameLinescore(g: z.infer<typeof gameSchema>): GameLinescore {
  // summarizeGame validates and derives every stat.
  return summarizeGame(g.frames as FrameLinescore[]);
}

export const saveMatchResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveResultInput.parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureSeasonId(context);

    // Load the slot + week
    const slot = await context.supabase.from("schedule_slots")
      .select("id, week_id, lane_pair, slot, bowler_a_id, bowler_b_id, name_a, name_b, bowler_number_a, bowler_number_b")
      .eq("id", data.slotId).maybeSingle();
    if (slot.error) throw new Error(slot.error.message);
    if (!slot.data) throw new Error("Schedule slot not found");
    if (!slot.data.bowler_a_id || !slot.data.bowler_b_id) {
      throw new Error("Slot is missing bowler assignments");
    }

    const [rosterA, rosterB, subs] = await Promise.all([
      loadRosterAny(context, seasonId, slot.data.bowler_a_id),
      loadRosterAny(context, seasonId, slot.data.bowler_b_id),
      loadSubs(context, seasonId),
    ]);
    if (!rosterA || !rosterB) throw new Error("Scheduled bowler(s) missing from roster");

    // Build participation per side. Substitutes MUST come from the
    // active substitute pool (referenced by id). This is enforced
    // server-side so a crafted request cannot bypass the UI: unknown,
    // inactive, or archived subs are rejected.
    const buildPart = (
      sched: { id: string; name: string },
      sd: z.infer<typeof sideDraftSchema>,
      side: "A" | "B",
    ): { part: SideParticipation; subRec: (typeof subs)[number] | null } => {
      if (sd.status === "rostered") {
        return {
          part: { scheduledId: sched.id, status: "rostered", actualId: sched.id, actualName: sched.name },
          subRec: null,
        };
      }
      if (sd.status === "absent") {
        return {
          part: { scheduledId: sched.id, status: "absent", actualId: null, actualName: "Absent" },
          subRec: null,
        };
      }
      if (!sd.substituteId) {
        throw new Error(`Side ${side}: substitute must be selected from the pool`);
      }
      const rec = subs.find((s) => s.id === sd.substituteId);
      if (!rec) throw new Error(`Side ${side}: substitute not found in this season's pool`);
      if (!rec.active || rec.archived) {
        throw new Error(`Side ${side}: substitute is inactive or archived`);
      }
      return {
        part: {
          scheduledId: sched.id, status: "substitute",
          actualId: rec.id, actualName: rec.name,
        },
        subRec: rec,
      };
    };
    const partA = buildPart({ id: rosterA.id, name: rosterA.name }, data.sideA, "A");
    const partB = buildPart({ id: rosterB.id, name: rosterB.name }, data.sideB, "B");
    const pA = partA.part, pB = partB.part;

    // Effective handicap per side. Substitutes bowl on THEIR OWN
    // starting-average handicap. Points and handicap pinfall are still
    // credited to the scheduled bowler by the pure computeMatchResult.
    const resolveSide = (
      sched: { id: string; entry_average: number },
      sd: z.infer<typeof sideDraftSchema>,
      partInfo: ReturnType<typeof buildPart>,
      side: "A" | "B",
    ) => {
      if (partInfo.part.status !== "substitute") {
        return { entry: sched.entry_average, hcp: computeHandicap(sched.entry_average) };
      }
      const sa = sd.substituteStartingAverage
        ?? partInfo.subRec?.starting_average
        ?? null;
      if (sa == null || !Number.isFinite(sa)) {
        throw new Error(`Side ${side}: substitute Starting Average required`);
      }
      return { entry: sa, hcp: computeHandicap(sa) };
    };
    const rA = resolveSide(rosterA, data.sideA, partA, "A");
    const rB = resolveSide(rosterB, data.sideB, partB, "B");


    // Validate override
    const override: PointsOverride | null = data.override && data.override.enabled ? {
      enabled: true, pointsA: data.override.pointsA,
      pointsB: data.override.pointsB, reason: data.override.reason,
    } : null;
    const anyAbsent = pA.status === "absent" || pB.status === "absent";
    if (anyAbsent && !override) {
      throw new Error("Absent side requires a manual points override with reason");
    }
    if (override) {
      const chk = validatePointsOverride(override);
      if (!chk.ok) throw new Error(chk.error);
    }

    // Linescores
    const gamesA = data.sideA.games && pA.status !== "absent"
      ? (data.sideA.games.map(toGameLinescore) as [GameLinescore, GameLinescore, GameLinescore])
      : undefined;
    const gamesB = data.sideB.games && pB.status !== "absent"
      ? (data.sideB.games.map(toGameLinescore) as [GameLinescore, GameLinescore, GameLinescore])
      : undefined;
    if (pA.status !== "absent" && !gamesA) throw new Error("Side A linescore required");
    if (pB.status !== "absent" && !gamesB) throw new Error("Side B linescore required");

    // Build MatchResult using existing pure logic
    const result = buildMatchResultFromDraft({
      scheduledA: rosteredToBowler(rosterA),
      scheduledB: rosteredToBowler(rosterB),
      // FROZEN names/averages/handicaps captured from CURRENT roster at save time.
      scheduledNameA: slot.data.name_a ?? rosterA.name,
      scheduledNameB: slot.data.name_b ?? rosterB.name,
      participationA: pA, participationB: pB,
      entryAverageA: rA.entry, entryAverageB: rB.entry,
      handicapA: rA.hcp, handicapB: rB.hcp,
      gamesA, gamesB,
      pointsOverride: override,
    });

    // Upsert into match_results by schedule_slot_id (unique).
    const row = {
      schedule_slot_id: slot.data.id,
      week_id: slot.data.week_id,
      season_id: seasonId,
      side_a: pA as unknown as Database["public"]["Tables"]["match_results"]["Insert"]["side_a"],
      side_b: pB as unknown as Database["public"]["Tables"]["match_results"]["Insert"]["side_b"],
      linescore_a: (result.linescoreA ?? null) as unknown as Database["public"]["Tables"]["match_results"]["Insert"]["linescore_a"],
      linescore_b: (result.linescoreB ?? null) as unknown as Database["public"]["Tables"]["match_results"]["Insert"]["linescore_b"],
      override: (override ?? null) as unknown as Database["public"]["Tables"]["match_results"]["Insert"]["override"],
      derived: result as unknown as Database["public"]["Tables"]["match_results"]["Insert"]["derived"],
      entered_by: context.userId,
    };
    const up = await context.supabase.from("match_results")
      .upsert(row, { onConflict: "schedule_slot_id" });
    if (up.error) throw new Error(up.error.message);

    // Mark week completed if every slot has a result.
    const wkSlots = await context.supabase.from("schedule_slots")
      .select("id").eq("week_id", slot.data.week_id);
    if (wkSlots.error) throw new Error(wkSlots.error.message);
    const ids = (wkSlots.data ?? []).map((s) => s.id);
    const done = await context.supabase.from("match_results")
      .select("schedule_slot_id", { head: true, count: "exact" }).in("schedule_slot_id", ids);
    if (done.error) throw new Error(done.error.message);
    const completed = ids.length > 0 && (done.count ?? 0) === ids.length;
    await context.supabase.from("weeks").update({ completed }).eq("id", slot.data.week_id);

    await rebuildAndSaveSnapshot(context.supabase, seasonId);
    return { ok: true };
  });

export const deleteMatchResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ slotId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await ensureSeasonId(context);

    // Look up the result row FIRST so we know which week to recompute the
    // completed flag on. Idempotent: no row → no-op success.
    const existing = await context.supabase.from("match_results")
      .select("schedule_slot_id, week_id")
      .eq("schedule_slot_id", data.slotId)
      .eq("season_id", seasonId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) return { ok: true, deleted: false };

    const weekId = existing.data.week_id;

    const del = await context.supabase.from("match_results")
      .delete().eq("schedule_slot_id", data.slotId);
    if (del.error) throw new Error(del.error.message);

    // Recompute completed from CURRENT slot vs remaining result counts.
    // Normally false after a delete, unless every remaining slot still
    // has a result.
    const wkSlots = await context.supabase.from("schedule_slots")
      .select("id").eq("week_id", weekId);
    if (wkSlots.error) throw new Error(wkSlots.error.message);
    const slotIds = (wkSlots.data ?? []).map((s) => s.id);
    let completed = false;
    if (slotIds.length > 0) {
      const done = await context.supabase.from("match_results")
        .select("schedule_slot_id", { head: true, count: "exact" }).in("schedule_slot_id", slotIds);
      if (done.error) throw new Error(done.error.message);
      completed = (done.count ?? 0) === slotIds.length;
    }
    const upd = await context.supabase.from("weeks").update({ completed }).eq("id", weekId);
    if (upd.error) throw new Error(upd.error.message);

    await rebuildAndSaveSnapshot(context.supabase, seasonId);
    return { ok: true, deleted: true };
  });

