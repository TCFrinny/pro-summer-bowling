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
  buildHistoricalParticipantStats,
  buildHistoricalStandings,
  dedupeHistoricalContributions,
  filterPublicHistoricalSnapshot,
  type HistoricalCareerContribution,
  type HistoricalMatch,
  type HistoricalParticipantMeta,
  type HistoricalSnapshot,
  type HistoricalWeekSummary,
} from "@/lib/historical-snapshot";
import { compareLanePairSlotCamel, compareLanePairSlotSnake } from "@/lib/lane-pair-order";
import { summarizeGame, validateGame, type FrameLinescore, type GameLinescore } from "@/lib/duckpin";

// ---------------------------------------------------------------
// Canonical linescore parser — NEVER trust browser-supplied derived
// counts (strikes, spares, opens, marks, scratchTotal, segments). The
// only ground truth is the array of frames {frameNumber, mark,
// cumulativeScore}. We re-run summarizeGame + validateGame here, and
// cross-check that the submitted game score matches the recomputed
// scratchTotal. Any mismatch or malformed shape is rejected.
// ---------------------------------------------------------------

function coerceFrameArray(raw: unknown, ctx: string): FrameLinescore[] {
  const framesRaw = Array.isArray(raw) ? raw
    : (raw && typeof raw === "object" && Array.isArray((raw as { frames?: unknown }).frames))
      ? (raw as { frames: unknown[] }).frames
      : null;
  if (!framesRaw) throw new Error(`${ctx}: linescore game must supply a 10-frame array.`);
  if (framesRaw.length !== 10) {
    throw new Error(`${ctx}: linescore game must have exactly 10 frames (got ${framesRaw.length}).`);
  }
  const frames: FrameLinescore[] = [];
  for (let i = 0; i < 10; i++) {
    const f = framesRaw[i] as { frameNumber?: unknown; mark?: unknown; cumulativeScore?: unknown };
    if (!f || typeof f !== "object") throw new Error(`${ctx}: frame ${i + 1} malformed.`);
    const fn = Number(f.frameNumber);
    if (!Number.isInteger(fn) || fn !== i + 1) {
      throw new Error(`${ctx}: frame ${i + 1} numbered ${String(f.frameNumber)}.`);
    }
    if (typeof f.mark !== "string") throw new Error(`${ctx}: frame ${i + 1} mark missing.`);
    const cs = Number(f.cumulativeScore);
    if (!Number.isInteger(cs) || cs < 0) throw new Error(`${ctx}: frame ${i + 1} cumulative invalid.`);
    frames.push({ frameNumber: fn, mark: f.mark, cumulativeScore: cs });
  }
  return frames;
}

/** Parse and canonicalize one side's three-game linescore. Recomputes
 *  strikes/spares/opens/marks/segments/scratchTotal from frames only,
 *  validates with the shared duckpin validator, and rejects if the
 *  submitted per-game total does not equal the recomputed scratchTotal. */
export function canonicalizeSideLinescore(
  rawSide: unknown,
  submittedGameScores: readonly [number, number, number] | null,
  ctx: string,
): [GameLinescore, GameLinescore, GameLinescore] {
  const gamesRaw = Array.isArray(rawSide) ? rawSide
    : (rawSide && typeof rawSide === "object" && Array.isArray((rawSide as { games?: unknown }).games))
      ? (rawSide as { games: unknown[] }).games
      : null;
  if (!gamesRaw || gamesRaw.length !== 3) {
    throw new Error(`${ctx}: linescore must contain exactly 3 games.`);
  }
  const out: GameLinescore[] = [];
  for (let gi = 0; gi < 3; gi++) {
    const gameCtx = `${ctx} game ${gi + 1}`;
    const frames = coerceFrameArray(gamesRaw[gi], gameCtx);
    const canonical = summarizeGame(frames);
    validateGame(canonical, gameCtx);
    if (submittedGameScores) {
      const submitted = submittedGameScores[gi];
      if (canonical.scratchTotal !== submitted) {
        throw new Error(
          `${gameCtx}: submitted game score ${submitted} disagrees with recomputed frame total ${canonical.scratchTotal}.`,
        );
      }
    }
    out.push(canonical);
  }
  return [out[0], out[1], out[2]];
}

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
  // FAIL CLOSED: any DB error blocks writes. Only a missing-table code —
  // which means the multi-season migration hasn't run — falls back to
  // "unconfigured" (assertLanePairAndSlot returns immediately).
  if (q.error) {
    if (isMissingTable(q.error.code)) return [];
    throw new Error(`lane pair config unavailable: ${q.error.message}`);
  }
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

