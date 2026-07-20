/**
 * Experimental Offense & Matchup Defense rating system.
 *
 * PURE MODULE — no framework, no Supabase, no globals. Every input arrives
 * as an explicit normalized `RatingGame[]`. Every helper is deterministic
 * and independently testable.
 *
 * Ratings are 100-centered:
 *   100 = season average
 *   >100 = better
 *   <100 = worse
 * Displayed to one decimal. `null` means insufficient/unavailable — never
 * substitute a fabricated zero.
 *
 * IMPORTANT — this module DOES NOT touch, replace, or import any current
 * 2026 standings, points, snapshot-builder, or historical scoring code.
 * Existing pipelines remain the source of truth for standings/averages.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Optional frame-derived counters for a single actual game. Present only
 *  for canonical FULL_LINESCORE games. Populated by the extractor from a
 *  saved GameLinescore. */
export interface RatingFrameStats {
  /** Regulation frames rolled in this game — 10 for a completed game. */
  framesRolled: number;
  strikes: number;
  spares: number;
  opens: number;
  /** Marks (strike + spare) in regulation frames 9 and 10 only. */
  clutchMarks: number;
  /** Regulation frames 9 and 10 that were rolled (usually 2). */
  clutchOpportunities: number;
}

/** A single ACTUAL game a specific person rolled against a specific
 *  opponent. One row per game (three per bowler per match).
 *
 *  Absent-side synthetic/threshold scores MUST NOT appear here. Substitute
 *  attribution lives on the person fields — the substitute's personal
 *  performance is credited to the substitute, never to the rostered
 *  bowler they filled in for.
 */
export interface RatingGame {
  seasonId: string;
  weekNumber: number;
  lanePair: string;
  /** Permanent person id when known; otherwise a stable per-season
   *  participant ref. Ratings never mix rows across ids. */
  personRef: string;
  /** Opponent person id / participant ref for the game. `null` when the
   *  opponent side is absent — the row is retained for personal offense
   *  calculations that don't need the opponent, but defense computations
   *  will skip null opponents. */
  opponentRef: string | null;
  /** Raw scratch game score the person rolled. */
  scratchScore: number;
  /** Entry / starting average when known. Used only as a POA baseline
   *  fallback for opponent expected score when the opponent has < 3
   *  leave-one-opponent-out actual games. */
  entryAverage?: number | null;
  /** Frame stats — present only for FULL_LINESCORE games. */
  frame?: RatingFrameStats | null;
}

export interface RatingContext {
  seasonId: string;
  seasonLabel?: string;
}

export type QualityBadge = "Full" | "Score-based" | "Limited sample";

export interface RatingDetails {
  /** How many actual games the person rolled that fed offense. */
  actualGames: number;
  /** How many of those were FULL_LINESCORE. */
  fullLinescoreGames: number;
  /** How many opponent games were used for defense. */
  opponentGames: number;
  /** Environment-adjusted scoring average. */
  adjustedAverage: number | null;
  /** Adjusted pins vs league mean, per game. Positive is better. */
  adjustedPinsPerGameVsLeague: number | null;
  strikePct: number | null;
  spareConversionPct: number | null;
  openPct: number | null;
  clutchPct: number | null;
  /** Opponent-facing suppressions (positive = opponents performed worse
   *  than expected against this bowler). */
  opponentScoreSuppressionPerGame: number | null;
  opponentStrikeSuppressionPct: number | null;
  opponentSpareConversionSuppressionPct: number | null;
  /** Opens: opponent open rate MINUS their expected open rate — higher
   *  is better for defense. */
  opponentOpenIncreasePct: number | null;
  opponentClutchSuppressionPct: number | null;
}

export interface BowlerRatings {
  personRef: string;
  offensiveRating: number | null;
  matchupDefense: number | null;
  twoWayRating: number | null;
  quality: QualityBadge;
  details: RatingDetails;
}

// ---------------------------------------------------------------------------
// Math helpers (kept private but exported for tests)
// ---------------------------------------------------------------------------

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation. Returns 0 for n<2. */
export function popStdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}

/** Convert a z-score to a 100-centered rating capped to [50,150]. */
export function zToRating(z: number): number {
  const raw = 100 + 15 * z;
  if (!Number.isFinite(raw)) return 100;
  return Math.max(50, Math.min(150, raw));
}

/** Reliability shrinkage: shrink z toward 0 by factor n/(n+k). k=9. */
export function shrinkZ(z: number, n: number, k = 9): number {
  if (n <= 0) return 0;
  return z * (n / (n + k));
}

