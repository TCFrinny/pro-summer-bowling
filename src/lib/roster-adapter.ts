/**
 * Roster / substitute row adapters + snapshot builder for Supabase.
 *
 * Pure, client-safe helpers. NO Supabase client, NO server-only imports.
 * Both the server functions (in league-repo.functions.ts) and the
 * deterministic tests (tests/deterministic.ts) import from here.
 */

import {
  buildSnapshot,
  computeHandicap,
  type Bowler,
  type PublicSnapshot,
} from "@/lib/mock-data";

// -- Row shapes (mirror types.ts Row shape; kept independent so tests
//    don't need the full Database generic) --------------------------------

export interface RosteredRow {
  id: string;
  name: string;
  entry_average: number;
  handicap: number;
  active: boolean;
  archived: boolean;
  bowler_number: string | null;
  season_id: string;
}

export interface SubRow {
  id: string;
  name: string;
  starting_average: number | null;
  handicap: number | null;
  active: boolean;
  archived: boolean;
  bowler_number: string | null;
  season_id: string;
}

// -- Adapters ------------------------------------------------------------

/** Convert a rostered_bowlers row into the Bowler shape buildSnapshot expects.
 *  Aggregate fields start at zero — buildSnapshot fills them from match
 *  results. `handicap` is derived from `entry_average` to guarantee
 *  invariant `handicap = floor(0.8 * (160 - entryAverage))`. Any stored
 *  `handicap` column value is deliberately IGNORED here so a rogue write
 *  cannot break the invariant seen by public pages. */
export function rosteredRowToBowler(row: RosteredRow): Bowler {
  const entryAverage = Number(row.entry_average);
  return {
    id: row.id,
    name: row.name,
    entryAverage,
    handicap: computeHandicap(entryAverage),
    scratchAverage: 0,
    points: 0,
    pointsLost: 0,
    gamePoints: 0,
    setPoints: 0,
    scratchPinfall: 0,
    handicapPinfall: 0,
    highGame: 0,
    highSet: 0,
    matchesPlayed: 0,
    gamesPlayed: 0,
    actualGamesRolled: 0,
    actualScratchPinfall: 0,
    movement: 0,
  };
}

/** Build a PublicSnapshot from the raw Supabase rows for a single season.
 *  For checkpoint 3A the weeks/matchesByWeek inputs are empty and the
 *  resulting snapshot has zero standings/history, matching the real
 *  Supabase roster (not seeded demo data).
 *
 *  ONLY `active === true && archived === false` bowlers appear in the
 *  public snapshot. Inactive or archived rows stay in Supabase (so the
 *  admin UI can repair or restore them and historical match_results can
 *  still hydrate their names later) but must NOT surface on the public
 *  Bowlers/Standings pages nor be scheduling-eligible via the snapshot. */
export function buildSnapshotFromRows(input: {
  rostered: RosteredRow[];
}): PublicSnapshot {
  const activeRoster = input.rostered
    .filter((r) => r.active === true && r.archived === false)
    .sort((a, b) => a.id.localeCompare(b.id));
  const bowlers = activeRoster.map(rosteredRowToBowler);
  return buildSnapshot({ bowlers, weeks: [], matchesByWeek: {} });
}


// -- ID minting ----------------------------------------------------------

/** Deterministic next roster id: b01, b02, ... zero-padded to at least 2. */
export function nextRosterIdFrom(existing: readonly { id: string }[]): string {
  return nextIdWithPrefix(existing, "b");
}
export function nextSubIdFrom(existing: readonly { id: string }[]): string {
  return nextIdWithPrefix(existing, "s");
}
function nextIdWithPrefix(existing: readonly { id: string }[], prefix: string): string {
  const nums = new Set<number>();
  for (const r of existing) {
    if (!r.id.startsWith(prefix)) continue;
    const n = Number(r.id.slice(prefix.length));
    if (Number.isFinite(n)) nums.add(n);
  }
  let n = 1;
  while (nums.has(n)) n++;
  return `${prefix}${n.toString().padStart(2, "0")}`;
}

// -- Validation (server + client share the same rules) ------------------

export const ROSTER_MAX_ACTIVE = 36;
export const BOWLER_NUMBER_MAX_LEN = 10;

/** ID Number is REQUIRED for every roster bowler and substitute. Returns
 *  an error message when the value is missing, all-whitespace, or too long.
 *  Callers must trim before passing. */
export function validateBowlerNumber(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  if (t.length === 0) return "ID Number is required (1–10 characters).";
  if (t.length > BOWLER_NUMBER_MAX_LEN) return "ID Number must be 1–10 characters.";
  return null;
}
export function validateName(value: string): string | null {
  const t = value.trim();
  if (t.length === 0) return "Name is required.";
  if (t.length > 80) return "Name is too long.";
  return null;
}
/** Accepts 0..300 as a real number (decimals preserved). */
export function validateAverage(value: number): string | null {
  if (!Number.isFinite(value)) return "Average must be a number.";
  if (value < 0 || value > 300) return "Average must be between 0 and 300.";
  return null;
}
export function isDuplicateActive(
  name: string,
  rows: readonly { id: string; name: string; active: boolean; archived: boolean }[],
  exceptId?: string,
): boolean {
  const norm = name.trim().toLowerCase();
  if (!norm) return false;
  return rows.some(
    (r) =>
      r.active &&
      !r.archived &&
      r.id !== exceptId &&
      r.name.trim().toLowerCase() === norm,
  );
}

