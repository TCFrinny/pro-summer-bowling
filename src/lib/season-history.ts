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
  isCurrent?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  totalWeeks?: number | null;
  pointSystem?: 4 | 7 | null;
  handicapPercent?: number | null;
  handicapBase?: number | null;
  championPersonId?: string | null;
  description?: string | null;
}

/** Client-side sort helper for a set of seasons already filtered/authorized
 *  on the server. Current always leads, then archived by start_date desc. */
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
  /** True when a saved snapshot for that season supplied concrete
   *  per-role game data. When false we still show the row (so the person's
   *  linked season is visible), but career-total aggregation MUST skip
   *  every game/pinfall/high figure from this row rather than treat them
   *  as zero. */
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

/** Fold historical career contributions (from `historical_season_snapshots`
 *  or summary-only records) into the primary CareerSeasonRow list.
 *  Deduplication key = `${seasonId}::${role}`. Preference order:
 *   1. Existing row with hasGameData
 *   2. Historical row with hasGameData
 *   3. Existing row without game data
 *   4. Historical row without game data
 *  This ensures the current-season snapshot path (2026) always wins and
 *  archived historical rows only fill gaps. */
export function mergeHistoricalIntoCareer(
  primary: readonly CareerSeasonRow[],
  historical: ReadonlyArray<{
    seasonId: string; seasonLabel: string; role: SeasonRole;
    displayName: string; bowlerNumber: string | null;
    startingAverage: number | null; handicap: number | null;
    games: number | null; scratchPinfall: number | null; average: number | null;
    highGame: number | null; highSet: number | null;
    points: number | null; finalFinish: number | null;
    isChampion: boolean; hasGameData: boolean;
    source: "historical_snapshot" | "historical_summary";
  }>,
): CareerSeasonRow[] {
  const key = (r: { seasonId: string; role: SeasonRole }) => `${r.seasonId}::${r.role}`;
  const score = (hasData: boolean, kind: "primary" | "historical") =>
    (hasData ? 2 : 0) + (kind === "primary" ? 1 : 0);
  const map = new Map<string, { row: CareerSeasonRow; score: number }>();
  for (const r of primary) {
    map.set(key(r), { row: r, score: score(!!r.hasGameData, "primary") });
  }
  for (const h of historical) {
    const k = key(h);
    const row: CareerSeasonRow = {
      seasonId: h.seasonId,
      seasonLabel: h.seasonLabel,
      role: h.role,
      seasonalName: h.displayName,
      bowlerNumber: h.bowlerNumber,
      startingAverage: h.startingAverage,
      handicap: h.handicap,
      hasGameData: h.hasGameData,
      finalFinish: h.finalFinish,
      games: h.games,
      scratchPinfall: h.scratchPinfall,
      average: h.average,
      highGame: h.highGame,
      highSet: h.highSet,
      points: h.points,
      isChampion: h.isChampion,
    };
    const s = score(h.hasGameData, "historical");
    const prev = map.get(k);
    if (!prev || s > prev.score) map.set(k, { row, score: s });
  }
  return Array.from(map.values()).map((v) => v.row);
}

// ---------------- Snapshot backward-compat parse ----------------

