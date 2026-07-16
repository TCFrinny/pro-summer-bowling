/**
 * Pure helpers for the historical season snapshot shape and its
 * consumers. Deterministic — no DB, no globals.
 *
 * The historical snapshot is a SEPARATE cached read model from the
 * current-season public_snapshot. It lives in `historical_season_snapshots`
 * and is rebuilt on any admin write to historical data for that season.
 *
 * The current-season snapshot rebuild path (buildFullSnapshot →
 * public_snapshots) is completely untouched.
 */

import type { HistoricalDetailMode, HistoricalPointSystem } from "./historical-scoring";
import type { GameLinescore } from "./duckpin";

export interface HistoricalParticipantMeta {
  ref: string;                  // participant_ref (rostered_bowlers.id / substitutes.id / etc)
  personId?: string | null;
  displayName: string;
  bowlerNumber?: string | null;
  startingAverage?: number | null;
  handicap?: number | null;
  role: "rostered" | "substitute";
}

/** One scheduled slot, whether or not a result exists yet. Public Schedule
 *  reads this; Weekly Results reads `matches` (result rows only). */
export interface HistoricalScheduledSlot {
  slotId: string;
  weekNumber: number;
  lanePair: string;
  slot: number;
  scheduledA: string; scheduledB: string;
  nameA: string; nameB: string;
  hasResult: boolean;
}

export interface HistoricalMatch {
  slotId: string;
  weekNumber: number;
  lanePair: string;
  slot: number;
  detailMode: HistoricalDetailMode;
  scheduledA: string; scheduledB: string;
  /** Frozen scheduled display names captured at schedule time. */
  scheduledNameA: string; scheduledNameB: string;
  actualA: string; actualB: string;
  actualNameA: string; actualNameB: string;
  isSubA: boolean; isSubB: boolean;
  absentA: boolean; absentB: boolean;
  entryAverageA: number; entryAverageB: number;
  handicapA: number; handicapB: number;
  hasGameDataA: boolean;
  hasGameDataB: boolean;
  scratchGamesA: [number, number, number] | null;
  scratchGamesB: [number, number, number] | null;
  handicapGamesA: [number, number, number];
  handicapGamesB: [number, number, number];
  scratchTotalA: number; scratchTotalB: number;
  handicapTotalA: number; handicapTotalB: number;
  gameAwardsA: [number, number, number];
  gameAwardsB: [number, number, number];
  gamePointsA: number; gamePointsB: number;
  setPointA: number; setPointB: number;
  totalPointsA: number; totalPointsB: number;
  finalPointsA: number; finalPointsB: number;
  overrideEnabled: boolean;
  winner: "A" | "B" | "T";
  /** Frame-level linescore for FULL_LINESCORE rows only. `null` for
   *  GAME_SCORES / SUMMARY_ONLY — readers must render "frame linescore
   *  unavailable" instead of fabricating frames. */
  linescoreA: [GameLinescore, GameLinescore, GameLinescore] | null;
  linescoreB: [GameLinescore, GameLinescore, GameLinescore] | null;
}

export interface HistoricalWeekSummary {
  weekNumber: number;
  date: string | null;
  published: boolean;
  completed: boolean;
  matches: HistoricalMatch[];
  /** Every scheduled slot in the week, ordered by natural lane-pair.
   *  Included regardless of whether a result exists. */
  schedule: HistoricalScheduledSlot[];
}

export interface HistoricalAdvancedTotals {
  /** Number of full-linescore games contributing to these totals. */
  games: number;
  strikes: number;
  spares: number;
  opens: number;
  marks: number;
}

export interface HistoricalStandingRow {
  participantRef: string;
  displayName: string;
  personId?: string | null;
  matchesPlayed: number;
  points: number | null;
  pointsLost: number | null;
  /** League tiebreaker after points. Sum of handicap totals for weeks the
   *  scheduled bowler received credit (self, substitute, or absent-with-
   *  scores). Null when we have no weekly data. */
  handicapPinfall: number | null;
  games: number | null;
  scratchPinfall: number | null;
  scratchAverage: number | null;
  highGame: number | null;
  highSet: number | null;
  /** Aggregated advanced stats from FULL_LINESCORE rows where THIS bowler
   *  actually rolled. null when no full-linescore data is available (game-
   *  scores-only or summary-only). Never returns zeros as a stand-in. */
  advanced: HistoricalAdvancedTotals | null;
  rank: number;
  fromSummaryOnly: boolean;
}