// -- Deterministic self-test --------------------------------------------

(function selfTest() {
  // Handicap invariant respected regardless of stored handicap column value.
  const b = rosteredRowToBowler({
    id: "b01",
    name: "Alice",
    entry_average: 140,
    handicap: 999, // bogus — must be ignored
    active: true,
    archived: false,
    bowler_number: "01001",
    season_id: "s1",
  });
  if (b.handicap !== computeHandicap(140)) {
    throw new Error(`roster-adapter: handicap invariant broken (${b.handicap})`);
  }
  if (b.points !== 0 || b.scratchAverage !== 0 || b.matchesPlayed !== 0) {
    throw new Error("roster-adapter: aggregate fields must start at zero");
  }

  // Empty roster snapshot: valid structure, empty standings.
  const emptySnap = buildSnapshotFromRows({ rostered: [] });
  if (!Array.isArray(emptySnap.bowlers) || emptySnap.bowlers.length !== 0) {
    throw new Error("roster-adapter: empty roster snapshot must have 0 bowlers");
  }
  if (!Array.isArray(emptySnap.standings) || emptySnap.standings.length !== 0) {
    throw new Error("roster-adapter: empty roster snapshot must have 0 standings rows");
  }
  if (!emptySnap.bowlersById || typeof emptySnap.bowlersById !== "object") {
    throw new Error("roster-adapter: bowlersById must be an object");
  }

  // Two-row snapshot: standings rank by points (all 0), tiebreak
  // handicapPinfall (all 0). Rows still appear.
  const snap = buildSnapshotFromRows({
    rostered: [
      { id: "b01", name: "Alice", entry_average: 140, handicap: 16, active: true, archived: false, bowler_number: "01001", season_id: "s1" },
      { id: "b02", name: "Bob",   entry_average: 120, handicap: 32, active: true, archived: false, bowler_number: "01002", season_id: "s1" },
    ],
  });
  if (snap.bowlers.length !== 2 || snap.standings.length !== 2) {
    throw new Error("roster-adapter: 2-row snapshot must yield 2 bowlers/standings");
  }
  if (snap.bowlersById["b01"]?.entryAverage !== 140) {
    throw new Error("roster-adapter: bowlersById lookup broken");
  }
  // Archived rows must be filtered out.
  const withArchived = buildSnapshotFromRows({
    rostered: [
      { id: "b01", name: "Alice", entry_average: 140, handicap: 16, active: true, archived: false, bowler_number: null, season_id: "s1" },
      { id: "b99", name: "Zed",   entry_average: 100, handicap: 48, active: false, archived: true, bowler_number: null, season_id: "s1" },
    ],
  });
  if (withArchived.bowlers.length !== 1 || withArchived.bowlersById["b99"]) {
    throw new Error("roster-adapter: archived rows must be excluded from snapshot");
  }

  // ID minting: skip existing.
  const nid = nextRosterIdFrom([{ id: "b01" }, { id: "b02" }, { id: "b04" }]);
  if (nid !== "b03") throw new Error(`roster-adapter: nextRosterIdFrom expected b03, got ${nid}`);
  const sid = nextSubIdFrom([]);
  if (sid !== "s01") throw new Error(`roster-adapter: nextSubIdFrom expected s01, got ${sid}`);

  // Duplicate detection ignores archived rows.
  const dup = isDuplicateActive("alice", [
    { id: "b01", name: "Alice", active: true, archived: false },
  ]);
  if (!dup) throw new Error("roster-adapter: duplicate-active check must match on trim/lower");
  const dupExcept = isDuplicateActive("alice", [
    { id: "b01", name: "Alice", active: true, archived: false },
  ], "b01");
  if (dupExcept) throw new Error("roster-adapter: except-id must allow same row rename");
  const dupArchived = isDuplicateActive("alice", [
    { id: "b01", name: "Alice", active: false, archived: true },
  ]);
  if (dupArchived) throw new Error("roster-adapter: archived rows must not block reuse");

  // ID Number is REQUIRED — empty / null / whitespace all rejected.
  if (validateBowlerNumber(null) == null)   throw new Error("roster-adapter: null ID must be rejected");
  if (validateBowlerNumber("")   == null)   throw new Error("roster-adapter: empty ID must be rejected");
  if (validateBowlerNumber("   ") == null)  throw new Error("roster-adapter: whitespace ID must be rejected");
  if (validateBowlerNumber("12345678901") == null)
    throw new Error("roster-adapter: >10-char ID must be rejected");
  if (validateBowlerNumber("01001") !== null)
    throw new Error("roster-adapter: valid ID must pass");

  // Decimal averages accepted.
  if (validateAverage(140.5) !== null) throw new Error("roster-adapter: decimals must be accepted");
  if (validateAverage(-1)    == null)  throw new Error("roster-adapter: negative avg must be rejected");
  if (validateAverage(301)   == null)  throw new Error("roster-adapter: avg > 300 must be rejected");

  // Decimal average round-trips through the adapter without silent rounding.
  const decBowler = rosteredRowToBowler({
    id: "b03", name: "Cara", entry_average: 145.75, handicap: 0,
    active: true, archived: false, bowler_number: "01003", season_id: "s1",
  });
  if (decBowler.entryAverage !== 145.75) {
    throw new Error(`roster-adapter: decimal avg lost (${decBowler.entryAverage})`);
  }
  if (decBowler.handicap !== computeHandicap(145.75)) {
    throw new Error("roster-adapter: handicap must derive from decimal avg via floor");
  }
})();
