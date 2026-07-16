/**
 * Server-only helper: rebuild the full PublicSnapshot from Supabase rows.
 *
 * Reads active roster, weeks, schedule slots, and match_results for a season
 * and produces the same PublicSnapshot shape the deterministic mock-data
 * buildSnapshot() emits. This is the single source of truth for the
 * `public_snapshots.snapshot` payload — every admin mutation calls this.
 *
 * Suffix `.server.ts` marks it server-only; only *.functions.ts imports it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  assembleSideLinescore,
  buildSnapshot,
  computeHandicap,
  computeMatchResult,
  LANE_PAIRS,
  type Bowler,
  type LanePair,
  type Match,
  type MatchResult,
  type PublicSnapshot,
  type SideParticipation,
  type SubstituteIdentity,
  type WeekSummary,
} from "@/lib/mock-data";
import { rosteredRowToBowler, type RosteredRow, type SubRow } from "@/lib/roster-adapter";
import { computeLiveMatchResult, type LiveMatchRow } from "@/lib/live-scoring";

type Sb = SupabaseClient<Database>;

const LANE_SET = new Set<string>(LANE_PAIRS);

/** Load roster, threading optional `person_id` when the column exists.
 *  BACKWARD-SAFE: if the migration adding `person_id` hasn't been applied
 *  (Postgres 42703 "undefined_column") retries with the legacy column set
 *  so the current-season snapshot builder keeps working exactly as before. */
async function loadRoster(sb: Sb, seasonId: string): Promise<RosteredRow[]> {
  const wide = await (sb.from as unknown as (t: string) => any)("rostered_bowlers") // eslint-disable-line @typescript-eslint/no-explicit-any
    .select("id, name, entry_average, handicap, active, archived, bowler_number, season_id, person_id")
    .eq("season_id", seasonId);
  if (!wide.error) {
    return (wide.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      entry_average: Number(r.entry_average),
    })) as RosteredRow[];
  }
  const code = (wide.error as { code?: string }).code;
  if (code !== "42703") throw new Error(wide.error.message);
  const res = await sb
    .from("rostered_bowlers")
    .select("id, name, entry_average, handicap, active, archived, bowler_number, season_id")
    .eq("season_id", seasonId);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).map((r) => ({ ...r, entry_average: Number(r.entry_average) })) as RosteredRow[];
}

async function loadSubstitutes(sb: Sb, seasonId: string): Promise<SubRow[]> {
  const wide = await (sb.from as unknown as (t: string) => any)("substitutes") // eslint-disable-line @typescript-eslint/no-explicit-any
    .select("id, name, starting_average, handicap, active, archived, bowler_number, season_id, person_id")
    .eq("season_id", seasonId);
  if (!wide.error) {
    return (wide.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      starting_average: r.starting_average != null ? Number(r.starting_average) : null,
    })) as SubRow[];
  }
  const code = (wide.error as { code?: string }).code;
  if (code !== "42703") throw new Error(wide.error.message);
  const res = await sb
    .from("substitutes")
    .select("id, name, starting_average, handicap, active, archived, bowler_number, season_id")
    .eq("season_id", seasonId);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).map((r) => ({
    ...r,
    starting_average: r.starting_average != null ? Number(r.starting_average) : null,
  })) as SubRow[];
}

/** Convert a substitute row into the identity shape buildSnapshot expects. */
function subRowToIdentity(row: SubRow): SubstituteIdentity {
  const starting = row.starting_average;
  const identity: SubstituteIdentity = {
    id: row.id,
    name: row.name,
    startingAverage: starting,
    handicap: starting != null ? computeHandicap(starting) : null,
    bowlerNumber: row.bowler_number,
    active: row.active,
    archived: row.archived,
  };
  if (row.person_id) identity.personId = row.person_id;
  return identity;
}

interface WeekRow {
  id: string; week_number: number; date: string | null;
  published: boolean; completed: boolean;
}
interface SlotRow {
  id: string; week_id: string; lane_pair: string; slot: number;
  bowler_a_id: string | null; bowler_b_id: string | null;
  name_a: string | null; name_b: string | null;
  bowler_number_a: string | null; bowler_number_b: string | null;
}
interface ResultRow {
  schedule_slot_id: string; week_id: string;
  side_a: unknown; side_b: unknown;
  linescore_a: unknown; linescore_b: unknown;
  override: unknown; derived: unknown;
}

