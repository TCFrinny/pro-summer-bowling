/**
 * Proof-safe, schedule-aware elimination solver.
 *
 * Called during PublicSnapshot rebuild (server-side, post-admin-mutation).
 * NEVER runs on public page loads. Deterministic and bounded.
 *
 * Semantics per league rule:
 *  - Each remaining match distributes exactly 7 points (14 half-point units,
 *    integer arithmetic throughout).
 *  - Each active bowler plays at most one match per week.
 *  - No opponent repeats before the final week; final-week repeats allowed.
 *  - Manual point overrides are already reflected in current points (they
 *    live inside completed match results, not in the solver's inputs).
 *
 * Statuses:
 *  - clinched: mathematically guaranteed to finish ALONE first on points
 *    under every possible remaining result. Proof is a strict points bound
 *    (current > every opponent's absolute maximum).
 *  - eliminated: no legal scenario reaches even a tie for first. Proof is
 *    either a single-opponent lock (some opp current > target max) or a
 *    schedule-independent total-capacity bound.
 *  - alive: a concrete legal remaining schedule and a strict integer point
 *    allocation (max-flow) place the target alone first.
 *  - tiebreaker_only: strict alone-first is impossible by an independent
 *    bound, but a legal schedule + non-strict allocation ties for first.
 *  - not_proven: bounded search neither proved nor disproved and no bound
 *    fired. Includes incomplete/inconsistent data cases.
 */

import type {
  Bowler,
  BowlerId,
  EliminationRow,
  EliminationSnapshot,
  Match,
  WeekSummary,
} from "./mock-data";

const DEFAULT_NODE_BUDGET = 200_000;

export interface EliminationInput {
  activeBowlers: Bowler[];
  weeks: WeekSummary[];
  matchesByWeek: Record<number, Match[]>;
  /** Total number of weeks in the season (e.g. 11). */
  totalWeeks: number;
  /** Optional clock injection for deterministic tests. */
  now?: () => Date;
  /** Backtracking operation budget (per target). Small values in tests
   *  intentionally force NOT PROVEN, never elimination. */
  nodeBudget?: number;
}

