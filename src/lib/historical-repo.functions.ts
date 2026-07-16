/**
 * Historical (non-current-season) data server functions.
 *
 * PROTECTIONS
 * ───────────
 * • Every write uses `requireSupabaseAuth` + `ensureAdmin`, AND validates
 *   server-side that the target season is NOT the current season. The DB
 *   also enforces this via `season_is_historical_writable(season_id)` in
 *   the RLS policy — this is defense in depth.
 * • Every public read runs through `getPublicHistoricalSnapshot` /
 *   `getPublicHistoricalSeason` which refuses drafts and archived-but-
 *   private seasons even for a hand-crafted UUID.
 *
 * SCOPING
 * ───────
 * Nothing in this file reads or writes:
 *   - weeks, schedule_slots, match_results, live_match_results
 *   - public_snapshots
 * The current-season pipeline (buildFullSnapshot / rebuildAndSaveSnapshot)
 * is not imported and cannot be triggered from here.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  computeHistoricalMatch,
  type HistoricalPointSystem,
  type HistoricalDetailMode,
  type HistoricalSideInput,
} from "@/lib/historical-scoring";
import {
  buildHistoricalStandings,
  dedupeHistoricalContributions,
  type HistoricalCareerContribution,
  type HistoricalMatch,
  type HistoricalParticipantMeta,
  type HistoricalSnapshot,
  type HistoricalWeekSummary,
} from "@/lib/historical-snapshot";
import { compareLanePairSlotCamel, compareLanePairSlotSnake } from "@/lib/lane-pair-order";

type Sb = SupabaseClient<Database>;
type AuthedCtx = { supabase: Sb; userId: string };
// Generated types don't know about the historical_* tables yet.
type LooseFrom = (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

const MISSING_TABLE = "42P01";
const MISSING_COLUMN = "42703";

async function ensureAdmin(context: AuthedCtx): Promise<void> {
  const { data, error } = await context.supabase.rpc("current_user_is_admin");
  if (error) throw new Error(`admin check failed: ${error.message}`);
  if (data !== true) throw new Error("Forbidden: admin role required");
}

/** Server-side check: refuse to touch the current season through the
 *  historical write path. Belt-and-braces with the RLS predicate. */
async function ensureNonCurrentSeason(sb: Sb, seasonId: string): Promise<{
  id: string; label: string; pointSystem: HistoricalPointSystem; totalWeeks: number | null;
  status: string; publicVisible: boolean; handicapPercent: number | null; handicapBase: number | null;
}> {
  const q = await (sb.from as unknown as LooseFrom)("seasons")
    .select("id,label,is_current,status,public_visible,point_system,total_weeks,handicap_percent,handicap_base")
    .eq("id", seasonId).maybeSingle();
  if (q.error) {
    if (isMissingColumn(q.error.code)) {
      throw new Error("Historical data requires the multi-season migration.");
    }
    throw new Error(q.error.message);
  }
  if (!q.data) throw new Error("Season not found.");
  if (q.data.is_current === true) {
    throw new Error("Refusing historical write against the CURRENT season. Historical data is for archived/draft seasons only.");
  }
  const ps = (q.data.point_system as number | null) ?? 7;
  return {
    id: String(q.data.id),
    label: String(q.data.label ?? ""),
    pointSystem: (ps === 4 ? 4 : 7),
    totalWeeks: (q.data.total_weeks as number | null) ?? null,
    status: String(q.data.status ?? (q.data.is_current ? "current" : "draft")),
    publicVisible: q.data.public_visible === true,
    handicapPercent: (q.data.handicap_percent as number | null) ?? null,
    handicapBase: (q.data.handicap_base as number | null) ?? null,
  };
}

function isMissingTable(code: string | undefined | null): boolean { return code === MISSING_TABLE; }
function isMissingColumn(code: string | undefined | null): boolean { return code === MISSING_COLUMN; }

// ---------------- Cross-table scope + config validators --------------------
// Every write goes through these — RLS/triggers are the DB backstop, but
// server-side rejection produces clean error messages and stops bad
// payloads before they hit the DB.

async function assertWeekInSeason(sb: Sb, weekId: string, seasonId: string): Promise<{
  id: string; seasonId: string; weekNumber: number; published: boolean;
}> {
  const q = await (sb.from as unknown as LooseFrom)("historical_weeks")
    .select("id,season_id,week_number,published").eq("id", weekId).maybeSingle();
  if (q.error) throw new Error(q.error.message);
  if (!q.data) throw new Error("Week not found.");
  if (String(q.data.season_id) !== seasonId) {
    throw new Error("Week does not belong to this season.");
  }
  return {
    id: String(q.data.id), seasonId: String(q.data.season_id),
    weekNumber: Number(q.data.week_number), published: q.data.published === true,
  };
}

async function assertSlotInWeekAndSeason(
  sb: Sb, slotId: string, weekId: string, seasonId: string,
): Promise<{ id: string; lanePair: string; slot: number; bowlerARef: string; bowlerBRef: string }> {
  const q = await (sb.from as unknown as LooseFrom)("historical_schedule_slots")
    .select("id,season_id,week_id,lane_pair,slot,bowler_a_ref,bowler_b_ref")
    .eq("id", slotId).maybeSingle();
  if (q.error) throw new Error(q.error.message);
  if (!q.data) throw new Error("Schedule slot not found.");
  if (String(q.data.season_id) !== seasonId || String(q.data.week_id) !== weekId) {
    throw new Error("Slot does not belong to the supplied week / season.");
  }
  return {
    id: String(q.data.id), lanePair: String(q.data.lane_pair), slot: Number(q.data.slot),
    bowlerARef: String(q.data.bowler_a_ref), bowlerBRef: String(q.data.bowler_b_ref),
  };
}