async function loadWeeks(sb: Sb, seasonId: string): Promise<WeekRow[]> {
  const res = await sb
    .from("weeks")
    .select("id, week_number, date, published, completed")
    .eq("season_id", seasonId)
    .order("week_number");
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as WeekRow[];
}
async function loadSlots(sb: Sb, weekIds: string[]): Promise<SlotRow[]> {
  if (weekIds.length === 0) return [];
  const res = await sb
    .from("schedule_slots")
    .select("id, week_id, lane_pair, slot, bowler_a_id, bowler_b_id, name_a, name_b, bowler_number_a, bowler_number_b")
    .in("week_id", weekIds);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as SlotRow[];
}
async function loadResults(sb: Sb, weekIds: string[]): Promise<ResultRow[]> {
  if (weekIds.length === 0) return [];
  const res = await sb
    .from("match_results")
    .select("schedule_slot_id, week_id, side_a, side_b, linescore_a, linescore_b, override, derived")
    .in("week_id", weekIds);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as ResultRow[];
}

/** Load `live_match_results` rows.
 *  BACKWARD-SAFE: if the table does not exist yet (deploy before migration
 *  is applied), returns []. Postgres "undefined_table" code is 42P01. */
export async function loadLiveResults(sb: Sb, weekIds: string[]): Promise<LiveMatchRow[]> {
  if (weekIds.length === 0) return [];
  // Table not present in generated types yet, so cast the client for this
  // one call. RLS still enforces admin-only access at the database layer.
  const res = await (sb as unknown as SupabaseClient<Record<string, never>>)
    .from("live_match_results")
    .select("id, schedule_slot_id, week_id, season_id, side_a, side_b, a_game1, a_game2, a_game3, b_game1, b_game2, b_game3")
    .in("week_id", weekIds);
  if (res.error) {
    const code = (res.error as { code?: string }).code;
    if (code === "42P01" || /does not exist/i.test(res.error.message ?? "")) return [];
    // Missing SELECT permission (public snapshot rebuild via non-admin
    // session) is not fatal — live rows are admin-only anyway.
    if (code === "42501") return [];
    throw new Error(res.error.message);
  }
  return ((res.data as unknown) as LiveMatchRow[]) ?? [];
}

/** Reconstruct in-memory Match[] / WeekSummary[] from DB rows.
 *  Live-scoring precedence: for any slot with a full `match_results` row,
 *  the live row (if any) is IGNORED — a full result is the single source
 *  of truth. Live rows only surface for slots with no full result. */
export function assembleWeeksAndMatches(input: {
  weeks: WeekRow[];
  slots: SlotRow[];
  results: ResultRow[];
  liveResults?: LiveMatchRow[];
}): { weeks: WeekSummary[]; matchesByWeek: Record<number, Match[]> } {
  const resultBySlot = new Map<string, ResultRow>();
  for (const r of input.results) resultBySlot.set(r.schedule_slot_id, r);
  const liveBySlot = new Map<string, LiveMatchRow>();
  for (const r of input.liveResults ?? []) {
    if (!resultBySlot.has(r.schedule_slot_id)) liveBySlot.set(r.schedule_slot_id, r);
  }

  const weeks: WeekSummary[] = input.weeks
    .slice()
    .sort((a, b) => a.week_number - b.week_number)
    .map((w) => ({
      week: w.week_number,
      date: w.date ?? "",
      completed: w.completed,
      published: w.published,
    }));

  const slotsByWeekId = new Map<string, SlotRow[]>();
  for (const s of input.slots) {
    const list = slotsByWeekId.get(s.week_id);
    if (list) list.push(s);
    else slotsByWeekId.set(s.week_id, [s]);
  }

  const matchesByWeek: Record<number, Match[]> = {};
  for (const w of input.weeks) {
    const slots = (slotsByWeekId.get(w.id) ?? []).slice().sort(compareLanePairSlotSnake);
    const matches: Match[] = [];
    for (const s of slots) {
      if (!LANE_SET.has(s.lane_pair)) continue;
      const bowlerA = s.bowler_a_id ?? "";
      const bowlerB = s.bowler_b_id ?? "";
      if (!bowlerA || !bowlerB) continue;
      const rr = resultBySlot.get(s.id);
      const live = liveBySlot.get(s.id);
      const match: Match = {
        id: s.id,
        week: w.week_number,
        lanePair: s.lane_pair as LanePair,
        slot: s.slot,
        status: rr ? "completed" : "scheduled",
        bowlerA,
        bowlerB,
        bowlerNumberA: s.bowler_number_a ?? undefined,
        bowlerNumberB: s.bowler_number_b ?? undefined,
      };
      if (rr) {
        const derived = rr.derived as MatchResult | null;
        if (derived && typeof derived === "object") {
          match.result = derived as MatchResult;
        }
      } else if (live) {
        // Score-only result synthesized from live row. Frame-derived stats
        // are excluded automatically because linescoreA/B are null.
        match.result = computeLiveMatchResult({
          row: live,
          scheduledNameA: s.name_a ?? "",
          scheduledNameB: s.name_b ?? "",
        });
        // A live row with 3 completed pairs is treated as a completed
        // score-only result; anything less remains "scheduled" but carries
        // partial credit through match.result.
        if (match.result.completedGameCount === 3) match.status = "completed";
      }
      matches.push(match);
    }
    matchesByWeek[w.week_number] = matches;
  }

  return { weeks, matchesByWeek };
}

