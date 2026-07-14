/**
 * Pro Summer Singles — Phase 1 shared league store.
 *
 * SINGLE SOURCE OF TRUTH for the entire league:
 *   - active roster (36 bowlers) + substitute pool
 *   - weekly schedule slots (draft + published state)
 *   - saved MatchResult per match, including frame-by-frame linescores
 *   - one precomputed PublicSnapshot rebuilt eagerly on every admin mutation
 *
 * Every public route reads through mock-data getters, which delegate to the
 * `snapshot` field on this store. Public rendering is a direct O(1) read; the
 * expensive `buildSnapshot()` pass runs only on admin saves and initial seed.
 *
 * Persisted to `localStorage` under a v2 schema key. A v1 record from the
 * earlier note-only draft is discarded on load and replaced with fresh seed.
 */

import { useSyncExternalStore } from "react";
import {
  _installSnapshotProvider,
  assembleSideLinescore,
  assertMatchResult,
  buildSnapshot,
  computeHandicap,
  computeMatchResult,
  LANE_PAIRS,
  seedBowlers,
  seedMatchesByWeek,
  seedWeeks,
  SEEDED_COMPLETED_WEEKS,
  TOTAL_WEEKS,
  validatePointsOverride,
  type Bowler,
  type BowlerId,
  type GameLinescore,
  type LanePair,
  type Match,
  type MatchResult,
  type ParticipationStatus,
  type PointsOverride,
  type PublicSnapshot,
  type SideParticipation,
  type WeekSummary,
} from "./mock-data";

// ---------------------------------------------------------------------------
// Persisted records
// ---------------------------------------------------------------------------

export interface RosteredBowlerRecord {
  id: string;
  name: string;
  entryAverage: number;
  handicap: number;
  active: boolean;
  archived: boolean;
  /** Editable 1–10 character ID Number. Displayed ONLY on schedule pages
   *  as `Name (ID 01234)`. Never used to identify records (that's `id`).
   *  Optional so v3-imported rows and blank drafts remain valid. */
  bowlerNumber?: string;
}
export interface SubstituteRecord {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
  bowlerNumber?: string;
  /** Substitute's own Starting Average. Required to bowl in a match: the
   *  sub's handicap (floor(0.80 * (160 - startingAverage))) is used as
   *  THIS match's scoring handicap. W-L points and handicap pinfall
   *  still credit the SCHEDULED bowler for the standings. */
  startingAverage?: number;
}

export interface ScheduleSlot {
  lanePair: LanePair;
  slot: number;
  bowlerA: BowlerId | "";
  bowlerB: BowlerId | "";
}
export interface WeekSchedule {
  week: number;
  slots: ScheduleSlot[];
  publishedAt: number | null;
  draftUpdatedAt: number | null;
}

export interface LeagueDatabase {
  version: number;
  rostered: RosteredBowlerRecord[];
  subs: SubstituteRecord[];
  weeks: WeekSummary[];
  matchesByWeek: Record<number, Match[]>;
  schedulesByWeek: Record<number, WeekSchedule>;
}

interface StoreState {
  db: LeagueDatabase;
  snapshot: PublicSnapshot;
  version: number;
}

const STORAGE_KEY = "pss.leagueStore.v4";
const OLD_KEYS_TO_CLEAR = ["pss.leagueStore.v1"];
const OLD_KEY_V2 = "pss.leagueStore.v2";
const OLD_KEY_V3 = "pss.leagueStore.v3";
const SCHEMA_VERSION = 4;

/** Format a bowlerNumber for display. Never used to store the value.
 *  Values are kept verbatim; only trim() is applied on save. */
