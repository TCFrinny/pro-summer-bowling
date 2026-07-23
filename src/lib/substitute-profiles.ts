/**
 * Pure aggregation of substitute performances from saved MatchResults.
 *
 * DOES NOT touch the DB schema. Reads `participation.actualId` /
 * `linescore.actualId` frozen in every completed MatchResult and rolls
 * them up per-substitute using the SAME frozen linescore/entry-average/
 * handicap values already stored, so editing the pool later cannot
 * rewrite historical calculations.
 *
 * Public substitute list rules:
 *   - include current active + non-archived pool subs (zero stats OK)
 *   - include any sub with at least one historical performance
 *   - EXCLUDE archived subs with zero performances
 *
 * League points / handicap pinfall / W-L record stay attached to the
 * SCHEDULED bowler in standings — never surface here as sub's own totals.
 */

import type {
  BowlerId,
  BowlerMatchLinescore,
  LanePair,
  Match,
  WeekSummary,
} from "@/lib/mock-data";
import { LANE_PAIRS } from "@/lib/mock-data";
import { stdev } from "@/lib/duckpin";

export interface SubstituteIdentity {
  id: string;
  name: string;
  startingAverage: number | null;
  handicap: number | null;
  bowlerNumber: string | null;
  active: boolean;
  archived: boolean;
  /** Optional permanent-person link. Present after the multi-season
   *  history migration is applied. Older snapshots without this field
   *  MUST still parse — treat as undefined when missing. */
  personId?: string;
}

export interface SubstituteWeekRow {
  week: number;
  matchId: string;
  lanePair: LanePair;
  /** Bowler the sub filled in for (frozen scheduled name at save time). */
  scheduledForName: string;
  scheduledForId: BowlerId;
  /** Opposing scheduled bowler (frozen). */
  opponentName: string;
  opponentId: BowlerId;
  /** Frozen scoring inputs used for THIS match. */
  startingAverageAtMatch: number;
  handicapAtMatch: number;
  scores: [number, number, number];
  scratchTotal: number;
  handicapTotal: number;
  linescore: BowlerMatchLinescore | null;
  /** True for score-only (final-week live scoring) rows. */
  scoreOnly?: boolean;
  /** Number of paired games completed (score-only rows only). */
  completedGameCount?: 0 | 1 | 2 | 3;
  /** Per-game paired completion mask (score-only rows only). */
  pairCompleted?: [boolean, boolean, boolean];
  weekStrikes: number;
  weekSpares: number;
  weekOpens: number;
  weekMarks: number;
  weekMarkPct: number;
  weekStrikePct: number;
  weekSpareConversionPct: number;
  weekOpenPct: number;
  weekPinsLost: number;
  weekFirst5: number;
  weekLast5: number;
  weekBigOpening: number;
  weekBigFinish: number;
  weekClutchMarks: number;
  weekClutchOpportunities: number;
  weekClutchPct: number;
  /** Per-match POA using the sub's frozen starting average for this match.
   *  For score-only partials this uses only completed pairs. */
  poaSet: number;
  poaBestGame: number;
}


export interface SubstituteProfile {
  id: string;
  name: string;
  /** Current pool identity — reference only. Historical calculations use
   *  the FROZEN per-match starting average/handicap in each week row. */
  currentStartingAverage: number | null;
  currentHandicap: number | null;
  bowlerNumber: string | null;
  active: boolean;
  archived: boolean;
  matchesSubbed: number;
  gamesRolled: number;
  scratchPinfall: number;
  scratchAverage: number;
  highGame: number;
  highSet: number;
  strikes: number;
  spares: number;
  opens: number;
  marks: number;
  framesRolled: number;
  markPct: number;
  strikePct: number;
  sparePct: number;
  openPct: number;
  spareConversionPct: number;
  pinsLost: number;
  consistency: number;
  /** Average (game scratch − frozen starting avg for that game) per game. */
  seasonPOA: number;
  first5PerGame: number;
  last5PerGame: number;
  bigOpeningPerGame: number;
  bigFinishPerGame: number;
  clutchMarks: number;
  clutchOpportunities: number;
  clutchPct: number;
  lanePairUsage: { lanePair: LanePair; count: number }[];
  weeks: SubstituteWeekRow[];
}

