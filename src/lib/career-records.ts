/**
 * Career records — pure module.
 *
 * Owns the three career records shown on the /people/$personId page and
 * used as inputs to the All-Time Leaderboards:
 *
 *   1. Game W-L-T    — PERSONAL, per game the person actually bowled,
 *                      compared by handicap-adjusted game totals.
 *   2. Set  W-L-T    — PERSONAL, per completed three-game set, compared
 *                      by handicap-adjusted three-game totals.
 *   3. Overall W-L   — OFFICIAL ROSTER CREDIT (league points), independent
 *                      of games rolled. Includes point overrides and
 *                      substitute weeks credited to the scheduled roster.
 *
 * Rules:
 *   - PERSONAL follows who actually rolled the games. A rostered bowler
 *     substituted-for gets NO personal outcome that week. The substitute
 *     does. Absent bowlers get no personal outcome.
 *   - A bowler facing an absent opponent DOES get personal outcomes when
 *     the opponent has official absent scores AND the game is complete.
 *   - Missing games are `null`, never numeric zero.
 *   - Snapshot-derived contributions supersede summary-only contributions
 *     for the same season+role+identity via `mergeCareerRecordContributions`.
 *
 * No DB access, no schema changes.
 */

import type { PublicSnapshot } from "./mock-data";

export type WLT = { wins: number; losses: number; ties: number };
export type WL = { wins: number; losses: number };

export interface CareerRecords {
  gameRecord: WLT | null;
  setRecord: WLT | null;
  overallRecord: WL | null;
  /** How many contributions supplied each bucket. */
  contributingSeasonsPersonal: number;
  contributingSeasonsOverall: number;
  /** Aggregate diagnostic counts — enable trivial balance checks. */
  personalGamesTotal: number;
  personalSetsTotal: number;
  creditedMatchesTotal: number;
}

/** One record contribution for a single season+role+identity.
 *  `null` in any bucket = unavailable. Never emit 0-of-N to represent
 *  "no data available"; use null. */
export interface CareerRecordContribution {
  seasonId: string;
  seasonLabel?: string;
  role: "rostered" | "substitute";
  /** Seasonal identity — roster seat id, substitute id, or historical
   *  participant_ref. Used for merge deduplication and for unlinked
   *  historical identity display. */
  identityRef?: string;
  // Personal — from every completed game/set the person actually rolled.
  gameW: number | null;
  gameL: number | null;
  gameT: number | null;
  setW: number | null;
  setL: number | null;
  setT: number | null;
  /** Diagnostic — number of personal completed games contributing to
   *  gameW/L/T. Always equals gameW+gameL+gameT when non-null. */
  personalGames: number | null;
  /** Diagnostic — number of personal completed 3-game sets contributing
   *  to setW/L/T. Always equals setW+setL+setT when non-null. */
  personalSets: number | null;
  // Roster-credit only. Half-points allowed. Substitute rows must leave null.
  pointsWon: number | null;
  pointsLost: number | null;
  /** Optional — matches for which points were credited to this rostered
   *  identity. Enables the "points won + points lost = pointSystem * N"
   *  balance invariant when the season's point system is known. */
  creditedMatches: number | null;
  /** Higher wins per-bucket on merge. Snapshot = 2, summary = 1. */
  priority?: number;
}

export function emptyContribution(base: Pick<CareerRecordContribution, "seasonId" | "role"> & Partial<CareerRecordContribution>): CareerRecordContribution {
  return {
    seasonLabel: undefined,
    identityRef: undefined,
    gameW: null, gameL: null, gameT: null,
    setW: null, setL: null, setT: null,
    personalGames: null, personalSets: null,
    pointsWon: null, pointsLost: null,
    creditedMatches: null,
    priority: 1,
    ...base,
  };
}

function addNullable(cur: number | null, v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return cur;
  return (cur ?? 0) + v;
}

/** Sum contributions bucket-by-bucket. Buckets that are null in EVERY
 *  contribution stay null; any contribution with a real number promotes
 *  the aggregate off `null`. Personal record is a tuple: if any of
 *  {W,L,T} is defined it counts as available. */
