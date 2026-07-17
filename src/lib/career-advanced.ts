/**
 * Career advanced-stat aggregation for /people/$personId.
 *
 * Pure — no DB. Combines per-season "advanced" contributions across every
 * season this person appeared in (rostered + substitute) into a single
 * career totals object.
 *
 * Contributions are extracted from saved snapshots (current-season
 * public_snapshot or historical_season_snapshots) by the pure extractors
 * below. Each contribution carries only aggregate counters plus optional
 * score-moments (n, Σx, Σx²) so we can combine consistency (population
 * stdev) EXACTLY across seasons without averaging per-season stdevs.
 *
 * Rules:
 *  - Personal totals cross both roles (rostered + substitute).
 *  - Points / points-lost / handicap-pinfall are roster-credit ONLY.
 *  - Frame-derived counters come only from full-linescore games; when a
 *    season has none they stay null and we never fabricate zero.
 *  - Rates and per-game stats compute from aggregated totals — never as
 *    averages of per-season percentages.
 *  - Career POA is game-weighted: totalPOA / totalGamesWithEntryAvg.
 *  - Consistency is available only when EVERY season with advanced games
 *    also supplied score moments; otherwise the aggregate returns null.
 */

import { parseSnapshotBackwardCompat, type SeasonRole } from "./season-history";

export interface CareerAdvancedContribution {
  seasonId: string;
  role: SeasonRole;
  // Roster credit — populated only for rostered rows.
  points?: number | null;
  pointsLost?: number | null;
  handicapPinfall?: number | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  // Frame-derived aggregates (from FULL_LINESCORE games only).
  advGames?: number | null;
  framesRolled?: number | null;
  strikes?: number | null;
  spares?: number | null;
  opens?: number | null;
  openPinsLeft?: number | null;
  first5Total?: number | null;
  last5Total?: number | null;
  bigOpeningTotal?: number | null;
  bigFinishTotal?: number | null;
  clutchMarks?: number | null;
  clutchOpportunities?: number | null;
  // Career POA — game-weighted totals.
  poaGames?: number | null;
  poaSum?: number | null;
  // Score moments over scratch game totals (any full-linescore game the
  // person personally rolled that season). Enables exact cross-season stdev.
  scoreMomentsN?: number | null;
  scoreMomentsSum?: number | null;
  scoreMomentsSumSq?: number | null;
}