export function isValidBowlerNumber(v: string): boolean {
  const t = v.trim();
  return t.length >= 1 && t.length <= 10;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

function slotsFromMatches(matches: Match[]): ScheduleSlot[] {
  return matches.map((m) => ({
    lanePair: m.lanePair, slot: m.slot,
    bowlerA: m.bowlerA, bowlerB: m.bowlerB,
  }));
}

function seedDb(): LeagueDatabase {
  const rawBowlers = seedBowlers();
  const rawWeeks = seedWeeks();
  const matches = seedMatchesByWeek(rawBowlers);
  const schedulesByWeek: Record<number, WeekSchedule> = {};
  for (const w of rawWeeks) {
    schedulesByWeek[w.week] = {
      week: w.week,
      slots: slotsFromMatches(matches[w.week] ?? []),
      publishedAt: w.week <= SEEDED_COMPLETED_WEEKS ? Date.now() : null,
      draftUpdatedAt: null,
    };
  }
  return {
    version: SCHEMA_VERSION,
    rostered: rawBowlers.map((b, i) => ({
      id: b.id, name: b.name, entryAverage: b.entryAverage,
      handicap: b.handicap, active: true, archived: false,
      // Seed IDs "01001".."01036" — unique, editable, 5 chars. Not
      // used by any lookup; display-only on schedule pages.
      bowlerNumber: `0${(1000 + i + 1).toString()}`,
    })),
    subs: [
      "Rick M.", "Terry L.", "Alicia P.", "Marco V.", "Dee K.", "Ronnie F.",
    ].map((name, i) => ({
      id: `s${(i + 1).toString().padStart(2, "0")}`,
      name, active: true, archived: false,
      bowlerNumber: `09${(100 + i + 1).toString()}`,
      // Seed sub starting averages so the pool is scoreable out-of-box.
      startingAverage: 130 + i * 4,
    })),
    weeks: rawWeeks,
    matchesByWeek: matches,
    schedulesByWeek,
  };
}

let __stateVersion = 0;
function buildStoreState(db: LeagueDatabase): StoreState {
  __stateVersion += 1;
  return {
    db,
    snapshot: buildSnapshot({ bowlers: rosterToBowlers(db.rostered), weeks: db.weeks, matchesByWeek: db.matchesByWeek }),
    version: __stateVersion,
  };
}

/** Every rostered record — active AND archived — becomes a Bowler so historic
 *  results still resolve names. Aggregate fields start at zero; the snapshot
 *  builder fills them from linescores. */
function rosterToBowlers(rostered: RosteredBowlerRecord[]): Bowler[] {
  return rostered.map((r) => ({
    id: r.id, name: r.name,
    entryAverage: r.entryAverage,
    handicap: r.handicap,
    scratchAverage: 0, points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0, actualScratchPinfall: 0,
    movement: 0,
  }));
}

function loadInitialDb(): LeagueDatabase {
  if (typeof window === "undefined") return seedDb();
  try {
    for (const k of OLD_KEYS_TO_CLEAR) window.localStorage.removeItem(k);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LeagueDatabase;
      if (parsed && parsed.version === SCHEMA_VERSION && parsed.rostered && parsed.matchesByWeek && parsed.weeks) {
        return parsed;
      }
    }
    // v3 → v4 migration first (recent installs). Preserves every match
    // result and schedule verbatim; only injects new optional fields.
    const v3Raw = window.localStorage.getItem(OLD_KEY_V3);
    if (v3Raw) {
      try {
        const v3 = JSON.parse(v3Raw) as unknown;
        const migrated = migrateV3ToV4(v3);
        if (migrated) {
          window.localStorage.removeItem(OLD_KEY_V3);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          return migrated;
        }
      } catch { /* fall through */ }
      window.localStorage.removeItem(OLD_KEY_V3);
    }
    // Older v2 store → migrate up through v3 then v4.
    const legacy = window.localStorage.getItem(OLD_KEY_V2);
    if (legacy) {
      try {
        const v2 = JSON.parse(legacy) as unknown;
        const v3Db = migrateV2ToV3(v2);
        const v4Db = v3Db ? migrateV3ToV4(v3Db) : null;
        if (v4Db) {
          window.localStorage.removeItem(OLD_KEY_V2);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v4Db));
          return v4Db;
        }
      } catch { /* fall through */ }
      window.localStorage.removeItem(OLD_KEY_V2);
    }
    return seedDb();
  } catch {
    return seedDb();
  }
}

/**
 * v3 → v4 migration.
 *
 * v4 additions are ALL optional fields — historic MatchResult values
 * (linescores, points, overrides, participation) are preserved byte-for-byte:
 *   - RosteredBowlerRecord.bowlerNumber   (default: "0" + (1000+index))
 *   - SubstituteRecord.bowlerNumber       (default: "09" + (100+index))
 *   - SubstituteRecord.startingAverage    (default: 140)
 *   - Match.bowlerNumberA / bowlerNumberB (backfilled from roster IDs so
 *     already-published schedules still display an ID cell)
 *
 * migrateV2ToV3 remains the shape guarantor for MatchResult; this pass
 * MUST NOT reshape or drop any completed result.
 */
export function migrateV3ToV4(raw: unknown): LeagueDatabase | null {
  if (!raw || typeof raw !== "object") return null;
  const v3 = raw as LeagueDatabase;
  if (!v3.rostered || !v3.matchesByWeek || !v3.weeks) return null;
  const rostered: RosteredBowlerRecord[] = v3.rostered.map((b, i) => ({
    ...b,
    bowlerNumber: b.bowlerNumber ?? `0${(1000 + i + 1).toString()}`,
  }));
  const subs: SubstituteRecord[] = (v3.subs ?? []).map((s, i) => ({
    ...s,
    bowlerNumber: s.bowlerNumber ?? `09${(100 + i + 1).toString()}`,
    startingAverage: s.startingAverage ?? 140,
  }));
  const rosterNumById = new Map(rostered.map((r) => [r.id, r.bowlerNumber]));
  const matchesByWeek: Record<number, Match[]> = {};
  for (const [wk, matches] of Object.entries(v3.matchesByWeek)) {
    matchesByWeek[Number(wk)] = matches.map((m) => ({
      ...m,
      bowlerNumberA: m.bowlerNumberA ?? rosterNumById.get(m.bowlerA),
      bowlerNumberB: m.bowlerNumberB ?? rosterNumById.get(m.bowlerB),
    }));
  }
  return {
    version: SCHEMA_VERSION,
    rostered, subs,
    weeks: v3.weeks,
    matchesByWeek,
    schedulesByWeek: v3.schedulesByWeek ?? {},
  };
}

