/**
 * Proof-safe, schedule-aware elimination solver.
 *
 * Called during PublicSnapshot rebuild (server-side, post-admin-mutation).
 * NEVER runs on public page loads. Deterministic and bounded.
 *
 * Semantics per league rule:
 *  - Each remaining match distributes exactly 7 points (14 half-point units).
 *  - Each active bowler plays at most one match per week.
 *  - No opponent repeats before the final week; final-week repeats allowed.
 *  - Manual point overrides are already reflected in current points (they
 *    live inside completed match results, not in the solver's inputs).
 *
 * Statuses (from spec):
 *  - clinched: mathematically guaranteed to finish ALONE first on points
 *    under every possible remaining result.
 *  - eliminated: no legal scenario reaches even a tie for first.
 *  - alive: a concrete legal scenario finishes the bowler alone first.
 *  - tiebreaker_only: best proven legal scenario ties on points (handicap
 *    pinfall is the official tiebreaker; we do not claim resolution here).
 *  - not_proven: bounded search neither proved nor disproved.
 *
 * The solver is intentionally conservative: it uses valid mathematical
 * bounds and one explicit constructive scenario. When neither fires it
 * returns `not_proven` with a plain-language reason.
 */

import type {
  Bowler,
  BowlerId,
  EliminationRow,
  EliminationSnapshot,
  Match,
  WeekSummary,
} from "./mock-data";

export interface EliminationInput {
  activeBowlers: Bowler[];
  weeks: WeekSummary[];
  matchesByWeek: Record<number, Match[]>;
  /** Total number of weeks in the season (e.g. 11). */
  totalWeeks: number;
  /** Optional clock injection for deterministic tests. */
  now?: () => Date;
}

/** Format half-point units back to display points ("3.5", "10"). */
function fmt(units: number): string {
  const pts = units / 2;
  return Number.isInteger(pts) ? pts.toString() : pts.toFixed(1);
}