interface LanePairCfg { label: string; matchupCapacity: number; active: boolean }

async function loadLanePairConfig(sb: Sb, seasonId: string): Promise<LanePairCfg[]> {
  const q = await (sb.from as unknown as LooseFrom)("season_lane_pairs")
    .select("label,matchup_capacity,active").eq("season_id", seasonId);
  if (q.error) return [];
  return ((q.data as Array<Record<string, unknown>>) ?? []).map((r) => ({
    label: String(r.label),
    matchupCapacity: Number(r.matchup_capacity ?? 0),
    active: r.active !== false,
  }));
}

function assertLanePairAndSlot(pairs: LanePairCfg[], lanePair: string, slot: number): void {
  if (pairs.length === 0) return; // legacy season without configured lane pairs — do not block
  const cfg = pairs.find((p) => p.label === lanePair && p.active);
  if (!cfg) {
    throw new Error(`Lane pair "${lanePair}" is not configured / active for this season.`);
  }
  if (slot < 1 || slot > cfg.matchupCapacity) {
    throw new Error(`Slot ${slot} exceeds capacity ${cfg.matchupCapacity} for lane pair ${lanePair}.`);
  }
}

/** Look up rostered_bowlers ids for this season; used to gate scheduled
 *  A/B pickers to roster-only participants (substitutes may only appear
 *  as ACTUAL participants inside a result). Returns an empty set if the
 *  table is unreachable — callers should treat that as "unknown" and
 *  fall back on the DB constraint. */
async function loadRosterIds(sb: Sb, seasonId: string): Promise<Set<string>> {
  const q = await (sb.from as unknown as LooseFrom)("rostered_bowlers")
    .select("id").eq("season_id", seasonId);
  if (q.error) return new Set();
  return new Set(((q.data as Array<{ id: string }>) ?? []).map((r) => String(r.id)));
}

// -------------------- Server publishable client (public reads) --------------

let _publicClient: Sb | undefined;
function makePublicClient(): Sb {
  if (_publicClient) return _publicClient;
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL) ?? "";
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY) ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not configured");
  _publicClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if ((key.startsWith("sb_publishable_") || key.startsWith("sb_secret_"))
            && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
  return _publicClient;
}

// =============================================================
// WEEKS
// =============================================================

export interface HistoricalWeekRow {
  id: string; seasonId: string; weekNumber: number;
  date: string | null; published: boolean; completed: boolean;
}

function mapWeek(r: Record<string, unknown>): HistoricalWeekRow {
  return {
    id: String(r.id), seasonId: String(r.season_id),
    weekNumber: Number(r.week_number),
    date: (r.date as string | null) ?? null,
    published: r.published === true,
    completed: r.completed === true,
  };
}

export const adminListHistoricalWeeks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const q = await (context.supabase.from as unknown as LooseFrom)("historical_weeks")
      .select("id,season_id,week_number,date,published,completed")
      .eq("season_id", data.seasonId)
      .order("week_number", { ascending: true });
    if (q.error) {
      if (isMissingTable(q.error.code)) return { available: false, weeks: [] as HistoricalWeekRow[] };
      throw new Error(q.error.message);
    }
    return { available: true, weeks: (q.data ?? []).map(mapWeek) };
  });

export const adminGenerateHistoricalWeeks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({
    seasonId: z.string().uuid(),
    totalWeeks: z.number().int().min(1).max(60),
  }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    // Upsert weeks 1..N, never clobbering existing dates/published.
    const existing = await (context.supabase.from as unknown as LooseFrom)("historical_weeks")
      .select("week_number").eq("season_id", data.seasonId);
    if (existing.error && !isMissingTable(existing.error.code)) throw new Error(existing.error.message);
    if (existing.error) throw new Error("Historical schema not available. Apply pending migration first.");
    const have = new Set<number>();
    for (const w of ((existing.data as Array<{ week_number: number }>) ?? [])) have.add(w.week_number);
    const toInsert: Array<Record<string, unknown>> = [];
    for (let n = 1; n <= data.totalWeeks; n++) {
      if (have.has(n)) continue;
      toInsert.push({ season_id: data.seasonId, week_number: n });
    }
    if (toInsert.length === 0) return { inserted: 0 };
    const ins = await (context.supabase.from as unknown as LooseFrom)("historical_weeks").insert(toInsert);
    if (ins.error) throw new Error(ins.error.message);
    return { inserted: toInsert.length };
  });

export const adminUpdateHistoricalWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({
    id: z.string().uuid(),
    seasonId: z.string().uuid(),
    date: z.string().nullable().optional(),
    published: z.boolean().optional(),
    completed: z.boolean().optional(),
  }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    const patch: Record<string, unknown> = {};
    if (data.date !== undefined) patch.date = data.date;
    if (data.published !== undefined) patch.published = data.published;
    if (data.completed !== undefined) patch.completed = data.completed;
    if (Object.keys(patch).length === 0) return { ok: true };
    const upd = await (context.supabase.from as unknown as LooseFrom)("historical_weeks")
      .update(patch).eq("id", data.id).eq("season_id", data.seasonId);
    if (upd.error) throw new Error(upd.error.message);
    return { ok: true };
  });