export interface CareerAdvancedTotals {
  // Frame-derived
  advGames: number | null;
  framesRolled: number | null;
  strikes: number | null;
  spares: number | null;
  opens: number | null;
  marks: number | null;
  openPinsLeft: number | null;
  markPct: number | null;
  strikePct: number | null;
  spareConversionPct: number | null;
  openPct: number | null;
  pinsLostPerGame: number | null;
  first5PerGame: number | null;
  last5PerGame: number | null;
  bigOpeningPerGame: number | null;
  bigFinishPerGame: number | null;
  clutchMarks: number | null;
  clutchOpportunities: number | null;
  clutchPct: number | null;
  consistency: number | null;
  consistencyAvailable: boolean;
  careerPOA: number | null;
  // Roster credit
  pointsCredited: number | null;
  pointsLost: number | null;
  handicapPinfall: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function addNullable(cur: number | null, v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return cur;
  return (cur ?? 0) + v;
}

export function aggregateCareerAdvanced(
  contribs: readonly CareerAdvancedContribution[],
): CareerAdvancedTotals {
  let advGames: number | null = null;
  let framesRolled: number | null = null;
  let strikes: number | null = null;
  let spares: number | null = null;
  let opens: number | null = null;
  let openPinsLeft: number | null = null;
  let first5: number | null = null;
  let last5: number | null = null;
  let bigO: number | null = null;
  let bigF: number | null = null;
  let clutchMarks: number | null = null;
  let clutchOpp: number | null = null;
  let poaGames: number | null = null;
  let poaSum: number | null = null;

  let pointsC: number | null = null;
  let pointsL: number | null = null;
  let hcpPin: number | null = null;
  let w: number | null = null;
  let l: number | null = null;
  let t: number | null = null;

  let mn = 0;
  let msum = 0;
  let msumSq = 0;
  let momentsCoverAll = true;
  let anyAdvGames = false;

  for (const c of contribs) {
    advGames = addNullable(advGames, c.advGames);
    framesRolled = addNullable(framesRolled, c.framesRolled);
    strikes = addNullable(strikes, c.strikes);
    spares = addNullable(spares, c.spares);
    opens = addNullable(opens, c.opens);
    openPinsLeft = addNullable(openPinsLeft, c.openPinsLeft);
    first5 = addNullable(first5, c.first5Total);
    last5 = addNullable(last5, c.last5Total);
    bigO = addNullable(bigO, c.bigOpeningTotal);
    bigF = addNullable(bigF, c.bigFinishTotal);
    clutchMarks = addNullable(clutchMarks, c.clutchMarks);
    clutchOpp = addNullable(clutchOpp, c.clutchOpportunities);
    poaGames = addNullable(poaGames, c.poaGames);
    poaSum = addNullable(poaSum, c.poaSum);

    if (c.role === "rostered") {
      pointsC = addNullable(pointsC, c.points);
      pointsL = addNullable(pointsL, c.pointsLost);
      hcpPin = addNullable(hcpPin, c.handicapPinfall);
      w = addNullable(w, c.wins);
      l = addNullable(l, c.losses);
      t = addNullable(t, c.ties);
    }

    // Consistency: every season that reports advGames > 0 must also carry
    // moments; otherwise cross-season stdev is not exact and we render "—".
    if (typeof c.advGames === "number" && c.advGames > 0) {
      anyAdvGames = true;
      const n = numOrNull(c.scoreMomentsN);
      const s = numOrNull(c.scoreMomentsSum);
      const s2 = numOrNull(c.scoreMomentsSumSq);
      if (n != null && s != null && s2 != null && n > 0) {
        mn += n;
        msum += s;
        msumSq += s2;
      } else {
        momentsCoverAll = false;
      }
    }
  }

  const marks = strikes != null && spares != null ? strikes + spares : null;
  const spareOpp = spares != null && opens != null ? spares + opens : null;

  let consistency: number | null = null;
  const consistencyAvailable = anyAdvGames && momentsCoverAll && mn > 0;
  if (consistencyAvailable) {
    const mean = msum / mn;
    const variance = Math.max(0, msumSq / mn - mean * mean);
    consistency = Math.sqrt(variance);
  }

  return {
    advGames,
    framesRolled,
    strikes,
    spares,
    opens,
    marks,
    openPinsLeft,
    markPct: framesRolled != null && framesRolled > 0 && marks != null ? (marks / framesRolled) * 100 : null,
    strikePct: framesRolled != null && framesRolled > 0 && strikes != null ? (strikes / framesRolled) * 100 : null,
    spareConversionPct: spareOpp != null && spareOpp > 0 && spares != null ? (spares / spareOpp) * 100 : null,
    openPct: framesRolled != null && framesRolled > 0 && opens != null ? (opens / framesRolled) * 100 : null,
    pinsLostPerGame: advGames != null && advGames > 0 && openPinsLeft != null ? openPinsLeft / advGames : null,
    first5PerGame: advGames != null && advGames > 0 && first5 != null ? first5 / advGames : null,
    last5PerGame: advGames != null && advGames > 0 && last5 != null ? last5 / advGames : null,
    bigOpeningPerGame: advGames != null && advGames > 0 && bigO != null ? bigO / advGames : null,
    bigFinishPerGame: advGames != null && advGames > 0 && bigF != null ? bigF / advGames : null,
    clutchMarks,
    clutchOpportunities: clutchOpp,
    clutchPct: clutchOpp != null && clutchOpp > 0 && clutchMarks != null ? (clutchMarks / clutchOpp) * 100 : null,
    consistency,
    consistencyAvailable,
    careerPOA: poaGames != null && poaGames > 0 && poaSum != null ? poaSum / poaGames : null,
    pointsCredited: pointsC,
    pointsLost: pointsL,
    handicapPinfall: hcpPin,
    wins: w,
    losses: l,
    ties: t,
  };
}

// ---------------------------------------------------------------------------
// Contribution extractors — pure, safe on malformed / legacy snapshots.
// ---------------------------------------------------------------------------

interface LinescoreGameLike {
  scratchTotal?: unknown;
  strikes?: unknown;
  spares?: unknown;
  opens?: unknown;
  openPinsLeft?: unknown;
  segments?: {
    first5?: unknown;
    last5?: unknown;
    bigOpening?: unknown;
    bigFinish?: unknown;
    clutchMarks?: unknown;
    clutchOpportunities?: unknown;
  };
}

function pushLinescoreGames(
  games: readonly LinescoreGameLike[] | undefined,
  acc: {
    advGames: number; frames: number; strikes: number; spares: number; opens: number;
    openPinsLeft: number; first5: number; last5: number; bigO: number; bigF: number;
    clutchMarks: number; clutchOpp: number;
    n: number; sum: number; sumSq: number;
    poaGames: number; poaSum: number;
  },
  entryAvg: number | null,
): void {
  if (!Array.isArray(games)) return;
  for (const g of games) {
    if (!g || typeof g !== "object") continue;
    const score = numOrNull((g as LinescoreGameLike).scratchTotal);
    if (score == null) continue;
    acc.advGames += 1;
    acc.frames += 10;
    acc.strikes += numOrNull(g.strikes) ?? 0;
    acc.spares += numOrNull(g.spares) ?? 0;
    acc.opens += numOrNull(g.opens) ?? 0;
    acc.openPinsLeft += numOrNull(g.openPinsLeft) ?? 0;
    const seg = g.segments ?? {};
    acc.first5 += numOrNull(seg.first5) ?? 0;
    acc.last5 += numOrNull(seg.last5) ?? 0;
    acc.bigO += numOrNull(seg.bigOpening) ?? 0;
    acc.bigF += numOrNull(seg.bigFinish) ?? 0;
    acc.clutchMarks += numOrNull(seg.clutchMarks) ?? 0;
    acc.clutchOpp += numOrNull(seg.clutchOpportunities) ?? 2;
    acc.n += 1;
    acc.sum += score;
    acc.sumSq += score * score;
    if (entryAvg != null) {
      acc.poaGames += 1;
      acc.poaSum += score - entryAvg;
    }
  }
}

function newAdvancedAcc() {
  return {
    advGames: 0, frames: 0, strikes: 0, spares: 0, opens: 0,
    openPinsLeft: 0, first5: 0, last5: 0, bigO: 0, bigF: 0,
    clutchMarks: 0, clutchOpp: 0,
    n: 0, sum: 0, sumSq: 0,
    poaGames: 0, poaSum: 0,
  };
}

function accToContribution(
  base: { seasonId: string; role: SeasonRole },
  acc: ReturnType<typeof newAdvancedAcc>,
  credit?: {
    points?: number | null; pointsLost?: number | null; handicapPinfall?: number | null;
    wins?: number | null; losses?: number | null; ties?: number | null;
  },
): CareerAdvancedContribution {
  const out: CareerAdvancedContribution = { ...base };
  if (acc.advGames > 0) {
    out.advGames = acc.advGames;
    out.framesRolled = acc.frames;
    out.strikes = acc.strikes;
    out.spares = acc.spares;
    out.opens = acc.opens;
    out.openPinsLeft = acc.openPinsLeft;
    out.first5Total = acc.first5;
    out.last5Total = acc.last5;
    out.bigOpeningTotal = acc.bigO;
    out.bigFinishTotal = acc.bigF;
    out.clutchMarks = acc.clutchMarks;
    out.clutchOpportunities = acc.clutchOpp;
  }
  if (acc.n > 0) {
    out.scoreMomentsN = acc.n;
    out.scoreMomentsSum = acc.sum;
    out.scoreMomentsSumSq = acc.sumSq;
  }
  if (acc.poaGames > 0) {
    out.poaGames = acc.poaGames;
    out.poaSum = acc.poaSum;
  }
  if (credit) {
    if (credit.points != null) out.points = credit.points;
    if (credit.pointsLost != null) out.pointsLost = credit.pointsLost;
    if (credit.handicapPinfall != null) out.handicapPinfall = credit.handicapPinfall;
    if (credit.wins != null) out.wins = credit.wins;
    if (credit.losses != null) out.losses = credit.losses;
    if (credit.ties != null) out.ties = credit.ties;
  }
  return out;
}

/** Extract an advanced contribution for a rostered bowler from a current-
 *  season public_snapshot payload. Reads snap.history[rosterId] for
 *  linescores (skipping absent / score-only / substitute rows), snap.
 *  bowlersById[rosterId] for roster credit fields, and derives W-L-T
 *  from per-week `result`. Safe on missing/legacy snapshots. */
export function extractCurrentRosterAdvancedContribution(
  snapshot: unknown,
  rosterId: string,
  seasonId: string,
): CareerAdvancedContribution {
  const base = { seasonId, role: "rostered" as const };
  const snap = parseSnapshotBackwardCompat(snapshot);
  if (!snap) return { ...base };

  let entryAvg: number | null = null;
  let credit: {
    points: number | null; pointsLost: number | null; handicapPinfall: number | null;
    wins: number | null; losses: number | null; ties: number | null;
  } | undefined;
  const byId = snap["bowlersById"];
  if (byId && typeof byId === "object") {
    const b = (byId as Record<string, unknown>)[rosterId];
    if (b && typeof b === "object") {
      const bb = b as Record<string, unknown>;
      entryAvg = numOrNull(bb["entryAverage"]);
      credit = {
        points: numOrNull(bb["points"]),
        pointsLost: numOrNull(bb["pointsLost"]),
        handicapPinfall: numOrNull(bb["handicapPinfall"]),
        wins: null, losses: null, ties: null,
      };
    }
  }

  const acc = newAdvancedAcc();
  const history = snap["history"];
  if (history && typeof history === "object") {
    const rows = (history as Record<string, unknown>)[rosterId];
    if (Array.isArray(rows)) {
      let w = 0, l = 0, t = 0, sawResult = false;
      for (const rowU of rows) {
        if (!rowU || typeof rowU !== "object") continue;
        const row = rowU as Record<string, unknown>;
        if (row.absent) continue;
        const isSub = row.isSub === true;
        if (!isSub) {
          const res = row["result"];
          if (res === "W") { w += 1; sawResult = true; }
          else if (res === "L") { l += 1; sawResult = true; }
          else if (res === "T") { t += 1; sawResult = true; }
        }
        if (row.scoreOnly) continue;
        if (isSub) continue;
        const ls = row["linescore"];
        if (ls && typeof ls === "object") {
          const games = (ls as { games?: unknown }).games as LinescoreGameLike[] | undefined;
          pushLinescoreGames(games, acc, entryAvg);
        }
      }
      if (credit && sawResult) { credit.wins = w; credit.losses = l; credit.ties = t; }
    }
  }
  return accToContribution(base, acc, credit);
}

/** Extract an advanced contribution for a substitute from a current-season
 *  snapshot's `substituteProfiles` map. Reads `weeks[].linescore` for full-
 *  linescore-derived counters and moments. No roster credit. */
export function extractCurrentSubstituteAdvancedContribution(
  snapshot: unknown,
  subId: string,
  seasonId: string,
): CareerAdvancedContribution {
  const base = { seasonId, role: "substitute" as const };
  const snap = parseSnapshotBackwardCompat(snapshot);
  if (!snap) return { ...base };
  const profiles = snap["substituteProfiles"];
  if (!profiles || typeof profiles !== "object") return { ...base };
  const p = (profiles as Record<string, unknown>)[subId];
  if (!p || typeof p !== "object") return { ...base };
  const pr = p as Record<string, unknown>;
  const weeks = pr["weeks"];
  const acc = newAdvancedAcc();
  if (Array.isArray(weeks)) {
    for (const wRaw of weeks) {
      if (!wRaw || typeof wRaw !== "object") continue;
      const wk = wRaw as Record<string, unknown>;
      const entryAvg = numOrNull(wk["startingAverageAtMatch"]);
      const ls = wk["linescore"];
      if (ls && typeof ls === "object") {
        const games = (ls as { games?: unknown }).games as LinescoreGameLike[] | undefined;
        pushLinescoreGames(games, acc, entryAvg);
      }
    }
  }
  return accToContribution(base, acc);
}

// -----------------------------------------------------------------
// Historical snapshot extractor
// -----------------------------------------------------------------

interface HistoricalMatchLike {
  actualA: string;
  actualB: string;
  absentA?: boolean;
  absentB?: boolean;
  winner?: "A" | "B" | "T";
  entryAverageA?: number;
  entryAverageB?: number;
  linescoreA?: LinescoreGameLike[] | null;
  linescoreB?: LinescoreGameLike[] | null;
}

interface HistoricalWeekLike {
  matches?: HistoricalMatchLike[];
}

interface HistoricalStandingLike {
  participantRef: string;
  points?: number | null;
  pointsLost?: number | null;
  handicapPinfall?: number | null;
}

/** Extract an advanced contribution for a historical snapshot participant.
 *  Roster credit (points, pointsLost, handicapPinfall) comes from standings
 *  when role='rostered'; substitutes carry personal stats only.
 *  W-L-T is derived from weekly matches for the participant ref. */
export function extractHistoricalAdvancedContribution(input: {
  seasonId: string;
  role: SeasonRole;
  participantRef: string;
  weeks: readonly HistoricalWeekLike[] | undefined;
  standings?: readonly HistoricalStandingLike[] | undefined;
}): CareerAdvancedContribution {
  const base = { seasonId: input.seasonId, role: input.role };
  const acc = newAdvancedAcc();
  let w = 0, l = 0, t = 0, sawResult = false;
  const ref = input.participantRef;
  for (const wk of input.weeks ?? []) {
    for (const m of wk.matches ?? []) {
      const isA = m.actualA === ref;
      const isB = m.actualB === ref;
      if (!isA && !isB) continue;
      const side = isA ? "A" : "B";
      const absent = side === "A" ? m.absentA === true : m.absentB === true;
      if (absent) continue;
      if (input.role === "rostered") {
        const winner = m.winner;
        if (winner === "T") { t += 1; sawResult = true; }
        else if (winner === side) { w += 1; sawResult = true; }
        else if (winner === "A" || winner === "B") { l += 1; sawResult = true; }
      }
      const games = side === "A" ? m.linescoreA : m.linescoreB;
      const entryAvg = numOrNull(side === "A" ? m.entryAverageA : m.entryAverageB);
      if (games) pushLinescoreGames(games, acc, entryAvg);
    }
  }
  let credit: Parameters<typeof accToContribution>[2];
  if (input.role === "rostered") {
    const st = (input.standings ?? []).find((s) => s.participantRef === ref);
    credit = {
      points: numOrNull(st?.points),
      pointsLost: numOrNull(st?.pointsLost),
      handicapPinfall: numOrNull(st?.handicapPinfall),
      wins: sawResult ? w : null,
      losses: sawResult ? l : null,
      ties: sawResult ? t : null,
    };
  }
  return accToContribution(base, acc, credit);
}

/** Merge/dedupe career contributions across primary (current-season) and
 *  historical sources. Key = seasonId::role. Winner = the entry with more
 *  concrete data: prefer any entry with advGames>0, else any entry with
 *  score moments, else the primary source, else the historical source. */
export function mergeCareerAdvancedContributions(
  primary: readonly CareerAdvancedContribution[],
  historical: readonly CareerAdvancedContribution[],
): CareerAdvancedContribution[] {
  const score = (c: CareerAdvancedContribution, kind: "primary" | "historical") => {
    let s = 0;
    if (typeof c.advGames === "number" && c.advGames > 0) s += 4;
    if (typeof c.scoreMomentsN === "number" && c.scoreMomentsN > 0) s += 2;
    if (kind === "primary") s += 1;
    return s;
  };
  const map = new Map<string, { c: CareerAdvancedContribution; s: number }>();
  const key = (c: CareerAdvancedContribution) => `${c.seasonId}::${c.role}`;
  for (const c of primary) map.set(key(c), { c, s: score(c, "primary") });
  for (const c of historical) {
    const k = key(c);
    const s = score(c, "historical");
    const prev = map.get(k);
    if (!prev || s > prev.s) map.set(k, { c, s });
  }
  return Array.from(map.values()).map((v) => v.c);
}
