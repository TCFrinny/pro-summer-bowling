/**
 * Bounds-only elimination — cheap, proof-safe, no search / no max-flow.
 *
 * Used by the server-side `buildSnapshot()` rebuild so a Cloudflare Worker
 * request cannot hit the 10 ms CPU limit. Only proves statuses that fall
 * out of trivial arithmetic on current points and remaining match counts:
 *   - clinched: `current > every opponent's absolute maximum`
 *   - eliminated: an opponent's current already exceeds target's absolute
 *     maximum, OR a schedule-independent tie-capacity bound proves it.
 *   - everyone else: `not_proven` with an explicit "Full schedule
 *     calculation pending admin recalculation." note.
 *
 * The heavy schedule-aware solver runs in the ADMIN'S BROWSER via a Web
 * Worker and persists results through the `saveFullEliminationResult`
 * server function.
 *
 * Complexity: O(bowlers × weeks) — no backtracking, no flow.
 */

import type {
  Bowler,
  BowlerId,
  EliminationRow,
  EliminationSnapshot,
  Match,
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

export function computeEliminationBounds(
  input: EliminationBoundsInput,
): EliminationSnapshot {
  const now = (input.now ?? (() => new Date()))().toISOString();
  const active = [...input.activeBowlers].sort((a, b) => a.id.localeCompare(b.id));
  const activeSet = new Set(active.map((b) => b.id));

  // Trivial / degenerate cases: nothing to prove — everyone unproven.
  if (active.length === 0) {
    return { lastCalculatedAt: now, weeksRemaining: 0, rows: [], calculationMode: "bounds_only" };
  }

  // Cheap per-bowler completed-match count over active-vs-active matches.
  const completed = new Map<BowlerId, number>();
  for (const b of active) completed.set(b.id, 0);

  let weeksRemaining = 0;
  for (let w = 1; w <= input.totalWeeks; w++) {
    const matches = input.matchesByWeek[w] ?? [];
    let anyUnresolved = matches.length === 0;
    for (const m of matches) {
      const aActive = activeSet.has(m.bowlerA);
      const bActive = activeSet.has(m.bowlerB);
      if (m.result) {
        if (aActive) completed.set(m.bowlerA, (completed.get(m.bowlerA) ?? 0) + 1);
        if (bActive) completed.set(m.bowlerB, (completed.get(m.bowlerB) ?? 0) + 1);
      } else if (aActive || bActive) {
        anyUnresolved = true;
      }
    }
    if (anyUnresolved) weeksRemaining += 1;
  }

  // Remaining match counts (each bowler plays at most one per week).
  const remaining = new Map<BowlerId, number>();
  for (const b of active) {
    const done = completed.get(b.id) ?? 0;
    remaining.set(b.id, Math.max(0, input.totalWeeks - done));
  }

  const currUnits = new Map<BowlerId, number>();
  for (const b of active) currUnits.set(b.id, Math.round(b.points * 2));

  const absMax = new Map<BowlerId, number>();
  for (const b of active) {
    absMax.set(b.id, (currUnits.get(b.id) ?? 0) + 14 * (remaining.get(b.id) ?? 0));
  }

  // Total remaining match slots across the season (each match consumes 2
  // "bowler-match" slots). Used for the schedule-independent tie-capacity
  // elimination bound.
  let totalRemainingSlots = 0;
  for (const b of active) totalRemainingSlots += remaining.get(b.id) ?? 0;
  const totalRemainingMatches = Math.floor(totalRemainingSlots / 2);

  const rows: EliminationRow[] = active.map((target) => {
    const tCurr = currUnits.get(target.id) ?? 0;
    const tRem = remaining.get(target.id) ?? 0;
    const tFinal = tCurr + 14 * tRem;
    const opponents = active.filter((b) => b.id !== target.id);

    if (opponents.length === 0) {
      return {
        bowler: target, status: "clinched",
        note: `${target.name} is the only active bowler.`,
        maxFinalPoints: tFinal / 2,
      };
    }

    // Clinch: current strictly greater than every opponent's absMax.
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

    // Elimination: single-opponent lock.
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

    // Elimination: schedule-independent capacity bound.
    // Non-target remaining matches distribute 14 units each among opponents.
    // If the sum of per-opponent tie-capacities (max(0, tFinal - oCurr)) is
    // less than the total non-target unit demand, at least one opponent
    // must exceed tFinal in every legal outcome.
    const nonTargetMatches = Math.max(0, totalRemainingMatches - tRem);
    if (nonTargetMatches > 0) {
      let sumTieCap = 0;
      for (const o of opponents) {
        const oCurr = currUnits.get(o.id) ?? 0;
        sumTieCap += Math.max(0, tFinal - oCurr);
      }
      if (sumTieCap < 14 * nonTargetMatches) {
        return {
          bowler: target, status: "eliminated",
          note: `Even with ${target.name} winning every remaining match (final ${fmt(tFinal)}), non-target matches distribute more opponent points than the combined room to stay at or below ${fmt(tFinal)} (capacity ${fmt(sumTieCap)} < needed ${fmt(14 * nonTargetMatches)}).`,
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