// ---------------------------------------------------------------------------
// Environment adjustment
// ---------------------------------------------------------------------------

export interface EnvironmentModel {
  seasonMean: number;
  /** Adjusted score for a specific row using the WK-LANE / WK / SEASON
   *  fallback. */
  adjust: (row: RatingGame) => number;
}

/** Build the season environment model from ALL eligible actual game
 *  rows in the season. */
export function buildEnvironment(rows: readonly RatingGame[]): EnvironmentModel {
  const seasonMean = mean(rows.map((r) => r.scratchScore));

  // group by week+lanePair and by week
  const wkLane = new Map<string, number[]>();
  const wk = new Map<number, number[]>();
  for (const r of rows) {
    const kL = `${r.weekNumber}|${r.lanePair}`;
    (wkLane.get(kL) ?? wkLane.set(kL, []).get(kL)!).push(r.scratchScore);
    (wk.get(r.weekNumber) ?? wk.set(r.weekNumber, []).get(r.weekNumber)!).push(r.scratchScore);
  }

  const wkLaneMean = new Map<string, number>();
  wkLane.forEach((arr, k) => { if (arr.length >= 6) wkLaneMean.set(k, mean(arr)); });
  const wkMean = new Map<number, number>();
  wk.forEach((arr, k) => { if (arr.length >= 6) wkMean.set(k, mean(arr)); });

  function envMeanFor(r: RatingGame): number {
    const kL = `${r.weekNumber}|${r.lanePair}`;
    if (wkLaneMean.has(kL)) return wkLaneMean.get(kL)!;
    if (wkMean.has(r.weekNumber)) return wkMean.get(r.weekNumber)!;
    return seasonMean;
  }

  return {
    seasonMean,
    adjust: (r) => r.scratchScore - (envMeanFor(r) - seasonMean),
  };
}

// ---------------------------------------------------------------------------
// Per-bowler component aggregates
// ---------------------------------------------------------------------------

interface PersonOffenseAgg {
  personRef: string;
  actualGames: number;
  fullLinescoreGames: number;
  framesRolled: number;
  strikes: number;
  spares: number;
  opens: number;
  clutchMarks: number;
  clutchOpportunities: number;
  adjustedScores: number[]; // env-adjusted scratch scores
}