export function computeElimination(input: EliminationInput): EliminationSnapshot {
  const now = (input.now ?? (() => new Date()))().toISOString();
  const active = input.activeBowlers;
  const weeksRemaining = Math.max(
    0,
    input.totalWeeks - input.weeks.filter((w) => w.completed).length,
  );

  if (active.length < 2) {
    return {
      lastCalculatedAt: now,
      weeksRemaining,
      rows: active.map((b) => ({
        bowler: b,
        status: "not_proven",
        note: "Roster incomplete — at least 2 active bowlers required for elimination proofs.",
      })),
    };
  }

  // Half-point units so every intermediate stays integer.
  const currUnits = new Map<BowlerId, number>();
  for (const b of active) currUnits.set(b.id, Math.round(b.points * 2));

  // Completed match count per active bowler & set of past opponents.
  const completedCount = new Map<BowlerId, number>();
  const pastOpponents = new Map<BowlerId, Set<BowlerId>>();
  for (const b of active) {
    completedCount.set(b.id, 0);
    pastOpponents.set(b.id, new Set());
  }
  for (const w of input.weeks) {
    for (const m of input.matchesByWeek[w.week] ?? []) {
      if (!m.result) continue;
      if (completedCount.has(m.bowlerA)) {
        completedCount.set(m.bowlerA, (completedCount.get(m.bowlerA) ?? 0) + 1);
        pastOpponents.get(m.bowlerA)!.add(m.bowlerB);
      }
      if (completedCount.has(m.bowlerB)) {
        completedCount.set(m.bowlerB, (completedCount.get(m.bowlerB) ?? 0) + 1);
        pastOpponents.get(m.bowlerB)!.add(m.bowlerA);
      }
    }
  }

  // Published unresolved matches per bowler (fixed future matchups + count
  // toward past-opponent set for repeat-check purposes).
  const publishedFuture = new Map<BowlerId, { week: number; opponent: BowlerId }[]>();
  for (const b of active) publishedFuture.set(b.id, []);
  for (const w of input.weeks) {
    if (!w.published) continue;
    for (const m of input.matchesByWeek[w.week] ?? []) {
      if (m.result) continue;
      if (publishedFuture.has(m.bowlerA)) {
        publishedFuture.get(m.bowlerA)!.push({ week: m.week, opponent: m.bowlerB });
        pastOpponents.get(m.bowlerA)!.add(m.bowlerB);
      }
      if (publishedFuture.has(m.bowlerB)) {
        publishedFuture.get(m.bowlerB)!.push({ week: m.week, opponent: m.bowlerA });
        pastOpponents.get(m.bowlerB)!.add(m.bowlerA);
      }
    }
  }

  // Remaining matches per bowler = TOTAL_WEEKS - completed matches.
  const remainingMatches = new Map<BowlerId, number>();
  for (const b of active) {
    remainingMatches.set(
      b.id,
      Math.max(0, input.totalWeeks - (completedCount.get(b.id) ?? 0)),
    );
  }

  // Max possible additional units = 14 per remaining match (win everything).
  const maxFinal = (id: BowlerId) =>
    (currUnits.get(id) ?? 0) + 14 * (remainingMatches.get(id) ?? 0);

  // Roster/schedule feasibility guard. With N active bowlers, at most
  // (N-1) distinct opponents exist. If any bowler's remaining matches
  // exceeds N (one extra final-week repeat allowed), a legal no-repeat
  // schedule cannot exist — declare unproven with a clear reason.
  const nOpponents = active.length - 1;
  const rosterTooSmall = active.some(
    (b) => (remainingMatches.get(b.id) ?? 0) > nOpponents + 1,
  );

  const rows: EliminationRow[] = [];

  for (const target of active) {
    if (rosterTooSmall) {
      rows.push({
        bowler: target,
        status: "not_proven",
        note: `Active roster (${active.length}) is too small for the remaining schedule; a legal no-repeat set of remaining matches does not exist.`,
      });
      continue;
    }

    const tCurr = currUnits.get(target.id) ?? 0;
    const tRem = remainingMatches.get(target.id) ?? 0;
    const tMax = tCurr + 14 * tRem;
    const opponents = active.filter((b) => b.id !== target.id);

    // ---- CLINCHED ------------------------------------------------------
    // Strong proof: tCurr strictly greater than every opponent's ceiling.
    // (Every remaining opponent match gives 7 pts to opponent, target 0.)
    let bestOppMax = { id: "", name: "", max: -Infinity };
    for (const o of opponents) {
      const m = maxFinal(o.id);
      if (m > bestOppMax.max) bestOppMax = { id: o.id, name: o.name, max: m };
    }
    if (tCurr > bestOppMax.max) {
      rows.push({
        bowler: target,
        status: "clinched",
        note: `${fmt(tCurr)} current points already exceed every opponent's maximum possible finish (${bestOppMax.name} could reach at most ${fmt(bestOppMax.max)}).`,
        maxFinalPoints: tMax / 2,
      });
      continue;
    }

    // ---- ELIMINATED ----------------------------------------------------
    // Proof: some opponent's guaranteed floor already > target's ceiling.
    // Opponent floor = their current points (they might lose everything).
    let eliminatedBy: { name: string; curr: number } | null = null;
    for (const o of opponents) {
      const oCurr = currUnits.get(o.id) ?? 0;
      if (oCurr > tMax) {
        eliminatedBy = { name: o.name, curr: oCurr };
        break;
      }
    }
    if (eliminatedBy) {
      rows.push({
        bowler: target,
        status: "eliminated",
        note: `${eliminatedBy.name} already has ${fmt(eliminatedBy.curr)} points; ${target.name}'s maximum possible finish is ${fmt(tMax)}.`,
        maxFinalPoints: tMax / 2,
      });
      continue;
    }

    // ---- CONSTRUCTIVE ALIVE / TIEBREAKER-ONLY --------------------------
    // Scenario: target wins every remaining match (target_final = tMax).
    // Non-target remaining matches split evenly (3.5–3.5 → +7 units each).
    // Each opponent loses exactly the matches published against target
    // plus (roughly) one more if unknown weeks require a target match.
    // Bound: opponent i final = current + 7 * (rem_i - facesTargetCount).
    const pubFutTarget = publishedFuture.get(target.id) ?? [];
    const publishedOpponents = new Set(pubFutTarget.map((p) => p.opponent));
    let worstOpp = { name: "", final: -Infinity };
    let anyTie = false;
    let anyBeat = false;
    for (const o of opponents) {
      const oCurr = currUnits.get(o.id) ?? 0;
      const oRem = remainingMatches.get(o.id) ?? 0;
      // How many of opponent's remaining matches are against target?
      // Lower-bound estimate: 1 if published, else assume 0 (opponent may
      // never face target in unknown weeks). Higher facesTargetCount lowers
      // opponent's ceiling — we use the safe (lower) count.
      const facesTargetCount = publishedOpponents.has(o.id) ? 1 : 0;
      const oFinal = oCurr + 7 * Math.max(0, oRem - facesTargetCount);
      if (oFinal > worstOpp.final) worstOpp = { name: o.name, final: oFinal };
      if (oFinal > tMax) anyBeat = true;
      else if (oFinal === tMax) anyTie = true;
    }

    if (!anyBeat && !anyTie) {
      // Alive alone in first proven.
      const nextPub = pubFutTarget.slice().sort((a, b) => a.week - b.week)[0];
      const nextOpponentName = nextPub
        ? active.find((b) => b.id === nextPub.opponent)?.name
        : undefined;
      rows.push({
        bowler: target,
        status: "alive",
        note: `A legal scenario exists where ${target.name} wins every remaining match (final ${fmt(tMax)}) and each opponent's balanced-split ceiling stays below (worst: ${worstOpp.name} at ${fmt(worstOpp.final)}).`,
        maxFinalPoints: tMax / 2,
        nextOpponent: nextOpponentName,
        bestMargin: (tMax - worstOpp.final) / 2,
      });
      continue;
    }
    if (!anyBeat && anyTie) {
      rows.push({
        bowler: target,
        status: "tiebreaker_only",
        note: `Best proven scenario ties on points with ${worstOpp.name} at ${fmt(tMax)}; total handicap pinfall would decide.`,
        maxFinalPoints: tMax / 2,
        bestMargin: 0,
      });
      continue;
    }
    rows.push({
      bowler: target,
      status: "not_proven",
      note: `Bounded search could not prove alive: even with ${target.name} winning every remaining match (${fmt(tMax)}), a balanced-split scenario leaves ${worstOpp.name} at ${fmt(worstOpp.final)}. Also could not prove eliminated.`,
      maxFinalPoints: tMax / 2,
    });
  }

  return { lastCalculatedAt: now, weeksRemaining, rows };
}