/** Roster ids for the season. FAIL CLOSED: query errors throw. Callers
 *  refuse an empty roster when they attempt to schedule new slots. */
async function loadRosterIds(sb: Sb, seasonId: string): Promise<Set<string>> {
  const q = await (sb.from as unknown as LooseFrom)("rostered_bowlers")
    .select("id").eq("season_id", seasonId);
  if (q.error) throw new Error(`roster unavailable: ${q.error.message}`);
  return new Set(((q.data as Array<{ id: string }>) ?? []).map((r) => String(r.id)));
}

/** Substitute ids for the season, fail-closed. */
async function loadSubstituteIds(sb: Sb, seasonId: string): Promise<Set<string>> {
  const q = await (sb.from as unknown as LooseFrom)("substitutes")
    .select("id").eq("season_id", seasonId);
  if (q.error) throw new Error(`substitutes unavailable: ${q.error.message}`);
  return new Set(((q.data as Array<{ id: string }>) ?? []).map((r) => String(r.id)));
}

/** Load authoritative identity + handicap/entry-average for a rostered
 *  bowler or substitute id in this season. Server-side freeze — never
 *  trust names/averages/handicaps supplied by the browser. */
async function loadFrozenIdentity(sb: Sb, seasonId: string, id: string, role: "rostered" | "substitute"): Promise<{
  ref: string; name: string; bowlerNumber: string | null; entryAverage: number; handicap: number;
} | null> {
  if (role === "rostered") {
    const q = await (sb.from as unknown as LooseFrom)("rostered_bowlers")
      .select("id,name,bowler_number,entry_average,handicap")
      .eq("id", id).eq("season_id", seasonId).maybeSingle();
    if (q.error) throw new Error(q.error.message);
    if (!q.data) return null;
    return {
      ref: String(q.data.id), name: String(q.data.name ?? ""),
      bowlerNumber: (q.data.bowler_number as string | null) ?? null,
      entryAverage: q.data.entry_average != null ? Number(q.data.entry_average) : 0,
      handicap: q.data.handicap != null ? Number(q.data.handicap) : 0,
    };
  }
  const q = await (sb.from as unknown as LooseFrom)("substitutes")
    .select("id,name,bowler_number,starting_average,handicap")
    .eq("id", id).eq("season_id", seasonId).maybeSingle();
  if (q.error) throw new Error(q.error.message);
  if (!q.data) return null;
  return {
    ref: String(q.data.id), name: String(q.data.name ?? ""),
    bowlerNumber: (q.data.bowler_number as string | null) ?? null,
    entryAverage: q.data.starting_average != null ? Number(q.data.starting_average) : 0,
    handicap: q.data.handicap != null ? Number(q.data.handicap) : 0,
  };
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
    /** Required when editing date/completed on a currently-published week. */
    allowPublished: z.boolean().optional(),
    /** Required whenever `published` changes value (publish OR unpublish). */
    confirmPublicationChange: z.boolean().optional(),
  }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    const cur = await assertWeekInSeason(context.supabase, data.id, data.seasonId);
    const wantsPubChange = data.published !== undefined && data.published !== cur.published;
    const wantsDateChange = data.date !== undefined;
    const wantsCompletedChange = data.completed !== undefined;
    if (wantsPubChange && data.confirmPublicationChange !== true) {
      throw new Error(
        `Toggling publication of Week ${cur.weekNumber} requires confirmPublicationChange=true.`,
      );
    }
    if (cur.published && (wantsDateChange || wantsCompletedChange) && data.allowPublished !== true) {
      throw new Error(
        `Week ${cur.weekNumber} is published. Set allowPublished=true to modify date/completed.`,
      );
    }
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
    allowPublished: z.boolean().optional(),
  }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    const w = await assertWeekInSeason(context.supabase, data.id, data.seasonId);
    if (w.published && data.allowPublished !== true) {
      throw new Error(`Week ${w.weekNumber} is published. Set allowPublished=true to delete.`);
    }
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
    // FAIL CLOSED: refuse to insert new slots when the season has no lane
    // configuration at all — a season MUST configure lane pairs before
    // schedule entry so slot bounds/capacities are enforceable.
    const pairs = await loadLanePairConfig(context.supabase, data.seasonId);
    if (!data.id && pairs.length === 0) {
      throw new Error(
        "This season has no lane pairs configured. Configure lane pairs before entering schedule slots.",
      );
    }
    assertLanePairAndSlot(pairs, data.lanePair, data.slot);

    // FAIL CLOSED: roster query throws on error. When inserting, an empty
    // roster means there is nobody legitimately schedulable — refuse.
    const rosterIds = await loadRosterIds(context.supabase, data.seasonId);
    if (!data.id && rosterIds.size === 0) {
      throw new Error("This season has no rostered bowlers yet — add rostered participants before scheduling.");
    }
    if (!rosterIds.has(data.bowlerARef)) {
      throw new Error(`Bowler A is not a rostered bowler for this season. Substitutes may only appear as an actual participant in results, never as a scheduled bowler.`);
    }
    if (!rosterIds.has(data.bowlerBRef)) {
      throw new Error(`Bowler B is not a rostered bowler for this season.`);
    }
    if (data.bowlerARef === data.bowlerBRef) {
      throw new Error("A bowler cannot face themselves.");
    }
    // Freeze display names/numbers from the DB — never trust the client.
    const idA = await loadFrozenIdentity(context.supabase, data.seasonId, data.bowlerARef, "rostered");
    const idB = await loadFrozenIdentity(context.supabase, data.seasonId, data.bowlerBRef, "rostered");
    if (!idA || !idB) throw new Error("Rostered bowler lookup failed.");

    // Duplicate-participant-in-week guard.
    const dup = await (context.supabase.from as unknown as LooseFrom)("historical_schedule_slots")
      .select("id,bowler_a_ref,bowler_b_ref").eq("week_id", data.weekId);
    if (dup.error) throw new Error(`schedule read failed: ${dup.error.message}`);
    for (const r of (dup.data as Array<{ id: string; bowler_a_ref: string; bowler_b_ref: string }>) ?? []) {
      if (data.id && r.id === data.id) continue;
      if (r.bowler_a_ref === data.bowlerARef || r.bowler_b_ref === data.bowlerARef) {
        throw new Error(`${idA.name} is already scheduled in another slot this week.`);
      }
      if (r.bowler_a_ref === data.bowlerBRef || r.bowler_b_ref === data.bowlerBRef) {
        throw new Error(`${idB.name} is already scheduled in another slot this week.`);
      }
    }
    const payload = {
      season_id: data.seasonId, week_id: data.weekId,
      lane_pair: data.lanePair, slot: data.slot,
      bowler_a_ref: data.bowlerARef, bowler_b_ref: data.bowlerBRef,
      name_a: idA.name, name_b: idB.name,
      bowler_number_a: idA.bowlerNumber, bowler_number_b: idB.bowlerNumber,
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
  allowPublished: z.boolean().optional(),
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

/** Compute an explicit availability flag per side, matching the 2026
 *  hasScores rule: a side has game data iff it bowled OR is absent-with-
 *  scores. Absent-without-scores has NO data — the snapshot must render
 *  `—`, not zero. */
function sideHasScores(p: z.infer<typeof participationSchema>): boolean {
  if (p.status === "absent") return Array.isArray(p.absentScores);
  return true;
}

export const adminSaveHistoricalMatchResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => resultSchema.parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const season = await ensureNonCurrentSeason(context.supabase, data.seasonId);
    const week = await assertWeekInSeason(context.supabase, data.weekId, data.seasonId);
    const slot = await assertSlotInWeekAndSeason(context.supabase, data.slotId, data.weekId, data.seasonId);
    if (week.published && data.allowPublished !== true) {
      throw new Error(`Week ${week.weekNumber} is published. Set allowPublished=true to modify.`);
    }

    // Authoritative participant validation — freeze identity server-side.
    const subIds = await loadSubstituteIds(context.supabase, data.seasonId);
    async function resolveSide(sideLabel: "A" | "B", side: z.infer<typeof participationSchema>) {
      const scheduledRef = sideLabel === "A" ? slot.bowlerARef : slot.bowlerBRef;
      if (side.status === "rostered" || side.status === "absent") {
        if (side.actualRef !== scheduledRef) {
          throw new Error(`Side ${sideLabel}: ${side.status} actualRef must equal the scheduled bowler.`);
        }
        const id = await loadFrozenIdentity(context.supabase, data.seasonId, scheduledRef, "rostered");
        if (!id) throw new Error(`Side ${sideLabel}: scheduled rostered bowler not found.`);
        return id;
      }
      // substitute
      if (!subIds.has(side.actualRef)) {
        throw new Error(`Side ${sideLabel}: substitute is not registered for this season.`);
      }
      const id = await loadFrozenIdentity(context.supabase, data.seasonId, side.actualRef, "substitute");
      if (!id) throw new Error(`Side ${sideLabel}: substitute not found.`);
      return id;
    }
    const frozenA = await resolveSide("A", data.sideA);
    const frozenB = await resolveSide("B", data.sideB);

    const bowledA = data.sideA.status !== "absent";
    const bowledB = data.sideB.status !== "absent";
    if (bowledA && !data.gameScoresA) {
      throw new Error(`${frozenA.name || "Side A"}: three game scores required.`);
    }
    if (bowledB && !data.gameScoresB) {
      throw new Error(`${frozenB.name || "Side B"}: three game scores required.`);
    }
    // Per-side linescore requirement — only require it for the sides that
    // are NOT absent. Absent side never has a linescore.
    if (data.detailMode === "full_linescore") {
      if (bowledA && !data.linescoreA) {
        throw new Error(`Full-linescore save: ${frozenA.name || "Side A"} linescore missing.`);
      }
      if (bowledB && !data.linescoreB) {
        throw new Error(`Full-linescore save: ${frozenB.name || "Side B"} linescore missing.`);
      }
    }

    const aHas = sideHasScores(data.sideA);
    const bHas = sideHasScores(data.sideB);
    if ((!aHas || !bHas) && !data.pointOverride) {
      throw new Error("Absent side without three absent scores requires an explicit points override.");
    }

    // Rebuild the frozen side payload from authoritative DB values.
    const frozenSideA = {
      status: data.sideA.status,
      actualRef: frozenA.ref,
      actualName: frozenA.name,
      entryAverage: frozenA.entryAverage,
      handicap: frozenA.handicap,
      absentScores: data.sideA.absentScores ?? null,
    };
    const frozenSideB = {
      status: data.sideB.status,
      actualRef: frozenB.ref,
      actualName: frozenB.name,
      entryAverage: frozenB.entryAverage,
      handicap: frozenB.handicap,
      absentScores: data.sideB.absentScores ?? null,
    };

    const sideA = participationInput(frozenSideA, data.gameScoresA ?? null);
    const sideB = participationInput(frozenSideB, data.gameScoresB ?? null);
    const outcome = computeHistoricalMatch({
      pointSystem: season.pointSystem, sideA, sideB,
      override: data.pointOverride ?? null,
    });

    const derived = {
      pointSystem: season.pointSystem,
      detailMode: data.detailMode,
      hasGameDataA: aHas,
      hasGameDataB: bHas,
      a: outcome.a, b: outcome.b,
      finalPointsA: outcome.finalPointsA, finalPointsB: outcome.finalPointsB,
      winner: outcome.winner,
      override: outcome.override,
    };

    // Canonicalize FULL_LINESCORE payloads — recompute frames-only
    // metrics via summarizeGame; reject any tampered derived count or
    // any submitted game score that disagrees with the recomputed total.
    let canonicalLineA: [GameLinescore, GameLinescore, GameLinescore] | null = null;
    let canonicalLineB: [GameLinescore, GameLinescore, GameLinescore] | null = null;
    if (data.detailMode === "full_linescore") {
      if (bowledA) {
        canonicalLineA = canonicalizeSideLinescore(
          data.linescoreA, data.gameScoresA, `Side A (${frozenA.name || "A"})`,
        );
      }
      if (bowledB) {
        canonicalLineB = canonicalizeSideLinescore(
          data.linescoreB, data.gameScoresB, `Side B (${frozenB.name || "B"})`,
        );
      }
    }

    const payload = {
      season_id: data.seasonId, week_id: data.weekId, slot_id: data.slotId,
      detail_mode: data.detailMode,
      side_a: frozenSideA, side_b: frozenSideB,
      linescore_a: canonicalLineA,
      linescore_b: canonicalLineB,
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

    await rebuildHistoricalSnapshotServer(context.supabase, data.seasonId);
    return { ok: true, points: { a: outcome.finalPointsA, b: outcome.finalPointsB } };
  });