export const adminDeleteHistoricalWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({
    id: z.string().uuid(), seasonId: z.string().uuid(), confirm: z.literal(true),
  }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    const del = await (context.supabase.from as unknown as LooseFrom)("historical_weeks")
      .delete().eq("id", data.id).eq("season_id", data.seasonId);
    if (del.error) throw new Error(del.error.message);
    return { ok: true };
  });

// =============================================================
// SCHEDULE SLOTS
// =============================================================

export interface HistoricalSlotRow {
  id: string; seasonId: string; weekId: string;
  lanePair: string; slot: number;
  bowlerARef: string; bowlerBRef: string;
  nameA: string | null; nameB: string | null;
  bowlerNumberA: string | null; bowlerNumberB: string | null;
}

function mapSlot(r: Record<string, unknown>): HistoricalSlotRow {
  return {
    id: String(r.id), seasonId: String(r.season_id), weekId: String(r.week_id),
    lanePair: String(r.lane_pair), slot: Number(r.slot),
    bowlerARef: String(r.bowler_a_ref), bowlerBRef: String(r.bowler_b_ref),
    nameA: (r.name_a as string | null) ?? null,
    nameB: (r.name_b as string | null) ?? null,
    bowlerNumberA: (r.bowler_number_a as string | null) ?? null,
    bowlerNumberB: (r.bowler_number_b as string | null) ?? null,
  };
}

export const adminListHistoricalSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ weekId: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const q = await (context.supabase.from as unknown as LooseFrom)("historical_schedule_slots")
      .select("*").eq("week_id", data.weekId);
    if (q.error) {
      if (isMissingTable(q.error.code)) return { available: false, slots: [] as HistoricalSlotRow[] };
      throw new Error(q.error.message);
    }
    const slots = ((q.data as Array<Record<string, unknown>>) ?? []).map(mapSlot);
    slots.sort(compareLanePairSlotCamel);
    return { available: true, slots };
  });

/** Loader that returns every slot in a season, grouped by week — public
 *  archived pages reuse this via a filtered snapshot. */

const slotSchema = z.object({
  id: z.string().uuid().optional(),
  seasonId: z.string().uuid(),
  weekId: z.string().uuid(),
  lanePair: z.string().min(1).max(20),
  slot: z.number().int().min(1).max(64),
  bowlerARef: z.string().min(1),
  bowlerBRef: z.string().min(1),
  nameA: z.string().max(120).nullable(),
  nameB: z.string().max(120).nullable(),
  bowlerNumberA: z.string().max(10).nullable(),
  bowlerNumberB: z.string().max(10).nullable(),
  /** Explicit acknowledgment for editing / adding within a published
   *  week. Blocks accidental changes to already-published data. */
  allowPublished: z.boolean().optional(),
});

export const adminUpsertHistoricalScheduleSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => slotSchema.parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    const week = await assertWeekInSeason(context.supabase, data.weekId, data.seasonId);
    if (week.published && data.allowPublished !== true) {
      throw new Error(`Week ${week.weekNumber} is published. Set allowPublished=true to modify.`);
    }
    // Lane pair must exist in season_lane_pairs config; slot within capacity.
    const pairs = await loadLanePairConfig(context.supabase, data.seasonId);
    assertLanePairAndSlot(pairs, data.lanePair, data.slot);

    // Scheduled A/B must be rostered bowlers only. Substitutes may appear
    // only as ACTUAL participants inside a result.
    const rosterIds = await loadRosterIds(context.supabase, data.seasonId);
    if (rosterIds.size > 0) {
      if (!rosterIds.has(data.bowlerARef)) {
        throw new Error(`${data.nameA ?? data.bowlerARef} is not a rostered bowler for this season. Substitutes cannot be scheduled — they can only appear as an actual participant in results.`);
      }
      if (!rosterIds.has(data.bowlerBRef)) {
        throw new Error(`${data.nameB ?? data.bowlerBRef} is not a rostered bowler for this season. Substitutes cannot be scheduled — they can only appear as an actual participant in results.`);
      }
    }
    if (data.bowlerARef === data.bowlerBRef) {
      throw new Error("A bowler cannot face themselves.");
    }
    // Duplicate-participant-in-week guard.
    const dup = await (context.supabase.from as unknown as LooseFrom)("historical_schedule_slots")
      .select("id,bowler_a_ref,bowler_b_ref").eq("week_id", data.weekId);
    if (!dup.error) {
      for (const r of (dup.data as Array<{ id: string; bowler_a_ref: string; bowler_b_ref: string }>) ?? []) {
        if (data.id && r.id === data.id) continue;
        if (r.bowler_a_ref === data.bowlerARef || r.bowler_b_ref === data.bowlerARef) {
          throw new Error(`${data.nameA ?? data.bowlerARef} is already scheduled in another slot this week.`);
        }
        if (r.bowler_a_ref === data.bowlerBRef || r.bowler_b_ref === data.bowlerBRef) {
          throw new Error(`${data.nameB ?? data.bowlerBRef} is already scheduled in another slot this week.`);
        }
      }
    }
    const payload = {
      season_id: data.seasonId, week_id: data.weekId,
      lane_pair: data.lanePair, slot: data.slot,
      bowler_a_ref: data.bowlerARef, bowler_b_ref: data.bowlerBRef,
      name_a: data.nameA, name_b: data.nameB,
      bowler_number_a: data.bowlerNumberA, bowler_number_b: data.bowlerNumberB,
    };
    if (data.id) {
      const upd = await (context.supabase.from as unknown as LooseFrom)("historical_schedule_slots")
        .update(payload).eq("id", data.id).eq("season_id", data.seasonId)
        .select("id").single();
      if (upd.error) throw new Error(upd.error.message);
      return { id: String(upd.data.id) };
    }
    const ins = await (context.supabase.from as unknown as LooseFrom)("historical_schedule_slots")
      .insert(payload).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    return { id: String(ins.data.id) };
  });

export const adminDeleteHistoricalScheduleSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({
    id: z.string().uuid(), seasonId: z.string().uuid(),
    allowPublished: z.boolean().optional(),
    confirm: z.literal(true),
  }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    // Fetch week to check published — cheap round-trip.
    const cur = await (context.supabase.from as unknown as LooseFrom)("historical_schedule_slots")
      .select("week_id").eq("id", data.id).maybeSingle();
    if (!cur.error && cur.data) {
      const week = await assertWeekInSeason(context.supabase, String(cur.data.week_id), data.seasonId);
      if (week.published && data.allowPublished !== true) {
        throw new Error(`Week ${week.weekNumber} is published. Set allowPublished=true to remove.`);
      }
    }
    const del = await (context.supabase.from as unknown as LooseFrom)("historical_schedule_slots")
      .delete().eq("id", data.id).eq("season_id", data.seasonId);
    if (del.error) throw new Error(del.error.message);
    return { ok: true };
  });

// =============================================================
// MATCH RESULTS (full linescore + game-scores)
// =============================================================

const participationSchema = z.object({
  status: z.enum(["rostered", "substitute", "absent"]),
  actualRef: z.string().min(1),
  actualName: z.string().min(1).max(120),
  entryAverage: z.number().min(0).max(300),
  handicap: z.number().min(0).max(300),
  absentScores: z.tuple([z.number(), z.number(), z.number()]).nullable().optional(),
});

const gameScoreTuple = z.tuple([
  z.number().int().min(0).max(300),
  z.number().int().min(0).max(300),
  z.number().int().min(0).max(300),
]).nullable();

const resultSchema = z.object({
  seasonId: z.string().uuid(),
  weekId: z.string().uuid(),
  slotId: z.string().uuid(),
  detailMode: z.enum(["full_linescore", "game_scores"]),
  sideA: participationSchema,
  sideB: participationSchema,
  gameScoresA: gameScoreTuple,
  gameScoresB: gameScoreTuple,
  linescoreA: z.unknown().nullable().optional(),
  linescoreB: z.unknown().nullable().optional(),
  pointOverride: z.object({
    pointsA: z.number().min(0),
    pointsB: z.number().min(0),
    reason: z.string().max(500).optional(),
  }).nullable().optional(),
});

function participationInput(p: z.infer<typeof participationSchema>, scores: [number, number, number] | null): HistoricalSideInput {
  if (p.status === "absent") {
    return {
      gameScores: [null, null, null],
      handicap: p.handicap,
      participation: {
        status: "absent",
        absentScores: p.absentScores ?? undefined,
      },
    };
  }
  return {
    gameScores: scores ?? [null, null, null],
    handicap: p.handicap,
    participation: { status: p.status },
  };
}

export const adminSaveHistoricalMatchResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => resultSchema.parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const season = await ensureNonCurrentSeason(context.supabase, data.seasonId);

    // full_linescore MUST come with three game scores derived from the
    // linescore (client freezes them into gameScoresA/B before save).
    if (data.detailMode === "full_linescore" && (!data.gameScoresA || !data.gameScoresB)) {
      throw new Error("Full linescore save requires game totals for both sides.");
    }
    if (data.detailMode === "game_scores" && (!data.gameScoresA || !data.gameScoresB)) {
      throw new Error("Game-score entry requires three scores per side.");
    }

    const sideA = participationInput(data.sideA, data.gameScoresA ?? null);
    const sideB = participationInput(data.sideB, data.gameScoresB ?? null);
    const outcome = computeHistoricalMatch({
      pointSystem: season.pointSystem, sideA, sideB,
      override: data.pointOverride ?? null,
    });

    const derived = {
      pointSystem: season.pointSystem,
      detailMode: data.detailMode,
      a: outcome.a, b: outcome.b,
      finalPointsA: outcome.finalPointsA, finalPointsB: outcome.finalPointsB,
      winner: outcome.winner,
      override: outcome.override,
    };

    const payload = {
      season_id: data.seasonId, week_id: data.weekId, slot_id: data.slotId,
      detail_mode: data.detailMode,
      side_a: data.sideA, side_b: data.sideB,
      linescore_a: data.detailMode === "full_linescore" ? data.linescoreA ?? null : null,
      linescore_b: data.detailMode === "full_linescore" ? data.linescoreB ?? null : null,
      game_scores_a: data.gameScoresA,
      game_scores_b: data.gameScoresB,
      points_a: outcome.finalPointsA,
      points_b: outcome.finalPointsB,
      point_override: data.pointOverride ?? null,
      derived,
    };
    const up = await (context.supabase.from as unknown as LooseFrom)("historical_match_results")
      .upsert(payload, { onConflict: "slot_id" });
    if (up.error) throw new Error(up.error.message);

    // Rebuild the historical snapshot immediately (cheap — no solver).
    await rebuildHistoricalSnapshotServer(context.supabase, data.seasonId);
    return { ok: true, points: { a: outcome.finalPointsA, b: outcome.finalPointsB } };
  });

export const adminDeleteHistoricalMatchResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({
    slotId: z.string().uuid(), seasonId: z.string().uuid(), confirm: z.literal(true),
  }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    const del = await (context.supabase.from as unknown as LooseFrom)("historical_match_results")
      .delete().eq("slot_id", data.slotId).eq("season_id", data.seasonId);
    if (del.error) throw new Error(del.error.message);
    await rebuildHistoricalSnapshotServer(context.supabase, data.seasonId);
    return { ok: true };
  });

// =============================================================
// SUMMARY RECORDS
// =============================================================

const summarySchema = z.object({
  id: z.string().uuid().optional(),
  seasonId: z.string().uuid(),
  participantRef: z.string().min(1),
  personId: z.string().uuid().nullable().optional(),
  role: z.enum(["rostered", "substitute"]),
  displayName: z.string().min(1).max(120),
  bowlerNumber: z.string().max(10).nullable().optional(),
  games: z.number().int().min(0).max(500).nullable().optional(),
  scratchPinfall: z.number().int().min(0).max(200000).nullable().optional(),
  average: z.number().min(0).max(300).nullable().optional(),
  highGame: z.number().int().min(0).max(300).nullable().optional(),
  highSet: z.number().int().min(0).max(900).nullable().optional(),
  points: z.number().min(0).max(500).nullable().optional(),
  pointsLost: z.number().min(0).max(500).nullable().optional(),
  finalFinish: z.number().int().min(1).max(200).nullable().optional(),
  isChampion: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const adminUpsertHistoricalSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => summarySchema.parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    const payload = {
      season_id: data.seasonId,
      participant_ref: data.participantRef,
      person_id: data.personId ?? null,
      role: data.role,
      display_name: data.displayName.trim(),
      bowler_number: data.bowlerNumber ?? null,
      games: data.games ?? null,
      scratch_pinfall: data.scratchPinfall ?? null,
      average: data.average ?? null,
      high_game: data.highGame ?? null,
      high_set: data.highSet ?? null,
      points: data.points ?? null,
      points_lost: data.pointsLost ?? null,
      final_finish: data.finalFinish ?? null,
      is_champion: data.isChampion === true,
      notes: data.notes ?? null,
    };
    const up = await (context.supabase.from as unknown as LooseFrom)("historical_season_summary_records")
      .upsert(payload, { onConflict: "season_id,participant_ref,role" });
    if (up.error) throw new Error(up.error.message);
    await rebuildHistoricalSnapshotServer(context.supabase, data.seasonId);
    return { ok: true };
  });

export const adminDeleteHistoricalSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({
    id: z.string().uuid(), seasonId: z.string().uuid(), confirm: z.literal(true),
  }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    const del = await (context.supabase.from as unknown as LooseFrom)("historical_season_summary_records")
      .delete().eq("id", data.id).eq("season_id", data.seasonId);
    if (del.error) throw new Error(del.error.message);
    await rebuildHistoricalSnapshotServer(context.supabase, data.seasonId);
    return { ok: true };
  });

export const adminListHistoricalSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const q = await (context.supabase.from as unknown as LooseFrom)("historical_season_summary_records")
      .select("*").eq("season_id", data.seasonId);
    if (q.error) {
      if (isMissingTable(q.error.code)) return { available: false, records: [] };
      throw new Error(q.error.message);
    }
    return { available: true, records: (q.data ?? []).map(mapSummaryRow) };
  });

function mapSummaryRow(r: Record<string, unknown>): HistoricalSnapshot["summaryRecords"][number] & { id: string } {
  return {
    id: String(r.id),
    participantRef: String(r.participant_ref),
    personId: (r.person_id as string | null) ?? null,
    role: (r.role as "rostered" | "substitute"),
    displayName: String(r.display_name),
    bowlerNumber: (r.bowler_number as string | null) ?? null,
    games: (r.games as number | null) ?? null,
    scratchPinfall: (r.scratch_pinfall as number | null) ?? null,
    average: r.average != null ? Number(r.average) : null,
    highGame: (r.high_game as number | null) ?? null,
    highSet: (r.high_set as number | null) ?? null,
    points: r.points != null ? Number(r.points) : null,
    pointsLost: r.points_lost != null ? Number(r.points_lost) : null,
    finalFinish: (r.final_finish as number | null) ?? null,
    isChampion: r.is_champion === true,
  };
}

// =============================================================
// SNAPSHOT REBUILD
// =============================================================