/**
 * v2 → v3 migration.
 *
 * v2 shape did not require `scheduledNameA/B` on every MatchResult. Backfill
 * frozen scheduled display names from the best historical source:
 *   1. an already-present `scheduledNameA/B` field
 *   2. `participationA/B.actualName` when the participant was rostered
 *   3. the current roster record's name (final fallback)
 *
 * Also guarantees that every completed result has frozen `entryAverageA/B`,
 * `handicapA/B`, `participationA/B`, `linescoreA/B` fields present in the
 * current MatchResult shape. Malformed results are DROPPED (match reverts
 * to `scheduled`), so no undefined labels or note-only placeholders leak.
 */
export function migrateV2ToV3(raw: unknown): LeagueDatabase | null {
  if (!raw || typeof raw !== "object") return null;
  const v2 = raw as Partial<LeagueDatabase> & Record<string, unknown>;
  if (!v2.rostered || !v2.matchesByWeek || !v2.weeks) return null;
  const rosterById = new Map<string, RosteredBowlerRecord>(
    (v2.rostered as RosteredBowlerRecord[]).map((b) => [b.id, b]),
  );
  const migratedMatches: Record<number, Match[]> = {};
  for (const [wkStr, matches] of Object.entries(v2.matchesByWeek as Record<string, Match[]>)) {
    const wk = Number(wkStr);
    migratedMatches[wk] = matches.map((m) => {
      if (!m.result) return { ...m, status: "scheduled" };
      const r = m.result as MatchResult & Record<string, unknown>;
      // Note-only or malformed leftover — drop it.
      const hasLinescoreShape =
        "linescoreA" in r && "linescoreB" in r &&
        "participationA" in r && "participationB" in r;
      if (!hasLinescoreShape) {
        return { id: m.id, week: m.week, lanePair: m.lanePair, slot: m.slot,
          status: "scheduled" as const, bowlerA: m.bowlerA, bowlerB: m.bowlerB };
      }
      const schedA = rosterById.get(m.bowlerA);
      const schedB = rosterById.get(m.bowlerB);
      const nameA = (r.scheduledNameA as string | undefined)
        ?? (r.participationA?.status === "rostered" ? r.participationA.actualName : undefined)
        ?? schedA?.name ?? m.bowlerA;
      const nameB = (r.scheduledNameB as string | undefined)
        ?? (r.participationB?.status === "rostered" ? r.participationB.actualName : undefined)
        ?? schedB?.name ?? m.bowlerB;
      const entryA = (r.entryAverageA as number | undefined) ?? schedA?.entryAverage ?? 0;
      const entryB = (r.entryAverageB as number | undefined) ?? schedB?.entryAverage ?? 0;
      const hcpA = (r.handicapA as number | undefined) ?? computeHandicap(entryA);
      const hcpB = (r.handicapB as number | undefined) ?? computeHandicap(entryB);
      return {
        ...m,
        status: "completed" as const,
        result: {
          ...r,
          scheduledNameA: nameA,
          scheduledNameB: nameB,
          entryAverageA: entryA,
          entryAverageB: entryB,
          handicapA: hcpA,
          handicapB: hcpB,
          pointsOverride: (r.pointsOverride as PointsOverride | null | undefined) ?? null,
        } as MatchResult,
      };
    });
  }
  const schedulesByWeek = (v2.schedulesByWeek as Record<number, WeekSchedule>) ?? {};
  const weeks = (v2.weeks as WeekSummary[]).map((w) => ({
    ...w,
    completed: (migratedMatches[w.week] ?? []).length > 0
      && (migratedMatches[w.week] ?? []).every((m) => m.status === "completed"),
  }));
  return {
    version: SCHEMA_VERSION,
    rostered: v2.rostered as RosteredBowlerRecord[],
    subs: (v2.subs as SubstituteRecord[]) ?? [],
    weeks,
    matchesByWeek: migratedMatches,
    schedulesByWeek,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Install the snapshot bridge FIRST with a lazy getter so any mock-data
// call during initial buildStoreState resolves without TDZ on `state`.
let state: StoreState = null as unknown as StoreState;
_installSnapshotProvider(() => (state ? state.snapshot : ({} as PublicSnapshot)));
state = buildStoreState(loadInitialDb());
// Non-production test hook: expose a stable getter for the current DB.
// The Playwright suite reads scheduled-match metadata immediately after
// wiping localStorage, before any mutation has triggered `persist()`.
if (typeof window !== "undefined") {
  (window as unknown as { __pssStore?: { getDb: () => LeagueDatabase } }).__pssStore =
    { getDb: () => state.db };
}
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.db)); }
  catch { /* ignore quota */ }
}

