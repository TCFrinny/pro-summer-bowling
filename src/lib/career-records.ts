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
 * Contributions are per-season, per-role, per-identity (roster seat, sub
 * seat, or historical participant ref). The aggregator sums each bucket
 * independently and treats `null` as "unavailable" — never zero.
 *
 * No DB access, no schema changes. Extractors take already-shaped
 * snapshots and derive the three records from stable public fields.
 */

export type WLT = { wins: number; losses: number; ties: number };
export type WL = { wins: number; losses: number };

export interface CareerRecords {
  gameRecord: WLT | null;
  setRecord: WLT | null;
  overallRecord: WL | null;
  /** Diagnostics: number of contributions that provided each bucket. */
  contributingSeasonsPersonal: number;
  contributingSeasonsOverall: number;
}

/** One record contribution for a single season+role+identity.
 *  `null` in any bucket = unavailable. Never emit 0-of-N to represent
 *  "no data available"; use null. */
export interface CareerRecordContribution {
  seasonId: string;
  seasonLabel?: string;
  role: "rostered" | "substitute";
  /** Optional identity used only for de-duplication or debugging. */
  identityRef?: string;
  // Personal — from every completed game/set the person actually rolled.
  gameW: number | null;
  gameL: number | null;
  gameT: number | null;
  setW: number | null;
  setL: number | null;
  setT: number | null;
  // Roster-credit only. Half-points allowed.
  pointsWon: number | null;
  pointsLost: number | null;
}

