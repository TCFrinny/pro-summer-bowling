/**
 * Pure, side-effect-free helpers for the multi-season history / permanent-
 * people phase. Kept isolated from Supabase and from the current-season
 * snapshot builder so we can unit-test lane math, career aggregation, and
 * merge-repointing without any DB access.
 *
 * NOTHING in this module reads or writes the database. Runtime queries
 * live in `history-repo.functions.ts`.
 */

// ---------------- Name normalization ----------------

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------- Lane-pair capacity math ----------------

export interface LanePairConfig {
  label: string;
  displayOrder: number;
  matchupCapacity: number;
  active: boolean;
}

export interface LanePairTotals {
  totalMatchups: number;
  bowlerCapacity: number;
  activePairs: number;
}

export function summarizeLanePairs(pairs: readonly LanePairConfig[]): LanePairTotals {
  let total = 0;
  let active = 0;
  for (const p of pairs) {
    if (!p.active) continue;
    active += 1;
    total += Math.max(0, Math.floor(p.matchupCapacity));
  }
  return { totalMatchups: total, bowlerCapacity: total * 2, activePairs: active };
}

/** Given `[4,3,4,4,3,4]` returns totalMatchups=22, bowlerCapacity=44. */
export function summarizeCapacityList(capacities: readonly number[]): LanePairTotals {
  return summarizeLanePairs(
    capacities.map((c, i) => ({
      label: `${i * 2 + 1}-${i * 2 + 2}`,
      displayOrder: i,
      matchupCapacity: c,
      active: true,
    })),
  );
}

// ---------------- Season status ----------------

export type SeasonStatus = "draft" | "current" | "archived";

export interface SeasonRecord {
  id: string;
  label: string;
  status: SeasonStatus;
  publicVisible: boolean;
  startDate?: string | null;
  endDate?: string | null;
  totalWeeks?: number | null;
  pointSystem?: 4 | 7 | null;
  championPersonId?: string | null;
  description?: string | null;
}

/** Public seasons page filter: current always shown, then public+archived. */
export function filterPublicSeasons(seasons: readonly SeasonRecord[]): SeasonRecord[] {
  const current = seasons.filter((s) => s.status === "current");
  const archived = seasons
    .filter((s) => s.status === "archived" && s.publicVisible)
    .sort((a, b) => (b.startDate ?? b.label).localeCompare(a.startDate ?? a.label));
  return [...current, ...archived];
}

// ---------------- Career profile aggregation ----------------

export type SeasonRole = "rostered" | "substitute";

export interface CareerSeasonRow {
  seasonId: string;
  seasonLabel: string;
  role: SeasonRole;
  seasonalName: string;
  bowlerNumber?: string | null;
  startingAverage?: number | null;
  handicap?: number | null;
  /** True when this season has a saved public snapshot we could read
   *  personal totals from. When false the row is shown but game-level
   *  aggregates must be excluded from career totals. */
  hasGameData: boolean;
  finalFinish?: number | null;
  games?: number | null;
  scratchPinfall?: number | null;
  average?: number | null;
  highGame?: number | null;
  highSet?: number | null;
  points?: number | null;
  isChampion?: boolean;
}

export interface CareerTotals {
  seasonsCount: number;
  seasonsWithGameData: number;
  totalGames: number;
  totalScratchPinfall: number;
  /** Weighted by games from seasons that have game data. Null when no
   *  season contributes game data — never return 0 in that case, to
   *  avoid fabricating a "0.00 average". */
  average: number | null;
  highGame: number | null;
  highSet: number | null;
  championships: number;
}

export function aggregateCareerTotals(rows: readonly CareerSeasonRow[]): CareerTotals {
  let games = 0;
  let pinfall = 0;
  let highGame: number | null = null;
  let highSet: number | null = null;
  let withData = 0;
  let championships = 0;
  for (const r of rows) {
    if (r.isChampion) championships += 1;
    if (!r.hasGameData) continue;
    withData += 1;
    if (typeof r.games === "number") games += r.games;
    if (typeof r.scratchPinfall === "number") pinfall += r.scratchPinfall;
    if (typeof r.highGame === "number") {
      highGame = highGame === null ? r.highGame : Math.max(highGame, r.highGame);
    }
    if (typeof r.highSet === "number") {
      highSet = highSet === null ? r.highSet : Math.max(highSet, r.highSet);
    }
  }
  const average = games > 0 ? pinfall / games : null;
  return {
    seasonsCount: rows.length,
    seasonsWithGameData: withData,
    totalGames: games,
    totalScratchPinfall: pinfall,
    average,
    highGame,
    highSet,
    championships,
  };
}

// ---------------- Snapshot backward-compat parse ----------------

/** Parse a possibly-old public snapshot payload defensively — never throw
 *  on missing new fields (personId, substitutes, substituteProfiles, etc.).
 *  Returns null when the value is not an object; otherwise returns the
 *  same reference. This mirrors what `public-snapshot.tsx` accepts. */
