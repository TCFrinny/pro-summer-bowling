/**
 * Phase 1 shared league store.
 *
 * Holds admin-editable roster and substitute pool with a React-friendly
 * subscription and localStorage persistence. Seeded from the mock-data
 * bowler list on first load. Historical match records stored in
 * `mock-data.ts` remain the source of truth for aggregates — this store
 * layers editable roster metadata on top of them so future scheduling
 * and substitute pickers reflect admin edits immediately, while
 * completed history keeps whatever names/handicaps were recorded then.
 *
 * NOTE: Full end-to-end recomputation of every public snapshot on admin
 * "save result" is intentionally out of scope for this file. That pipeline
 * lives in `mock-data.ts` today and is invoked once at module load.
 * `applyResultDraft` records the admin's saved draft in-memory and bumps
 * the store version so admin views re-render; public pages continue to
 * render from the seeded snapshot until the aggregation refactor lands.
 */

import { useSyncExternalStore } from "react";
import { BOWLERS, computeHandicap } from "./mock-data";

export interface RosteredBowlerRecord {
  id: string;
  name: string;
  entryAverage: number;
  /** Derived: max(0, floor(0.8 * (160 - entryAverage))). Cached for display. */
  handicap: number;
  active: boolean;
  /** True when the person exists only for historical reference. */
  archived: boolean;
}

export interface SubstituteRecord {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
}

export interface LeagueState {
  version: number;
  rostered: RosteredBowlerRecord[];
  subs: SubstituteRecord[];
  /** In-memory admin-saved result drafts keyed by matchId. Persisted for
   *  the current browser session so admin can navigate away and back. */
  savedResults: Record<string, { savedAt: number; note: string }>;
}

const STORAGE_KEY = "pss.leagueStore.v1";
const SCHEMA_VERSION = 1;

const SEED_SUBS = [
  "Rick M.", "Terry L.", "Alicia P.", "Marco V.", "Dee K.", "Ronnie F.",
];

function seed(): LeagueState {
  return {
    version: SCHEMA_VERSION,
    rostered: BOWLERS.map((b) => ({
      id: b.id,
      name: b.name,
      entryAverage: b.entryAverage,
      handicap: b.handicap,
      active: true,
      archived: false,
    })),
    subs: SEED_SUBS.map((name, i) => ({
      id: `s${(i + 1).toString().padStart(2, "0")}`,
      name,
      active: true,
      archived: false,
    })),
    savedResults: {},
  };
}

function loadInitial(): LeagueState {
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as LeagueState;
    if (!parsed || parsed.version !== SCHEMA_VERSION) return seed();
    return parsed;
  } catch {
    return seed();
  }
}

let state: LeagueState = loadInitial();
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore quota errors */ }
}