export async function loadAllForSeason(sb: Sb, seasonId: string) {
  const [rostered, subsRows, weekRows] = await Promise.all([
    loadRoster(sb, seasonId),
    loadSubstitutes(sb, seasonId),
    loadWeeks(sb, seasonId),
  ]);
  const weekIds = weekRows.map((w) => w.id);
  const [slots, results, liveResults] = await Promise.all([
    loadSlots(sb, weekIds),
    loadResults(sb, weekIds),
    loadLiveResults(sb, weekIds),
  ]);
  return { rostered, subs: subsRows, weekRows, slots, results, liveResults };
}

/** Build the full snapshot: roster + subs + weeks + slots + results + live. */
export async function buildFullSnapshot(sb: Sb, seasonId: string): Promise<PublicSnapshot> {
  const { rostered, subs, weekRows, slots, results, liveResults } = await loadAllForSeason(sb, seasonId);

  const historicalBowlers: Bowler[] = rostered.map(rosteredRowToBowler);
  const activeBowlerIds = new Set(
    rostered.filter((r) => r.active && !r.archived).map((r) => r.id),
  );
  const substitutes: SubstituteIdentity[] = subs.map(subRowToIdentity);

  const { weeks, matchesByWeek } = assembleWeeksAndMatches({
    weeks: weekRows, slots, results, liveResults,
  });

  return buildSnapshot({
    bowlers: historicalBowlers,
    weeks,
    matchesByWeek,
    activeBowlerIds,
    substitutes,
  });
}



/** Convenience: build + upsert into public_snapshots. */
export async function rebuildAndSaveSnapshot(sb: Sb, seasonId: string): Promise<void> {
  const snap = await buildFullSnapshot(sb, seasonId);
  const up = await sb
    .from("public_snapshots")
    .upsert(
      { season_id: seasonId, snapshot: snap as unknown as Database["public"]["Tables"]["public_snapshots"]["Insert"]["snapshot"] },
      { onConflict: "season_id" },
    );
  if (up.error) throw new Error(`snapshot upsert failed: ${up.error.message}`);
}

/** Helper for server functions that build a MatchResult from a draft. */
export function buildMatchResultFromDraft(input: {
  scheduledA: Bowler;
  scheduledB: Bowler;
  scheduledNameA: string;
  scheduledNameB: string;
  participationA: SideParticipation;
  participationB: SideParticipation;
  entryAverageA: number;
  entryAverageB: number;
  handicapA: number;
  handicapB: number;
  gamesA?: Parameters<typeof assembleSideLinescore>[0]["games"];
  gamesB?: Parameters<typeof assembleSideLinescore>[0]["games"];
  pointsOverride: MatchResult["pointsOverride"];
}): MatchResult {
  const lsA = input.gamesA ? assembleSideLinescore({
    scheduled: input.scheduledA,
    actualId: input.participationA.actualId,
    actualName: input.participationA.actualName,
    isSub: input.participationA.status === "substitute",
    entryAverage: input.entryAverageA, handicap: input.handicapA,
    games: input.gamesA,
  }) : null;
  const lsB = input.gamesB ? assembleSideLinescore({
    scheduled: input.scheduledB,
    actualId: input.participationB.actualId,
    actualName: input.participationB.actualName,
    isSub: input.participationB.status === "substitute",
    entryAverage: input.entryAverageB, handicap: input.handicapB,
    games: input.gamesB,
  }) : null;
  return computeMatchResult({
    scheduledA: input.scheduledA,
    scheduledB: input.scheduledB,
    scheduledNameA: input.scheduledNameA,
    scheduledNameB: input.scheduledNameB,
    participationA: input.participationA,
    participationB: input.participationB,
    entryAverageA: input.entryAverageA,
    entryAverageB: input.entryAverageB,
    handicapA: input.handicapA,
    handicapB: input.handicapB,
    linescoreA: lsA,
    linescoreB: lsB,
    pointsOverride: input.pointsOverride,
  });
}