function aggregateOffense(rows: readonly RatingGame[], env: EnvironmentModel): Map<string, PersonOffenseAgg> {
  const m = new Map<string, PersonOffenseAgg>();
  for (const r of rows) {
    let a = m.get(r.personRef);
    if (!a) {
      a = {
        personRef: r.personRef, actualGames: 0, fullLinescoreGames: 0,
        framesRolled: 0, strikes: 0, spares: 0, opens: 0,
        clutchMarks: 0, clutchOpportunities: 0, adjustedScores: [],
      };
      m.set(r.personRef, a);
    }
    a.actualGames += 1;
    a.adjustedScores.push(env.adjust(r));
    if (r.frame) {
      a.fullLinescoreGames += 1;
      a.framesRolled += r.frame.framesRolled;
      a.strikes += r.frame.strikes;
      a.spares += r.frame.spares;
      a.opens += r.frame.opens;
      a.clutchMarks += r.frame.clutchMarks;
      a.clutchOpportunities += r.frame.clutchOpportunities;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Component: standardize with omission of zero-variance/insufficient
// ---------------------------------------------------------------------------

/** Compute a z-score of `value` against the population `pool` (which
 *  should INCLUDE `value`). Returns null when the pool is too small or
 *  has zero variance. */
function zAgainst(value: number, pool: readonly number[]): number | null {
  const filtered = pool.filter((v) => Number.isFinite(v));
  if (filtered.length < 2) return null;
  const s = popStdev(filtered);
  if (s === 0) return null;
  return (value - mean(filtered)) / s;
}

interface WeightedZ {
  z: number;
  weight: number;
}
/** Combine per-component `WeightedZ` entries, dropping nulls and
 *  proportionally reweighting remaining components. Returns null if
 *  nothing is available. */
function combineWeighted(entries: Array<WeightedZ | null>): number | null {
  const kept = entries.filter((e): e is WeightedZ => e != null);
  if (kept.length === 0) return null;
  const totalW = kept.reduce((a, e) => a + e.weight, 0);
  if (totalW <= 0) return null;
  let z = 0;
  for (const e of kept) z += (e.weight / totalW) * e.z;
  return z;
}

// ---------------------------------------------------------------------------
// OFFENSIVE RATING
// ---------------------------------------------------------------------------

const OFFENSE_WEIGHTS = {
  score: 0.50,
  strike: 0.15,
  spareConv: 0.15,
  open: 0.10,
  clutch: 0.10,
};

interface OffenseResult {
  rating: number | null;
  hasFrames: boolean;
  details: {
    adjustedAverage: number | null;
    adjustedPinsPerGameVsLeague: number | null;
    strikePct: number | null;
    spareConversionPct: number | null;
    openPct: number | null;
    clutchPct: number | null;
  };
}

function computeOffense(
  agg: PersonOffenseAgg,
  aggs: Map<string, PersonOffenseAgg>,
  env: EnvironmentModel,
): OffenseResult {
  const details: OffenseResult["details"] = {
    adjustedAverage: null,
    adjustedPinsPerGameVsLeague: null,
    strikePct: null,
    spareConversionPct: null,
    openPct: null,
    clutchPct: null,
  };
  if (agg.actualGames < 3) {
    return { rating: null, hasFrames: false, details };
  }
  // score component (eligible: actualGames >= 3)
  const eligibleScore = [...aggs.values()].filter((a) => a.actualGames >= 3);
  const adjAvg = mean(agg.adjustedScores);
  details.adjustedAverage = adjAvg;
  details.adjustedPinsPerGameVsLeague = adjAvg - env.seasonMean;
  const scoreZ = zAgainst(adjAvg, eligibleScore.map((a) => mean(a.adjustedScores)));

  // frame components (eligible: fullLinescoreGames >= 3 AND framesRolled >= 30)
  const frameEligible = [...aggs.values()].filter((a) => a.fullLinescoreGames >= 3 && a.framesRolled >= 30);
  const hasFrames = agg.fullLinescoreGames >= 3 && agg.framesRolled >= 30;

  let strikeZ: WeightedZ | null = null;
  let spareZ: WeightedZ | null = null;
  let openZ: WeightedZ | null = null;
  let clutchZ: WeightedZ | null = null;

  if (hasFrames) {
    const strikePct = (agg.strikes / agg.framesRolled) * 100;
    const sparePlusOpen = agg.spares + agg.opens;
    const spareConvPct = sparePlusOpen > 0 ? (agg.spares / sparePlusOpen) * 100 : null;
    const openPct = (agg.opens / agg.framesRolled) * 100;
    const clutchPct = agg.clutchOpportunities > 0 ? (agg.clutchMarks / agg.clutchOpportunities) * 100 : null;
    details.strikePct = strikePct;
    details.spareConversionPct = spareConvPct;
    details.openPct = openPct;
    details.clutchPct = clutchPct;

    const pool = frameEligible;
    const zS = zAgainst(strikePct, pool.map((a) => (a.strikes / a.framesRolled) * 100));
    if (zS != null) strikeZ = { z: zS, weight: OFFENSE_WEIGHTS.strike };

    if (spareConvPct != null) {
      const spool = pool
        .map((a) => {
          const sp = a.spares + a.opens;
          return sp > 0 ? (a.spares / sp) * 100 : null;
        })
        .filter((v): v is number => v != null);
      const zSp = zAgainst(spareConvPct, spool);
      if (zSp != null) spareZ = { z: zSp, weight: OFFENSE_WEIGHTS.spareConv };
    }

    const zO = zAgainst(openPct, pool.map((a) => (a.opens / a.framesRolled) * 100));
    // lower open is better — flip sign
    if (zO != null) openZ = { z: -zO, weight: OFFENSE_WEIGHTS.open };

    if (clutchPct != null) {
      const cpool = pool
        .map((a) => (a.clutchOpportunities > 0 ? (a.clutchMarks / a.clutchOpportunities) * 100 : null))
        .filter((v): v is number => v != null);
      const zC = zAgainst(clutchPct, cpool);
      if (zC != null) clutchZ = { z: zC, weight: OFFENSE_WEIGHTS.clutch };
    }
  }

  const combined = combineWeighted([
    scoreZ != null ? { z: scoreZ, weight: OFFENSE_WEIGHTS.score } : null,
    strikeZ, spareZ, openZ, clutchZ,
  ]);
  if (combined == null) return { rating: null, hasFrames, details };
  const shrunk = shrinkZ(combined, agg.actualGames);
  return { rating: Number(zToRating(shrunk).toFixed(1)), hasFrames, details };
}

// ---------------------------------------------------------------------------
// MATCHUP DEFENSE
// ---------------------------------------------------------------------------

const DEFENSE_WEIGHTS = {
  score: 0.60,
  strike: 0.15,
  spareConv: 0.10,
  open: 0.10,
  clutch: 0.05,
};

interface OpponentBaseline {
  /** Leave-one-opponent-out mean adjusted score. */
  looAdjAverageExcluding: (opponentBeingEvaluated: string) => number | null;
  /** LOO frame baselines. */
  looStrikePctExcluding: (o: string) => number | null;
  looSpareConvPctExcluding: (o: string) => number | null;
  looOpenPctExcluding: (o: string) => number | null;
  looClutchPctExcluding: (o: string) => number | null;
  entryAverage: number | null;
}

function buildOpponentBaselines(
  rows: readonly RatingGame[],
  env: EnvironmentModel,
): Map<string, OpponentBaseline> {
  // group all rows by their personRef; expose helpers that exclude games
  // versus a specific opponent (the evaluated bowler).
  const byPerson = new Map<string, RatingGame[]>();
  for (const r of rows) {
    (byPerson.get(r.personRef) ?? byPerson.set(r.personRef, []).get(r.personRef)!).push(r);
  }
  const out = new Map<string, OpponentBaseline>();
  byPerson.forEach((games, person) => {
    let entryAvg: number | null = null;
    for (const g of games) { if (g.entryAverage != null) { entryAvg = g.entryAverage; break; } }
    out.set(person, {
      entryAverage: entryAvg,
      looAdjAverageExcluding: (opp) => {
        const filtered = games.filter((g) => g.opponentRef !== opp);
        if (filtered.length < 3) return null;
        return mean(filtered.map((g) => env.adjust(g)));
      },
      looStrikePctExcluding: (opp) => {
        const f = games.filter((g) => g.opponentRef !== opp && g.frame);
        const framesTotal = f.reduce((a, g) => a + g.frame!.framesRolled, 0);
        if (f.length < 3 || framesTotal < 30) return null;
        const strikes = f.reduce((a, g) => a + g.frame!.strikes, 0);
        return (strikes / framesTotal) * 100;
      },
      looSpareConvPctExcluding: (opp) => {
        const f = games.filter((g) => g.opponentRef !== opp && g.frame);
        const framesTotal = f.reduce((a, g) => a + g.frame!.framesRolled, 0);
        if (f.length < 3 || framesTotal < 30) return null;
        const spares = f.reduce((a, g) => a + g.frame!.spares, 0);
        const opens = f.reduce((a, g) => a + g.frame!.opens, 0);
        return spares + opens > 0 ? (spares / (spares + opens)) * 100 : null;
      },
      looOpenPctExcluding: (opp) => {
        const f = games.filter((g) => g.opponentRef !== opp && g.frame);
        const framesTotal = f.reduce((a, g) => a + g.frame!.framesRolled, 0);
        if (f.length < 3 || framesTotal < 30) return null;
        const opens = f.reduce((a, g) => a + g.frame!.opens, 0);
        return (opens / framesTotal) * 100;
      },
      looClutchPctExcluding: (opp) => {
        const f = games.filter((g) => g.opponentRef !== opp && g.frame);
        if (f.length < 3) return null;
        const opps = f.reduce((a, g) => a + g.frame!.clutchOpportunities, 0);
        if (opps === 0) return null;
        const marks = f.reduce((a, g) => a + g.frame!.clutchMarks, 0);
        return (marks / opps) * 100;
      },
    });
  });
  return out;
}

interface PersonDefenseAgg {
  personRef: string;
  opponentGames: number;
  fullOpponentGames: number;
  scoreSuppressionTotal: number;
  scoreSuppressionCount: number;
  // opponent frames faced (only from FULL_LINESCORE opponent games)
  oppFrames: number;
  oppStrikes: number;
  oppSpares: number;
  oppOpens: number;
  oppClutchMarks: number;
  oppClutchOpportunities: number;
  // expected sums (baselines aggregated) for frame components
  expStrikePctSum: number; expStrikePctN: number;
  expSpareConvPctSum: number; expSpareConvPctN: number;
  expOpenPctSum: number; expOpenPctN: number;
  expClutchPctSum: number; expClutchPctN: number;
}

function newDefenseAgg(ref: string): PersonDefenseAgg {
  return {
    personRef: ref, opponentGames: 0, fullOpponentGames: 0,
    scoreSuppressionTotal: 0, scoreSuppressionCount: 0,
    oppFrames: 0, oppStrikes: 0, oppSpares: 0, oppOpens: 0,
    oppClutchMarks: 0, oppClutchOpportunities: 0,
    expStrikePctSum: 0, expStrikePctN: 0,
    expSpareConvPctSum: 0, expSpareConvPctN: 0,
    expOpenPctSum: 0, expOpenPctN: 0,
    expClutchPctSum: 0, expClutchPctN: 0,
  };
}

function aggregateDefense(
  rows: readonly RatingGame[],
  env: EnvironmentModel,
  baselines: Map<string, OpponentBaseline>,
  leagueFrame: LeagueFrameBaseline,
): Map<string, PersonDefenseAgg> {
  const m = new Map<string, PersonDefenseAgg>();
  for (const r of rows) {
    if (r.opponentRef == null) continue;
    // This row represents an OPPONENT game seen by the OPPONENT's opponent
    // (which is the person indexed by opponentRef). We aggregate defense
    // stats against the person whose *opponent* rolled this row.
    // In other words: for defender D = r.opponentRef, opponent O = r.personRef.
    const defender = r.opponentRef;
    const opponent = r.personRef;
    let a = m.get(defender) ?? newDefenseAgg(defender);
    m.set(defender, a);
    a.opponentGames += 1;

    const base = baselines.get(opponent);
    let expectedAdj = base?.looAdjAverageExcluding(defender) ?? null;
    if (expectedAdj == null) {
      const ea = base?.entryAverage;
      expectedAdj = ea != null ? ea : env.seasonMean;
    }
    const actualAdj = env.adjust(r);
    a.scoreSuppressionTotal += expectedAdj - actualAdj;
    a.scoreSuppressionCount += 1;

    if (r.frame) {
      a.fullOpponentGames += 1;
      a.oppFrames += r.frame.framesRolled;
      a.oppStrikes += r.frame.strikes;
      a.oppSpares += r.frame.spares;
      a.oppOpens += r.frame.opens;
      a.oppClutchMarks += r.frame.clutchMarks;
      a.oppClutchOpportunities += r.frame.clutchOpportunities;

      const eStr = base?.looStrikePctExcluding(defender) ?? leagueFrame.strikePct;
      if (eStr != null) { a.expStrikePctSum += eStr; a.expStrikePctN += 1; }
      const eSC = base?.looSpareConvPctExcluding(defender) ?? leagueFrame.spareConvPct;
      if (eSC != null) { a.expSpareConvPctSum += eSC; a.expSpareConvPctN += 1; }
      const eOp = base?.looOpenPctExcluding(defender) ?? leagueFrame.openPct;
      if (eOp != null) { a.expOpenPctSum += eOp; a.expOpenPctN += 1; }
      const eCl = base?.looClutchPctExcluding(defender) ?? leagueFrame.clutchPct;
      if (eCl != null) { a.expClutchPctSum += eCl; a.expClutchPctN += 1; }
    }
  }
  return m;
}

interface LeagueFrameBaseline {
  strikePct: number | null;
  spareConvPct: number | null;
  openPct: number | null;
  clutchPct: number | null;
}

function computeLeagueFrameBaseline(rows: readonly RatingGame[]): LeagueFrameBaseline {
  let frames = 0, strikes = 0, spares = 0, opens = 0, cm = 0, co = 0;
  for (const r of rows) {
    if (!r.frame) continue;
    frames += r.frame.framesRolled;
    strikes += r.frame.strikes;
    spares += r.frame.spares;
    opens += r.frame.opens;
    cm += r.frame.clutchMarks;
    co += r.frame.clutchOpportunities;
  }
  if (frames === 0) return { strikePct: null, spareConvPct: null, openPct: null, clutchPct: null };
  return {
    strikePct: (strikes / frames) * 100,
    spareConvPct: spares + opens > 0 ? (spares / (spares + opens)) * 100 : null,
    openPct: (opens / frames) * 100,
    clutchPct: co > 0 ? (cm / co) * 100 : null,
  };
}

interface DefenseResult {
  rating: number | null;
  details: {
    opponentScoreSuppressionPerGame: number | null;
    opponentStrikeSuppressionPct: number | null;
    opponentSpareConversionSuppressionPct: number | null;
    opponentOpenIncreasePct: number | null;
    opponentClutchSuppressionPct: number | null;
  };
}

function computeDefense(
  agg: PersonDefenseAgg,
  all: Map<string, PersonDefenseAgg>,
): DefenseResult {
  const details: DefenseResult["details"] = {
    opponentScoreSuppressionPerGame: null,
    opponentStrikeSuppressionPct: null,
    opponentSpareConversionSuppressionPct: null,
    opponentOpenIncreasePct: null,
    opponentClutchSuppressionPct: null,
  };
  if (agg.opponentGames < 3) return { rating: null, details };

  const pool = [...all.values()].filter((a) => a.opponentGames >= 3);
  // score suppression per game
  const suppScore = agg.scoreSuppressionTotal / agg.scoreSuppressionCount;
  details.opponentScoreSuppressionPerGame = suppScore;
  const scoreZ = zAgainst(
    suppScore,
    pool.map((a) => a.scoreSuppressionTotal / a.scoreSuppressionCount),
  );

  const hasFrames = agg.fullOpponentGames >= 3 && agg.oppFrames >= 30;
  const framePool = [...all.values()].filter((a) => a.fullOpponentGames >= 3 && a.oppFrames >= 30);

  let strikeZ: WeightedZ | null = null;
  let spareZ: WeightedZ | null = null;
  let openZ: WeightedZ | null = null;
  let clutchZ: WeightedZ | null = null;

  if (hasFrames) {
    const actStrike = (agg.oppStrikes / agg.oppFrames) * 100;
    const expStrike = agg.expStrikePctN > 0 ? agg.expStrikePctSum / agg.expStrikePctN : null;
    const strikeSupp = expStrike != null ? expStrike - actStrike : null;
    details.opponentStrikeSuppressionPct = strikeSupp;
    if (strikeSupp != null) {
      const pool2 = framePool
        .map((a) => {
          const act = (a.oppStrikes / a.oppFrames) * 100;
          const exp = a.expStrikePctN > 0 ? a.expStrikePctSum / a.expStrikePctN : null;
          return exp != null ? exp - act : null;
        })
        .filter((v): v is number => v != null);
      const z = zAgainst(strikeSupp, pool2);
      if (z != null) strikeZ = { z, weight: DEFENSE_WEIGHTS.strike };
    }

    const actSC = agg.oppSpares + agg.oppOpens > 0 ? (agg.oppSpares / (agg.oppSpares + agg.oppOpens)) * 100 : null;
    const expSC = agg.expSpareConvPctN > 0 ? agg.expSpareConvPctSum / agg.expSpareConvPctN : null;
    const scSupp = actSC != null && expSC != null ? expSC - actSC : null;
    details.opponentSpareConversionSuppressionPct = scSupp;
    if (scSupp != null) {
      const pool2 = framePool
        .map((a) => {
          const act = a.oppSpares + a.oppOpens > 0 ? (a.oppSpares / (a.oppSpares + a.oppOpens)) * 100 : null;
          const exp = a.expSpareConvPctN > 0 ? a.expSpareConvPctSum / a.expSpareConvPctN : null;
          return act != null && exp != null ? exp - act : null;
        })
        .filter((v): v is number => v != null);
      const z = zAgainst(scSupp, pool2);
      if (z != null) spareZ = { z, weight: DEFENSE_WEIGHTS.spareConv };
    }

    const actOp = (agg.oppOpens / agg.oppFrames) * 100;
    const expOp = agg.expOpenPctN > 0 ? agg.expOpenPctSum / agg.expOpenPctN : null;
    const opInc = expOp != null ? actOp - expOp : null;
    details.opponentOpenIncreasePct = opInc;
    if (opInc != null) {
      const pool2 = framePool
        .map((a) => {
          const act = (a.oppOpens / a.oppFrames) * 100;
          const exp = a.expOpenPctN > 0 ? a.expOpenPctSum / a.expOpenPctN : null;
          return exp != null ? act - exp : null;
        })
        .filter((v): v is number => v != null);
      const z = zAgainst(opInc, pool2);
      if (z != null) openZ = { z, weight: DEFENSE_WEIGHTS.open };
    }

    const actCl = agg.oppClutchOpportunities > 0 ? (agg.oppClutchMarks / agg.oppClutchOpportunities) * 100 : null;
    const expCl = agg.expClutchPctN > 0 ? agg.expClutchPctSum / agg.expClutchPctN : null;
    const clSupp = actCl != null && expCl != null ? expCl - actCl : null;
    details.opponentClutchSuppressionPct = clSupp;
    if (clSupp != null) {
      const pool2 = framePool
        .map((a) => {
          const act = a.oppClutchOpportunities > 0 ? (a.oppClutchMarks / a.oppClutchOpportunities) * 100 : null;
          const exp = a.expClutchPctN > 0 ? a.expClutchPctSum / a.expClutchPctN : null;
          return act != null && exp != null ? exp - act : null;
        })
        .filter((v): v is number => v != null);
      const z = zAgainst(clSupp, pool2);
      if (z != null) clutchZ = { z, weight: DEFENSE_WEIGHTS.clutch };
    }
  }

  const combined = combineWeighted([
    scoreZ != null ? { z: scoreZ, weight: DEFENSE_WEIGHTS.score } : null,
    strikeZ, spareZ, openZ, clutchZ,
  ]);
  if (combined == null) return { rating: null, details };
  const shrunk = shrinkZ(combined, agg.opponentGames);
  return { rating: Number(zToRating(shrunk).toFixed(1)), details };
}

// ---------------------------------------------------------------------------
// Two-way + top-level API
// ---------------------------------------------------------------------------

export function twoWay(off: number | null, def: number | null): number | null {
  if (off == null || def == null) return null;
  return Number((0.70 * off + 0.30 * def).toFixed(1));
}

function qualityBadge(off: OffenseResult | null, actualGames: number): QualityBadge {
  if (off == null || off.rating == null) return "Limited sample";
  if (actualGames < 9) return "Limited sample";
  return off.hasFrames ? "Full" : "Score-based";
}

/** Compute ratings for every eligible person in `rows`. Zero-variance and
 *  insufficient-sample components are omitted; unavailable ratings are
 *  `null`. */
export function computeSeasonRatings(rows: readonly RatingGame[]): BowlerRatings[] {
  const env = buildEnvironment(rows);
  const offenseAggs = aggregateOffense(rows, env);
  const baselines = buildOpponentBaselines(rows, env);
  const leagueFrame = computeLeagueFrameBaseline(rows);
  const defenseAggs = aggregateDefense(rows, env, baselines, leagueFrame);

  const persons = new Set<string>([...offenseAggs.keys(), ...defenseAggs.keys()]);
  const results: BowlerRatings[] = [];
  for (const p of persons) {
    const oAgg = offenseAggs.get(p);
    const dAgg = defenseAggs.get(p);
    const oRes = oAgg ? computeOffense(oAgg, offenseAggs, env) : null;
    const dRes = dAgg ? computeDefense(dAgg, defenseAggs) : null;
    const off = oRes?.rating ?? null;
    const def = dRes?.rating ?? null;
    const quality = qualityBadge(oRes, oAgg?.actualGames ?? 0);
    results.push({
      personRef: p,
      offensiveRating: off,
      matchupDefense: def,
      twoWayRating: twoWay(off, def),
      quality,
      details: {
        actualGames: oAgg?.actualGames ?? 0,
        fullLinescoreGames: oAgg?.fullLinescoreGames ?? 0,
        opponentGames: dAgg?.opponentGames ?? 0,
        adjustedAverage: oRes?.details.adjustedAverage ?? null,
        adjustedPinsPerGameVsLeague: oRes?.details.adjustedPinsPerGameVsLeague ?? null,
        strikePct: oRes?.details.strikePct ?? null,
        spareConversionPct: oRes?.details.spareConversionPct ?? null,
        openPct: oRes?.details.openPct ?? null,
        clutchPct: oRes?.details.clutchPct ?? null,
        opponentScoreSuppressionPerGame: dRes?.details.opponentScoreSuppressionPerGame ?? null,
        opponentStrikeSuppressionPct: dRes?.details.opponentStrikeSuppressionPct ?? null,
        opponentSpareConversionSuppressionPct: dRes?.details.opponentSpareConversionSuppressionPct ?? null,
        opponentOpenIncreasePct: dRes?.details.opponentOpenIncreasePct ?? null,
        opponentClutchSuppressionPct: dRes?.details.opponentClutchSuppressionPct ?? null,
      },
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Career aggregation across public seasons
// ---------------------------------------------------------------------------

export interface CareerSeasonContribution {
  seasonId: string;
  seasonLabel?: string;
  offense: number | null;
  defense: number | null;
  actualGames: number;
  opponentGames: number;
  fullLinescoreGames: number;
}

export interface CareerRatings {
  personRef: string;
  offensiveRating: number | null;
  matchupDefense: number | null;
  twoWayRating: number | null;
  contributions: CareerSeasonContribution[];
  totals: {
    actualGames: number;
    opponentGames: number;
    fullLinescoreGames: number;
    seasonsOffense: number;
    seasonsDefense: number;
  };
}

/** Career = actual-game-weighted average of season offense ratings and
 *  opponent-game-weighted average of season defense ratings. Never pools
 *  raw game scores across seasons. */
export function computeCareerRatings(
  personRef: string,
  contributions: readonly CareerSeasonContribution[],
): CareerRatings {
  let offNum = 0, offDen = 0;
  let defNum = 0, defDen = 0;
  let actual = 0, opp = 0, full = 0;
  let sOff = 0, sDef = 0;
  for (const c of contributions) {
    actual += c.actualGames;
    opp += c.opponentGames;
    full += c.fullLinescoreGames;
    if (c.offense != null && c.actualGames > 0) {
      offNum += c.offense * c.actualGames; offDen += c.actualGames; sOff += 1;
    }
    if (c.defense != null && c.opponentGames > 0) {
      defNum += c.defense * c.opponentGames; defDen += c.opponentGames; sDef += 1;
    }
  }
  const off = offDen > 0 ? Number((offNum / offDen).toFixed(1)) : null;
  const def = defDen > 0 ? Number((defNum / defDen).toFixed(1)) : null;
  return {
    personRef,
    offensiveRating: off,
    matchupDefense: def,
    twoWayRating: twoWay(off, def),
    contributions: [...contributions],
    totals: { actualGames: actual, opponentGames: opp, fullLinescoreGames: full,
              seasonsOffense: sOff, seasonsDefense: sDef },
  };
}

/** Career-level quality label derived from aggregate contributions.
 *  - `Limited sample` when total actual games < 9 or no rating available.
 *  - `Full` when every contribution that produced an offense rating used
 *    eligible frame evidence (>=3 full-linescore games in that season)
 *    AND aggregate full-linescore games across the career reach 9+.
 *  - Otherwise `Score-based`. */
export function careerRatingQuality(c: CareerRatings): QualityBadge {
  if (c.offensiveRating == null || c.totals.actualGames < 9) return "Limited sample";
  const available = c.contributions.filter((x) => x.offense != null);
  if (available.length === 0) return "Limited sample";
  const allHaveFrames = available.every((x) => x.fullLinescoreGames >= 3);
  if (allHaveFrames && c.totals.fullLinescoreGames >= 9) return "Full";
  return "Score-based";
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatRating(r: number | null): string {
  if (r == null) return "—";
  return r.toFixed(1);
}

/** Return an ordered leaderboard using stable ties: rating desc, then
 *  larger eligible sample, then displayed name alphabetically. */
export function leaderboardOffense(
  entries: ReadonlyArray<BowlerRatings & { displayName: string }>,
): typeof entries {
  return [...entries]
    .filter((e) => e.details.actualGames >= 6 && e.offensiveRating != null)
    .sort((a, b) => {
      if (b.offensiveRating! !== a.offensiveRating!) return b.offensiveRating! - a.offensiveRating!;
      if (b.details.actualGames !== a.details.actualGames) return b.details.actualGames - a.details.actualGames;
      return a.displayName.localeCompare(b.displayName);
    });
}
export function leaderboardDefense(
  entries: ReadonlyArray<BowlerRatings & { displayName: string }>,
): typeof entries {
  return [...entries]
    .filter((e) => e.details.opponentGames >= 6 && e.matchupDefense != null)
    .sort((a, b) => {
      if (b.matchupDefense! !== a.matchupDefense!) return b.matchupDefense! - a.matchupDefense!;
      if (b.details.opponentGames !== a.details.opponentGames) return b.details.opponentGames - a.details.opponentGames;
      return a.displayName.localeCompare(b.displayName);
    });
}
export function leaderboardTwoWay(
  entries: ReadonlyArray<BowlerRatings & { displayName: string }>,
): typeof entries {
  return [...entries]
    .filter((e) => e.details.actualGames >= 6 && e.details.opponentGames >= 6 && e.twoWayRating != null)
    .sort((a, b) => {
      if (b.twoWayRating! !== a.twoWayRating!) return b.twoWayRating! - a.twoWayRating!;
      const sampleA = Math.min(a.details.actualGames, a.details.opponentGames);
      const sampleB = Math.min(b.details.actualGames, b.details.opponentGames);
      if (sampleB !== sampleA) return sampleB - sampleA;
      return a.displayName.localeCompare(b.displayName);
    });
}