export function aggregateCareerRecords(
  contribs: readonly CareerRecordContribution[],
): CareerRecords {
  let gW: number | null = null, gL: number | null = null, gT: number | null = null;
  let sW: number | null = null, sL: number | null = null, sT: number | null = null;
  let pW: number | null = null, pL: number | null = null;
  let personalSeasons = 0;
  let overallSeasons = 0;
  let pGames = 0, pSets = 0, credMatches = 0;
  for (const c of contribs) {
    const hasPersonal =
      c.gameW != null || c.gameL != null || c.gameT != null ||
      c.setW != null || c.setL != null || c.setT != null;
    if (hasPersonal) personalSeasons += 1;
    const hasOverall = c.pointsWon != null || c.pointsLost != null;
    if (hasOverall) overallSeasons += 1;
    gW = addNullable(gW, c.gameW); gL = addNullable(gL, c.gameL); gT = addNullable(gT, c.gameT);
    sW = addNullable(sW, c.setW); sL = addNullable(sL, c.setL); sT = addNullable(sT, c.setT);
    pW = addNullable(pW, c.pointsWon); pL = addNullable(pL, c.pointsLost);
    pGames += c.personalGames ?? 0;
    pSets += c.personalSets ?? 0;
    credMatches += c.creditedMatches ?? 0;
  }
  const gameRecord: WLT | null =
    gW != null || gL != null || gT != null
      ? { wins: gW ?? 0, losses: gL ?? 0, ties: gT ?? 0 }
      : null;
  const setRecord: WLT | null =
    sW != null || sL != null || sT != null
      ? { wins: sW ?? 0, losses: sL ?? 0, ties: sT ?? 0 }
      : null;
  const overallRecord: WL | null =
    pW != null || pL != null ? { wins: pW ?? 0, losses: pL ?? 0 } : null;
  return {
    gameRecord, setRecord, overallRecord,
    contributingSeasonsPersonal: personalSeasons,
    contributingSeasonsOverall: overallSeasons,
    personalGamesTotal: pGames,
    personalSetsTotal: pSets,
    creditedMatchesTotal: credMatches,
  };
}

/** Group contributions by seasonId+role+identityRef. When multiple
 *  contributions exist for the same key, produce ONE merged contribution
 *  that:
 *    - Takes personal buckets from the highest-priority contrib whose
 *      personal buckets are non-null.
 *    - Takes overall buckets from the highest-priority contrib whose
 *      overall buckets are non-null.
 *  Snapshot contributions carry priority=2 by convention; summary=1.
 *  Contributions with a null identityRef are keyed by seasonId+role
 *  alone (best-effort). */