type PairT = readonly [BowlerId, BowlerId];
function pk(a: BowlerId, b: BowlerId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function fmt(units: number): string {
  const pts = units / 2;
  return Number.isInteger(pts) ? pts.toString() : pts.toFixed(1);
}

interface WeekSlot {
  week: number;
  isFinal: boolean;
  published: boolean;
  completedPairs: PairT[];               // both endpoints active
  completedBowlers: Set<BowlerId>;       // active bowlers already resolved this week
  fixedPairs: PairT[];                   // published unresolved pairs (both active)
  unresolvedActive: Set<BowlerId>;       // active bowlers still to be paired this week
  fixedForBowler: Map<BowlerId, BowlerId>; // fast lookup: id -> fixed opponent
}

interface Prep {
  ok: true;
  active: Bowler[];
  activeSet: Set<BowlerId>;
  currUnits: Map<BowlerId, number>;
  weekSlots: WeekSlot[];
  finalWeek: number;
  pastPairsPreFinal: Set<string>;
  publishedNextOpp: Map<BowlerId, { week: number; opp: BowlerId } | undefined>;
  weeksRemaining: number;
}
interface PrepFail { ok: false; reason: string; }

function prepare(input: EliminationInput): Prep | PrepFail {
  const active = [...input.activeBowlers].sort((a, b) => a.id.localeCompare(b.id));
  const activeSet = new Set(active.map((b) => b.id));

  if (active.length === 0) return { ok: false, reason: "No active bowlers on the roster." };
  if (active.length % 2 !== 0)
    return { ok: false, reason: `Active roster size (${active.length}) is odd; weekly pairings are impossible.` };

  const currUnits = new Map<BowlerId, number>();
  for (const b of active) currUnits.set(b.id, Math.round(b.points * 2));

  const finalWeek = input.totalWeeks;
  const pastPairsPreFinal = new Set<string>();
  const weekSlots: WeekSlot[] = [];
  const publishedNextOpp = new Map<BowlerId, { week: number; opp: BowlerId } | undefined>();

  // Index week metadata by number.
  const weekMeta = new Map<number, WeekSummary>();
  for (const w of input.weeks) weekMeta.set(w.week, w);

  for (let w = 1; w <= input.totalWeeks; w++) {
    const meta = weekMeta.get(w);
    const published = meta?.published === true;
    const matches = input.matchesByWeek[w] ?? [];
    const isFinal = w === finalWeek;

    const completedPairs: PairT[] = [];
    const completedBowlers = new Set<BowlerId>();
    const fixedPairs: PairT[] = [];
    const fixedForBowler = new Map<BowlerId, BowlerId>();
    const seenThisWeek = new Set<BowlerId>();

    for (const m of matches) {
      if (m.bowlerA === m.bowlerB)
        return { ok: false, reason: `Week ${w} has a self-match (${m.bowlerA}).` };
      const aActive = activeSet.has(m.bowlerA);
      const bActive = activeSet.has(m.bowlerB);
      if (m.result) {
        // Completed. Count active endpoints as covered.
        if (aActive) {
          if (seenThisWeek.has(m.bowlerA))
            return { ok: false, reason: `Week ${w}: bowler ${m.bowlerA} appears in multiple matches.` };
          seenThisWeek.add(m.bowlerA);
          completedBowlers.add(m.bowlerA);
        }
        if (bActive) {
          if (seenThisWeek.has(m.bowlerB))
            return { ok: false, reason: `Week ${w}: bowler ${m.bowlerB} appears in multiple matches.` };
          seenThisWeek.add(m.bowlerB);
          completedBowlers.add(m.bowlerB);
        }
        if (aActive && bActive) {
          const p: PairT = [m.bowlerA, m.bowlerB];
          completedPairs.push(p);
          if (!isFinal) {
            const key = pk(p[0], p[1]);
            if (pastPairsPreFinal.has(key))
              return {
                ok: false,
                reason: `Pair ${m.bowlerA}/${m.bowlerB} repeats in pre-final weeks (through week ${w}).`,
              };
            pastPairsPreFinal.add(key);
          }
        }
      } else if (published) {
        // Fixed unresolved.
        if (!aActive || !bActive) continue; // schedule references an inactive bowler; skip
        if (seenThisWeek.has(m.bowlerA))
          return { ok: false, reason: `Week ${w}: bowler ${m.bowlerA} appears in multiple matches.` };
        if (seenThisWeek.has(m.bowlerB))
          return { ok: false, reason: `Week ${w}: bowler ${m.bowlerB} appears in multiple matches.` };
        seenThisWeek.add(m.bowlerA);
        seenThisWeek.add(m.bowlerB);
        fixedPairs.push([m.bowlerA, m.bowlerB]);
        fixedForBowler.set(m.bowlerA, m.bowlerB);
        fixedForBowler.set(m.bowlerB, m.bowlerA);
        if (!isFinal) {
          const key = pk(m.bowlerA, m.bowlerB);
          if (pastPairsPreFinal.has(key))
            return {
              ok: false,
              reason: `Pair ${m.bowlerA}/${m.bowlerB} repeats in pre-final weeks (through week ${w}).`,
            };
          pastPairsPreFinal.add(key);
        }
        // Earliest-week published opponent per bowler.
        for (const [a, b] of [[m.bowlerA, m.bowlerB], [m.bowlerB, m.bowlerA]] as const) {
          const cur = publishedNextOpp.get(a);
          if (!cur || cur.week > w) publishedNextOpp.set(a, { week: w, opp: b });
        }
      }
    }

    const unresolvedActive = new Set<BowlerId>();
    for (const b of active)
      if (!completedBowlers.has(b.id)) unresolvedActive.add(b.id);

    if (published) {
      // Every active bowler must be covered exactly once by completed+fixed.
      const covered = new Set<BowlerId>(completedBowlers);
      for (const [a, b] of fixedPairs) { covered.add(a); covered.add(b); }
      for (const b of active) {
        if (!covered.has(b.id))
          return {
            ok: false,
            reason: `Week ${w} is published but active bowler ${b.name ?? b.id} has no scheduled match.`,
          };
      }
      const fixedBowlers = new Set<BowlerId>();
      for (const [a, b] of fixedPairs) { fixedBowlers.add(a); fixedBowlers.add(b); }
      for (const id of unresolvedActive) {
        if (!fixedBowlers.has(id))
          return {
            ok: false,
            reason: `Week ${w} is published but ${id} has neither a completed nor a fixed unresolved match.`,
          };
      }
    } else {
      if (unresolvedActive.size % 2 !== 0)
        return {
          ok: false,
          reason: `Week ${w}: odd number of unresolved active bowlers (${unresolvedActive.size}).`,
        };
    }

    weekSlots.push({
      week: w, isFinal, published,
      completedPairs, completedBowlers, fixedPairs, unresolvedActive, fixedForBowler,
    });
  }

  const weeksRemaining = weekSlots.filter((s) => s.unresolvedActive.size > 0).length;
  return { ok: true, active, activeSet, currUnits, weekSlots, finalWeek, pastPairsPreFinal, publishedNextOpp, weeksRemaining };
}

// -----------------------------------------------------------------------
// Schedule construction (bounded backtracking).
// -----------------------------------------------------------------------

interface ScheduleWitness {
  // For every WeekSlot with unresolvedActive.size > 0: the full pairing.
  perWeek: Array<{ week: number; pairs: PairT[] }>;
}

interface SearchCtx {
  target: BowlerId | null;
  currUnits: Map<BowlerId, number>;
  pastPairsPreFinal: Set<string>;
  budget: { remaining: number };
}

/**
 * Try to build a legal remaining schedule. When `target` is non-null, the
 * target is paired first each week (opponent iteration ordered by current
 * points, tiebreak by id). When `target` is null, no bowler is preferred —
 * used for the global schedule-feasibility check.
 *
 * Returns null if the budget runs out or no legal schedule exists.
 */
function buildSchedule(prep: Prep, target: BowlerId | null, budget: { remaining: number }): ScheduleWitness | null {
  const ctx: SearchCtx = {
    target,
    currUnits: prep.currUnits,
    pastPairsPreFinal: new Set(prep.pastPairsPreFinal),
    budget,
  };
  const witness: ScheduleWitness = { perWeek: [] };
  const activeUnresolvedSlots = prep.weekSlots.filter((s) => s.unresolvedActive.size > 0);
  const ok = solveWeeks(ctx, activeUnresolvedSlots, 0, witness);
  return ok ? witness : null;
}

/**
 * Global remaining-schedule feasibility check. Returns:
 *  - "ok" if a complete legal schedule exists (including trivially, when
 *    there are no unresolved matches).
 *  - "infeasible" if the bounded search completed and no legal schedule
 *    exists.
 *  - "budget_exhausted" if the search consumed its node budget without
 *    reaching a conclusion.
 * Never returns a witness — this is used only as a precondition for
 * proving per-target statuses.
 */
function checkGlobalFeasibility(
  prep: Prep,
  budget: { remaining: number },
): { status: "ok" | "infeasible" | "budget_exhausted" } {
  if (prep.weeksRemaining === 0) return { status: "ok" };
  const witness = buildSchedule(prep, null, budget);
  if (witness) return { status: "ok" };
  if (budget.remaining <= 0) return { status: "budget_exhausted" };
  return { status: "infeasible" };
}

function solveWeeks(
  ctx: SearchCtx,
  slots: WeekSlot[],
  idx: number,
  witness: ScheduleWitness,
): boolean {
  if (idx === slots.length) return true;
  const slot = slots[idx];
  const isFinal = slot.isFinal;

  // Initial state: fixed pairs already placed.
  const pairs: PairT[] = [...slot.fixedPairs];
  const paired = new Set<BowlerId>();
  for (const [a, b] of slot.fixedPairs) { paired.add(a); paired.add(b); }

  // Remaining bowlers to pair this week.
  const remaining = new Set<BowlerId>();
  for (const id of slot.unresolvedActive) if (!paired.has(id)) remaining.add(id);

  // Track pair additions for this week so we can undo on backtrack.
  const addedKeys: string[] = [];

  const finish = (): boolean => {
    if (!isFinal) {
      // Commit added pair keys to context (already added; leave them).
    }
    witness.perWeek.push({ week: slot.week, pairs: [...pairs] });
    if (solveWeeks(ctx, slots, idx + 1, witness)) return true;
    witness.perWeek.pop();
    return false;
  };

  const addPair = (a: BowlerId, b: BowlerId): boolean => {
    const key = pk(a, b);
    if (!isFinal && ctx.pastPairsPreFinal.has(key)) return false;
    pairs.push([a, b]);
    paired.add(a); paired.add(b);
    if (!isFinal) {
      ctx.pastPairsPreFinal.add(key);
      addedKeys.push(key);
    }
    return true;
  };
  const removePair = (a: BowlerId, b: BowlerId) => {
    pairs.pop();
    paired.delete(a); paired.delete(b);
    if (!isFinal) {
      const key = pk(a, b);
      const i = addedKeys.lastIndexOf(key);
      if (i >= 0) { addedKeys.splice(i, 1); ctx.pastPairsPreFinal.delete(key); }
    }
  };

  // Prefer pairing the target first, choosing the opponent with the highest
  // current points (deterministic tiebreak by id ascending). When target is
  // null (global feasibility check) skip the target-first branch entirely.
  const target = ctx.target;
  const targetHere = target !== null
    && remaining.has(target)
    && !slot.fixedForBowler.has(target);
  const rest: BowlerId[] = [];
  for (const id of remaining) if (id !== target) rest.push(id);
  rest.sort((a, b) => {
    const dc = (ctx.currUnits.get(b) ?? 0) - (ctx.currUnits.get(a) ?? 0);
    if (dc !== 0) return dc;
    return a.localeCompare(b);
  });

  const backtrackRest = (): boolean => {
    if (ctx.budget.remaining-- <= 0) return false;
    // Find still-unpaired bowler with fewest legal options (MRV).
    const unpaired = [...remaining].filter((id) => !paired.has(id));
    if (unpaired.length === 0) return finish();

    let bestBowler: BowlerId | null = null;
    let bestOpts: BowlerId[] = [];
    let bestCount = Infinity;
    for (const bId of unpaired.sort()) {
      const opts: BowlerId[] = [];
      for (const oId of unpaired) {
        if (oId === bId) continue;
        const key = pk(bId, oId);
        if (!isFinal && ctx.pastPairsPreFinal.has(key)) continue;
        opts.push(oId);
      }
      opts.sort();
      if (opts.length < bestCount) {
        bestCount = opts.length;
        bestBowler = bId;
        bestOpts = opts;
        if (bestCount === 0) break;
      }
    }
    if (bestBowler === null || bestOpts.length === 0) return false;
    for (const oId of bestOpts) {
      if (ctx.budget.remaining-- <= 0) return false;
      if (!addPair(bestBowler, oId)) continue;
      if (backtrackRest()) return true;
      removePair(bestBowler, oId);
    }
    return false;
  };

  if (targetHere && target !== null) {
    const candidates = rest.filter((o) => !paired.has(o));
    for (const opp of candidates) {
      if (ctx.budget.remaining-- <= 0) return false;
      if (!addPair(target, opp)) continue;
      if (backtrackRest()) return true;
      removePair(target, opp);
    }
    return false;
  }
  // Target has a fixed pair this week (or target isn't in unresolvedActive
  // this week, or no target was specified); just pair the rest.
  return backtrackRest();
}

// -----------------------------------------------------------------------
// Max flow (Edmonds-Karp).
// -----------------------------------------------------------------------

interface FlowEdge { to: number; cap: number; rev: number; }
class MaxFlow {
  g: FlowEdge[][] = [];
  constructor(public n: number) { for (let i = 0; i < n; i++) this.g.push([]); }
  addEdge(u: number, v: number, cap: number) {
    this.g[u].push({ to: v, cap, rev: this.g[v].length });
    this.g[v].push({ to: u, cap: 0, rev: this.g[u].length - 1 });
  }
  run(s: number, t: number): number {
    let flow = 0;
    while (true) {
      const prev = new Int32Array(this.n).fill(-1);
      const prevE = new Int32Array(this.n).fill(-1);
      prev[s] = s;
      const q: number[] = [s];
      while (q.length) {
        const u = q.shift()!;
        for (let i = 0; i < this.g[u].length; i++) {
          const e = this.g[u][i];
          if (e.cap > 0 && prev[e.to] === -1) {
            prev[e.to] = u; prevE[e.to] = i;
            if (e.to === t) { q.length = 0; break; }
            q.push(e.to);
          }
        }
      }
      if (prev[t] === -1) return flow;
      let push = Infinity;
      for (let v = t; v !== s; v = prev[v]) push = Math.min(push, this.g[prev[v]][prevE[v]].cap);
      for (let v = t; v !== s; v = prev[v]) {
        const e = this.g[prev[v]][prevE[v]];
        e.cap -= push;
        this.g[e.to][e.rev].cap += push;
      }
      flow += push;
    }
  }
  /** After run: flow on edge (u -> v) is initialCap - residualCap. */
  flowOn(u: number, idx: number, initialCap: number): number {
    return initialCap - this.g[u][idx].cap;
  }
}

interface FlowResult {
  feasible: boolean;
  witnessFinals?: Map<BowlerId, number>;
}

/**
 * Given target and a witness schedule, verify a point allocation exists
 * where every opponent stays within `allowance(o)` units.
 * strict=true → allowance = tFinal - 1 - oCurr (alone first)
 * strict=false → allowance = tFinal - oCurr (tie-or-better)
 */
function tryFlow(
  prep: Prep,
  target: BowlerId,
  witness: ScheduleWitness,
  strict: boolean,
): FlowResult {
  const tCurr = prep.currUnits.get(target) ?? 0;
  const tRem = witness.perWeek.reduce(
    (acc, w) => acc + (w.pairs.some((p) => p[0] === target || p[1] === target) ? 1 : 0),
    0,
  );
  const tFinal = tCurr + 14 * tRem;

  const nonTargetPairs: PairT[] = [];
  for (const w of witness.perWeek)
    for (const p of w.pairs)
      if (p[0] !== target && p[1] !== target) nonTargetPairs.push(p);

  const M = nonTargetPairs.length;
  const opponentIds = prep.active.map((b) => b.id).filter((id) => id !== target);
  const oppIdx = new Map<BowlerId, number>();
  opponentIds.forEach((id, i) => oppIdx.set(id, i));
  const K = opponentIds.length;

  const S = 0;
  const matchNode = (i: number) => 1 + i;
  const oppNode = (i: number) => 1 + M + i;
  const T = 1 + M + K;
  const nNodes = T + 1;

  const flow = new MaxFlow(nNodes);
  // Track match->opponent edge indices for witness extraction.
  const matchEdges: Array<[number, number, BowlerId, BowlerId]> = [];

  for (let i = 0; i < M; i++) {
    flow.addEdge(S, matchNode(i), 14);
    const [a, b] = nonTargetPairs[i];
    const ea = flow.g[matchNode(i)].length;
    flow.addEdge(matchNode(i), oppNode(oppIdx.get(a)!), 14);
    const eb = flow.g[matchNode(i)].length;
    flow.addEdge(matchNode(i), oppNode(oppIdx.get(b)!), 14);
    matchEdges.push([ea, eb, a, b]);
    void matchEdges;
  }
  for (let j = 0; j < K; j++) {
    const oCurr = prep.currUnits.get(opponentIds[j]) ?? 0;
    const allowance = strict ? tFinal - 1 - oCurr : tFinal - oCurr;
    flow.addEdge(oppNode(j), T, Math.max(0, allowance));
  }

  const demand = 14 * M;
  const maxflow = flow.run(S, T);
  if (maxflow !== demand) return { feasible: false };

  // Extract witness: per-opponent flow = 14 - residual on opp->T edge.
  const finals = new Map<BowlerId, number>();
  for (const b of prep.active) finals.set(b.id, prep.currUnits.get(b.id) ?? 0);
  finals.set(target, tFinal);
  for (let j = 0; j < K; j++) {
    // The last edge added from oppNode(j) is to T; but we added edges from matches
    // to oppNode(j), which means oppNode(j)'s adjacency has residuals+the T edge.
    // Find the edge to T explicitly.
    const adj = flow.g[oppNode(j)];
    const tEdge = adj.find((e) => e.to === T)!;
    const oCurr = prep.currUnits.get(opponentIds[j]) ?? 0;
    const allowance = strict ? tFinal - 1 - oCurr : tFinal - oCurr;
    const usedAllowance = Math.max(0, allowance) - tEdge.cap;
    finals.set(opponentIds[j], oCurr + usedAllowance);
  }
  return { feasible: true, witnessFinals: finals };
}

// -----------------------------------------------------------------------
// Main entry.
// -----------------------------------------------------------------------

export function computeElimination(input: EliminationInput): EliminationSnapshot {
  const now = (input.now ?? (() => new Date()))().toISOString();
  const prep = prepare(input);

  if (!prep.ok) {
    return {
      lastCalculatedAt: now,
      weeksRemaining: 0,
      rows: input.activeBowlers.map((b) => ({
        bowler: b,
        status: "not_proven",
        note: prep.reason,
      })),
    };
  }

  const budget = input.nodeBudget ?? DEFAULT_NODE_BUDGET;

  // Global remaining-schedule feasibility check. Runs BEFORE any clinch /
  // elimination bound so that inconsistent/impossible schedules can never be
  // reported as a final status. Never converts search failure into a
  // clinched/eliminated verdict.
  const feasBudget = { remaining: budget };
  const feas = checkGlobalFeasibility(prep, feasBudget);
  if (feas.status !== "ok") {
    const reason = feas.status === "budget_exhausted"
      ? "Could not verify a complete legal remaining schedule within the calculation limit."
      : "No complete legal remaining schedule exists under the current roster, published matchups, and no-repeat rules.";
    return {
      lastCalculatedAt: now,
      weeksRemaining: prep.weeksRemaining,
      rows: prep.active.map((b) => ({
        bowler: b,
        status: "not_proven" as const,
        note: reason,
        diagnostics: { budgetExhausted: feas.status === "budget_exhausted" },
      })),
    };
  }

  const rows: EliminationRow[] = [];
  for (const target of prep.active) {
    rows.push(proveTarget(prep, target, budget));
  }

  return { lastCalculatedAt: now, weeksRemaining: prep.weeksRemaining, rows };
}

function proveTarget(prep: Prep, target: Bowler, nodeBudget: number): EliminationRow {
  const tCurr = prep.currUnits.get(target.id) ?? 0;
  const opponents = prep.active.filter((b) => b.id !== target.id);

  // Remaining match counts per bowler (over all unresolved weeks).
  const remaining = new Map<BowlerId, number>();
  for (const b of prep.active) remaining.set(b.id, 0);
  for (const s of prep.weekSlots)
    for (const id of s.unresolvedActive) remaining.set(id, (remaining.get(id) ?? 0) + 1);

  const tRem = remaining.get(target.id) ?? 0;
  const tFinal = tCurr + 14 * tRem;

  const publishedNext = prep.publishedNextOpp.get(target.id);
  const nextOpponent = publishedNext
    ? prep.active.find((b) => b.id === publishedNext.opp)?.name
    : undefined;

  // --- Bound 1: CLINCHED ---------------------------------------------------
  let bestOppMax = { id: "" as BowlerId, name: "", max: -Infinity };
  for (const o of opponents) {
    const oMax = (prep.currUnits.get(o.id) ?? 0) + 14 * (remaining.get(o.id) ?? 0);
    if (oMax > bestOppMax.max) bestOppMax = { id: o.id, name: o.name, max: oMax };
  }
  if (opponents.length > 0 && tCurr > bestOppMax.max) {
    return {
      bowler: target,
      status: "clinched",
      note: `${target.name} has ${fmt(tCurr)} points; the strongest opponent (${bestOppMax.name}) can reach at most ${fmt(bestOppMax.max)}.`,
      maxFinalPoints: tFinal / 2,
      nextOpponent,
    };
  }
  if (opponents.length === 0) {
    return { bowler: target, status: "clinched", note: `${target.name} is the only active bowler.`, maxFinalPoints: tFinal / 2 };
  }

  // --- Bound 2: ELIMINATED (single opponent lock) --------------------------
  for (const o of opponents) {
    const oCurr = prep.currUnits.get(o.id) ?? 0;
    if (oCurr > tFinal) {
      return {
        bowler: target,
        status: "eliminated",
        note: `${o.name} already has ${fmt(oCurr)} points; ${target.name}'s maximum possible finish is ${fmt(tFinal)}.`,
        maxFinalPoints: tFinal / 2,
        nextOpponent,
      };
    }
  }

  // --- Capacity bound (schedule independent) -------------------------------
  // Every unresolved match not involving target still distributes exactly
  // 14 units among the two participants (opponents). Sum of opponent
  // allowances must be at least that total or the target cannot avoid tie/beat.
  let numTargetMatches = 0;
  let numTotalMatches = 0;
  for (const s of prep.weekSlots) {
    numTotalMatches += s.unresolvedActive.size / 2;
    if (s.unresolvedActive.has(target.id)) numTargetMatches += 1;
  }
  const nonTargetMatches = numTotalMatches - numTargetMatches;
  const totalNonTargetUnits = 14 * nonTargetMatches;

  let sumStrictCap = 0;
  let sumTieCap = 0;
  for (const o of opponents) {
    const oCurr = prep.currUnits.get(o.id) ?? 0;
    sumStrictCap += Math.max(0, tFinal - 1 - oCurr);
    sumTieCap += Math.max(0, tFinal - oCurr);
  }

  const tieImpossibleByCapacity = sumTieCap < totalNonTargetUnits;
  if (tieImpossibleByCapacity) {
    return {
      bowler: target,
      status: "eliminated",
      note: `Even with ${target.name} winning every remaining match (final ${fmt(tFinal)}), opponent points available in the ${nonTargetMatches} non-target match(es) exceed the combined room to stay at or below ${fmt(tFinal)} (capacity ${fmt(sumTieCap)} < needed ${fmt(totalNonTargetUnits)}).`,
      maxFinalPoints: tFinal / 2,
      nextOpponent,
    };
  }

  const strictImpossibleIndependent =
    sumStrictCap < totalNonTargetUnits ||
    opponents.some((o) => (prep.currUnits.get(o.id) ?? 0) >= tFinal);

  // --- Try to prove ALIVE ---------------------------------------------------
  const budgetHolder = { remaining: nodeBudget };
  let witness: ScheduleWitness | null = null;
  if (!strictImpossibleIndependent) {
    witness = buildSchedule(prep, target.id, budgetHolder);
    if (witness) {
      const fr = tryFlow(prep, target.id, witness, /* strict */ true);
      if (fr.feasible && fr.witnessFinals) {
        const oppFinals = opponents.map((o) => ({ name: o.name, final: fr.witnessFinals!.get(o.id) ?? 0 }));
        const strongest = oppFinals.reduce((a, b) => (b.final > a.final ? b : a), oppFinals[0]);
        const margin = tFinal - strongest.final;
        return {
          bowler: target,
          status: "alive",
          note: `A legal schedule was constructed and an integer point allocation places ${target.name} at ${fmt(tFinal)} with the strongest opponent (${strongest.name}) capped at ${fmt(strongest.final)}.`,
          maxFinalPoints: tFinal / 2,
          nextOpponent,
          bestMargin: margin / 2,
          diagnostics: {
            witnessPairs: witness.perWeek.map((w) => ({ week: w.week, pairs: w.pairs.map((p) => [p[0], p[1]] as [BowlerId, BowlerId]) })),
            witnessFinals: Object.fromEntries(fr.witnessFinals),
            witnessType: "strict",
            budgetExhausted: budgetHolder.remaining <= 0,
          },
        };
      }
    }
  }

  // --- Try to prove TIEBREAKER_ONLY -----------------------------------------
  if (strictImpossibleIndependent) {
    if (!witness) witness = buildSchedule(prep, target.id, budgetHolder);
    if (witness) {
      const fr = tryFlow(prep, target.id, witness, /* strict */ false);
      if (fr.feasible && fr.witnessFinals) {
        // Confirm at least one opponent ties (else this would be strict alive,
        // which we already showed is independently impossible).
        const finals = fr.witnessFinals;
        const tiesTarget = opponents.some((o) => (finals.get(o.id) ?? 0) === tFinal);
        if (tiesTarget) {
          return {
            bowler: target,
            status: "tiebreaker_only",
            note: `Strict alone-first is impossible; a legal schedule + integer allocation produces a tie for first with ${target.name} at ${fmt(tFinal)}. Total handicap pinfall is the official tiebreaker.`,
            maxFinalPoints: tFinal / 2,
            nextOpponent,
            bestMargin: 0,
            diagnostics: {
              witnessPairs: witness.perWeek.map((w) => ({ week: w.week, pairs: w.pairs.map((p) => [p[0], p[1]] as [BowlerId, BowlerId]) })),
              witnessFinals: Object.fromEntries(finals),
              witnessType: "tie",
              budgetExhausted: budgetHolder.remaining <= 0,
            },
          };
        }
      }
    }
  }

  // --- Not proven ----------------------------------------------------------
  const budgetExhausted = budgetHolder.remaining <= 0;
  const reason = budgetExhausted
    ? `Bounded search budget exhausted before proving a status for ${target.name}.`
    : witness == null
    ? `No legal remaining schedule could be constructed for ${target.name} within the search budget.`
    : `A legal schedule was found but no integer point allocation proved ${target.name} alone-first or tied-for-first.`;
  return {
    bowler: target,
    status: "not_proven",
    note: reason,
    maxFinalPoints: tFinal / 2,
    nextOpponent,
    diagnostics: { budgetExhausted },
  };
}