interface SubAcc {
  identity: SubstituteIdentity | null;
  fallbackName: string;
  matches: number;
  games: number;
  scratchPinfall: number;
  highGame: number;
  highSet: number;
  strikes: number;
  spares: number;
  opens: number;
  openPinsLeft: number;
  framesRolled: number;
  gameScores: number[];
  first5: number;
  last5: number;
  bigOpening: number;
  bigFinish: number;
  clutchMarks: number;
  clutchOpportunities: number;
  poaSum: number;
  laneUsage: Map<LanePair, number>;
  weekRows: SubstituteWeekRow[];
}

function newAcc(): SubAcc {
  return {
    identity: null,
    fallbackName: "",
    matches: 0, games: 0, scratchPinfall: 0, highGame: 0, highSet: 0,
    strikes: 0, spares: 0, opens: 0, openPinsLeft: 0, framesRolled: 0,
    gameScores: [],
    first5: 0, last5: 0, bigOpening: 0, bigFinish: 0,
    clutchMarks: 0, clutchOpportunities: 0, poaSum: 0,
    laneUsage: new Map(),
    weekRows: [],
  };
}

export interface BuildSubstituteDataInput {
  substitutes: readonly SubstituteIdentity[];
  weeks: readonly WeekSummary[];
  matchesByWeek: Record<number, Match[]>;
}
export interface BuildSubstituteDataOutput {
  substitutes: SubstituteIdentity[];
  substituteProfiles: Record<string, SubstituteProfile>;
}