export function mergeCareerRecordContributions(
  contribs: readonly CareerRecordContribution[],
): CareerRecordContribution[] {
  const groups = new Map<string, CareerRecordContribution[]>();
  for (const c of contribs) {
    const key = `${c.seasonId}|${c.role}|${c.identityRef ?? ""}`;
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }
  const out: CareerRecordContribution[] = [];
  for (const arr of groups.values()) {
    if (arr.length === 1) { out.push(arr[0]); continue; }
    const sorted = [...arr].sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
    const base = { ...sorted[0] };
    // Fill personal from highest-priority contrib that has personal.
    if (base.gameW == null && base.gameL == null && base.gameT == null &&
        base.setW == null && base.setL == null && base.setT == null) {
      for (const c of sorted) {
        if (c.gameW != null || c.gameL != null || c.gameT != null ||
            c.setW != null || c.setL != null || c.setT != null) {
          base.gameW = c.gameW; base.gameL = c.gameL; base.gameT = c.gameT;
          base.setW = c.setW; base.setL = c.setL; base.setT = c.setT;
          base.personalGames = c.personalGames;
          base.personalSets = c.personalSets;
          break;
        }
      }
    }
    // Fill overall from highest-priority contrib that has overall.
    if (base.pointsWon == null && base.pointsLost == null) {
      for (const c of sorted) {
        if (c.pointsWon != null || c.pointsLost != null) {
          base.pointsWon = c.pointsWon;
          base.pointsLost = c.pointsLost;
          base.creditedMatches = c.creditedMatches;
          break;
        }
      }
    }
    out.push(base);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatHalf(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

export function formatWLT(r: WLT | null): string {
  if (!r) return "—";
  return `${formatHalf(r.wins)}-${formatHalf(r.losses)}-${formatHalf(r.ties)}`;
}
export function formatWL(r: WL | null): string {
  if (!r) return "—";
  return `${formatHalf(r.wins)}-${formatHalf(r.losses)}`;
}

// ---------------------------------------------------------------------------
// Personal-outcome helpers
// ---------------------------------------------------------------------------

function judge(a: number, b: number): "W" | "L" | "T" {
  return a > b ? "W" : a < b ? "L" : "T";
}

interface PersonalCounts {
  gameW: number; gameL: number; gameT: number;
  setW: number; setL: number; setT: number;
  personalGames: number;
  personalSets: number;
}
function newPersonal(): PersonalCounts {
  return { gameW: 0, gameL: 0, gameT: 0, setW: 0, setL: 0, setT: 0, personalGames: 0, personalSets: 0 };
}

/** Credit per-game and per-set outcomes into `acc` when the pairing is
 *  complete on both sides. `pairMask` (score-only rows) forces games to
 *  be skipped when either side did not complete the game. */
function creditGameSetHandicap(
  acc: PersonalCounts,
  selfHcpGames: readonly (number | null | undefined)[],
  oppHcpGames: readonly (number | null | undefined)[],
  pairMask: readonly boolean[] | null,
): void {
  const completed: [boolean, boolean, boolean] = [false, false, false];
  for (let i = 0; i < 3; i++) {
    const s = selfHcpGames[i];
    const o = oppHcpGames[i];
    if (pairMask && !pairMask[i]) continue;
    if (typeof s !== "number" || typeof o !== "number") continue;
    completed[i] = true;
    acc.personalGames += 1;
    const r = judge(s, o);
    if (r === "W") acc.gameW += 1;
    else if (r === "L") acc.gameL += 1;
    else acc.gameT += 1;
  }
  if (completed[0] && completed[1] && completed[2]) {
    const selfTot = (selfHcpGames[0] as number) + (selfHcpGames[1] as number) + (selfHcpGames[2] as number);
    const oppTot = (oppHcpGames[0] as number) + (oppHcpGames[1] as number) + (oppHcpGames[2] as number);
    acc.personalSets += 1;
    const r = judge(selfTot, oppTot);
    if (r === "W") acc.setW += 1;
    else if (r === "L") acc.setL += 1;
    else acc.setT += 1;
  }
}

function personalToContrib(
  base: Pick<CareerRecordContribution, "seasonId" | "role" | "seasonLabel" | "identityRef" | "priority">,
  personal: PersonalCounts | null,
  overall: { pointsWon: number | null; pointsLost: number | null; creditedMatches?: number | null },
): CareerRecordContribution {
  const c = emptyContribution(base);
  if (personal && personal.personalGames > 0) {
    c.gameW = personal.gameW; c.gameL = personal.gameL; c.gameT = personal.gameT;
    c.personalGames = personal.personalGames;
  }
  if (personal && personal.personalSets > 0) {
    c.setW = personal.setW; c.setL = personal.setL; c.setT = personal.setT;
    c.personalSets = personal.personalSets;
  }
  c.pointsWon = overall.pointsWon;
  c.pointsLost = overall.pointsLost;
  c.creditedMatches = overall.creditedMatches ?? null;
  return c;
}

// ---------------------------------------------------------------------------
// Current-season snapshot extractor
// ---------------------------------------------------------------------------

/** Extract personal record + roster-credit overall record for a rostered
 *  bowler on the CURRENT-season snapshot. Iterates `matchesByWeek` for
 *  the participation identity carried on each MatchResult — never scans
 *  history rows. Skips any week not in `publishedWeeks`. */
export function extractCurrentRosterRecordContribution(
  snapshot: PublicSnapshot,
  rosterId: string,
  publishedWeeks: ReadonlySet<number>,
  seasonId: string,
  seasonLabel?: string,
): CareerRecordContribution {
  const base = { seasonId, seasonLabel, role: "rostered" as const, identityRef: rosterId, priority: 2 };
  const bb = snapshot.bowlersById?.[rosterId];
  const overall = {
    pointsWon: typeof bb?.points === "number" ? bb.points : null,
    pointsLost: typeof bb?.pointsLost === "number" ? bb.pointsLost : null,
    creditedMatches: typeof bb?.matchesPlayed === "number" ? bb.matchesPlayed : null,
  };
  const acc = newPersonal();
  for (const [wkStr, matches] of Object.entries(snapshot.matchesByWeek ?? {})) {
    const wk = Number(wkStr);
    if (!publishedWeeks.has(wk)) continue;
    for (const m of matches) {
      if (m.status !== "completed" || !m.result) continue;
      const r = m.result;
      const isA = r.scheduledA === rosterId;
      const isB = r.scheduledB === rosterId;
      if (!isA && !isB) continue;
      const partSelf = isA ? r.participationA : r.participationB;
      const partOpp = isA ? r.participationB : r.participationA;
      // Personal outcomes only when this rostered bowler actually rolled.
      if (partSelf.status !== "rostered") continue;
      // Opponent must have a scorable side.
      const oppHasScores = partOpp.status !== "absent" || !!partOpp.absentScores;
      if (!oppHasScores) continue;
      const selfHcp = isA ? r.handicapGamesA : r.handicapGamesB;
      const oppHcp = isA ? r.handicapGamesB : r.handicapGamesA;
      const mask = r.scoreOnly && r.pairCompleted ? r.pairCompleted : null;
      creditGameSetHandicap(acc, selfHcp, oppHcp, mask);
    }
  }
  return personalToContrib(base, acc, overall);
}

/** Extract personal record for a CURRENT-season substitute identity.
 *  Substitutes never carry Overall (roster-credit) points. Compares
 *  against the OPPOSING side's handicap game totals, taken directly
 *  from the MatchResult — never against the sub's own side. */
export function extractCurrentSubstituteRecordContribution(
  snapshot: PublicSnapshot,
  subId: string,
  publishedWeeks: ReadonlySet<number>,
  seasonId: string,
  seasonLabel?: string,
): CareerRecordContribution {
  const base = { seasonId, seasonLabel, role: "substitute" as const, identityRef: subId, priority: 2 };
  const acc = newPersonal();
  for (const [wkStr, matches] of Object.entries(snapshot.matchesByWeek ?? {})) {
    const wk = Number(wkStr);
    if (!publishedWeeks.has(wk)) continue;
    for (const m of matches) {
      if (m.status !== "completed" || !m.result) continue;
      const r = m.result;
      // Identify the side this sub rolled for.
      const isA = r.participationA.status === "substitute" && r.participationA.actualId === subId;
      const isB = r.participationB.status === "substitute" && r.participationB.actualId === subId;
      if (!isA && !isB) continue;
      const partOpp = isA ? r.participationB : r.participationA;
      const oppHasScores = partOpp.status !== "absent" || !!partOpp.absentScores;
      if (!oppHasScores) continue;
      const selfHcp = isA ? r.handicapGamesA : r.handicapGamesB;
      const oppHcp = isA ? r.handicapGamesB : r.handicapGamesA;
      const mask = r.scoreOnly && r.pairCompleted ? r.pairCompleted : null;
      creditGameSetHandicap(acc, selfHcp, oppHcp, mask);
    }
  }
  return personalToContrib(base, acc, { pointsWon: null, pointsLost: null, creditedMatches: null });
}

/** Convenience — extract every roster and substitute identity linked to
 *  `personId` from the current-season snapshot. Enforces the published-
 *  week set. Never touches local demo state. */
export function extractCurrentPersonRecordContributions(
  snapshot: PublicSnapshot,
  personId: string,
  publishedWeeks: ReadonlySet<number>,
  seasonId: string,
  seasonLabel?: string,
): CareerRecordContribution[] {
  const out: CareerRecordContribution[] = [];
  for (const b of snapshot.bowlers ?? []) {
    if (b.personId === personId) {
      out.push(extractCurrentRosterRecordContribution(snapshot, b.id, publishedWeeks, seasonId, seasonLabel));
    }
  }
  for (const s of snapshot.substitutes ?? []) {
    if (s.personId === personId) {
      out.push(extractCurrentSubstituteRecordContribution(snapshot, s.id, publishedWeeks, seasonId, seasonLabel));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Historical extractors
// ---------------------------------------------------------------------------

interface HistoricalMatchLike {
  actualA: string;
  actualB: string;
  absentA?: boolean;
  absentB?: boolean;
  hasGameDataA?: boolean;
  hasGameDataB?: boolean;
  handicapGamesA: [number, number, number];
  handicapGamesB: [number, number, number];
}
interface HistoricalWeekLike { published?: boolean; matches?: HistoricalMatchLike[] }
interface HistoricalStandingLike {
  participantRef: string;
  matchesPlayed?: number | null;
  points?: number | null;
  pointsLost?: number | null;
}

export function extractHistoricalRecordContribution(input: {
  seasonId: string;
  seasonLabel?: string;
  role: "rostered" | "substitute";
  participantRef: string;
  weeks: readonly HistoricalWeekLike[] | undefined;
  standings?: readonly HistoricalStandingLike[] | undefined;
}): CareerRecordContribution {
  const base = {
    seasonId: input.seasonId, seasonLabel: input.seasonLabel,
    role: input.role, identityRef: input.participantRef, priority: 2,
  };
  const acc = newPersonal();
  for (const w of input.weeks ?? []) {
    // Loader has already filtered to published weeks, but re-gate defensively.
    if (w.published === false) continue;
    for (const m of w.matches ?? []) {
      const isA = m.actualA === input.participantRef;
      const isB = m.actualB === input.participantRef;
      if (!isA && !isB) continue;
      const absent = isA ? m.absentA : m.absentB;
      if (absent) continue;
      const hasData = isA ? m.hasGameDataA : m.hasGameDataB;
      const oppHasData = isA ? m.hasGameDataB : m.hasGameDataA;
      if (!hasData || !oppHasData) continue;
      const self = isA ? m.handicapGamesA : m.handicapGamesB;
      const opp = isA ? m.handicapGamesB : m.handicapGamesA;
      if (!Array.isArray(self) || !Array.isArray(opp)) continue;
      creditGameSetHandicap(acc, self, opp, null);
    }
  }
  let overall = { pointsWon: null as number | null, pointsLost: null as number | null, creditedMatches: null as number | null };
  if (input.role === "rostered") {
    const st = (input.standings ?? []).find((s) => s.participantRef === input.participantRef);
    if (st) {
      overall = {
        pointsWon: typeof st.points === "number" ? st.points : null,
        pointsLost: typeof st.pointsLost === "number" ? st.pointsLost : null,
        creditedMatches: typeof st.matchesPlayed === "number" ? st.matchesPlayed : null,
      };
    }
  }
  return personalToContrib(base, acc, overall);
}

/** Summary-only historical row: no per-game data, so personal record is
 *  unavailable. Roster credit only when the summary carries explicit
 *  points and/or points_lost. Priority=1 so a snapshot contribution for
 *  the same identity wins under merge. */
export function extractHistoricalSummaryRecordContribution(input: {
  seasonId: string;
  seasonLabel?: string;
  role: "rostered" | "substitute";
  participantRef: string;
  points: number | null;
  pointsLost: number | null;
}): CareerRecordContribution {
  const base = {
    seasonId: input.seasonId, seasonLabel: input.seasonLabel,
    role: input.role, identityRef: input.participantRef, priority: 1,
  };
  const c = emptyContribution(base);
  if (input.role === "rostered") {
    c.pointsWon = input.points;
    c.pointsLost = input.pointsLost;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Diagnostics / invariants (used by tests)
// ---------------------------------------------------------------------------

export function assertCareerRecordInvariants(
  contribs: readonly CareerRecordContribution[],
  aggregated: CareerRecords,
): void {
  // 1. Per-contribution self-balance.
  for (const c of contribs) {
    if (c.personalGames != null) {
      const s = (c.gameW ?? 0) + (c.gameL ?? 0) + (c.gameT ?? 0);
      if (s !== c.personalGames) throw new Error(`invariant: W+L+T (${s}) != personalGames (${c.personalGames})`);
    }
    if (c.personalSets != null) {
      const s = (c.setW ?? 0) + (c.setL ?? 0) + (c.setT ?? 0);
      if (s !== c.personalSets) throw new Error(`invariant: setW+setL+setT (${s}) != personalSets (${c.personalSets})`);
    }
  }
  // 2. Aggregate sums equal per-contribution sums (linear aggregator).
  let gw = 0, gl = 0, gt = 0, sw = 0, sl = 0, st = 0, pw = 0, pl = 0;
  let hasP = false, hasO = false;
  for (const c of contribs) {
    gw += c.gameW ?? 0; gl += c.gameL ?? 0; gt += c.gameT ?? 0;
    sw += c.setW ?? 0; sl += c.setL ?? 0; st += c.setT ?? 0;
    pw += c.pointsWon ?? 0; pl += c.pointsLost ?? 0;
    if (c.gameW != null || c.gameL != null || c.gameT != null) hasP = true;
    if (c.pointsWon != null || c.pointsLost != null) hasO = true;
  }
  if (hasP) {
    if (!aggregated.gameRecord) throw new Error("invariant: personal present but gameRecord null");
    if (aggregated.gameRecord.wins !== gw) throw new Error(`gameW ${aggregated.gameRecord.wins} != ${gw}`);
    if (aggregated.gameRecord.losses !== gl) throw new Error(`gameL ${aggregated.gameRecord.losses} != ${gl}`);
    if (aggregated.gameRecord.ties !== gt) throw new Error(`gameT ${aggregated.gameRecord.ties} != ${gt}`);
    if (!aggregated.setRecord) throw new Error("invariant: personal present but setRecord null");
    if (aggregated.setRecord.wins !== sw) throw new Error(`setW ${aggregated.setRecord.wins} != ${sw}`);
    if (aggregated.setRecord.losses !== sl) throw new Error(`setL ${aggregated.setRecord.losses} != ${sl}`);
    if (aggregated.setRecord.ties !== st) throw new Error(`setT ${aggregated.setRecord.ties} != ${st}`);
  }
  if (hasO) {
    if (!aggregated.overallRecord) throw new Error("invariant: overall present but null");
    if (Math.abs(aggregated.overallRecord.wins - pw) > 1e-9) throw new Error(`pW ${aggregated.overallRecord.wins} != ${pw}`);
    if (Math.abs(aggregated.overallRecord.losses - pl) > 1e-9) throw new Error(`pL ${aggregated.overallRecord.losses} != ${pl}`);
  }
}

/** For a rostered contribution with a known credited-match count and
 *  seasonal point system, verify pointsWon + pointsLost = pointSystem * N.
 *  Overrides are independent per side, so this only guarantees the SUM,
 *  not the split. */
export function assertOverallPointSystemBalance(
  contrib: CareerRecordContribution,
  pointSystem: number,
): void {
  if (contrib.role !== "rostered") return;
  if (contrib.pointsWon == null || contrib.pointsLost == null) return;
  if (contrib.creditedMatches == null) return;
  const sum = contrib.pointsWon + contrib.pointsLost;
  const expected = pointSystem * contrib.creditedMatches;
  if (Math.abs(sum - expected) > 1e-9) {
    throw new Error(`overall balance: pW+pL (${sum}) != pointSystem*N (${expected})`);
  }
}