function commit(nextDb: LeagueDatabase) {
  state = buildStoreState(nextDb);
  persist();
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnapshot(): StoreState { return state; }
function getServerSnapshot(): StoreState { return state; }

export function useLeagueState(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
/** Subscribe to the store and get the current public snapshot. Public routes
 *  call this to re-render whenever admin mutations rebuild the snapshot. */
export function useLeagueSnapshot(): PublicSnapshot {
  return useLeagueState().snapshot;
}
export function getLeagueState(): StoreState { return state; }

// ---------------------------------------------------------------------------
// Roster mutations
// ---------------------------------------------------------------------------

function normName(n: string): string { return n.trim().toLowerCase(); }

export function isDuplicateActiveRosterName(name: string, exceptId?: string): boolean {
  const norm = normName(name);
  if (!norm) return false;
  return state.db.rostered.some((b) =>
    b.active && !b.archived && b.id !== exceptId && normName(b.name) === norm);
}
export function isDuplicateActiveSubName(name: string, exceptId?: string): boolean {
  const norm = normName(name);
  if (!norm) return false;
  return state.db.subs.some((s) =>
    s.active && !s.archived && s.id !== exceptId && normName(s.name) === norm);
}

function nextRosterId(): string {
  let n = state.db.rostered.length + 1;
  while (state.db.rostered.some((b) => b.id === `b${n.toString().padStart(2, "0")}`)) n++;
  return `b${n.toString().padStart(2, "0")}`;
}
function nextSubId(): string {
  let n = state.db.subs.length + 1;
  while (state.db.subs.some((s) => s.id === `s${n.toString().padStart(2, "0")}`)) n++;
  return `s${n.toString().padStart(2, "0")}`;
}

export function addRosteredBowler(
  name: string, entryAverage: number, bowlerNumber?: string,
): RosteredBowlerRecord {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required.");
  if (isDuplicateActiveRosterName(trimmed))
    throw new Error(`An active roster bowler named "${trimmed}" already exists.`);
  const bn = bowlerNumber?.trim() || undefined;
  if (bn && !isValidBowlerNumber(bn))
    throw new Error("ID Number must be 1–10 characters.");
  const record: RosteredBowlerRecord = {
    id: nextRosterId(),
    name: trimmed,
    entryAverage,
    handicap: computeHandicap(entryAverage),
    active: true, archived: false,
    bowlerNumber: bn,
  };
  commit({ ...state.db, rostered: [...state.db.rostered, record] });
  return record;
}
export function updateRosteredBowler(
  id: string,
  patch: Partial<Pick<RosteredBowlerRecord, "name" | "entryAverage" | "active" | "bowlerNumber">>,
): void {
  if (patch.name != null && isDuplicateActiveRosterName(patch.name, id))
    throw new Error(`An active roster bowler named "${patch.name.trim()}" already exists.`);
  if (patch.bowlerNumber != null) {
    const bn = patch.bowlerNumber.trim();
    if (bn && !isValidBowlerNumber(bn))
      throw new Error("ID Number must be 1–10 characters.");
  }
  commit({
    ...state.db,
    rostered: state.db.rostered.map((b) => {
      if (b.id !== id) return b;
      const name = patch.name != null ? patch.name.trim() : b.name;
      const entryAverage = patch.entryAverage != null ? patch.entryAverage : b.entryAverage;
      const active = patch.active != null ? patch.active : b.active;
      const bowlerNumber = patch.bowlerNumber != null
        ? (patch.bowlerNumber.trim() || undefined)
        : b.bowlerNumber;
      return { ...b, name, entryAverage, handicap: computeHandicap(entryAverage), active, bowlerNumber };
    }),
  });
}
export function archiveRosteredBowler(id: string): void {
  commit({
    ...state.db,
    rostered: state.db.rostered.map((b) =>
      b.id === id ? { ...b, active: false, archived: true } : b),
  });
}

export function addSubstitute(
  name: string,
  opts?: { bowlerNumber?: string; startingAverage?: number },
): SubstituteRecord {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required.");
  if (isDuplicateActiveSubName(trimmed))
    throw new Error(`An active substitute named "${trimmed}" already exists.`);
  const bn = opts?.bowlerNumber?.trim() || undefined;
  if (bn && !isValidBowlerNumber(bn))
    throw new Error("ID Number must be 1–10 characters.");
  const record: SubstituteRecord = {
    id: nextSubId(), name: trimmed, active: true, archived: false,
    bowlerNumber: bn,
    startingAverage: opts?.startingAverage,
  };
  commit({ ...state.db, subs: [...state.db.subs, record] });
  return record;
}
export function updateSubstitute(
  id: string,
  patch: Partial<Pick<SubstituteRecord, "name" | "active" | "bowlerNumber" | "startingAverage">>,
): void {
  if (patch.name != null && isDuplicateActiveSubName(patch.name, id))
    throw new Error(`An active substitute named "${patch.name.trim()}" already exists.`);
  if (patch.bowlerNumber != null) {
    const bn = patch.bowlerNumber.trim();
    if (bn && !isValidBowlerNumber(bn))
      throw new Error("ID Number must be 1–10 characters.");
  }
  commit({
    ...state.db,
    subs: state.db.subs.map((s) => {
      if (s.id !== id) return s;
      const name = patch.name != null ? patch.name.trim() : s.name;
      const active = patch.active != null ? patch.active : s.active;
      const bowlerNumber = patch.bowlerNumber != null
        ? (patch.bowlerNumber.trim() || undefined)
        : s.bowlerNumber;
      const startingAverage = patch.startingAverage != null
        ? patch.startingAverage
        : s.startingAverage;
      return { ...s, name, active, bowlerNumber, startingAverage };
    }),
  });
}
export function archiveSubstitute(id: string): void {
  commit({
    ...state.db,
    subs: state.db.subs.map((s) =>
      s.id === id ? { ...s, active: false, archived: true } : s),
  });
}

// ---------------------------------------------------------------------------
// Schedule editor
// ---------------------------------------------------------------------------

export function getWeekSchedule(week: number): WeekSchedule | undefined {
  return state.db.schedulesByWeek[week];
}

/** Save the schedule slots for a week as a draft. Does NOT create match
 *  results — those still need admin result entry. Any matches for this week
 *  that don't already have a result are replaced with the new pairings. */
export function saveScheduleDraft(week: number, slots: ScheduleSlot[]): void {
  applyScheduleSlots(week, slots, /*publish*/ false);
}
/** Same as saveScheduleDraft, but also marks the week's schedule as published. */
export function publishWeek(week: number, slots: ScheduleSlot[]): void {
  applyScheduleSlots(week, slots, /*publish*/ true);
}

function applyScheduleSlots(week: number, slots: ScheduleSlot[], publish: boolean) {
  const existing = state.db.matchesByWeek[week] ?? [];
  const byKey = new Map(existing.map((m) => [`${m.lanePair}-${m.slot}`, m]));
  const rosterById = new Map(state.db.rostered.map((b) => [b.id, b]));
  const nextMatches: Match[] = slots.map((s) => {
    const key = `${s.lanePair}-${s.slot}`;
    const prior = byKey.get(key);
    if (prior && prior.result) return prior; // frozen: has a saved result
    // FREEZE the bowler ID numbers into the Match at schedule-save time.
    // Editing a roster ID later will only affect matches saved AFTER
    // that edit — historical schedules keep the ID they were published with.
    return {
      id: prior?.id ?? `w${week}-${s.lanePair}-${s.slot}`,
      week, lanePair: s.lanePair, slot: s.slot,
      status: "scheduled",
      bowlerA: s.bowlerA, bowlerB: s.bowlerB,
      bowlerNumberA: s.bowlerA ? rosterById.get(s.bowlerA)?.bowlerNumber : undefined,
      bowlerNumberB: s.bowlerB ? rosterById.get(s.bowlerB)?.bowlerNumber : undefined,
    };
  });
  const now = Date.now();
  const schedule: WeekSchedule = {
    week, slots,
    publishedAt: publish ? now : (state.db.schedulesByWeek[week]?.publishedAt ?? null),
    draftUpdatedAt: now,
  };
  commit({
    ...state.db,
    matchesByWeek: { ...state.db.matchesByWeek, [week]: nextMatches },
    schedulesByWeek: { ...state.db.schedulesByWeek, [week]: schedule },
  });
}

// ---------------------------------------------------------------------------
// Result entry — the shared applyResult transaction
// ---------------------------------------------------------------------------

export interface SideDraft {
  status: ParticipationStatus;
  /** Required when status === "substitute". */
  substituteId?: string;
  /** Set when the admin typed a new sub inline. Overrides substituteId. */
  substituteName?: string;
  /** Required when status !== "absent". Three 10-frame games. */
  games?: [GameLinescore, GameLinescore, GameLinescore];
  /**
   * Substitute's own Starting Average — REQUIRED for any substitute row.
   * The sub's handicap (floor(0.80 * (160 - startingAverage))) becomes THIS
   * match's scoring handicap for the side. W-L points and the resulting
   * handicap pinfall are still credited to the SCHEDULED bowler in
   * standings via the buildSnapshot roster credit rules.
   * When the admin picks a pool sub with a saved startingAverage, this
   * may be omitted and the pool value is used.
   */
  substituteStartingAverage?: number;
}
export interface ResultDraft {
  matchId: string;
  sideA: SideDraft;
  sideB: SideDraft;
  override?: PointsOverride | null;
}
export type ApplyResultOutcome =
  | { ok: true; matchId: string }
  | { ok: false; errors: string[] };

export function applyResult(draft: ResultDraft): ApplyResultOutcome {
  const errors: string[] = [];
  const match = findMatchInDb(state.db, draft.matchId);
  if (!match) return { ok: false, errors: [`Match ${draft.matchId} not found.`] };
  const sched = {
    A: state.db.rostered.find((b) => b.id === match.bowlerA),
    B: state.db.rostered.find((b) => b.id === match.bowlerB),
  };
  if (!sched.A || !sched.B)
    return { ok: false, errors: ["Scheduled bowler(s) not in current roster."] };

  const buildParticipation = (
    side: "A" | "B", schedRec: RosteredBowlerRecord, sd: SideDraft,
  ): SideParticipation | null => {
    if (sd.status === "rostered") {
      return { scheduledId: schedRec.id, status: "rostered",
        actualId: schedRec.id, actualName: schedRec.name };
    }
    if (sd.status === "absent") {
      return { scheduledId: schedRec.id, status: "absent",
        actualId: null, actualName: "Absent" };
    }
    // substitute
    let subName: string | null = null;
    let subId: string | null = null;
    if (sd.substituteName && sd.substituteName.trim().length > 0) {
      subName = sd.substituteName.trim();
    } else if (sd.substituteId) {
      const rec = state.db.subs.find((s) => s.id === sd.substituteId);
      if (!rec) { errors.push(`Side ${side}: substitute not found.`); return null; }
      subId = rec.id; subName = rec.name;
    } else {
      errors.push(`Side ${side}: pick a substitute or enter a name.`);
      return null;
    }
    return {
      scheduledId: schedRec.id, status: "substitute",
      actualId: subId, actualName: subName ?? "Substitute",
    };
  };
  const pA = buildParticipation("A", sched.A, draft.sideA);
  const pB = buildParticipation("B", sched.B, draft.sideB);
  if (!pA || !pB) return { ok: false, errors };

  // Absent side must supply an override.
  const anyAbsent = pA.status === "absent" || pB.status === "absent";
  if (anyAbsent) {
    if (!draft.override || !draft.override.enabled) {
      errors.push("At least one side is Absent — a manual points override with a reason is required.");
    }
  }
  // Linescores required for any side that bowled.
  if (pA.status !== "absent" && !draft.sideA.games)
    errors.push("Side A linescore is required.");
  if (pB.status !== "absent" && !draft.sideB.games)
    errors.push("Side B linescore is required.");
  if (draft.override && draft.override.enabled) {
    const chk = validatePointsOverride(draft.override);
    if (!chk.ok) errors.push(chk.error);
  }
  if (errors.length > 0) return { ok: false, errors };

  // Per-side entry average / handicap for scoring:
  //   - rostered / absent → scheduled bowler's frozen entry average
  //   - substitute        → the SUB's Starting Average (draft override or
  //                         pool record), yielding the sub's handicap
  // W-L awards + handicap pinfall computed from these still credit the
  // SCHEDULED bowler in standings via buildSnapshot's roster-credit rules.
  const resolveSide = (
    side: "A" | "B", schedRec: RosteredBowlerRecord, sd: SideDraft,
    part: SideParticipation,
  ): { entry: number; hcp: number } | null => {
    if (part.status !== "substitute") {
      const e = schedRec.entryAverage;
      return { entry: e, hcp: computeHandicap(e) };
    }
    let sa = sd.substituteStartingAverage;
    if (sa == null && sd.substituteId) {
      sa = state.db.subs.find((s) => s.id === sd.substituteId)?.startingAverage;
    }
    if (sa == null || !Number.isFinite(sa)) {
      errors.push(`Side ${side}: substitute Starting Average is required.`);
      return null;
    }
    return { entry: sa, hcp: computeHandicap(sa) };
  };
  const rA = resolveSide("A", sched.A, draft.sideA, pA);
  const rB = resolveSide("B", sched.B, draft.sideB, pB);
  if (!rA || !rB) return { ok: false, errors };
  const entryA = rA.entry, hcpA = rA.hcp;
  const entryB = rB.entry, hcpB = rB.hcp;

  const linescoreA = draft.sideA.games ? assembleSideLinescore({
    scheduled: rosteredToBowler(sched.A),
    actualId: pA.actualId, actualName: pA.actualName, isSub: pA.status === "substitute",
    entryAverage: entryA, handicap: hcpA, games: draft.sideA.games,
  }) : null;
  const linescoreB = draft.sideB.games ? assembleSideLinescore({
    scheduled: rosteredToBowler(sched.B),
    actualId: pB.actualId, actualName: pB.actualName, isSub: pB.status === "substitute",
    entryAverage: entryB, handicap: hcpB, games: draft.sideB.games,
  }) : null;

  const result: MatchResult = computeMatchResult({
    scheduledA: rosteredToBowler(sched.A),
    scheduledB: rosteredToBowler(sched.B),
    scheduledNameA: sched.A.name, scheduledNameB: sched.B.name,
    participationA: pA, participationB: pB,
    entryAverageA: entryA, entryAverageB: entryB,
    handicapA: hcpA, handicapB: hcpB,
    linescoreA, linescoreB,
    pointsOverride: draft.override ?? null,
  });
  const updatedMatch: Match = { ...match, status: "completed", result };
  try { assertMatchResult(updatedMatch, result); }
  catch (e) { return { ok: false, errors: [(e as Error).message] }; }


  const wk = updatedMatch.week;
  // REPLACEMENT semantics: map over existing matches so a re-save of the
  // same matchId overwrites the prior result exactly once (no double-count).
  const nextWeekMatches = (state.db.matchesByWeek[wk] ?? []).map((m) =>
    m.id === updatedMatch.id ? updatedMatch : m);
  const nextWeeks = state.db.weeks.map((w) =>
    w.week === wk ? { ...w, completed: nextWeekMatches.every((m) => m.status === "completed") } : w);
  commit({
    ...state.db,
    matchesByWeek: { ...state.db.matchesByWeek, [wk]: nextWeekMatches },
    weeks: nextWeeks,
  });
  return { ok: true, matchId: updatedMatch.id };
}

function rosteredToBowler(r: RosteredBowlerRecord): Bowler {
  return {
    id: r.id, name: r.name,
    entryAverage: r.entryAverage, handicap: r.handicap,
    scratchAverage: 0, points: 0, pointsLost: 0, gamePoints: 0, setPoints: 0,
    scratchPinfall: 0, handicapPinfall: 0, highGame: 0, highSet: 0,
    matchesPlayed: 0, gamesPlayed: 0, actualGamesRolled: 0, actualScratchPinfall: 0,
    movement: 0,
  };
}

function findMatchInDb(db: LeagueDatabase, matchId: string): Match | undefined {
  for (const w of Object.values(db.matchesByWeek)) {
    const m = w.find((mm) => mm.id === matchId);
    if (m) return m;
  }
  return undefined;
}
/** Look up a match anywhere in the current DB by id. */
export function findMatch(matchId: string): Match | undefined {
  return findMatchInDb(state.db, matchId);
}
/** Convenience: return a saved MatchResult (or undefined) for hydrating
 *  the /admin/results editor into "edit existing" mode. */
export function getSavedResult(matchId: string): MatchResult | undefined {
  return findMatch(matchId)?.result;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

export function resetToDemoData(): void {
  commit(seedDb());
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectActiveRoster(s: StoreState = state): RosteredBowlerRecord[] {
  return s.db.rostered.filter((b) => b.active && !b.archived);
}
export function selectActiveSubs(s: StoreState = state): SubstituteRecord[] {
  return s.db.subs.filter((sb) => sb.active && !sb.archived);
}
export function findRosterRecord(id: string, s: StoreState = state): RosteredBowlerRecord | undefined {
  return s.db.rostered.find((b) => b.id === id);
}
export function findSubRecord(id: string, s: StoreState = state): SubstituteRecord | undefined {
  return s.db.subs.find((sb) => sb.id === id);
}

// ---------------------------------------------------------------------------
// Deterministic self-tests — 13 required scenarios (Phase 1 v3).
// Run at module load; a throw aborts the app in dev so regressions are loud.
// ---------------------------------------------------------------------------

(function selfTest() {
  const db = seedDb();
  const errors: string[] = [];
  const check = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

  // #1 exact frame notation surfaces — enforced in frame-input.ts;
  //    round-trip verified below via saved frame marks in seed results.
  const anyResult = db.matchesByWeek[1].find((m) => m.result)?.result;
  check(!!anyResult, "seed missing week-1 result");
  if (anyResult?.linescoreA) {
    const allowed9 = new Set(["X", "/", "-"]);
    const allowed10 = new Set(["XXX", "XX", "X/", "/X", "X", "/", "-"]);
    for (const game of anyResult.linescoreA.games) {
      for (let f = 0; f < 9; f++)
        check(allowed9.has(game.frames[f].mark), `frame ${f + 1} mark outside allowed set`);
      check(allowed10.has(game.frames[9].mark), "frame 10 mark outside allowed set");
    }
  }
  // #2 frame 10 cumulative IS the scratch game total.
  if (anyResult?.linescoreA) {
    for (let i = 0; i < 3; i++) {
      const g = anyResult.linescoreA.games[i];
      check(g.frames[9].cumulativeScore === g.scratchTotal,
        `frame 10 cumulative != scratchTotal (game ${i + 1})`);
    }
  }
  // #3-5 normal-match awards: 3×game (2 pts) + set (1 pt) → sum to 7.
  for (const m of db.matchesByWeek[1]) {
    if (!m.result || m.result.pointsOverride?.enabled) continue;
    const r = m.result;
    if (!r.linescoreA || !r.linescoreB) continue;
    for (let i = 0; i < 3; i++) {
      const sa = r.handicapGamesA[i], sb = r.handicapGamesB[i];
      const aw = r.gameAwardsA[i], bw = r.gameAwardsB[i];
      if (sa > sb) check(aw === 2 && bw === 0, `game award A>B mismatch`);
      else if (sb > sa) check(bw === 2 && aw === 0, `game award B>A mismatch`);
      else check(aw === 1 && bw === 1, `tie award mismatch`);
    }
    check(r.totalPointsA + r.totalPointsB === 7, "match must sum to 7");
  }
  // #6 handicap formula: floor(0.80 * (160 - avg)), clamped ≥ 0.
  check(computeHandicap(140) === 16, "computeHandicap(140) expected 16");
  check(computeHandicap(160) === 0, "computeHandicap(160) expected 0");
  check(computeHandicap(180) === 0, "computeHandicap(180) expected 0 (clamped)");
  check(computeHandicap(120) === 32, "computeHandicap(120) expected 32");

  // #7 override validator: must be 0..7, 0.5 steps, sum ≤ 7, reason required.
  check(!validatePointsOverride({ enabled: true, pointsA: 4, pointsB: 4, reason: "x" }).ok,
    "override sum > 7 must fail");
  check(!validatePointsOverride({ enabled: true, pointsA: 4.25, pointsB: 2, reason: "x" }).ok,
    "override non-0.5 step must fail");
  check(!validatePointsOverride({ enabled: true, pointsA: 4, pointsB: 3, reason: "  " }).ok,
    "override empty reason must fail");
  check(validatePointsOverride({ enabled: true, pointsA: 4, pointsB: 3, reason: "OK" }).ok,
    "override 4+3 with reason must pass");

  // #8 absent side has zero pinfall and no linescore.
  const absentSeeded = Object.values(db.matchesByWeek)
    .flat()
    .find((m) => m.result?.participationA.status === "absent"
      || m.result?.participationB.status === "absent");
  if (absentSeeded?.result) {
    const r = absentSeeded.result;
    if (r.participationA.status === "absent") {
      check(r.handicapTotalA === 0 && r.scratchTotalA === 0,
        "absent A must have zero pinfall");
      check(r.linescoreA === null, "absent A must have null linescore");
    }
    if (r.participationB.status === "absent") {
      check(r.handicapTotalB === 0 && r.scratchTotalB === 0,
        "absent B must have zero pinfall");
      check(r.linescoreB === null, "absent B must have null linescore");
    }
  }

  // #9 frozen scheduled names/averages present on every completed result.
  for (const m of Object.values(db.matchesByWeek).flat()) {
    if (!m.result) continue;
    const r = m.result;
    check(typeof r.scheduledNameA === "string" && r.scheduledNameA.length > 0,
      `${m.id}: missing scheduledNameA`);
    check(typeof r.scheduledNameB === "string" && r.scheduledNameB.length > 0,
      `${m.id}: missing scheduledNameB`);
    check(typeof r.entryAverageA === "number" && typeof r.entryAverageB === "number",
      `${m.id}: missing frozen entry averages`);
    check(typeof r.handicapA === "number" && typeof r.handicapB === "number",
      `${m.id}: missing frozen handicaps`);
  }

  // #10 v4 substitute scoring: when a substitute rolled, the frozen
  //     handicap on the result is the SUB's handicap (from Starting
  //     Average). When rostered/absent, it equals the scheduled bowler's.
  for (const m of Object.values(db.matchesByWeek).flat()) {
    if (!m.result) continue;
    const r = m.result;
    const sA = db.rostered.find((b) => b.id === m.bowlerA);
    const sB = db.rostered.find((b) => b.id === m.bowlerB);
    if (sA && r.participationA.status !== "substitute")
      check(r.handicapA === computeHandicap(sA.entryAverage),
        `${m.id}: side A handicap must be scheduled bowler's handicap`);
    if (sB && r.participationB.status !== "substitute")
      check(r.handicapB === computeHandicap(sB.entryAverage),
        `${m.id}: side B handicap must be scheduled bowler's handicap`);
    if (r.participationA.status === "substitute")
      check(r.handicapA === computeHandicap(r.entryAverageA),
        `${m.id}: sub A handicap must derive from sub Starting Average`);
    if (r.participationB.status === "substitute")
      check(r.handicapB === computeHandicap(r.entryAverageB),
        `${m.id}: sub B handicap must derive from sub Starting Average`);
  }

  // #11 substitute leakage: sub scratch must NOT be attributed to
  //     scheduled bowler's roster-only totals. Verified by inspecting
  //     any seeded sub result: the linescore's actualId differs from the
  //     scheduled id and `isSubstitute` is true.
  const subResult = Object.values(db.matchesByWeek).flat()
    .find((m) => m.result?.participationA.status === "substitute"
      || m.result?.participationB.status === "substitute");
  if (subResult?.result) {
    const r = subResult.result;
    if (r.participationA.status === "substitute" && r.linescoreA) {
      check(r.linescoreA.isSub === true, "sub A linescore must be flagged");
      check(r.linescoreA.actualId !== r.participationA.scheduledId,
        "sub A actualId must differ from scheduled id");
    }
    if (r.participationB.status === "substitute" && r.linescoreB) {
      check(r.linescoreB.isSub === true, "sub B linescore must be flagged");
    }
  }

  // #12 schema version bumped to v4.
  check(db.version === SCHEMA_VERSION && SCHEMA_VERSION === 4,
    "schema version must be v4");


  // #13 v2 → v3 migration backfills frozen names / averages and drops
  //     malformed note-only results.
  const legacy = {
    version: 2,
    rostered: db.rostered,
    subs: db.subs,
    weeks: db.weeks,
    schedulesByWeek: db.schedulesByWeek,
    matchesByWeek: {
      99: [
        // valid v2 shape missing scheduledName fields
        (() => {
          const src = db.matchesByWeek[1].find((m) => m.result)!;
          const clone: Match = JSON.parse(JSON.stringify(src));
          clone.id = "migtest-A";
          if (clone.result) {
            // simulate v2 by stripping frozen names
            delete (clone.result as unknown as Record<string, unknown>).scheduledNameA;
            delete (clone.result as unknown as Record<string, unknown>).scheduledNameB;
          }
          return clone;
        })(),
        // malformed note-only entry that must be dropped
        {
          id: "migtest-B", week: 99, lanePair: "1-2", slot: 1,
          bowlerA: db.rostered[0].id, bowlerB: db.rostered[1].id,
          status: "completed",
          result: { note: "legacy note only" } as unknown as MatchResult,
        } as unknown as Match,
      ],
    },
  };
  const migrated = migrateV2ToV3(legacy);
  check(!!migrated, "v2→v3 migration must return a database");
  if (migrated) {
    const wk99 = migrated.matchesByWeek[99];
    const kept = wk99.find((m) => m.id === "migtest-A");
    const dropped = wk99.find((m) => m.id === "migtest-B");
    check(!!kept?.result?.scheduledNameA && !!kept?.result?.scheduledNameB,
      "migration must backfill scheduled names");
    check(dropped?.status === "scheduled" && !dropped?.result,
      "migration must drop malformed note-only result to 'scheduled'");
  }

  if (errors.length > 0) {
    // Log all so devs see the full picture, then throw a summary.
    // eslint-disable-next-line no-console
    console.error("[league-store] self-test failures:\n" + errors.map((e) => "  - " + e).join("\n"));
    throw new Error(`league-store self-test failed (${errors.length}): ${errors[0]}`);
  }
})();