export interface HistoricalSnapshot {
  version: 1;
  builtAt: number;
  seasonId: string;
  seasonLabel: string;
  pointSystem: HistoricalPointSystem;
  totalWeeks: number | null;
  participants: HistoricalParticipantMeta[];
  weeks: HistoricalWeekSummary[];
  standings: HistoricalStandingRow[];
  /** True when the season only has summary-only records (no weekly matches). */
  summaryOnly: boolean;
  /** Rows fed straight from historical_season_summary_records. Never null;
   *  may be an empty array. */
  summaryRecords: Array<{
    participantRef: string;
    personId: string | null;
    role: "rostered" | "substitute";
    displayName: string;
    bowlerNumber: string | null;
    games: number | null;
    scratchPinfall: number | null;
    average: number | null;
    highGame: number | null;
    highSet: number | null;
    points: number | null;
    pointsLost: number | null;
    finalFinish: number | null;
    isChampion: boolean;
  }>;
}

/** Build standings by aggregating computed weekly matches. Falls back to
 *  summary-only records for participants who have no weekly data. */
export function buildHistoricalStandings(input: {
  participants: HistoricalParticipantMeta[];
  weeks: HistoricalWeekSummary[];
  summaryRecords: HistoricalSnapshot["summaryRecords"];
}): HistoricalStandingRow[] {
  // key = participantRef (scheduled). Absent scores credit the scheduled
  // side. Substitute performance stays with the substitute for personal
  // stats but points/handicap pinfall go to the scheduled bowler.
  type Acc = {
    ref: string;
    matches: number;
    points: number;
    pointsLost: number;
    handicapPinfall: number;
    hasHandicapData: boolean;
    games: number;
    pinfall: number;
    highGame: number | null;
    highSet: number | null;
    hasWeekly: boolean;
    /** True when this participant only ever appeared as a substitute in
     *  another slot (personal stats collector). */
    personalStatsOnly?: boolean;
    // Advanced (full-linescore only) — attributed to the ACTUAL bowler.
    advGames: number;
    advStrikes: number;
    advSpares: number;
    advOpens: number;
    advMarks: number;
  };
  const acc = new Map<string, Acc>();
  function ensure(ref: string): Acc {
    let a = acc.get(ref);
    if (!a) {
      a = { ref, matches: 0, points: 0, pointsLost: 0, handicapPinfall: 0, hasHandicapData: false,
        games: 0, pinfall: 0, highGame: null, highSet: null, hasWeekly: false,
        advGames: 0, advStrikes: 0, advSpares: 0, advOpens: 0, advMarks: 0 };
      acc.set(ref, a);
    }
    return a;
  }

  for (const w of input.weeks) {
    for (const m of w.matches) {
      // POINTS + HANDICAP-PINFALL credit scheduled bowler
      const sa = ensure(m.scheduledA);
      const sb = ensure(m.scheduledB);
      sa.hasWeekly = true; sb.hasWeekly = true;
      sa.matches += 1; sb.matches += 1;
      sa.points += m.finalPointsA;
      sb.points += m.finalPointsB;
      sa.pointsLost += m.finalPointsB;
      sb.pointsLost += m.finalPointsA;
      if (m.hasGameDataA) { sa.handicapPinfall += m.handicapTotalA; sa.hasHandicapData = true; }
      if (m.hasGameDataB) { sb.handicapPinfall += m.handicapTotalB; sb.hasHandicapData = true; }

      // PERSONAL scratch stats (games/pinfall/highs) + ADVANCED linescore
      // stats credit the ACTUAL bowler ONLY when they physically rolled.
      // Absent-without-scores and absent-with-scores never add personal
      // scratch to anyone (absent scores are handicap-only credit above).
      if (!m.absentA && m.scratchGamesA) {
        const target = m.isSubA ? ensure(m.actualA) : sa;
        target.games += 3;
        target.pinfall += m.scratchTotalA;
        const hg = Math.max(...m.scratchGamesA);
        target.highGame = target.highGame === null ? hg : Math.max(target.highGame, hg);
        target.highSet = target.highSet === null ? m.scratchTotalA : Math.max(target.highSet, m.scratchTotalA);
        if (m.isSubA) target.personalStatsOnly = target.hasWeekly ? target.personalStatsOnly : true;
        if (m.linescoreA) {
          for (const g of m.linescoreA) {
            target.advGames += 1;
            target.advStrikes += g.strikes;
            target.advSpares += g.spares;
            target.advOpens += g.opens;
            target.advMarks += g.marks;
          }
        }
      }
      if (!m.absentB && m.scratchGamesB) {
        const target = m.isSubB ? ensure(m.actualB) : sb;
        target.games += 3;
        target.pinfall += m.scratchTotalB;
        const hg = Math.max(...m.scratchGamesB);
        target.highGame = target.highGame === null ? hg : Math.max(target.highGame, hg);
        target.highSet = target.highSet === null ? m.scratchTotalB : Math.max(target.highSet, m.scratchTotalB);
        if (m.isSubB) target.personalStatsOnly = target.hasWeekly ? target.personalStatsOnly : true;
        if (m.linescoreB) {
          for (const g of m.linescoreB) {
            target.advGames += 1;
            target.advStrikes += g.strikes;
            target.advSpares += g.spares;
            target.advOpens += g.opens;
            target.advMarks += g.marks;
          }
        }
      }
    }
  }

  const partByRef = new Map(input.participants.map((p) => [p.ref, p] as const));
  const summaryByRef = new Map(input.summaryRecords.map((r) => [r.participantRef, r] as const));

  // Include summary-only participants (never appeared in weekly matches).
  for (const r of input.summaryRecords) {
    if (!acc.has(r.participantRef)) {
      acc.set(r.participantRef, {
        ref: r.participantRef,
        matches: 0, points: 0, pointsLost: 0,
        handicapPinfall: 0, hasHandicapData: false,
        games: 0, pinfall: 0, highGame: null, highSet: null, hasWeekly: false,
        advGames: 0, advStrikes: 0, advSpares: 0, advOpens: 0, advMarks: 0,
      });
    }
  }

  const rows: HistoricalStandingRow[] = [];
  for (const a of acc.values()) {
    const p = partByRef.get(a.ref);
    const s = summaryByRef.get(a.ref);
    // Rostered bowlers only appear in standings. Personal-stats-only rows
    // (a substitute who bowled for someone) are not on the standings board.
    if (p && p.role !== "rostered") continue;
    if (!p && s && s.role !== "rostered") continue;
    if (!p && !s) continue;
    const usingSummaryOnly = !a.hasWeekly && !!s;
    const games = usingSummaryOnly ? s?.games ?? null : (a.games > 0 ? a.games : null);
    const pinfall = usingSummaryOnly ? s?.scratchPinfall ?? null : (a.games > 0 ? a.pinfall : null);
    const avg = games !== null && pinfall !== null && games > 0 ? pinfall / games : (usingSummaryOnly ? s?.average ?? null : null);
    const highGame = usingSummaryOnly ? s?.highGame ?? null : a.highGame;
    const highSet = usingSummaryOnly ? s?.highSet ?? null : a.highSet;
    const points = usingSummaryOnly ? s?.points ?? null : (a.hasWeekly ? a.points : null);
    const pointsLost = usingSummaryOnly ? s?.pointsLost ?? null : (a.hasWeekly ? a.pointsLost : null);
    const handicapPinfall = usingSummaryOnly ? null : (a.hasHandicapData ? a.handicapPinfall : null);
    const advanced: HistoricalAdvancedTotals | null = a.advGames > 0 ? {
      games: a.advGames, strikes: a.advStrikes, spares: a.advSpares, opens: a.advOpens, marks: a.advMarks,
    } : null;
    rows.push({
      participantRef: a.ref,
      displayName: p?.displayName ?? s?.displayName ?? a.ref,
      personId: p?.personId ?? s?.personId ?? null,
      matchesPlayed: a.matches,
      points, pointsLost, handicapPinfall,
      games, scratchPinfall: pinfall, scratchAverage: avg,
      highGame, highSet, advanced,
      rank: 0,
      fromSummaryOnly: usingSummaryOnly,
    });
  }
  // League tiebreaker: points DESC, handicap pinfall DESC, scratch pinfall DESC.
  rows.sort((x, y) =>
    (y.points ?? -1) - (x.points ?? -1) ||
    (y.handicapPinfall ?? -1) - (x.handicapPinfall ?? -1) ||
    (y.scratchPinfall ?? -1) - (x.scratchPinfall ?? -1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** Public-facing snapshot filter: strip unpublished weeks and rebuild
 *  standings from the visible subset. Admin snapshot writer always stores
 *  the FULL snapshot; this function is what public readers must apply
 *  before rendering anything a spectator sees. */
export function filterPublicHistoricalSnapshot(snap: HistoricalSnapshot): HistoricalSnapshot {
  const publishedWeeks = snap.weeks.filter((w) => w.published);
  const standings = buildHistoricalStandings({
    participants: snap.participants,
    weeks: publishedWeeks,
    summaryRecords: snap.summaryRecords,
  });
  return {
    ...snap,
    weeks: publishedWeeks,
    standings,
    summaryOnly: publishedWeeks.every((w) => w.matches.length === 0) && snap.summaryRecords.length > 0,
  };
}

// ---------------- Career aggregation from historical snapshots -----------

export interface HistoricalCareerContribution {
  seasonId: string;
  seasonLabel: string;
  role: "rostered" | "substitute";
  displayName: string;
  bowlerNumber: string | null;
  startingAverage: number | null;
  handicap: number | null;
  games: number | null;
  scratchPinfall: number | null;
  average: number | null;
  highGame: number | null;
  highSet: number | null;
  points: number | null;
  finalFinish: number | null;
  isChampion: boolean;
  hasGameData: boolean;
  source: "historical_snapshot" | "historical_summary";
}

/** Deduplicate season+role contributions from possibly overlapping sources
 *  (snapshot vs summary record). Prefer snapshot-derived rows (they have
 *  real game data) over summary-only fallbacks. */
export function dedupeHistoricalContributions(
  rows: readonly HistoricalCareerContribution[],
): HistoricalCareerContribution[] {
  const byKey = new Map<string, HistoricalCareerContribution>();
  for (const r of rows) {
    const key = `${r.seasonId}::${r.role}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, r); continue; }
    const prevScore = (prev.source === "historical_snapshot" ? 2 : 0) + (prev.hasGameData ? 1 : 0);
    const nextScore = (r.source === "historical_snapshot" ? 2 : 0) + (r.hasGameData ? 1 : 0);
    if (nextScore > prevScore) byKey.set(key, r);
  }
  return Array.from(byKey.values());
}

// ---------------- Deterministic self-tests -------------------------------
(function selfTest() {
  // Dedupe: prefer historical_snapshot over historical_summary.
  const deduped = dedupeHistoricalContributions([
    { seasonId: "s1", seasonLabel: "S1", role: "rostered", displayName: "n",
      bowlerNumber: null, startingAverage: null, handicap: null,
      games: null, scratchPinfall: null, average: null, highGame: null, highSet: null,
      points: null, finalFinish: null, isChampion: false, hasGameData: false,
      source: "historical_summary" },
    { seasonId: "s1", seasonLabel: "S1", role: "rostered", displayName: "n",
      bowlerNumber: null, startingAverage: null, handicap: null,
      games: 30, scratchPinfall: 3300, average: 110, highGame: 180, highSet: 500,
      points: 42, finalFinish: 3, isChampion: false, hasGameData: true,
      source: "historical_snapshot" },
    { seasonId: "s2", seasonLabel: "S2", role: "substitute", displayName: "n",
      bowlerNumber: null, startingAverage: 105, handicap: 45,
      games: 6, scratchPinfall: 660, average: 110, highGame: 150, highSet: 350,
      points: null, finalFinish: null, isChampion: false, hasGameData: true,
      source: "historical_snapshot" },
  ]);
  if (deduped.length !== 2) throw new Error(`dedupe collapsed: ${deduped.length}`);
  const s1 = deduped.find((r) => r.seasonId === "s1")!;
  if (s1.source !== "historical_snapshot" || s1.games !== 30) {
    throw new Error("dedupe should have kept the snapshot row");
  }
})();
