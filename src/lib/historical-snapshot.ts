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
import { stdev, type GameLinescore } from "./duckpin";

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
  framesRolled: number;
  strikes: number;
  spares: number;
  opens: number;
  marks: number;
  cleanFrames: number;
  cleanGames: number;
  openPinsLeft: number;
  markPct: number;
  strikePct: number;
  sparePct: number;
  openPct: number;
  spareConversionPct: number;
  pinsLostPerGame: number;
  consistency: number;
  first5Total: number;
  first5PerGame: number;
  last5Total: number;
  last5PerGame: number;
  bigOpeningTotal: number;
  bigOpeningPerGame: number;
  bigFinishTotal: number;
  bigFinishPerGame: number;
  clutchMarks: number;
  clutchOpportunities: number;
  clutchPct: number;
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

/** Per-participant personal bowling projection. INCLUDES substitutes so
 *  their personal games / advanced stats survive alongside the roster-only
 *  standings board. Never carries points / handicap-pinfall credit —
 *  those live only on HistoricalStandingRow for the SCHEDULED (rostered)
 *  bowler. */
export interface HistoricalParticipantStats {
  participantRef: string;
  personId: string | null;
  role: "rostered" | "substitute";
  displayName: string;
  bowlerNumber: string | null;
  matches: number;
  games: number | null;
  scratchPinfall: number | null;
  scratchAverage: number | null;
  highGame: number | null;
  highSet: number | null;
  seasonPOA: number | null;
  bestGamePOA: number | null;
  bestSetPOA: number | null;
  /** Advanced (frame-derived) stats — null when the participant has NO
   *  FULL_LINESCORE games. Never zero-as-stand-in. */
  advanced: HistoricalAdvancedTotals | null;
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
  /** Personal bowling stats for ALL actual participants (rostered +
   *  substitutes). Older snapshots may omit this; readers must tolerate
   *  `undefined`. */
  participantStats?: HistoricalParticipantStats[];
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

// -----------------------------------------------------------------------
// Shared accumulator: personal stats + advanced from full linescores.
// -----------------------------------------------------------------------

interface PersonalAcc {
  ref: string;
  role: "rostered" | "substitute";
  matches: number;
  games: number;
  pinfall: number;
  highGame: number | null;
  highSet: number | null;
  gameScores: number[];
  poaSum: number;
  poaGames: number;
  poaBestGame: number | null;
  poaBestSet: number | null;
  // advanced (full linescore) — attributed to ACTUAL bowler ONLY
  advGames: number;
  advFrames: number;
  advStrikes: number;
  advSpares: number;
  advOpens: number;
  advCleanFrames: number;
  advCleanGames: number;
  advOpenPinsLeft: number;
  advFirst5: number;
  advLast5: number;
  advBigOpening: number;
  advBigFinish: number;
  advClutchMarks: number;
  advClutchOpp: number;
}

function newPersonal(ref: string, role: "rostered" | "substitute"): PersonalAcc {
  return {
    ref, role,
    matches: 0, games: 0, pinfall: 0, highGame: null, highSet: null,
    gameScores: [], poaSum: 0, poaGames: 0, poaBestGame: null, poaBestSet: null,
    advGames: 0, advFrames: 0, advStrikes: 0, advSpares: 0, advOpens: 0,
    advCleanFrames: 0, advCleanGames: 0, advOpenPinsLeft: 0,
    advFirst5: 0, advLast5: 0, advBigOpening: 0, advBigFinish: 0,
    advClutchMarks: 0, advClutchOpp: 0,
  };
}

function addLinescoreToPersonal(acc: PersonalAcc, line: readonly GameLinescore[]) {
  for (const g of line) {
    acc.advGames += 1;
    acc.advFrames += 10;
    acc.advStrikes += g.strikes;
    acc.advSpares += g.spares;
    acc.advOpens += g.opens;
    acc.advOpenPinsLeft += g.openPinsLeft;
    acc.advFirst5 += g.segments.first5;
    acc.advLast5 += g.segments.last5;
    acc.advBigOpening += g.segments.bigOpening;
    acc.advBigFinish += g.segments.bigFinish;
    acc.advClutchMarks += g.segments.clutchMarks;
    acc.advClutchOpp += 2;
    // "clean" frame = strike or spare (mark). "clean game" = zero opens.
    if (g.opens === 0) acc.advCleanGames += 1;
  }
  // clean frames = strikes + spares total (marks).
  acc.advCleanFrames += line.reduce((s, g) => s + g.strikes + g.spares, 0);
}

function finalizeAdvanced(a: PersonalAcc): HistoricalAdvancedTotals | null {
  if (a.advGames === 0) return null;
  const marks = a.advStrikes + a.advSpares;
  const spareOpp = a.advSpares + a.advOpens;
  const gs = a.advGames;
  const frames = a.advFrames;
  return {
    games: gs, framesRolled: frames,
    strikes: a.advStrikes, spares: a.advSpares, opens: a.advOpens,
    marks, cleanFrames: a.advCleanFrames, cleanGames: a.advCleanGames,
    openPinsLeft: a.advOpenPinsLeft,
    markPct: frames > 0 ? (marks / frames) * 100 : 0,
    strikePct: frames > 0 ? (a.advStrikes / frames) * 100 : 0,
    sparePct: frames > 0 ? (a.advSpares / frames) * 100 : 0,
    openPct: frames > 0 ? (a.advOpens / frames) * 100 : 0,
    spareConversionPct: spareOpp > 0 ? (a.advSpares / spareOpp) * 100 : 0,
    pinsLostPerGame: gs > 0 ? a.advOpenPinsLeft / gs : 0,
    consistency: 0, // filled below from gameScores subset
    first5Total: a.advFirst5, first5PerGame: gs > 0 ? a.advFirst5 / gs : 0,
    last5Total: a.advLast5, last5PerGame: gs > 0 ? a.advLast5 / gs : 0,
    bigOpeningTotal: a.advBigOpening, bigOpeningPerGame: gs > 0 ? a.advBigOpening / gs : 0,
    bigFinishTotal: a.advBigFinish, bigFinishPerGame: gs > 0 ? a.advBigFinish / gs : 0,
    clutchMarks: a.advClutchMarks, clutchOpportunities: a.advClutchOpp,
    clutchPct: a.advClutchOpp > 0 ? (a.advClutchMarks / a.advClutchOpp) * 100 : 0,
  };
}

function creditPersonalScratch(
  acc: PersonalAcc, scratchGames: [number, number, number],
  scratchTotal: number, entryAverage: number,
) {
  acc.matches += 1;
  for (const s of scratchGames) {
    acc.games += 1;
    acc.pinfall += s;
    acc.gameScores.push(s);
    if (acc.highGame === null || s > acc.highGame) acc.highGame = s;
    const poa = s - entryAverage;
    acc.poaSum += poa;
    acc.poaGames += 1;
    if (acc.poaBestGame === null || poa > acc.poaBestGame) acc.poaBestGame = poa;
  }
  if (acc.highSet === null || scratchTotal > acc.highSet) acc.highSet = scratchTotal;
  const setPOA = scratchTotal - 3 * entryAverage;
  if (acc.poaBestSet === null || setPOA > acc.poaBestSet) acc.poaBestSet = setPOA;
}

/** Personal stats projection for every participant that PHYSICALLY rolled
 *  (rostered on their own card OR substitute for someone else). Rostered
 *  bowlers with no personal scratch are still included (they may exist in
 *  the participant list). Absent scores never contribute here. */
export function buildHistoricalParticipantStats(input: {
  participants: HistoricalParticipantMeta[];
  weeks: HistoricalWeekSummary[];
}): HistoricalParticipantStats[] {
  const acc = new Map<string, PersonalAcc>();
  const partByRef = new Map(input.participants.map((p) => [p.ref, p] as const));
  function ensure(ref: string, role: "rostered" | "substitute"): PersonalAcc {
    let a = acc.get(ref);
    if (!a) { a = newPersonal(ref, role); acc.set(ref, a); }
    return a;
  }

  for (const w of input.weeks) {
    for (const m of w.matches) {
      if (!m.absentA && m.scratchGamesA) {
        const p = partByRef.get(m.actualA);
        const role = p?.role ?? (m.isSubA ? "substitute" : "rostered");
        const target = ensure(m.actualA, role);
        creditPersonalScratch(target, m.scratchGamesA, m.scratchTotalA, m.entryAverageA);
        if (m.linescoreA) addLinescoreToPersonal(target, m.linescoreA);
      }
      if (!m.absentB && m.scratchGamesB) {
        const p = partByRef.get(m.actualB);
        const role = p?.role ?? (m.isSubB ? "substitute" : "rostered");
        const target = ensure(m.actualB, role);
        creditPersonalScratch(target, m.scratchGamesB, m.scratchTotalB, m.entryAverageB);
        if (m.linescoreB) addLinescoreToPersonal(target, m.linescoreB);
      }
    }
  }

  // Ensure listed participants appear even if they never bowled.
  for (const p of input.participants) {
    if (!acc.has(p.ref)) acc.set(p.ref, newPersonal(p.ref, p.role));
  }

  const rows: HistoricalParticipantStats[] = [];
  for (const a of acc.values()) {
    const p = partByRef.get(a.ref);
    const adv = finalizeAdvanced(a);
    if (adv && a.gameScores.length >= 2) adv.consistency = stdev(a.gameScores);
    rows.push({
      participantRef: a.ref,
      personId: p?.personId ?? null,
      role: p?.role ?? a.role,
      displayName: p?.displayName ?? a.ref,
      bowlerNumber: p?.bowlerNumber ?? null,
      matches: a.matches,
      games: a.games > 0 ? a.games : null,
      scratchPinfall: a.games > 0 ? a.pinfall : null,
      scratchAverage: a.games > 0 ? a.pinfall / a.games : null,
      highGame: a.highGame,
      highSet: a.highSet,
      seasonPOA: a.poaGames > 0 ? a.poaSum / a.poaGames : null,
      bestGamePOA: a.poaBestGame,
      bestSetPOA: a.poaBestSet,
      advanced: adv,
    });
  }
  return rows;
}

/** Snap a value to the nearest 0.5 to absorb tiny floating-point noise. */
function halfRound(x: number): number { return Math.round(x * 2) / 2; }

/** Build standings by aggregating computed weekly matches. Roster-only.
 *  Personal scratch stats attribute to the ACTUAL bowler (self on scheduled
 *  side); substitutes contribute their scratch to their own personal
 *  projection via buildHistoricalParticipantStats — NOT here. Points and
 *  handicap-pinfall always credit the SCHEDULED (rostered) bowler.
 *  Falls back to summary-only records for participants who have no weekly
 *  data. */
export function buildHistoricalStandings(input: {
  participants: HistoricalParticipantMeta[];
  weeks: HistoricalWeekSummary[];
  summaryRecords: HistoricalSnapshot["summaryRecords"];
  pointSystem: HistoricalPointSystem;
}): HistoricalStandingRow[] {
  type Acc = {
    ref: string;
    matches: number;
    points: number;
    pointsLost: number;
    handicapPinfall: number;
    hasHandicapData: boolean;
    // personal scratch (self on own scheduled card only; sub goes to the
    // sub's personal projection, not standings)
    personalGames: number;
    personalPinfall: number;
    personalHighGame: number | null;
    personalHighSet: number | null;
    // advanced (full linescore, self on own card only)
    adv: PersonalAcc | null;
    gameScores: number[];
    hasWeekly: boolean;
  };
  const acc = new Map<string, Acc>();
  function ensure(ref: string): Acc {
    let a = acc.get(ref);
    if (!a) {
      a = {
        ref, matches: 0, points: 0, pointsLost: 0,
        handicapPinfall: 0, hasHandicapData: false,
        personalGames: 0, personalPinfall: 0,
        personalHighGame: null, personalHighSet: null,
        adv: null, gameScores: [], hasWeekly: false,
      };
      acc.set(ref, a);
    }
    return a;
  }

  for (const w of input.weeks) {
    for (const m of w.matches) {
      // POINTS + HANDICAP-PINFALL credit scheduled bowler.
      const sa = ensure(m.scheduledA);
      const sb = ensure(m.scheduledB);
      sa.hasWeekly = true; sb.hasWeekly = true;
      sa.matches += 1; sb.matches += 1;
      sa.points += m.finalPointsA;
      sb.points += m.finalPointsB;
      // Each side's losses = pointSystem - own points won. Never derive
      // from opponent's points (independent overrides may not sum to
      // pointSystem). Snap to nearest 0.5 to absorb float noise.
      sa.pointsLost += halfRound(input.pointSystem - m.finalPointsA);
      sb.pointsLost += halfRound(input.pointSystem - m.finalPointsB);
      if (m.hasGameDataA) { sa.handicapPinfall += m.handicapTotalA; sa.hasHandicapData = true; }
      if (m.hasGameDataB) { sb.handicapPinfall += m.handicapTotalB; sb.hasHandicapData = true; }

      // Personal scratch on standings ONLY when scheduled bowler is also
      // the actual bowler (self on own card). Substitute performance and
      // absent scores never become standings-side personal stats.
      if (!m.absentA && !m.isSubA && m.scratchGamesA) {
        sa.personalGames += 3;
        sa.personalPinfall += m.scratchTotalA;
        const hg = Math.max(...m.scratchGamesA);
        sa.personalHighGame = sa.personalHighGame === null ? hg : Math.max(sa.personalHighGame, hg);
        sa.personalHighSet = sa.personalHighSet === null ? m.scratchTotalA : Math.max(sa.personalHighSet, m.scratchTotalA);
        sa.gameScores.push(...m.scratchGamesA);
        if (m.linescoreA) {
          if (!sa.adv) sa.adv = newPersonal(sa.ref, "rostered");
          addLinescoreToPersonal(sa.adv, m.linescoreA);
        }
      }
      if (!m.absentB && !m.isSubB && m.scratchGamesB) {
        sb.personalGames += 3;
        sb.personalPinfall += m.scratchTotalB;
        const hg = Math.max(...m.scratchGamesB);
        sb.personalHighGame = sb.personalHighGame === null ? hg : Math.max(sb.personalHighGame, hg);
        sb.personalHighSet = sb.personalHighSet === null ? m.scratchTotalB : Math.max(sb.personalHighSet, m.scratchTotalB);
        sb.gameScores.push(...m.scratchGamesB);
        if (m.linescoreB) {
          if (!sb.adv) sb.adv = newPersonal(sb.ref, "rostered");
          addLinescoreToPersonal(sb.adv, m.linescoreB);
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
        personalGames: 0, personalPinfall: 0,
        personalHighGame: null, personalHighSet: null,
        adv: null, gameScores: [], hasWeekly: false,
      });
    }
  }

  const rows: HistoricalStandingRow[] = [];
  for (const a of acc.values()) {
    const p = partByRef.get(a.ref);
    const s = summaryByRef.get(a.ref);
    // Roster-only board.
    if (p && p.role !== "rostered") continue;
    if (!p && s && s.role !== "rostered") continue;
    if (!p && !s) continue;
    const usingSummaryOnly = !a.hasWeekly && !!s;
    const games = usingSummaryOnly ? s?.games ?? null : (a.personalGames > 0 ? a.personalGames : null);
    const pinfall = usingSummaryOnly ? s?.scratchPinfall ?? null : (a.personalGames > 0 ? a.personalPinfall : null);
    const avg = games !== null && pinfall !== null && games > 0 ? pinfall / games : (usingSummaryOnly ? s?.average ?? null : null);
    const highGame = usingSummaryOnly ? s?.highGame ?? null : a.personalHighGame;
    const highSet = usingSummaryOnly ? s?.highSet ?? null : a.personalHighSet;
    const points = usingSummaryOnly ? s?.points ?? null : (a.hasWeekly ? a.points : null);
    const pointsLost = usingSummaryOnly ? s?.pointsLost ?? null : (a.hasWeekly ? a.pointsLost : null);
    const handicapPinfall = usingSummaryOnly ? null : (a.hasHandicapData ? a.handicapPinfall : null);
    let advanced: HistoricalAdvancedTotals | null = null;
    if (a.adv) {
      advanced = finalizeAdvanced(a.adv);
      if (advanced && a.gameScores.length >= 2) advanced.consistency = stdev(a.gameScores);
    }
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
 *  standings + participantStats from the visible subset. Admin snapshot
 *  writer always stores the FULL snapshot; this function is what public
 *  readers must apply before rendering anything a spectator sees. */
export function filterPublicHistoricalSnapshot(snap: HistoricalSnapshot): HistoricalSnapshot {
  const publishedWeeks = snap.weeks.filter((w) => w.published);
  const standings = buildHistoricalStandings({
    participants: snap.participants,
    weeks: publishedWeeks,
    summaryRecords: snap.summaryRecords,
    pointSystem: snap.pointSystem,
  });
  const participantStats = buildHistoricalParticipantStats({
    participants: snap.participants,
    weeks: publishedWeeks,
  });
  return {
    ...snap,
    weeks: publishedWeeks,
    standings,
    participantStats,
    summaryOnly: publishedWeeks.every((w) => w.matches.length === 0) && snap.summaryRecords.length > 0,
  };
}

// ---------------- Season completion + champion derivation ----------------

export interface HistoricalChampion {
  participantRef: string;
  personId: string | null;
  displayName: string;
}

/** True only when totalWeeks is a positive integer AND every week number
 *  1..totalWeeks exists in `snap.weeks` and is BOTH published AND
 *  completed. Any missing / unpublished / incomplete week => false. */
export function isHistoricalSeasonComplete(
  snap: Pick<HistoricalSnapshot, "totalWeeks" | "weeks">,
): boolean {
  const tw = snap.totalWeeks;
  if (tw == null || !Number.isInteger(tw) || tw <= 0) return false;
  const byNum = new Map<number, HistoricalWeekSummary>();
  for (const w of snap.weeks) byNum.set(w.weekNumber, w);
  for (let n = 1; n <= tw; n++) {
    const w = byNum.get(n);
    if (!w || !w.published || !w.completed) return false;
  }
  return true;
}

/** Derived champion for a historical snapshot. Returns `null` unless the
 *  season is fully complete. When complete:
 *   1) prefer a single explicit summaryRecords[].isChampion,
 *   2) otherwise the standings row ranked #1. */
export function deriveHistoricalChampion(snap: HistoricalSnapshot): HistoricalChampion | null {
  if (!isHistoricalSeasonComplete(snap)) return null;
  const explicit = (snap.summaryRecords ?? []).filter((r) => r.isChampion === true);
  if (explicit.length === 1) {
    const e = explicit[0];
    return {
      participantRef: e.participantRef,
      personId: e.personId ?? null,
      displayName: e.displayName || e.participantRef,
    };
  }
  const top = (snap.standings ?? []).find((r) => r.rank === 1);
  if (!top) return null;
  const meta = snap.participants.find((p) => p.ref === top.participantRef);
  return {
    participantRef: top.participantRef,
    personId: top.personId ?? meta?.personId ?? null,
    displayName: top.displayName || meta?.displayName || top.participantRef,
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
 *  (snapshot vs summary record). A row with real game data ALWAYS beats a
 *  row without — otherwise a summary-only substitute (no weekly rows, so
 *  the snapshot projection is empty) would lose its real career stats to
 *  the empty snapshot contribution. When both rows carry data, prefer
 *  `historical_snapshot` (frame-derived). When neither carries data, also
 *  prefer `historical_snapshot` for determinism. */
export function dedupeHistoricalContributions(
  rows: readonly HistoricalCareerContribution[],
): HistoricalCareerContribution[] {
  const byKey = new Map<string, HistoricalCareerContribution>();
  const score = (r: HistoricalCareerContribution) =>
    (r.hasGameData ? 2 : 0) + (r.source === "historical_snapshot" ? 1 : 0);
  for (const r of rows) {
    const key = `${r.seasonId}::${r.role}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, r); continue; }
    if (score(r) > score(prev)) byKey.set(key, r);
  }
  return Array.from(byKey.values());
}

// ---------------- Deterministic self-tests -------------------------------
(function selfTest() {
  const mk = (over: Partial<HistoricalCareerContribution>): HistoricalCareerContribution => ({
    seasonId: "s", seasonLabel: "S", role: "rostered", displayName: "n",
    bowlerNumber: null, startingAverage: null, handicap: null,
    games: null, scratchPinfall: null, average: null, highGame: null, highSet: null,
    points: null, finalFinish: null, isChampion: false,
    hasGameData: false, source: "historical_summary", ...over,
  });

  // (b) snapshot with data beats overlapping summary with data.
  const d1 = dedupeHistoricalContributions([
    mk({ seasonId: "s1", games: 30, scratchPinfall: 3300, hasGameData: true, source: "historical_summary" }),
    mk({ seasonId: "s1", games: 30, scratchPinfall: 3300, points: 42, hasGameData: true, source: "historical_snapshot" }),
  ]);
  if (d1.length !== 1 || d1[0].source !== "historical_snapshot" || d1[0].points !== 42) {
    throw new Error("dedupe: snapshot+data should beat summary+data");
  }

  // (a) summary-only substitute: summary WITH data must beat empty snapshot projection.
  const d2 = dedupeHistoricalContributions([
    mk({ seasonId: "s2", role: "substitute", hasGameData: false, source: "historical_snapshot" }),
    mk({ seasonId: "s2", role: "substitute", games: 6, scratchPinfall: 660, average: 110,
         highGame: 150, highSet: 350, hasGameData: true, source: "historical_summary" }),
  ]);
  if (d2.length !== 1 || d2[0].source !== "historical_summary" || d2[0].games !== 6) {
    throw new Error("dedupe: summary-with-data must beat empty snapshot projection");
  }

  // (c) no duplicate season+role rows survive, distinct seasons/roles retained.
  const d3 = dedupeHistoricalContributions([
    mk({ seasonId: "s3", role: "rostered", hasGameData: false, source: "historical_summary" }),
    mk({ seasonId: "s3", role: "rostered", hasGameData: false, source: "historical_snapshot" }),
    mk({ seasonId: "s3", role: "substitute", games: 3, hasGameData: true, source: "historical_summary" }),
    mk({ seasonId: "s4", role: "rostered", games: 30, hasGameData: true, source: "historical_snapshot" }),
  ]);
  if (d3.length !== 3) throw new Error(`dedupe: expected 3 unique season+role rows, got ${d3.length}`);
  const keys = new Set(d3.map((r) => `${r.seasonId}::${r.role}`));
  if (keys.size !== 3) throw new Error("dedupe: duplicate season+role survived");
  const s3ros = d3.find((r) => r.seasonId === "s3" && r.role === "rostered")!;
  if (s3ros.source !== "historical_snapshot") {
    throw new Error("dedupe: neither-has-data should prefer historical_snapshot");
  }
})();