export function emptyContribution(base: Pick<CareerRecordContribution, "seasonId" | "role"> & Partial<CareerRecordContribution>): CareerRecordContribution {
  return {
    seasonLabel: undefined,
    identityRef: undefined,
    gameW: null, gameL: null, gameT: null,
    setW: null, setL: null, setT: null,
    pointsWon: null, pointsLost: null,
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
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatHalf(n: number): string {
  // Trim trailing ".0" but preserve ".5"
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
// Extractor 1 — current-season snapshot: rostered bowler
// ---------------------------------------------------------------------------

interface CurrentSnapshotShape {
  bowlersById?: Record<string, {
    points?: number | null;
    pointsLost?: number | null;
    id?: string;
  }>;
  history?: Record<string, Array<CurrentHistoryRowShape>>;
}

interface CurrentHistoryRowShape {
  matchId: string;
  isSub?: boolean;
  absent?: boolean;
  scoreOnly?: boolean;
  pairCompleted?: [boolean, boolean, boolean];
  handicapGames?: [number, number, number];
  handicapTotal?: number;
  opponentHandicapTotal?: number;
  scores?: [number, number, number];
  // Score-only rows don't carry opponent per-game handicap totals.
}

/** History rows on the CURRENT snapshot expose `handicapGames[i]` (self)
 *  and `handicapTotal`+`opponentHandicapTotal`. Per-game opponent handicap
 *  totals are recoverable by looking up the opponent's own history row for
 *  the same matchId. This helper builds a map keyed by matchId. */
function buildOpponentHandicapGamesByMatchId(snap: CurrentSnapshotShape): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  if (!snap.history) return out;
  for (const rows of Object.values(snap.history)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      if (Array.isArray(r.handicapGames) && r.handicapGames.length === 3) {
        // Multiple identities may share a matchId; last write wins, which
        // is fine because both sides carry equivalent per-game handicap
        // totals for their side. We index by matchId + side later.
        out.set(r.matchId, r.handicapGames);
      }
    }
  }
  return out;
}

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

/** Given self and opponent per-game handicap totals plus optional pair
 *  completion mask (score-only), append per-game and per-set outcomes to
 *  the personal accumulator.
 *
 *  Rules:
 *  - A game contributes only when it is completed on both sides. We
 *    infer completion from the pair mask (score-only) or from both sides
 *    having non-null handicap game totals.
 *  - A set contributes only when all three games are completed. */
function creditGameSetHandicap(
  acc: PersonalCounts,
  selfHcpGames: readonly (number | null | undefined)[],
  oppHcpGames: readonly (number | null | undefined)[],
  pairMask: readonly boolean[] | null,
): void {
  const completed = [false, false, false];
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
  base: Pick<CareerRecordContribution, "seasonId" | "role" | "seasonLabel" | "identityRef">,
  personal: PersonalCounts | null,
  overall: { pointsWon: number | null; pointsLost: number | null },
): CareerRecordContribution {
  const c = emptyContribution(base);
  if (personal && personal.personalGames > 0) {
    c.gameW = personal.gameW; c.gameL = personal.gameL; c.gameT = personal.gameT;
  }
  if (personal && personal.personalSets > 0) {
    c.setW = personal.setW; c.setL = personal.setL; c.setT = personal.setT;
  }
  c.pointsWon = overall.pointsWon;
  c.pointsLost = overall.pointsLost;
  return c;
}

/** Extract personal record + roster-credit overall record for a rostered
 *  bowler on the CURRENT-season snapshot. */
export function extractCurrentRosterRecordContribution(
  snapshot: unknown,
  rosterId: string,
  seasonId: string,
  seasonLabel?: string,
): CareerRecordContribution {
  const base = { seasonId, seasonLabel, role: "rostered" as const, identityRef: rosterId };
  const snap = (snapshot && typeof snapshot === "object" ? snapshot : null) as CurrentSnapshotShape | null;
  if (!snap) return emptyContribution(base);

  const bb = snap.bowlersById?.[rosterId];
  const overall = {
    pointsWon: typeof bb?.points === "number" ? bb.points : null,
    pointsLost: typeof bb?.pointsLost === "number" ? bb.pointsLost : null,
  };

  const rows = snap.history?.[rosterId];
  if (!Array.isArray(rows) || rows.length === 0) {
    return personalToContrib(base, null, overall);
  }
  const oppLookup = buildOpponentHandicapGamesByMatchId(snap);
  const acc = newPersonal();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    if (r.absent) continue;
    if (r.isSub) continue; // personal credit for a sub goes to the sub, not the roster seat
    if (!Array.isArray(r.handicapGames) || r.handicapGames.length !== 3) continue;
    // Find opponent's per-game handicap totals from their own history row.
    // The map above indexes by matchId with no side awareness, but the
    // opponent's row on the same matchId carries the opponent's own
    // handicap games — exactly what we need.
    const oppRow = findOpponentRow(snap, r.matchId, rosterId);
    if (!oppRow || !Array.isArray(oppRow.handicapGames) || oppRow.handicapGames.length !== 3) {
      // Fall back to the map (may be self if only one identity has this id — skip in that case).
      const oppFromMap = oppLookup.get(r.matchId);
      if (!oppFromMap) continue;
      creditGameSetHandicap(acc, r.handicapGames, oppFromMap, r.scoreOnly && Array.isArray(r.pairCompleted) ? r.pairCompleted : null);
      continue;
    }
    creditGameSetHandicap(
      acc,
      r.handicapGames,
      oppRow.handicapGames,
      r.scoreOnly && Array.isArray(r.pairCompleted) ? r.pairCompleted : null,
    );
  }
  return personalToContrib(base, acc, overall);
}

function findOpponentRow(
  snap: CurrentSnapshotShape,
  matchId: string,
  selfId: string,
): CurrentHistoryRowShape | null {
  if (!snap.history) return null;
  for (const [id, rows] of Object.entries(snap.history)) {
    if (id === selfId) continue;
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      if (r && typeof r === "object" && r.matchId === matchId) return r;
    }
  }
  return null;
}

/** Extract personal record for a CURRENT-season substitute. Substitutes
 *  never carry overall (roster-credit) points. */
