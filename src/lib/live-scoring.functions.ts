/**
 * Admin server functions for Final Week Live Scoring.
 *
 * Rules (mirrors spec):
 *   - Admin-only. Verified via `current_user_is_admin()`.
 *   - Final week only. The target week is the highest week_number that
 *     exists for the current season and has at least one schedule slot.
 *   - Absent-sided slots are NOT accepted here (use normal result editor).
 *   - Batch save is per game-round (1, 2, or 3) across all matchups; a
 *     single snapshot rebuild happens once at the end.
 *   - Full `match_results` for the same slot always take precedence. If a
 *     full result exists, the live-scoring save for that slot is rejected.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rebuildAndSaveSnapshot } from "@/lib/snapshot-builder.server";
import { resolveEffectiveScoring } from "@/lib/substitute-handicap";
import { buildLiveSideJson, pairCompletedMask, type LiveMatchRow, type LiveSideJson } from "@/lib/live-scoring";

type Sb = SupabaseClient<Database>;
type Ctx = { supabase: Sb; userId: string };
type AnySb = SupabaseClient<Record<string, never>>;

async function ensureAdmin(context: Ctx) {
  const { data, error } = await context.supabase.rpc("current_user_is_admin");
  if (error) throw new Error(`admin check failed: ${error.message}`);
  if (data !== true) throw new Error("Forbidden: admin role required");
}
async function currentSeasonId(context: Ctx): Promise<string> {
  const r = await context.supabase.from("seasons")
    .select("id").eq("is_current", true).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) throw new Error("No current season configured");
  return r.data.id;
}

/** Return the current-season week with the highest week_number that has
 *  at least one schedule slot. Returns null if no such week exists. */
async function loadFinalWeek(context: Ctx, seasonId: string) {
  const wr = await context.supabase.from("weeks")
    .select("id, week_number, date, published, completed")
    .eq("season_id", seasonId).order("week_number", { ascending: false });
  if (wr.error) throw new Error(wr.error.message);
  const weeks = wr.data ?? [];
  for (const w of weeks) {
    const s = await context.supabase.from("schedule_slots")
      .select("id", { head: true, count: "exact" }).eq("week_id", w.id);
    if (s.error) throw new Error(s.error.message);
    if ((s.count ?? 0) > 0) return w;
  }
  return null;
}

// ---------- READ ----------

export const getLiveScoringData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const seasonId = await currentSeasonId(context);
    const week = await loadFinalWeek(context, seasonId);
    if (!week) {
      return { migrationRequired: false, week: null, slots: [], roster: [], subs: [], liveRows: [], fullResultSlotIds: [] };
    }

    const [slots, roster, subs] = await Promise.all([
      context.supabase.from("schedule_slots")
        .select("id, week_id, lane_pair, slot, bowler_a_id, bowler_b_id, name_a, name_b, bowler_number_a, bowler_number_b")
        .eq("week_id", week.id),
      context.supabase.from("rostered_bowlers")
        .select("id, name, entry_average, handicap, active, archived, bowler_number")
        .eq("season_id", seasonId),
      context.supabase.from("substitutes")
        .select("id, name, starting_average, handicap, active, archived, bowler_number")
        .eq("season_id", seasonId),
    ]);
    if (slots.error) throw new Error(slots.error.message);
    if (roster.error) throw new Error(roster.error.message);
    if (subs.error) throw new Error(subs.error.message);

    // Any slots with a full match_result are excluded from live entry.
    const slotIds = (slots.data ?? []).map((s) => s.id);
    let fullResultSlotIds: string[] = [];
    if (slotIds.length > 0) {
      const rr = await context.supabase.from("match_results")
        .select("schedule_slot_id").in("schedule_slot_id", slotIds);
      if (rr.error) throw new Error(rr.error.message);
      fullResultSlotIds = (rr.data ?? []).map((r) => r.schedule_slot_id);
    }

    // Load live rows for this week. Backward-safe: return migrationRequired
    // when the table doesn't exist yet (deploy before migration applied).
    let liveRows: LiveMatchRow[] = [];
    let migrationRequired = false;
    if (slotIds.length > 0) {
      const lr = await (context.supabase as unknown as AnySb)
        .from("live_match_results")
        .select("id, schedule_slot_id, week_id, season_id, side_a, side_b, a_game1, a_game2, a_game3, b_game1, b_game2, b_game3")
        .eq("week_id", week.id);
      if (lr.error) {
        const code = (lr.error as { code?: string }).code;
        if (code === "42P01" || /does not exist/i.test(lr.error.message ?? "")) {
          migrationRequired = true;
        } else {
          throw new Error(lr.error.message);
        }
      } else {
        liveRows = ((lr.data as unknown) as LiveMatchRow[]) ?? [];
      }
    }

    return {
      migrationRequired,
      week: {
        id: week.id, weekNumber: week.week_number, date: week.date,
        published: week.published, completed: week.completed,
      },
      slots: slots.data ?? [],
      roster: (roster.data ?? []).map((r) => ({ ...r, entry_average: Number(r.entry_average) })),
      subs: (subs.data ?? []).map((r) => ({
        ...r, starting_average: r.starting_average != null ? Number(r.starting_average) : null,
      })),
      liveRows,
      fullResultSlotIds,
    };
  });