async function loadParticipants(sb: Sb, seasonId: string): Promise<HistoricalParticipantMeta[]> {
  const [rb, sub] = await Promise.all([
    (sb.from as unknown as LooseFrom)("rostered_bowlers")
      .select("id,name,bowler_number,entry_average,handicap,person_id").eq("season_id", seasonId),
    (sb.from as unknown as LooseFrom)("substitutes")
      .select("id,name,bowler_number,starting_average,handicap,person_id").eq("season_id", seasonId),
  ]);
  const out: HistoricalParticipantMeta[] = [];
  for (const r of ((rb.error ? [] : rb.data) as Array<Record<string, unknown>>) ?? []) {
    out.push({
      ref: String(r.id), personId: (r.person_id as string | null) ?? null,
      displayName: String(r.name ?? ""),
      bowlerNumber: (r.bowler_number as string | null) ?? null,
      startingAverage: r.entry_average != null ? Number(r.entry_average) : null,
      handicap: r.handicap != null ? Number(r.handicap) : null,
      role: "rostered",
    });
  }
  for (const r of ((sub.error ? [] : sub.data) as Array<Record<string, unknown>>) ?? []) {
    out.push({
      ref: String(r.id), personId: (r.person_id as string | null) ?? null,
      displayName: String(r.name ?? ""),
      bowlerNumber: (r.bowler_number as string | null) ?? null,
      startingAverage: r.starting_average != null ? Number(r.starting_average) : null,
      handicap: r.handicap != null ? Number(r.handicap) : null,
      role: "substitute",
    });
  }
  return out;
}

/** Server-only helper: rebuild + save historical snapshot from current
 *  historical_weeks / _schedule_slots / _match_results / _summary_records. */
export async function rebuildHistoricalSnapshotServer(sb: Sb, seasonId: string): Promise<void> {
  const seasonInfo = await ensureNonCurrentSeason(sb, seasonId);

  const [weeksQ, slotsQ, resultsQ, summaryQ, participants] = await Promise.all([
    (sb.from as unknown as LooseFrom)("historical_weeks")
      .select("*").eq("season_id", seasonId).order("week_number", { ascending: true }),
    (sb.from as unknown as LooseFrom)("historical_schedule_slots")
      .select("*").eq("season_id", seasonId),
    (sb.from as unknown as LooseFrom)("historical_match_results")
      .select("*").eq("season_id", seasonId),
    (sb.from as unknown as LooseFrom)("historical_season_summary_records")
      .select("*").eq("season_id", seasonId),
    loadParticipants(sb, seasonId),
  ]);

  const weeksRaw = (weeksQ.error ? [] : weeksQ.data) as Array<Record<string, unknown>>;
  const slotsRaw = (slotsQ.error ? [] : slotsQ.data) as Array<Record<string, unknown>>;
  const resultsRaw = (resultsQ.error ? [] : resultsQ.data) as Array<Record<string, unknown>>;
  const summaryRaw = (summaryQ.error ? [] : summaryQ.data) as Array<Record<string, unknown>>;

  const slotsByWeek = new Map<string, Array<Record<string, unknown>>>();
  for (const s of slotsRaw) {
    const wid = String(s.week_id);
    const arr = slotsByWeek.get(wid) ?? [];
    arr.push(s);
    slotsByWeek.set(wid, arr);
  }
  const resultBySlot = new Map<string, Record<string, unknown>>();
  for (const r of resultsRaw) resultBySlot.set(String(r.slot_id), r);

  const weeks: HistoricalWeekSummary[] = weeksRaw.map((w) => {
    const wid = String(w.id);
    const slotList = (slotsByWeek.get(wid) ?? [])
      .slice()
      .sort((a, b) => {
        const la = String(a.lane_pair), lb = String(b.lane_pair);
        return compareLanePairSlotSnake(
          { lane_pair: la, slot: Number(a.slot) },
          { lane_pair: lb, slot: Number(b.slot) },
        );
      });
    const matches: HistoricalMatch[] = [];
    for (const s of slotList) {
      const sid = String(s.id);
      const r = resultBySlot.get(sid);
      if (!r) continue;
      const derived = r.derived as (null | {
        detailMode: HistoricalDetailMode;
        a: { gameScoresScratch: [number, number, number]; gameScoresHandicap: [number, number, number]; scratchTotal: number; handicapTotal: number; gameAwards: [number, number, number]; gamePoints: number; setPoint: number; totalPoints: number };
        b: { gameScoresScratch: [number, number, number]; gameScoresHandicap: [number, number, number]; scratchTotal: number; handicapTotal: number; gameAwards: [number, number, number]; gamePoints: number; setPoint: number; totalPoints: number };
        finalPointsA: number; finalPointsB: number; winner: "A" | "B" | "T";
        override: { pointsA: number; pointsB: number } | null;
      });
      if (!derived) continue;
      const sideA = r.side_a as { status: string; actualRef: string; actualName: string; entryAverage: number; handicap: number };
      const sideB = r.side_b as { status: string; actualRef: string; actualName: string; entryAverage: number; handicap: number };
      matches.push({
        slotId: sid,
        weekNumber: Number(w.week_number),
        lanePair: String(s.lane_pair),
        slot: Number(s.slot),
        detailMode: derived.detailMode,
        scheduledA: String(s.bowler_a_ref), scheduledB: String(s.bowler_b_ref),
        actualA: sideA.actualRef, actualB: sideB.actualRef,
        actualNameA: sideA.actualName, actualNameB: sideB.actualName,
        isSubA: sideA.status === "substitute", isSubB: sideB.status === "substitute",
        absentA: sideA.status === "absent",   absentB: sideB.status === "absent",
        entryAverageA: sideA.entryAverage,   entryAverageB: sideB.entryAverage,
        handicapA: sideA.handicap,           handicapB: sideB.handicap,
        scratchGamesA: derived.a.scratchTotal > 0 ? derived.a.gameScoresScratch : null,
        scratchGamesB: derived.b.scratchTotal > 0 ? derived.b.gameScoresScratch : null,
        handicapGamesA: derived.a.gameScoresHandicap,
        handicapGamesB: derived.b.gameScoresHandicap,
        scratchTotalA: derived.a.scratchTotal, scratchTotalB: derived.b.scratchTotal,
        handicapTotalA: derived.a.handicapTotal, handicapTotalB: derived.b.handicapTotal,
        gameAwardsA: derived.a.gameAwards, gameAwardsB: derived.b.gameAwards,
        gamePointsA: derived.a.gamePoints, gamePointsB: derived.b.gamePoints,
        setPointA: derived.a.setPoint, setPointB: derived.b.setPoint,
        totalPointsA: derived.a.totalPoints, totalPointsB: derived.b.totalPoints,
        finalPointsA: derived.finalPointsA, finalPointsB: derived.finalPointsB,
        overrideEnabled: !!derived.override,
        winner: derived.winner,
      });
    }
    return {
      weekNumber: Number(w.week_number),
      date: (w.date as string | null) ?? null,
      published: w.published === true,
      completed: w.completed === true,
      matches,
    };
  });

  const summaryRecords = summaryRaw.map(mapSummaryRow);
  const standings = buildHistoricalStandings({ participants, weeks, summaryRecords });
  const snapshot: HistoricalSnapshot = {
    version: 1,
    builtAt: Date.now(),
    seasonId,
    seasonLabel: seasonInfo.label,
    pointSystem: seasonInfo.pointSystem,
    totalWeeks: seasonInfo.totalWeeks,
    participants,
    weeks,
    standings,
    summaryOnly: weeks.every((w) => w.matches.length === 0) && summaryRecords.length > 0,
    summaryRecords,
  };

  const up = await (sb.from as unknown as LooseFrom)("historical_season_snapshots")
    .upsert({ season_id: seasonId, snapshot, built_at: new Date().toISOString() },
      { onConflict: "season_id" });
  if (up.error) throw new Error(`historical snapshot upsert failed: ${up.error.message}`);
}