export function extractCurrentSubstituteRecordContribution(
  snapshot: unknown,
  subId: string,
  seasonId: string,
  seasonLabel?: string,
): CareerRecordContribution {
  const base = { seasonId, seasonLabel, role: "substitute" as const, identityRef: subId };
  const snap = (snapshot && typeof snapshot === "object" ? snapshot : null) as
    | (CurrentSnapshotShape & { substituteProfiles?: Record<string, { weeks?: SubWeekShape[] }> })
    | null;
  if (!snap?.substituteProfiles) return emptyContribution(base);
  const profile = snap.substituteProfiles[subId];
  if (!profile || !Array.isArray(profile.weeks) || profile.weeks.length === 0) {
    return emptyContribution(base);
  }
  const acc = newPersonal();
  for (const w of profile.weeks) {
    if (!w || typeof w !== "object") continue;
    // The sub's own week row carries `scores`, `scratchTotal`, `handicapTotal`
    // and `handicapAtMatch`, but NOT per-game handicap totals or the
    // opponent's totals. Reconstruct per-game handicap totals from
    // `scores` + `handicapAtMatch`.
    const scores = Array.isArray(w.scores) && w.scores.length === 3 ? w.scores : null;
    const hcp = typeof w.handicapAtMatch === "number" ? w.handicapAtMatch : null;
    if (!scores || hcp == null) continue;
    const selfHcpGames: [number, number, number] = [scores[0] + hcp, scores[1] + hcp, scores[2] + hcp];
    // Opponent's own history row for the same matchId gives opponent per-game handicap.
    const oppRow = findOpponentRow(snap, w.matchId, "__none__");
    if (!oppRow || !Array.isArray(oppRow.handicapGames)) continue;
    const mask = w.scoreOnly && Array.isArray(w.pairCompleted) ? w.pairCompleted : null;
    creditGameSetHandicap(acc, selfHcpGames, oppRow.handicapGames, mask);
  }
  return personalToContrib(base, acc, { pointsWon: null, pointsLost: null });
}

interface SubWeekShape {
  matchId: string;
  scores?: [number, number, number];
  handicapAtMatch?: number;
  scoreOnly?: boolean;
  pairCompleted?: [boolean, boolean, boolean];
}

// ---------------------------------------------------------------------------
// Extractor 2 — historical snapshot participant
// ---------------------------------------------------------------------------

/** Minimal duck-typed match / week / standings shapes so this module
 *  stays independent of the historical-snapshot module. */
interface HistoricalMatchLike {
  actualA: string;
  actualB: string;
  absentA?: boolean;
  absentB?: boolean;
  hasGameDataA?: boolean;
  hasGameDataB?: boolean;
  handicapGamesA: [number, number, number];
  handicapGamesB: [number, number, number];
  handicapTotalA: number;
  handicapTotalB: number;
}
interface HistoricalWeekLike { matches?: HistoricalMatchLike[] }
interface HistoricalStandingLike {
  participantRef: string;
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
    role: input.role, identityRef: input.participantRef,
  };
  const acc = newPersonal();
  for (const w of input.weeks ?? []) {
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
  let overall = { pointsWon: null as number | null, pointsLost: null as number | null };
  if (input.role === "rostered") {
    const st = (input.standings ?? []).find((s) => s.participantRef === input.participantRef);
    if (st) {
      overall = {
        pointsWon: typeof st.points === "number" ? st.points : null,
        pointsLost: typeof st.pointsLost === "number" ? st.pointsLost : null,
      };
    }
  }
  return personalToContrib(base, acc, overall);
}

/** Summary-only historical row: no per-game data, so personal record is
 *  unavailable. Roster credit only when the summary carries explicit
 *  points and/or points_lost. */
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
    role: input.role, identityRef: input.participantRef,
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
    // Half-safe comparison
    if (Math.abs(aggregated.overallRecord.wins - pw) > 1e-9) throw new Error(`pW ${aggregated.overallRecord.wins} != ${pw}`);
    if (Math.abs(aggregated.overallRecord.losses - pl) > 1e-9) throw new Error(`pL ${aggregated.overallRecord.losses} != ${pl}`);
  }
}
