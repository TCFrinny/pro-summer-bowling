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
}
export interface SubstituteRecord {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
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

const STORAGE_KEY = "pss.leagueStore.v2";
const OLD_KEY_V1 = "pss.leagueStore.v1";
const SCHEMA_VERSION = 2;

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
    rostered: rawBowlers.map((b) => ({
      id: b.id, name: b.name, entryAverage: b.entryAverage,
      handicap: b.handicap, active: true, archived: false,
    })),
    subs: [
      "Rick M.", "Terry L.", "Alicia P.", "Marco V.", "Dee K.", "Ronnie F.",
    ].map((name, i) => ({
      id: `s${(i + 1).toString().padStart(2, "0")}`,
      name, active: true, archived: false,
    })),
    weeks: rawWeeks,
    matchesByWeek: matches,
    schedulesByWeek,
  };
}

function buildStoreState(db: LeagueDatabase): StoreState {
  return {
    db,
    snapshot: buildSnapshot({ bowlers: rosterToBowlers(db.rostered), weeks: db.weeks, matchesByWeek: db.matchesByWeek }),
    version: (state?.version ?? 0) + 1,
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
    // Discard the incompatible v1 shape.
    window.localStorage.removeItem(OLD_KEY_V1);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedDb();
    const parsed = JSON.parse(raw) as LeagueDatabase;
    if (!parsed || parsed.version !== SCHEMA_VERSION) return seedDb();
    // Structural sanity: matchesByWeek + weeks present.
    if (!parsed.rostered || !parsed.matchesByWeek || !parsed.weeks) return seedDb();
    return parsed;
  } catch {
    return seedDb();
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let state: StoreState = buildStoreState(loadInitialDb());
const listeners = new Set<() => void>();

// Bridge: mock-data getters read the snapshot through this hook.
_installSnapshotProvider(() => state.snapshot);

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

export function addRosteredBowler(name: string, entryAverage: number): RosteredBowlerRecord {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required.");
  if (isDuplicateActiveRosterName(trimmed))
    throw new Error(`An active roster bowler named "${trimmed}" already exists.`);
  const record: RosteredBowlerRecord = {
    id: nextRosterId(),
    name: trimmed,
    entryAverage,
    handicap: computeHandicap(entryAverage),
    active: true, archived: false,
  };
  commit({ ...state.db, rostered: [...state.db.rostered, record] });
  return record;
}
export function updateRosteredBowler(
  id: string,
  patch: Partial<Pick<RosteredBowlerRecord, "name" | "entryAverage" | "active">>,
): void {
  if (patch.name != null && isDuplicateActiveRosterName(patch.name, id))
    throw new Error(`An active roster bowler named "${patch.name.trim()}" already exists.`);
  commit({
    ...state.db,
    rostered: state.db.rostered.map((b) => {
      if (b.id !== id) return b;
      const name = patch.name != null ? patch.name.trim() : b.name;
      const entryAverage = patch.entryAverage != null ? patch.entryAverage : b.entryAverage;
      const active = patch.active != null ? patch.active : b.active;
      return { ...b, name, entryAverage, handicap: computeHandicap(entryAverage), active };
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

export function addSubstitute(name: string): SubstituteRecord {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required.");
  if (isDuplicateActiveSubName(trimmed))
    throw new Error(`An active substitute named "${trimmed}" already exists.`);
  const record: SubstituteRecord = {
    id: nextSubId(), name: trimmed, active: true, archived: false,
  };
  commit({ ...state.db, subs: [...state.db.subs, record] });
  return record;
}
export function updateSubstitute(
  id: string,
  patch: Partial<Pick<SubstituteRecord, "name" | "active">>,
): void {
  if (patch.name != null && isDuplicateActiveSubName(patch.name, id))
    throw new Error(`An active substitute named "${patch.name.trim()}" already exists.`);
  commit({
    ...state.db,
    subs: state.db.subs.map((s) => {
      if (s.id !== id) return s;
      const name = patch.name != null ? patch.name.trim() : s.name;
      const active = patch.active != null ? patch.active : s.active;
      return { ...s, name, active };
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
  const nextMatches: Match[] = slots.map((s) => {
    const key = `${s.lanePair}-${s.slot}`;
    const prior = byKey.get(key);
    if (prior && prior.result) return prior; // frozen: has a saved result
    return {
      id: prior?.id ?? `w${week}-${s.lanePair}-${s.slot}`,
      week, lanePair: s.lanePair, slot: s.slot,
      status: "scheduled",
      bowlerA: s.bowlerA, bowlerB: s.bowlerB,
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
  /** Optional override — new frozen entry average for a sub or edit. */
  entryAverageOverride?: number;
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
  const match = findMatch(draft.matchId);
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

  const entryA = draft.sideA.entryAverageOverride ?? sched.A.entryAverage;
  const entryB = draft.sideB.entryAverageOverride ?? sched.B.entryAverage;
  const hcpA = computeHandicap(sched.A.entryAverage);
  const hcpB = computeHandicap(sched.B.entryAverage);

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

function findMatch(matchId: string): Match | undefined {
  for (const w of Object.values(state.db.matchesByWeek)) {
    const m = w.find((mm) => mm.id === matchId);
    if (m) return m;
  }
  return undefined;
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
// Deterministic self-tests
// ---------------------------------------------------------------------------

(function selfTest() {
  const db = seedDb();
  // #1 exact frame notation surfaces — checked in frame-input.ts.
  // #3 Frame 10 cumulative IS the scratch game.
  const anyResult = db.matchesByWeek[1].find((m) => m.result)?.result;
  if (!anyResult) throw new Error("store: seed missing week-1 result");
  if (anyResult.linescoreA) {
    for (let i = 0; i < 3; i++) {
      const g = anyResult.linescoreA.games[i];
      const tenth = g.frames[9].cumulativeScore;
      if (tenth !== g.scratchTotal)
        throw new Error(`store: frame 10 cumulative != scratchTotal`);
    }
  }
  // #4-6 Awards from HCP, sum to 7 on normal.
  for (const m of db.matchesByWeek[1]) {
    if (!m.result || m.result.pointsOverride) continue;
    const r = m.result;
    if (!r.linescoreA || !r.linescoreB) continue;
    for (let i = 0; i < 3; i++) {
      const sa = r.handicapGamesA[i], sb = r.handicapGamesB[i];
      const aw = r.gameAwardsA[i], bw = r.gameAwardsB[i];
      if (sa > sb && aw !== 2) throw new Error("store: game award mismatch (A>B)");
      if (sb > sa && bw !== 2) throw new Error("store: game award mismatch (B>A)");
      if (sa === sb && (aw !== 1 || bw !== 1)) throw new Error("store: tie awards");
    }
    if (r.totalPointsA + r.totalPointsB !== 7)
      throw new Error("store: match must sum to 7");
  }
  // Handicap formula.
  if (computeHandicap(140) !== 16)
    throw new Error("store: computeHandicap(140) expected 16");
  if (computeHandicap(160) !== 0)
    throw new Error("store: computeHandicap(160) expected 0");
})();