/** Load a saved result so the admin form can pre-populate for edit. */
export const adminGetHistoricalMatchResult = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ slotId: z.string().uuid(), seasonId: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const q = await (context.supabase.from as unknown as LooseFrom)("historical_match_results")
      .select("*").eq("slot_id", data.slotId).eq("season_id", data.seasonId).maybeSingle();
    if (q.error) {
      if (isMissingTable(q.error.code)) return { available: false as const, result: null };
      throw new Error(q.error.message);
    }
    if (!q.data) return { available: true as const, result: null };
    const r = q.data as Record<string, unknown>;
    return {
      available: true as const,
      result: {
        slotId: String(r.slot_id),
        weekId: String(r.week_id),
        seasonId: String(r.season_id),
        detailMode: r.detail_mode as "full_linescore" | "game_scores",
        sideA: r.side_a as z.infer<typeof participationSchema>,
        sideB: r.side_b as z.infer<typeof participationSchema>,
        linescoreA: r.linescore_a ?? null,
        linescoreB: r.linescore_b ?? null,
        gameScoresA: (r.game_scores_a as number[] | null) ?? null,
        gameScoresB: (r.game_scores_b as number[] | null) ?? null,
        pointsA: r.points_a != null ? Number(r.points_a) : 0,
        pointsB: r.points_b != null ? Number(r.points_b) : 0,
        pointOverride: (r.point_override as { pointsA: number; pointsB: number; reason?: string } | null) ?? null,
      },
    };
  });

export const adminDeleteHistoricalMatchResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({
    slotId: z.string().uuid(), seasonId: z.string().uuid(),
    allowPublished: z.boolean().optional(),
    confirm: z.literal(true),
  }).parse(v))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    await ensureNonCurrentSeason(context.supabase, data.seasonId);
    // Fetch containing week to gate the published-week override.
    const row = await (context.supabase.from as unknown as LooseFrom)("historical_match_results")
      .select("week_id").eq("slot_id", data.slotId).eq("season_id", data.seasonId).maybeSingle();
    if (!row.error && row.data) {
      const week = await assertWeekInSeason(context.supabase, String(row.data.week_id), data.seasonId);
      if (week.published && data.allowPublished !== true) {
        throw new Error(`Week ${week.weekNumber} is published. Set allowPublished=true to clear.`);
      }
    }
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
    // Freeze participant identity + role from the DB — never trust the
    // caller's role/displayName/personId claim.
    const id = await loadFrozenIdentity(context.supabase, data.seasonId, data.participantRef, data.role);
    if (!id) {
      throw new Error(`Participant ${data.participantRef} is not registered as ${data.role} for this season.`);
    }
    // Look up personId server-side too, to keep career profiles honest.
    // FAIL CLOSED: a DB error must not silently save null person_id and
    // orphan the summary row from the person's career.
    const personLookup = await (context.supabase.from as unknown as LooseFrom)(
      data.role === "rostered" ? "rostered_bowlers" : "substitutes",
    ).select("person_id").eq("id", data.participantRef).eq("season_id", data.seasonId).maybeSingle();
    if (personLookup.error) {
      throw new Error(`person_id lookup failed: ${personLookup.error.message}`);
    }
    const frozenPersonId = (personLookup.data?.person_id as string | null) ?? null;
    const payload = {
      season_id: data.seasonId,
      participant_ref: data.participantRef,
      person_id: frozenPersonId,
      role: data.role,
      display_name: id.name,
      bowler_number: id.bowlerNumber,
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
  // FAIL CLOSED: never silently return an empty roster on a DB error and
  // let the caller overwrite a good snapshot with empty data. Missing
  // multi-season migration remains the one clear-cut cause of a missing
  // table — propagate that as a targeted error.
  if (rb.error) {
    if (isMissingTable(rb.error.code)) throw new Error("Historical data requires the multi-season migration.");
    throw new Error(`rostered_bowlers load failed: ${rb.error.message}`);
  }
  if (sub.error) {
    if (isMissingTable(sub.error.code)) throw new Error("Historical data requires the multi-season migration.");
    throw new Error(`substitutes load failed: ${sub.error.message}`);
  }
  const out: HistoricalParticipantMeta[] = [];
  for (const r of (rb.data as Array<Record<string, unknown>>) ?? []) {
    out.push({
      ref: String(r.id), personId: (r.person_id as string | null) ?? null,
      displayName: String(r.name ?? ""),
      bowlerNumber: (r.bowler_number as string | null) ?? null,
      startingAverage: r.entry_average != null ? Number(r.entry_average) : null,
      handicap: r.handicap != null ? Number(r.handicap) : null,
      role: "rostered",
    });
  }
  for (const r of (sub.data as Array<Record<string, unknown>>) ?? []) {
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
      .sort((a, b) => compareLanePairSlotSnake(
        { lane_pair: String(a.lane_pair), slot: Number(a.slot) },
        { lane_pair: String(b.lane_pair), slot: Number(b.slot) },
      ));
    const matches: HistoricalMatch[] = [];
    const schedule: HistoricalSnapshot["weeks"][number]["schedule"] = [];
    for (const s of slotList) {
      const sid = String(s.id);
      const scheduledA = String(s.bowler_a_ref);
      const scheduledB = String(s.bowler_b_ref);
      const nameA = (s.name_a as string | null) ?? scheduledA;
      const nameB = (s.name_b as string | null) ?? scheduledB;
      const r = resultBySlot.get(sid);
      // ALWAYS include the slot in `schedule` — public Schedule shows
      // every scheduled matchup, played or not.
      schedule.push({
        slotId: sid,
        weekNumber: Number(w.week_number),
        lanePair: String(s.lane_pair),
        slot: Number(s.slot),
        scheduledA, scheduledB,
        nameA, nameB,
        hasResult: !!r,
      });
      if (!r) continue;
      const derived = r.derived as (null | {
        detailMode: HistoricalDetailMode;
        hasGameDataA?: boolean; hasGameDataB?: boolean;
        a: { gameScoresScratch: [number, number, number]; gameScoresHandicap: [number, number, number]; scratchTotal: number; handicapTotal: number; gameAwards: [number, number, number]; gamePoints: number; setPoint: number; totalPoints: number };
        b: { gameScoresScratch: [number, number, number]; gameScoresHandicap: [number, number, number]; scratchTotal: number; handicapTotal: number; gameAwards: [number, number, number]; gamePoints: number; setPoint: number; totalPoints: number };
        finalPointsA: number; finalPointsB: number; winner: "A" | "B" | "T";
        override: { pointsA: number; pointsB: number } | null;
      });
      if (!derived) continue;
      const sideA = r.side_a as { status: string; actualRef: string; actualName: string; entryAverage: number; handicap: number; absentScores?: [number, number, number] | null };
      const sideB = r.side_b as { status: string; actualRef: string; actualName: string; entryAverage: number; handicap: number; absentScores?: [number, number, number] | null };
      const hasA = typeof derived.hasGameDataA === "boolean" ? derived.hasGameDataA
        : (sideA.status !== "absent" || Array.isArray(sideA.absentScores));
      const hasB = typeof derived.hasGameDataB === "boolean" ? derived.hasGameDataB
        : (sideB.status !== "absent" || Array.isArray(sideB.absentScores));
      const isFull = derived.detailMode === "full_linescore";
      const rawLA = r.linescore_a;
      const rawLB = r.linescore_b;
      const lineA = isFull && Array.isArray(rawLA) && rawLA.length === 3
        ? (rawLA as HistoricalMatch["linescoreA"]) : null;
      const lineB = isFull && Array.isArray(rawLB) && rawLB.length === 3
        ? (rawLB as HistoricalMatch["linescoreB"]) : null;
      matches.push({
        slotId: sid,
        weekNumber: Number(w.week_number),
        lanePair: String(s.lane_pair),
        slot: Number(s.slot),
        detailMode: derived.detailMode,
        scheduledA, scheduledB,
        scheduledNameA: nameA, scheduledNameB: nameB,
        actualA: sideA.actualRef, actualB: sideB.actualRef,
        actualNameA: sideA.actualName, actualNameB: sideB.actualName,
        isSubA: sideA.status === "substitute", isSubB: sideB.status === "substitute",
        absentA: sideA.status === "absent",   absentB: sideB.status === "absent",
        entryAverageA: sideA.entryAverage,   entryAverageB: sideB.entryAverage,
        handicapA: sideA.handicap,           handicapB: sideB.handicap,
        hasGameDataA: hasA, hasGameDataB: hasB,
        scratchGamesA: hasA && sideA.status !== "absent" ? derived.a.gameScoresScratch : null,
        scratchGamesB: hasB && sideB.status !== "absent" ? derived.b.gameScoresScratch : null,
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
        linescoreA: lineA,
        linescoreB: lineB,
      });
    }
    return {
      weekNumber: Number(w.week_number),
      date: (w.date as string | null) ?? null,
      published: w.published === true,
      completed: w.completed === true,
      matches,
      schedule,
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
    // PRIVACY: strip unpublished weeks and rebuild standings for public view.
    const filtered = filterPublicHistoricalSnapshot(q.data.snapshot as HistoricalSnapshot);
    return {
      available: true as const,
      forbidden: false,
      snapshot: filtered,
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