// ---------- SAVE (batch, per game) ----------

const sideDraftSchema = z.object({
  scheduledId: z.string().min(1),
  status: z.enum(["rostered", "substitute"]),
  substituteId: z.string().min(1).nullable().optional(),
  substituteStartingAverage: z.number().min(1).max(300).nullable().optional(),
});
const matchDraftSchema = z.object({
  slotId: z.string().min(1),
  sideA: sideDraftSchema,
  sideB: sideDraftSchema,
  scoreA: z.number().int().min(0).max(300).nullable(),
  scoreB: z.number().int().min(0).max(300).nullable(),
});
const batchInput = z.object({
  gameNumber: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  matches: z.array(matchDraftSchema).min(1),
});

/** Batch-save one game round across matchups. Transactional-ish: we apply
 *  all upserts then rebuild the snapshot once. RLS + the unique
 *  (schedule_slot_id) constraint enforce single-source semantics. */
export const saveLiveGameBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => batchInput.parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await currentSeasonId(context);
    const week = await loadFinalWeek(context, seasonId);
    if (!week) throw new Error("No scheduled final week exists yet");

    const slotIds = data.matches.map((m) => m.slotId);
    const [slots, roster, subs, existingLive, existingFull] = await Promise.all([
      context.supabase.from("schedule_slots")
        .select("id, week_id, lane_pair, slot, bowler_a_id, bowler_b_id, name_a, name_b")
        .in("id", slotIds),
      context.supabase.from("rostered_bowlers")
        .select("id, name, entry_average, active, archived")
        .eq("season_id", seasonId),
      context.supabase.from("substitutes")
        .select("id, name, starting_average, active, archived")
        .eq("season_id", seasonId),
      (context.supabase as unknown as AnySb).from("live_match_results")
        .select("id, schedule_slot_id, week_id, season_id, side_a, side_b, a_game1, a_game2, a_game3, b_game1, b_game2, b_game3")
        .in("schedule_slot_id", slotIds),
      context.supabase.from("match_results")
        .select("schedule_slot_id").in("schedule_slot_id", slotIds),
    ]);
    if (slots.error) throw new Error(slots.error.message);
    if (roster.error) throw new Error(roster.error.message);
    if (subs.error) throw new Error(subs.error.message);
    if (existingLive.error) {
      const code = (existingLive.error as { code?: string }).code;
      if (code === "42P01") throw new Error("Live scoring migration has not been applied to this database yet");
      throw new Error(existingLive.error.message);
    }
    if (existingFull.error) throw new Error(existingFull.error.message);

    const slotById = new Map((slots.data ?? []).map((s) => [s.id, s]));
    const rosterById = new Map((roster.data ?? []).map((r) => [r.id, { ...r, entry_average: Number(r.entry_average) }]));
    const subsById = new Map((subs.data ?? []).map((r) => [r.id, { ...r, starting_average: r.starting_average != null ? Number(r.starting_average) : null }]));
    const fullSet = new Set((existingFull.data ?? []).map((r) => r.schedule_slot_id));
    const liveById = new Map(((existingLive.data as unknown) as LiveMatchRow[] | null ?? []).map((r) => [r.schedule_slot_id, r]));

    // Build one upsert row per matchup.
    const upserts: Record<string, unknown>[] = [];
    for (const m of data.matches) {
      const slot = slotById.get(m.slotId);
      if (!slot) throw new Error(`Slot ${m.slotId} not found`);
      if (slot.week_id !== week.id) throw new Error("Live scoring is limited to the final week");
      if (fullSet.has(m.slotId)) {
        throw new Error(`A full result already exists for slot ${m.slotId}; remove it before live scoring`);
      }
      if (!slot.bowler_a_id || !slot.bowler_b_id) {
        throw new Error("Slot missing bowler assignments");
      }
      const rA = rosterById.get(slot.bowler_a_id);
      const rB = rosterById.get(slot.bowler_b_id);
      if (!rA || !rB) throw new Error("Scheduled bowler(s) missing from roster");

      const resolveSide = (
        sched: { id: string; name: string; entry_average: number },
        sd: z.infer<typeof sideDraftSchema>,
        side: "A" | "B",
      ): LiveSideJson => {
        // Absent is intentionally not allowed here — spec: use Results editor.
        if (sd.status === "rostered") {
          const r = resolveEffectiveScoring({
            status: "rostered", scheduledEntryAverage: sched.entry_average,
            submittedSubStartingAverage: null, poolSubStartingAverage: null,
          });
          if (!r.ok) throw new Error(`Side ${side}: ${r.error}`);
          return buildLiveSideJson({
            scheduledId: sched.id, scheduledName: sched.name, status: "rostered",
            actualId: sched.id, actualName: sched.name, entryAverage: r.value.entry,
          });
        }
        // substitute
        if (!sd.substituteId) throw new Error(`Side ${side}: substitute must be selected`);
        const sub = subsById.get(sd.substituteId);
        if (!sub) throw new Error(`Side ${side}: substitute not found in pool`);
        if (!sub.active || sub.archived) throw new Error(`Side ${side}: substitute is inactive/archived`);
        const r = resolveEffectiveScoring({
          status: "substitute", scheduledEntryAverage: sched.entry_average,
          submittedSubStartingAverage: sd.substituteStartingAverage ?? null,
          poolSubStartingAverage: sub.starting_average,
        });
        if (!r.ok) throw new Error(`Side ${side}: ${r.error}`);
        return buildLiveSideJson({
          scheduledId: sched.id, scheduledName: sched.name, status: "substitute",
          actualId: sub.id, actualName: sub.name, entryAverage: r.value.entry,
        });
      };

      // Freeze participation identity at first save. If a prior live row
      // exists and the requested side matches (same status + same actual id
      // for substitutes), reuse the frozen JSON exactly so later Game N
      // saves cannot silently recalc entry averages against a shifted pool.
      const prior = liveById.get(m.slotId);
      const anyGameSaved =
        prior != null &&
        (prior.a_game1 != null || prior.a_game2 != null || prior.a_game3 != null ||
         prior.b_game1 != null || prior.b_game2 != null || prior.b_game3 != null);
      const sameIdentity = (
        priorSide: LiveSideJson | undefined,
        sd: z.infer<typeof sideDraftSchema>,
      ): boolean => {
        if (!priorSide) return false;
        if (priorSide.status !== sd.status) return false;
        if (sd.status === "substitute") return (priorSide.actualId ?? "") === (sd.substituteId ?? "");
        return true;
      };
      const sideA = anyGameSaved && sameIdentity(prior?.side_a, m.sideA)
        ? (prior!.side_a as LiveSideJson)
        : resolveSide(rA, m.sideA, "A");
      const sideB = anyGameSaved && sameIdentity(prior?.side_b, m.sideB)
        ? (prior!.side_b as LiveSideJson)
        : resolveSide(rB, m.sideB, "B");

      const gameCol = (side: "A" | "B", n: 1 | 2 | 3) =>
        (side === "A" ? "a_game" : "b_game") + String(n);

      const row: Record<string, unknown> = {
        schedule_slot_id: slot.id,
        week_id: slot.week_id,
        season_id: seasonId,
        side_a: sideA,
        side_b: sideB,
        a_game1: prior?.a_game1 ?? null, a_game2: prior?.a_game2 ?? null, a_game3: prior?.a_game3 ?? null,
        b_game1: prior?.b_game1 ?? null, b_game2: prior?.b_game2 ?? null, b_game3: prior?.b_game3 ?? null,
        entered_by: context.userId,
      };
      row[gameCol("A", data.gameNumber)] = m.scoreA;
      row[gameCol("B", data.gameNumber)] = m.scoreB;
      upserts.push(row);
    }

    // Do the upsert.
    const up = await (context.supabase as unknown as AnySb)
      .from("live_match_results")
      .upsert(upserts as unknown as never[], { onConflict: "schedule_slot_id" });
    if (up.error) throw new Error(`live save failed: ${up.error.message}`);

    // Recompute week `completed` flag: every scheduled slot must be either
    // a full result or a score-only live row with ALL 3 pairs completed.
    await recomputeWeekCompleted(context.supabase, week.id);

    // One snapshot rebuild for the whole batch.
    await rebuildAndSaveSnapshot(context.supabase, seasonId);
    return { ok: true, saved: upserts.length };
  });