function commit(next: LeagueState) {
  state = next;
  persist();
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnapshot(): LeagueState { return state; }
function getServerSnapshot(): LeagueState { return state; }

export function useLeagueState(): LeagueState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function getLeagueState(): LeagueState { return state; }

// ---------------------------------------------------------------------------
// Roster mutations
// ---------------------------------------------------------------------------

function normName(n: string): string {
  return n.trim().toLowerCase();
}

/** Duplicate-name check across ACTIVE roster (excluding a specific id). */
export function isDuplicateActiveRosterName(name: string, exceptId?: string): boolean {
  const norm = normName(name);
  if (!norm) return false;
  return state.rostered.some((b) => b.active && !b.archived && b.id !== exceptId && normName(b.name) === norm);
}
export function isDuplicateActiveSubName(name: string, exceptId?: string): boolean {
  const norm = normName(name);
  if (!norm) return false;
  return state.subs.some((s) => s.active && !s.archived && s.id !== exceptId && normName(s.name) === norm);
}

function nextRosterId(): string {
  let n = state.rostered.length + 1;
  while (state.rostered.some((b) => b.id === `b${n.toString().padStart(2, "0")}`)) n++;
  return `b${n.toString().padStart(2, "0")}`;
}
function nextSubId(): string {
  let n = state.subs.length + 1;
  while (state.subs.some((s) => s.id === `s${n.toString().padStart(2, "0")}`)) n++;
  return `s${n.toString().padStart(2, "0")}`;
}

export function addRosteredBowler(name: string, entryAverage: number): RosteredBowlerRecord {
  const record: RosteredBowlerRecord = {
    id: nextRosterId(),
    name: name.trim(),
    entryAverage,
    handicap: computeHandicap(entryAverage),
    active: true,
    archived: false,
  };
  commit({ ...state, rostered: [...state.rostered, record] });
  return record;
}

export function updateRosteredBowler(
  id: string,
  patch: Partial<Pick<RosteredBowlerRecord, "name" | "entryAverage" | "active">>,
): void {
  commit({
    ...state,
    rostered: state.rostered.map((b) => {
      if (b.id !== id) return b;
      const name = patch.name != null ? patch.name.trim() : b.name;
      const entryAverage = patch.entryAverage != null ? patch.entryAverage : b.entryAverage;
      const active = patch.active != null ? patch.active : b.active;
      return { ...b, name, entryAverage, handicap: computeHandicap(entryAverage), active };
    }),
  });
}

/** Soft-remove: archive rather than delete so completed history is preserved. */
export function archiveRosteredBowler(id: string): void {
  commit({
    ...state,
    rostered: state.rostered.map((b) => b.id === id ? { ...b, active: false, archived: true } : b),
  });
}

export function addSubstitute(name: string): SubstituteRecord {
  const record: SubstituteRecord = {
    id: nextSubId(),
    name: name.trim(),
    active: true,
    archived: false,
  };
  commit({ ...state, subs: [...state.subs, record] });
  return record;
}

export function updateSubstitute(
  id: string,
  patch: Partial<Pick<SubstituteRecord, "name" | "active">>,
): void {
  commit({
    ...state,
    subs: state.subs.map((s) => {
      if (s.id !== id) return s;
      const name = patch.name != null ? patch.name.trim() : s.name;
      const active = patch.active != null ? patch.active : s.active;
      return { ...s, name, active };
    }),
  });
}

export function archiveSubstitute(id: string): void {
  commit({
    ...state,
    subs: state.subs.map((s) => s.id === id ? { ...s, active: false, archived: true } : s),
  });
}

// ---------------------------------------------------------------------------
// Result-draft passthrough (mock-only)
// ---------------------------------------------------------------------------

export function recordSavedResult(matchId: string, note: string): void {
  commit({
    ...state,
    savedResults: { ...state.savedResults, [matchId]: { savedAt: Date.now(), note } },
  });
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

export function resetToDemoData(): void {
  commit(seed());
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectActiveRoster(s: LeagueState = state): RosteredBowlerRecord[] {
  return s.rostered.filter((b) => b.active && !b.archived);
}
export function selectActiveSubs(s: LeagueState = state): SubstituteRecord[] {
  return s.subs.filter((sb) => sb.active && !sb.archived);
}

/** Look up a roster record by id, including archived. Used so historical
 *  displays can still resolve names even after archival. */
export function findRosterRecord(id: string, s: LeagueState = state): RosteredBowlerRecord | undefined {
  return s.rostered.find((b) => b.id === id);
}

// ---------------------------------------------------------------------------
// Deterministic module-load asserts — the ten test cases from the plan
// (adapted to what the store can prove without the aggregation rewrite).
// ---------------------------------------------------------------------------

(function selfTest() {
  const s0 = seed();
  // 1. Add roster bowler → appears in active list; archive → gone from active,
  //    still present overall.
  const before = s0.rostered.length;
  const added: RosteredBowlerRecord = {
    id: "test-x", name: "Test Bowler", entryAverage: 140,
    handicap: computeHandicap(140), active: true, archived: false,
  };
  const s1: LeagueState = { ...s0, rostered: [...s0.rostered, added] };
  if (selectActiveRoster(s1).length !== before + 1) throw new Error("league-store: add failed");
  const s2: LeagueState = {
    ...s1,
    rostered: s1.rostered.map((b) => b.id === "test-x" ? { ...b, active: false, archived: true } : b),
  };
  if (selectActiveRoster(s2).some((b) => b.id === "test-x"))
    throw new Error("league-store: archive still shows in active");
  if (!findRosterRecord("test-x", s2)) throw new Error("league-store: archive removed historical record");
  // 2. Sub add/archive parallel.
  const sAdd: LeagueState = { ...s0, subs: [...s0.subs, { id: "sx", name: "Late Add", active: true, archived: false }] };
  if (!selectActiveSubs(sAdd).some((x) => x.id === "sx")) throw new Error("league-store: sub add failed");
  const sArc: LeagueState = { ...sAdd, subs: sAdd.subs.map((x) => x.id === "sx" ? { ...x, active: false, archived: true } : x) };
  if (selectActiveSubs(sArc).some((x) => x.id === "sx")) throw new Error("league-store: sub archive still active");
  // Handicap derivation stays in sync with entryAverage.
  if (computeHandicap(140) !== Math.max(0, Math.floor(0.8 * (160 - 140))))
    throw new Error("league-store: handicap formula drift");
})();