export function parseSnapshotBackwardCompat(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

/** Attach optional personId to a snapshot roster identity object without
 *  mutating the original. Safe for old snapshots lacking the field. */
export function withPersonId<T extends Record<string, unknown>>(
  identity: T,
  personId: string | null | undefined,
): T & { personId?: string } {
  if (!personId) return { ...identity };
  return { ...identity, personId };
}

// ---------------- Person merge — pure repointing plan ----------------

export interface PersonLink {
  /** Table this link came from — 'rostered_bowlers' | 'substitutes' | 'seasons'. */
  table: "rostered_bowlers" | "substitutes" | "seasons";
  /** Primary key of the affected row (text or uuid depending on table). */
  id: string;
  /** Column that currently points at the duplicate person. */
  column: "person_id" | "champion_person_id";
}

export interface MergePlan {
  keepPersonId: string;
  removePersonId: string;
  repoints: PersonLink[];
  /** Emitted so callers can confirm exactly what will change. Never
   *  contains the substring "delete row" for a seasonal record — only the
   *  duplicate person identity itself is ever deleted. */
  summary: string[];
}

export function planPersonMerge(
  keepPersonId: string,
  removePersonId: string,
  links: readonly PersonLink[],
): MergePlan {
  if (!keepPersonId || !removePersonId) throw new Error("both person ids required");
  if (keepPersonId === removePersonId) throw new Error("cannot merge a person into itself");
  const repoints = links.filter(
    (l) => l.table === "rostered_bowlers" || l.table === "substitutes" || l.table === "seasons",
  );
  const summary = [
    `Repoint ${repoints.length} record(s) from ${removePersonId} → ${keepPersonId}.`,
    "Seasonal roster/substitute rows are preserved; only the duplicate person identity is deleted.",
  ];
  return { keepPersonId, removePersonId, repoints, summary };
}

// ---------------------------------------------------------------------------
// Deterministic self-tests
// ---------------------------------------------------------------------------
(function selfTest() {
  const uneven = summarizeCapacityList([4, 3, 4, 4, 3, 4]);
  if (uneven.totalMatchups !== 22 || uneven.bowlerCapacity !== 44) {
    throw new Error(`uneven lane capacity math wrong: ${JSON.stringify(uneven)}`);
  }
  const norm = normalizeName("  John   Q. Public  ");
  if (norm !== "john q. public") throw new Error(`normalizeName wrong: ${norm}`);

  const seasons: SeasonRecord[] = [
    { id: "s1", label: "2026 Summer", status: "current", publicVisible: true },
    { id: "s0", label: "2025 Winter", status: "archived", publicVisible: true, startDate: "2025-01-01" },
    { id: "s-1", label: "2024 Draft", status: "draft", publicVisible: false },
    { id: "s-2", label: "2024 Private Archive", status: "archived", publicVisible: false },
  ];
  const pub = filterPublicSeasons(seasons);
  if (pub.length !== 2 || pub[0].id !== "s1" || pub[1].id !== "s0") {
    throw new Error(`filterPublicSeasons wrong: ${pub.map((s) => s.id).join(",")}`);
  }

  const totals = aggregateCareerTotals([
    {
      seasonId: "a", seasonLabel: "A", role: "rostered", seasonalName: "n",
      hasGameData: true, games: 30, scratchPinfall: 3600, highGame: 180, highSet: 500,
    },
    {
      seasonId: "b", seasonLabel: "B", role: "substitute", seasonalName: "n",
      hasGameData: false, // unavailable — must not be treated as zero
    },
    {
      seasonId: "c", seasonLabel: "C", role: "rostered", seasonalName: "n",
      hasGameData: true, games: 15, scratchPinfall: 1500, highGame: 210, highSet: 550,
      isChampion: true,
    },
  ]);
  if (totals.totalGames !== 45 || totals.totalScratchPinfall !== 5100) {
    throw new Error(`career totals sums wrong: ${JSON.stringify(totals)}`);
  }
  if (!totals.average || Math.abs(totals.average - 5100 / 45) > 1e-9) {
    throw new Error(`career average wrong: ${totals.average}`);
  }
  if (totals.highGame !== 210 || totals.highSet !== 550 || totals.championships !== 1) {
    throw new Error(`career high/champ wrong: ${JSON.stringify(totals)}`);
  }
  if (totals.seasonsCount !== 3 || totals.seasonsWithGameData !== 2) {
    throw new Error(`seasons counts wrong: ${JSON.stringify(totals)}`);
  }
  // "no data at all" case must yield null average, not 0.
  const nothing = aggregateCareerTotals([
    { seasonId: "x", seasonLabel: "X", role: "rostered", seasonalName: "n", hasGameData: false },
  ]);
  if (nothing.average !== null || nothing.highGame !== null) {
    throw new Error(`career null-preserve wrong: ${JSON.stringify(nothing)}`);
  }

  // Backward-compat snapshot: missing new fields must not throw.
  const oldSnap = parseSnapshotBackwardCompat({ builtAt: 1, bowlers: [] });
  if (!oldSnap || !("bowlers" in oldSnap)) throw new Error("backward-compat parse failed");
  if ("personId" in (oldSnap as Record<string, unknown>)) {
    throw new Error("backward-compat parse invented personId");
  }
  const enriched = withPersonId({ id: "b00", name: "n" }, "p-1");
  if (enriched.personId !== "p-1") throw new Error("withPersonId did not attach");
  const passthrough = withPersonId({ id: "b00" }, null);
  if ("personId" in passthrough) throw new Error("withPersonId leaked null");

  // Merge plan: repoints all links, never emits a "delete row" instruction
  // for a seasonal record.
  const plan = planPersonMerge("keep", "remove", [
    { table: "rostered_bowlers", id: "b00", column: "person_id" },
    { table: "substitutes", id: "s5", column: "person_id" },
    { table: "seasons", id: "season-1", column: "champion_person_id" },
  ]);
  if (plan.repoints.length !== 3) throw new Error("merge plan lost links");
  if (plan.summary.join(" ").toLowerCase().includes("delete row")) {
    throw new Error("merge plan proposed deleting a seasonal row");
  }
  let threw = false;
  try { planPersonMerge("x", "x", []); } catch { threw = true; }
  if (!threw) throw new Error("planPersonMerge should reject self-merge");
})();