export function parseSnapshotBackwardCompat(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export function withPersonId<T extends Record<string, unknown>>(
  identity: T,
  personId: string | null | undefined,
): T & { personId?: string } {
  if (!personId) return { ...identity };
  return { ...identity, personId };
}

// ---------------- Career row extraction from saved snapshots ------------

/** Extract per-season game data for a rostered bowler from a saved
 *  `public_snapshots.snapshot` payload. The payload is trusted only for
 *  fields we know are stable: bowlersById → games/pinfall/highGame/highSet/
 *  points. Missing fields degrade gracefully; hasGameData is only true when
 *  the payload actually contained the target bowler. */
export function extractRosteredSeasonRow(
  snapshot: unknown,
  rosterId: string,
): {
  hasGameData: boolean;
  games: number | null;
  scratchPinfall: number | null;
  average: number | null;
  highGame: number | null;
  highSet: number | null;
  points: number | null;
  finalFinish: number | null;
} {
  const empty = {
    hasGameData: false,
    games: null,
    scratchPinfall: null,
    average: null,
    highGame: null,
    highSet: null,
    points: null,
    finalFinish: null,
  } as const;
  const snap = parseSnapshotBackwardCompat(snapshot);
  if (!snap) return { ...empty };
  const byId = snap["bowlersById"];
  if (!byId || typeof byId !== "object") return { ...empty };
  const row = (byId as Record<string, unknown>)[rosterId];
  if (!row || typeof row !== "object") return { ...empty };
  const b = row as Record<string, unknown>;
  // Career personal stats: use rostered-only counters (`actualGamesRolled` /
  // `actualScratchPinfall`) so weeks a substitute rolled on this bowler's
  // behalf don't inflate the denominator. Fall back to the credited counters
  // only for legacy snapshots that pre-date those fields.
  const actualGames = numOrNull(b["actualGamesRolled"]);
  const actualPinfall = numOrNull(b["actualScratchPinfall"]);
  const creditedGames = numOrNull(b["gamesPlayed"]);
  const creditedPinfall = numOrNull(b["scratchPinfall"]);
  const games = actualGames ?? creditedGames;
  const pinfall = actualPinfall ?? creditedPinfall;
  const storedAvg = numOrNull(b["scratchAverage"]);
  const points = numOrNull(b["points"]);
  const highGame = numOrNull(b["highGame"]);
  const highSet = numOrNull(b["highSet"]);
  const finalFinish = extractFinalFinish(snap, rosterId);
  const derivedAvg = pinfall != null && games != null && games > 0 ? pinfall / games : null;
  return {
    hasGameData: true,
    games,
    scratchPinfall: pinfall,
    average: storedAvg ?? derivedAvg,
    highGame,
    highSet,
    points,
    finalFinish,
  };

}

function extractFinalFinish(snap: Record<string, unknown>, bowlerId: string): number | null {
  const standings = snap["standings"];
  if (!Array.isArray(standings)) return null;
  for (let i = 0; i < standings.length; i++) {
    const row = standings[i];
    if (row && typeof row === "object") {
      const b = (row as Record<string, unknown>)["bowler"];
      if (b && typeof b === "object" && (b as Record<string, unknown>)["id"] === bowlerId) {
        const rank = (row as Record<string, unknown>)["rank"];
        return typeof rank === "number" ? rank : i + 1;
      }
      if ((row as Record<string, unknown>)["bowlerId"] === bowlerId) {
        const rank = (row as Record<string, unknown>)["rank"];
        return typeof rank === "number" ? rank : i + 1;
      }
    }
  }
  return null;
}

/** Extract per-season game data for a substitute from a saved snapshot's
 *  `substituteProfiles` map. Older snapshots (before final-week live scoring)
 *  did not include this map, so falls back to hasGameData:false. */
export function extractSubstituteSeasonRow(
  snapshot: unknown,
  substituteId: string,
): {
  hasGameData: boolean;
  games: number | null;
  scratchPinfall: number | null;
  average: number | null;
  highGame: number | null;
  highSet: number | null;
} {
  const empty = {
    hasGameData: false,
    games: null,
    scratchPinfall: null,
    average: null,
    highGame: null,
    highSet: null,
  } as const;
  const snap = parseSnapshotBackwardCompat(snapshot);
  if (!snap) return { ...empty };
  const profiles = snap["substituteProfiles"];
  if (!profiles || typeof profiles !== "object") return { ...empty };
  const p = (profiles as Record<string, unknown>)[substituteId];
  if (!p || typeof p !== "object") return { ...empty };
  const pr = p as Record<string, unknown>;
  const games = numOrNull(pr["gamesRolled"]);
  const pinfall = numOrNull(pr["scratchPinfall"]);
  const avg = numOrNull(pr["scratchAverage"]);
  const highGame = numOrNull(pr["highGame"]);
  const highSet = numOrNull(pr["highSet"]);
  if ((games ?? 0) <= 0) {
    // Pool sub with no historical performances — not "game data".
    return { ...empty };
  }
  return {
    hasGameData: true,
    games,
    scratchPinfall: pinfall,
    average: avg ?? (pinfall != null && games != null && games > 0 ? pinfall / games : null),
    highGame,
    highSet,
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------------- Person merge — pure repointing plan ----------------

export interface PersonLink {
  table: "rostered_bowlers" | "substitutes" | "seasons";
  id: string;
  column: "person_id" | "champion_person_id";
}

export interface MergePlan {
  keepPersonId: string;
  removePersonId: string;
  repoints: PersonLink[];
  /** Never contains "delete row" for a seasonal record; only the duplicate
   *  person identity itself is ever deleted. */
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

// ---------------- Server-side privacy filter (source of truth) ----------

/** Filter applied by the PUBLIC seasons server function BEFORE returning
 *  data to unauthenticated clients. Draft seasons and archived-but-private
 *  seasons are never emitted. Kept pure so tests can assert on its output
 *  without spinning up any Supabase client. */
export function publicVisibleSeasons(seasons: readonly SeasonRecord[]): SeasonRecord[] {
  return seasons.filter(
    (s) =>
      s.status === "current" ||
      (s.status === "archived" && s.publicVisible === true),
  );
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
  const pubServer = publicVisibleSeasons(seasons);
  if (pubServer.length !== 2 || pubServer.find((s) => s.id === "s-1") || pubServer.find((s) => s.id === "s-2")) {
    throw new Error(`publicVisibleSeasons leaked private/draft: ${pubServer.map((s) => s.id).join(",")}`);
  }
  const pub = filterPublicSeasons(seasons);
  if (pub.length !== 2 || pub[0].id !== "s1" || pub[1].id !== "s0") {
    throw new Error(`filterPublicSeasons wrong: ${pub.map((s) => s.id).join(",")}`);
  }

  const totals = aggregateCareerTotals([
    { seasonId: "a", seasonLabel: "A", role: "rostered", seasonalName: "n",
      hasGameData: true, games: 30, scratchPinfall: 3600, highGame: 180, highSet: 500 },
    { seasonId: "b", seasonLabel: "B", role: "substitute", seasonalName: "n",
      hasGameData: false },
    { seasonId: "c", seasonLabel: "C", role: "rostered", seasonalName: "n",
      hasGameData: true, games: 15, scratchPinfall: 1500, highGame: 210, highSet: 550,
      isChampion: true },
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
  const nothing = aggregateCareerTotals([
    { seasonId: "x", seasonLabel: "X", role: "rostered", seasonalName: "n", hasGameData: false },
  ]);
  if (nothing.average !== null || nothing.highGame !== null) {
    throw new Error(`career null-preserve wrong: ${JSON.stringify(nothing)}`);
  }

  // Snapshot back-compat + extraction
  const oldSnap = parseSnapshotBackwardCompat({ builtAt: 1, bowlers: [], bowlersById: {} });
  if (!oldSnap || !("bowlers" in oldSnap)) throw new Error("backward-compat parse failed");
  const enriched = withPersonId({ id: "b00", name: "n" }, "p-1");
  if (enriched.personId !== "p-1") throw new Error("withPersonId did not attach");

  const roster = extractRosteredSeasonRow(
    {
      bowlersById: {
        b01: {
          id: "b01",
          gamesPlayed: 21,
          actualGamesRolled: 15,
          scratchPinfall: 2110,
          actualScratchPinfall: 2110,
          scratchAverage: 140.667,
          highGame: 180,
          highSet: 480,
          points: 42,
        },
      },
      standings: [{ bowler: { id: "b01" }, rank: 3 }, { bowler: { id: "b02" }, rank: 4 }],
    },
    "b01",
  );
  if (
    !roster.hasGameData ||
    roster.games !== 15 ||
    roster.scratchPinfall !== 2110 ||
    roster.average !== 140.667 ||
    roster.finalFinish !== 3
  ) {
    throw new Error(`extractRosteredSeasonRow wrong: ${JSON.stringify(roster)}`);
  }
  // Legacy snapshot (pre-final-week live scoring) — no actual* fields; must
  // gracefully fall back to gamesPlayed / scratchPinfall.
  const legacyRosterRow = extractRosteredSeasonRow(
    {
      bowlersById: {
        b01: { id: "b01", gamesPlayed: 30, scratchPinfall: 3300, scratchAverage: 110 },
      },
    },
    "b01",
  );
  if (
    !legacyRosterRow.hasGameData ||
    legacyRosterRow.games !== 30 ||
    legacyRosterRow.scratchPinfall !== 3300 ||
    legacyRosterRow.average !== 110
  ) {
    throw new Error(`extractRosteredSeasonRow legacy fallback wrong: ${JSON.stringify(legacyRosterRow)}`);
  }
  const missingRoster = extractRosteredSeasonRow({ bowlersById: {} }, "b01");
  if (missingRoster.hasGameData) throw new Error("missing bowler must not report data");
  const legacySnap = extractRosteredSeasonRow({ builtAt: 1 }, "b01");
  if (legacySnap.hasGameData) throw new Error("legacy snapshot without bowlersById must be no-data");


  const sub = extractSubstituteSeasonRow(
    { substituteProfiles: { s01: { gamesRolled: 6, scratchPinfall: 660, scratchAverage: 110, highGame: 130, highSet: 350 } } },
    "s01",
  );
  if (!sub.hasGameData || sub.games !== 6 || sub.scratchPinfall !== 660) {
    throw new Error(`extractSubstituteSeasonRow wrong: ${JSON.stringify(sub)}`);
  }
  const emptyPoolSub = extractSubstituteSeasonRow(
    { substituteProfiles: { s02: { gamesRolled: 0, scratchPinfall: 0, scratchAverage: 0 } } },
    "s02",
  );
  if (emptyPoolSub.hasGameData) throw new Error("zero-games sub must not be marked hasGameData");
  const legacySubSnap = extractSubstituteSeasonRow({ builtAt: 1 }, "s01");
  if (legacySubSnap.hasGameData) throw new Error("legacy snapshot without substituteProfiles must be no-data");

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