export function buildSubstituteData(
  input: BuildSubstituteDataInput,
): BuildSubstituteDataOutput {
  const poolById = new Map<string, SubstituteIdentity>();
  for (const s of input.substitutes) poolById.set(s.id, s);

  const accById = new Map<string, SubAcc>();
  const ensure = (id: string, fallbackName: string): SubAcc => {
    let a = accById.get(id);
    if (!a) {
      a = newAcc();
      a.identity = poolById.get(id) ?? null;
      a.fallbackName = fallbackName;
      accById.set(id, a);
    }
    return a;
  };

  for (const w of input.weeks) {
    const list = input.matchesByWeek[w.week] ?? [];
    for (const m of list) {
      const r = m.result;
      if (!r) continue;
      for (const isA of [true, false] as const) {
        const part = isA ? r.participationA : r.participationB;
        if (part.status !== "substitute") continue;
        const ls = isA ? r.linescoreA : r.linescoreB;
        const scoreOnly = r.scoreOnly === true;
        if (!ls && !scoreOnly) continue;

        const subId = ls?.actualId ?? part.actualId;
        if (!subId) continue; // anonymous inline sub — cannot link to profile

        const fallbackName = ls?.actualName || part.actualName || "Substitute";
        const acc = ensure(subId, fallbackName);

        const scratchTotal = isA ? r.scratchTotalA : r.scratchTotalB;
        const hdcpTotal = isA ? r.handicapTotalA : r.handicapTotalB;
        const scores = isA ? r.gamesA : r.gamesB;
        // Frozen starting avg / handicap. Full-linescore rows keep them on
        // the linescore; score-only rows use the frozen MatchResult fields.
        const startingAvg = ls?.entryAverage ?? (isA ? r.entryAverageA : r.entryAverageB);
        const hdcp = ls?.handicap ?? (isA ? r.handicapA : r.handicapB);
        const scheduledForName = isA ? r.scheduledNameA : r.scheduledNameB;
        const scheduledForId = isA ? r.scheduledA : r.scheduledB;
        const opponentName = isA ? r.scheduledNameB : r.scheduledNameA;
        const opponentId = isA ? r.scheduledB : r.scheduledA;

        if (ls) {
          acc.matches += 1;
          acc.laneUsage.set(m.lanePair, (acc.laneUsage.get(m.lanePair) ?? 0) + 1);
          for (const g of ls.games) {
            acc.games += 1;
            acc.scratchPinfall += g.scratchTotal;
            if (g.scratchTotal > acc.highGame) acc.highGame = g.scratchTotal;
            acc.gameScores.push(g.scratchTotal);
            acc.strikes += g.strikes;
            acc.spares += g.spares;
            acc.opens += g.opens;
            acc.openPinsLeft += g.openPinsLeft;
            acc.framesRolled += 10;
            acc.first5 += g.segments.first5;
            acc.last5 += g.segments.last5;
            acc.bigOpening += g.segments.bigOpening;
            acc.bigFinish += g.segments.bigFinish;
            acc.clutchMarks += g.segments.clutchMarks;
            acc.clutchOpportunities += 2;
            acc.poaSum += g.scratchTotal - startingAvg;
          }
          if (scratchTotal > acc.highSet) acc.highSet = scratchTotal;

          const frames = ls.framesRolled;
          const marks = ls.marks;
          const spareOpp = ls.spares + ls.opens;
          const clutchOpp = ls.segments.clutchOpportunities;
          const poaSet = scratchTotal - 3 * startingAvg;
          const poaBest = Math.max(...ls.games.map((g) => g.scratchTotal - startingAvg));

          acc.weekRows.push({
            week: w.week, matchId: m.id, lanePair: m.lanePair,
            scheduledForName, scheduledForId,
            opponentName, opponentId,
            startingAverageAtMatch: startingAvg,
            handicapAtMatch: hdcp,
            scores, scratchTotal, handicapTotal: hdcpTotal,
            linescore: ls,
            weekStrikes: ls.strikes, weekSpares: ls.spares, weekOpens: ls.opens, weekMarks: marks,
            weekMarkPct: frames > 0 ? (marks / frames) * 100 : 0,
            weekStrikePct: frames > 0 ? (ls.strikes / frames) * 100 : 0,
            weekSpareConversionPct: spareOpp > 0 ? (ls.spares / spareOpp) * 100 : 0,
            weekOpenPct: frames > 0 ? (ls.opens / frames) * 100 : 0,
            weekPinsLost: ls.opens > 0 ? ls.openPinsLeft / ls.opens : 0,
            weekFirst5: ls.segments.first5, weekLast5: ls.segments.last5,
            weekBigOpening: ls.segments.bigOpening, weekBigFinish: ls.segments.bigFinish,
            weekClutchMarks: ls.segments.clutchMarks,
            weekClutchOpportunities: clutchOpp,
            weekClutchPct: clutchOpp > 0 ? (ls.segments.clutchMarks / clutchOpp) * 100 : 0,
            poaSet, poaBestGame: poaBest,
          });
        } else {
          // Score-only substitute aggregation. Frame-derived totals stay zero;
          // completed paired games contribute to games/pinfall/avg/highGame/
          // POA/lane usage. HighSet requires all 3 pairs complete.
          const mask = r.pairCompleted ?? [true, true, true];
          const completedN = (r.completedGameCount ?? 0) as 0 | 1 | 2 | 3;
          let anyCompleted = false;
          const completedGameScores: number[] = [];
          for (let i = 0; i < 3; i++) {
            if (!mask[i]) continue;
            anyCompleted = true;
            const s = scores[i];
            acc.games += 1;
            acc.scratchPinfall += s;
            if (s > acc.highGame) acc.highGame = s;
            acc.gameScores.push(s);
            acc.poaSum += s - startingAvg;
            completedGameScores.push(s);
          }
          if (!anyCompleted) continue;
          acc.matches += 1;
          acc.laneUsage.set(m.lanePair, (acc.laneUsage.get(m.lanePair) ?? 0) + 1);
          if (completedN === 3 && scratchTotal > acc.highSet) acc.highSet = scratchTotal;

          const poaSet = scratchTotal - completedN * startingAvg;
          const poaBest = completedGameScores.length > 0
            ? Math.max(...completedGameScores.map((s) => s - startingAvg))
            : 0;

          acc.weekRows.push({
            week: w.week, matchId: m.id, lanePair: m.lanePair,
            scheduledForName, scheduledForId,
            opponentName, opponentId,
            startingAverageAtMatch: startingAvg,
            handicapAtMatch: hdcp,
            scores, scratchTotal, handicapTotal: hdcpTotal,
            linescore: null,
            scoreOnly: true,
            completedGameCount: completedN,
            pairCompleted: mask,
            weekStrikes: 0, weekSpares: 0, weekOpens: 0, weekMarks: 0,
            weekMarkPct: 0, weekStrikePct: 0, weekSpareConversionPct: 0,
            weekOpenPct: 0, weekPinsLost: 0,
            weekFirst5: 0, weekLast5: 0, weekBigOpening: 0, weekBigFinish: 0,
            weekClutchMarks: 0, weekClutchOpportunities: 0, weekClutchPct: 0,
            poaSet, poaBestGame: poaBest,
          });
        }
      }
    }
  }


  // Ensure every pool sub has an entry (zero stats OK) so an active
  // unused sub appears in the public list.
  for (const s of input.substitutes) {
    if (!accById.has(s.id)) {
      const a = newAcc();
      a.identity = s;
      a.fallbackName = s.name;
      accById.set(s.id, a);
    }
  }

  const substitutes: SubstituteIdentity[] = [];
  const substituteProfiles: Record<string, SubstituteProfile> = {};

  for (const [id, a] of accById) {
    const identity = a.identity;
    const hasPerformances = a.matches > 0;
    // Public visibility: active non-archived pool sub OR any sub with
    // historical performances. Archived sub with zero perf is omitted.
    if (identity) {
      if (identity.archived && !hasPerformances) continue;
      if (!identity.archived && !identity.active && !hasPerformances) continue;
    }
    // If no pool identity but has performances → historical-only entry.
    const displayName = identity?.name ?? a.fallbackName ?? "Substitute";
    const marks = a.strikes + a.spares;
    const spareOpp = a.spares + a.opens;
    substitutes.push(
      identity ?? {
        id, name: displayName,
        startingAverage: null, handicap: null,
        bowlerNumber: null, active: false, archived: false,
      },
    );
    substituteProfiles[id] = {
      id, name: displayName,
      currentStartingAverage: identity?.startingAverage ?? null,
      currentHandicap: identity?.handicap ?? null,
      bowlerNumber: identity?.bowlerNumber ?? null,
      active: identity?.active ?? false,
      archived: identity?.archived ?? false,
      matchesSubbed: a.matches,
      gamesRolled: a.games,
      scratchPinfall: a.scratchPinfall,
      scratchAverage: a.games > 0 ? Number((a.scratchPinfall / a.games).toFixed(3)) : 0,
      highGame: a.highGame,
      highSet: a.highSet,
      strikes: a.strikes, spares: a.spares, opens: a.opens, marks,
      framesRolled: a.framesRolled,
      markPct: a.framesRolled > 0 ? (marks / a.framesRolled) * 100 : 0,
      strikePct: a.framesRolled > 0 ? (a.strikes / a.framesRolled) * 100 : 0,
      sparePct: a.framesRolled > 0 ? (a.spares / a.framesRolled) * 100 : 0,
      openPct: a.framesRolled > 0 ? (a.opens / a.framesRolled) * 100 : 0,
      spareConversionPct: spareOpp > 0 ? (a.spares / spareOpp) * 100 : 0,
      pinsLost: a.games > 0 ? a.openPinsLeft / a.games : 0,
      consistency: a.games >= 2 ? stdev(a.gameScores) : 0,
      seasonPOA: a.games > 0 ? Number((a.poaSum / a.games).toFixed(3)) : 0,
      first5PerGame: a.games > 0 ? a.first5 / a.games : 0,
      last5PerGame: a.games > 0 ? a.last5 / a.games : 0,
      bigOpeningPerGame: a.games > 0 ? a.bigOpening / a.games : 0,
      bigFinishPerGame: a.games > 0 ? a.bigFinish / a.games : 0,
      clutchMarks: a.clutchMarks,
      clutchOpportunities: a.clutchOpportunities,
      clutchPct: a.clutchOpportunities > 0 ? (a.clutchMarks / a.clutchOpportunities) * 100 : 0,
      lanePairUsage: LANE_PAIRS.map((lp) => ({ lanePair: lp, count: a.laneUsage.get(lp) ?? 0 })),
      weeks: a.weekRows.slice().sort((x, y) => x.week - y.week),
    };
  }

  substitutes.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) ||
    a.id.localeCompare(b.id),
  );
  return { substitutes, substituteProfiles };
}