/** Recompute the `weeks.completed` flag for the given week id, considering
 *  both full match_results AND fully-completed live_match_results. */
async function recomputeWeekCompleted(sb: Sb, weekId: string): Promise<void> {
  const wkSlots = await sb.from("schedule_slots").select("id").eq("week_id", weekId);
  if (wkSlots.error) throw new Error(wkSlots.error.message);
  const slotIds = (wkSlots.data ?? []).map((s) => s.id);
  if (slotIds.length === 0) {
    await sb.from("weeks").update({ completed: false }).eq("id", weekId);
    return;
  }
  const full = await sb.from("match_results")
    .select("schedule_slot_id").in("schedule_slot_id", slotIds);
  if (full.error) throw new Error(full.error.message);
  const fullSet = new Set((full.data ?? []).map((r) => r.schedule_slot_id));
  const remaining = slotIds.filter((id) => !fullSet.has(id));

  let completedLive = 0;
  if (remaining.length > 0) {
    const live = await (sb as unknown as AnySb)
      .from("live_match_results")
      .select("schedule_slot_id, a_game1, a_game2, a_game3, b_game1, b_game2, b_game3")
      .in("schedule_slot_id", remaining);
    if (!live.error) {
      for (const row of (live.data ?? []) as LiveMatchRow[]) {
        const mask = pairCompletedMask(row);
        if (mask[0] && mask[1] && mask[2]) completedLive += 1;
      }
    }
    // 42P01 → treat live table as empty; nothing else must fail hard.
  }
  const completed = (fullSet.size + completedLive) === slotIds.length;
  await sb.from("weeks").update({ completed }).eq("id", weekId);
}

/** Delete a live row (admin recovery). Idempotent. */
export const deleteLiveMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ slotId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const seasonId = await currentSeasonId(context);
    const del = await (context.supabase as unknown as AnySb)
      .from("live_match_results").delete().eq("schedule_slot_id", data.slotId);
    if (del.error) {
      const code = (del.error as { code?: string }).code;
      if (code === "42P01") return { ok: true, deleted: false };
      throw new Error(del.error.message);
    }
    await rebuildAndSaveSnapshot(context.supabase, seasonId);
    return { ok: true, deleted: true };
  });