export const adminRebuildHistoricalSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await rebuildHistoricalSnapshotServer(context.supabase, data.seasonId);
    return { ok: true };
  });

// =============================================================
// PROGRESS SUMMARY (admin)
// =============================================================

export const adminHistoricalProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const sb = context.supabase;
    const [rc, sc, wc, slc, mrc, smc, snap] = await Promise.all([
      sb.from("rostered_bowlers").select("id", { count: "exact", head: true }).eq("season_id", data.seasonId),
      sb.from("substitutes").select("id", { count: "exact", head: true }).eq("season_id", data.seasonId),
      (sb.from as unknown as LooseFrom)("historical_weeks").select("id", { count: "exact", head: true }).eq("season_id", data.seasonId),
      (sb.from as unknown as LooseFrom)("historical_schedule_slots").select("id", { count: "exact", head: true }).eq("season_id", data.seasonId),
      (sb.from as unknown as LooseFrom)("historical_match_results").select("id", { count: "exact", head: true }).eq("season_id", data.seasonId),
      (sb.from as unknown as LooseFrom)("historical_season_summary_records").select("id", { count: "exact", head: true }).eq("season_id", data.seasonId),
      (sb.from as unknown as LooseFrom)("historical_season_snapshots").select("built_at").eq("season_id", data.seasonId).maybeSingle(),
    ]);
    return {
      rostered: rc.count ?? 0,
      substitutes: sc.count ?? 0,
      weeks: wc.count ?? 0,
      schedules: slc.count ?? 0,
      results: mrc.count ?? 0,
      summaries: smc.count ?? 0,
      snapshotBuiltAt: snap.error ? null : (snap.data?.built_at ?? null),
      historicalAvailable: !wc.error,
    };
  });

// =============================================================
// PUBLIC READS
// =============================================================

async function ensurePublicArchive(sb: Sb, seasonId: string): Promise<{
  id: string; label: string; pointSystem: HistoricalPointSystem;
  totalWeeks: number | null; status: string; publicVisible: boolean;
} | null> {
  const q = await (sb.from as unknown as LooseFrom)("seasons")
    .select("id,label,status,public_visible,point_system,total_weeks,is_current")
    .eq("id", seasonId).maybeSingle();
  if (q.error || !q.data) return null;
  if (q.data.is_current === true) return null;                    // current season not served here
  if (q.data.status !== "archived") return null;
  if (q.data.public_visible !== true) return null;
  const ps = (q.data.point_system as number | null) ?? 7;
  return {
    id: String(q.data.id), label: String(q.data.label),
    pointSystem: (ps === 4 ? 4 : 7),
    totalWeeks: (q.data.total_weeks as number | null) ?? null,
    status: String(q.data.status), publicVisible: q.data.public_visible === true,
  };
}

