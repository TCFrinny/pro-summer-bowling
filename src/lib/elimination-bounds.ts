/**
 * Bounds-only elimination — cheap, proof-safe, no search / no max-flow.
 *
 * Runs inside the server-side snapshot rebuild (Cloudflare Worker). O(N²)
 * over active bowlers; safe under the 10 ms CPU budget. The heavy
 * schedule-aware solver runs in the admin browser Web Worker.
 *
 * Final-week live scoring: a live matchup with only some of its 3 games
 * saved contributes fewer than 14 unawarded half-point units. This module
 * consumes per-match remaining capacity via `MatchResult.scoreOnly` +
 * `completedGameCount` so bounds stay proof-safe when Week 11 partially
 * fills in game by game.
 */

import type {
  Bowler,
  BowlerId,
  EliminationRow,
  EliminationSnapshot,
  Match,
  MatchResult,
  WeekSummary,
} from "./mock-data";

export interface EliminationBoundsInput {
  activeBowlers: Bowler[];
  weeks: WeekSummary[];
  matchesByWeek: Record<number, Match[]>;
  totalWeeks: number;
  now?: () => Date;
}

function fmt(units: number): string {
  const pts = units / 2;
  return Number.isInteger(pts) ? pts.toString() : pts.toFixed(1);
}

const PENDING_NOTE = "Full schedule calculation pending admin recalculation.";

/** Unawarded half-point units for one match.
 *  - No result: 14 (full 7-point matchup).
 *  - Full linescore result / non-score-only result: 0 (fully resolved).
 *  - Score-only w/ n completed pairs: 14 - 2n × 2 = (14, 10, 6, 0).
 *    Points remaining {7,5,3,0} × 2 = units {14,10,6,0}. */
export function unawardedUnitsForMatch(r: MatchResult | undefined): number {
  if (!r) return 14;
  if (r.scoreOnly !== true) return 0;
  const n = r.completedGameCount ?? 0;
  if (n >= 3) return 0;
  if (n === 2) return 6;
  if (n === 1) return 10;
  return 14;
}

export function computeEliminationBounds(
  input: EliminationBoundsInput,
): EliminationSnapshot {
  const now = (input.now ?? (() => new Date()))().toISOString();
  const active = [...input.activeBowlers].sort((a, b) => a.id.localeCompare(b.id));
  const activeSet = new Set(active.map((b) => b.id));

  if (active.length === 0) {
    return { lastCalculatedAt: now, weeksRemaining: 0, rows: [], calculationMode: "bounds_only" };
  }

  // Per-bowler list of unawarded matches: opponent + remaining units.
  const perBowlerUnawarded = new Map<BowlerId, Array<{ opp: BowlerId; units: number }>>();
  for (const b of active) perBowlerUnawarded.set(b.id, []);

  let weeksRemaining = 0;
  let totalUnawardedUnits = 0;
  for (let w = 1; w <= input.totalWeeks; w++) {
    const matches = input.matchesByWeek[w] ?? [];
    let anyUnresolved = matches.length === 0;
    for (const m of matches) {
      const u = unawardedUnitsForMatch(m.result);
      const aActive = activeSet.has(m.bowlerA);
      const bActive = activeSet.has(m.bowlerB);
      if (u > 0 && (aActive || bActive)) anyUnresolved = true;
      if (u <= 0) continue;
      if (aActive) perBowlerUnawarded.get(m.bowlerA)!.push({ opp: m.bowlerB, units: u });
      if (bActive) perBowlerUnawarded.get(m.bowlerB)!.push({ opp: m.bowlerA, units: u });
      if (aActive || bActive) totalUnawardedUnits += u;
    }
    if (anyUnresolved) weeksRemaining += 1;
  }

  const currUnits = new Map<BowlerId, number>();
  for (const b of active) currUnits.set(b.id, Math.round(b.points * 2));

  // absMax per target = current + sum of unawarded units on target's own matches.
  const absMax = new Map<BowlerId, number>();
  const targetOwnUnits = new Map<BowlerId, number>();
  for (const b of active) {
    let own = 0;
    for (const entry of perBowlerUnawarded.get(b.id) ?? []) own += entry.units;
    targetOwnUnits.set(b.id, own);
    absMax.set(b.id, (currUnits.get(b.id) ?? 0) + own);
  }

  const rows: EliminationRow[] = active.map((target) => {
    const tCurr = currUnits.get(target.id) ?? 0;
    const tFinal = absMax.get(target.id) ?? tCurr;
    const opponents = active.filter((b) => b.id !== target.id);

    if (opponents.length === 0) {
      return {
        bowler: target, status: "clinched",
        note: `${target.name} is the only active bowler.`,
        maxFinalPoints: tFinal / 2,
      };
    }

    // Clinch: target's current > every opponent's absolute maximum.
    let bestOpp = opponents[0];
    let bestOppMax = absMax.get(bestOpp.id) ?? 0;
    for (const o of opponents) {
      const m = absMax.get(o.id) ?? 0;
      if (m > bestOppMax) { bestOppMax = m; bestOpp = o; }
    }
    if (tCurr > bestOppMax) {
      return {
        bowler: target, status: "clinched",
        note: `${target.name} has ${fmt(tCurr)} points; the strongest opponent (${bestOpp.name}) can reach at most ${fmt(bestOppMax)}.`,
        maxFinalPoints: tFinal / 2,
      };
    }

    // Elimination — single opponent already exceeds target's ceiling.
    for (const o of opponents) {
      const oCurr = currUnits.get(o.id) ?? 0;
      if (oCurr > tFinal) {
        return {
          bowler: target, status: "eliminated",
          note: `${o.name} already has ${fmt(oCurr)} points; ${target.name}'s maximum possible finish is ${fmt(tFinal)}.`,
          maxFinalPoints: tFinal / 2,
        };
      }
    }

    // Elimination — schedule-independent tie-capacity bound.
    // Non-target unawarded units = total minus target's own share.
    const nonTargetUnits = totalUnawardedUnits - (targetOwnUnits.get(target.id) ?? 0);
    if (nonTargetUnits > 0) {
      let sumTieCap = 0;
      for (const o of opponents) {
        const oCurr = currUnits.get(o.id) ?? 0;
        sumTieCap += Math.max(0, tFinal - oCurr);
      }
      if (sumTieCap < nonTargetUnits) {
        return {
          bowler: target, status: "eliminated",
          note: `Even with ${target.name} winning every remaining unawarded point (final ${fmt(tFinal)}), non-target matches distribute more opponent units than the combined room to stay at or below ${fmt(tFinal)} (capacity ${fmt(sumTieCap)} < needed ${fmt(nonTargetUnits)}).`,
          maxFinalPoints: tFinal / 2,
        };
      }
    }

    return {
      bowler: target, status: "not_proven",
      note: PENDING_NOTE,
      maxFinalPoints: tFinal / 2,
    };
  });

  return {
    lastCalculatedAt: now,
    weeksRemaining,
    rows,
    calculationMode: "bounds_only",
  };
}

export const BOUNDS_PENDING_NOTE = PENDING_NOTE;