export const getPublicHistoricalSnapshot = createServerFn({ method: "GET" })
  .inputValidator((v) => z.object({ seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ data }) => {
    const sb = makePublicClient();
    const season = await ensurePublicArchive(sb, data.seasonId);
    if (!season) return { available: false as const, forbidden: true, snapshot: null };
    const q = await (sb.from as unknown as LooseFrom)("historical_season_snapshots")
      .select("snapshot,built_at").eq("season_id", data.seasonId).maybeSingle();
    if (q.error) {
      if (isMissingTable(q.error.code)) return { available: false as const, forbidden: false, snapshot: null };
      throw new Error(q.error.message);
    }
    if (!q.data) return { available: true as const, forbidden: false, snapshot: null, season };
    return {
      available: true as const,
      forbidden: false,
      snapshot: q.data.snapshot as HistoricalSnapshot,
      builtAt: q.data.built_at as string,
      season,
    };
  });

// -----------------------------------------------------------------
// Career contribution loader — used by /people/$personId to fold in
// historical seasons alongside current-season data.
// -----------------------------------------------------------------

export const getHistoricalCareerContributions = createServerFn({ method: "GET" })
  .inputValidator((v) => z.object({ personId: z.string().uuid() }).parse(v))
  .handler(async ({ data }) => {
    const sb = makePublicClient();
    // Snapshot contributions: filter snapshots to public seasons only.
    const snaps = await (sb.from as unknown as LooseFrom)("historical_season_snapshots")
      .select("season_id,snapshot");
    const seasonMeta = new Map<string, { label: string }>();
    if (!snaps.error && snaps.data) {
      const ids = Array.from(new Set((snaps.data as Array<{ season_id: string }>).map((r) => r.season_id)));
      if (ids.length > 0) {
        const sq = await (sb.from as unknown as LooseFrom)("seasons")
          .select("id,label,status,public_visible").in("id", ids);
        for (const s of ((sq.data as Array<{ id: string; label: string; status: string; public_visible: boolean }>) ?? [])) {
          if (s.status === "archived" && s.public_visible) seasonMeta.set(s.id, { label: s.label });
        }
      }
    }

    const rows: HistoricalCareerContribution[] = [];
    if (!snaps.error && snaps.data) {
      for (const row of (snaps.data as Array<{ season_id: string; snapshot: HistoricalSnapshot }>)) {
        const meta = seasonMeta.get(row.season_id);
        if (!meta) continue;
        const snap = row.snapshot;
        // Match participants by personId.
        for (const p of snap.participants ?? []) {
          if (p.personId !== data.personId) continue;
          const standings = (snap.standings ?? []).find((s) => s.participantRef === p.ref) ?? null;
          rows.push({
            seasonId: row.season_id,
            seasonLabel: meta.label,
            role: p.role,
            displayName: p.displayName,
            bowlerNumber: p.bowlerNumber ?? null,
            startingAverage: p.startingAverage ?? null,
            handicap: p.handicap ?? null,
            games: standings?.games ?? null,
            scratchPinfall: standings?.scratchPinfall ?? null,
            average: standings?.scratchAverage ?? null,
            highGame: standings?.highGame ?? null,
            highSet: standings?.highSet ?? null,
            points: standings?.points ?? null,
            finalFinish: standings?.rank ?? null,
            isChampion: (snap.summaryRecords ?? []).some((s) => s.participantRef === p.ref && s.isChampion),
            hasGameData: standings != null && standings.games != null,
            source: "historical_snapshot",
          });
        }
      }
    }

    // Summary-only fallback: rows tagged with this person that snapshot
    // doesn't cover.
    const summ = await (sb.from as unknown as LooseFrom)("historical_season_summary_records")
      .select("season_id,participant_ref,person_id,role,display_name,bowler_number,games,scratch_pinfall,average,high_game,high_set,points,final_finish,is_champion")
      .eq("person_id", data.personId);
    if (!summ.error && summ.data) {
      const summaryIds = Array.from(new Set((summ.data as Array<{ season_id: string }>).map((r) => r.season_id)));
      const missing = summaryIds.filter((id) => !seasonMeta.has(id));
      if (missing.length > 0) {
        const sq = await (sb.from as unknown as LooseFrom)("seasons")
          .select("id,label,status,public_visible").in("id", missing);
        for (const s of ((sq.data as Array<{ id: string; label: string; status: string; public_visible: boolean }>) ?? [])) {
          if (s.status === "archived" && s.public_visible) seasonMeta.set(s.id, { label: s.label });
        }
      }
      for (const r of (summ.data as Array<Record<string, unknown>>)) {
        const sid = String(r.season_id);
        const meta = seasonMeta.get(sid);
        if (!meta) continue;
        rows.push({
          seasonId: sid,
          seasonLabel: meta.label,
          role: r.role as "rostered" | "substitute",
          displayName: String(r.display_name),
          bowlerNumber: (r.bowler_number as string | null) ?? null,
          startingAverage: null,
          handicap: null,
          games: (r.games as number | null) ?? null,
          scratchPinfall: (r.scratch_pinfall as number | null) ?? null,
          average: r.average != null ? Number(r.average) : null,
          highGame: (r.high_game as number | null) ?? null,
          highSet: (r.high_set as number | null) ?? null,
          points: r.points != null ? Number(r.points) : null,
          finalFinish: (r.final_finish as number | null) ?? null,
          isChampion: r.is_champion === true,
          hasGameData: r.games != null,
          source: "historical_summary",
        });
      }
    }

    return { rows: dedupeHistoricalContributions(rows) };
  });
