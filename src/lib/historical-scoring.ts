/**
 * Pure historical-mode scoring helpers.
 *
 * The current-season snapshot builder and computeMatchResult() are 7-point
 * (2 per game, 1 set, ties 1-1 and 0.5-0.5). Historical seasons may use
 * either 7-point OR 4-point (1 per game, 1 set, ties 0.5-0.5 and 0.5-0.5).
 *
 * We do NOT reuse computeMatchResult() for game-score-only rows because it
 * expects full linescores. Instead we compute directly from three per-side
 * scratch scores here, then feed the derived shape into the snapshot cache.
 *
 * No DB, no snapshot, no globals. Deterministic.
 */

export type HistoricalPointSystem = 4 | 7;

export type HistoricalParticipation =
  | { status: "rostered" }
  | { status: "substitute" }
  | { status: "absent"; absentScores?: [number, number, number] };

export interface HistoricalSideInput {
  /** Scratch scores per game. Absent w/o scores → all null. */
  gameScores: [number | null, number | null, number | null];
  handicap: number;
  participation: HistoricalParticipation;
}

export interface HistoricalPointsResult {
  gameScoresScratch: [number, number, number];
  gameScoresHandicap: [number, number, number];
  scratchTotal: number;
  handicapTotal: number;
  /** gameAwards[i] is the fraction of the "per-game" award this side won:
   *   7-point: 2 win / 1 tie / 0 loss
   *   4-point: 1 win / 0.5 tie / 0 loss (halved) */
  gameAwards: [number, number, number];
  gamePoints: number;
  setPoint: number;
  totalPoints: number;
}

export interface HistoricalMatchOutcome {
  pointSystem: HistoricalPointSystem;
  a: HistoricalPointsResult;
  b: HistoricalPointsResult;
  winner: "A" | "B" | "T";
  override: { pointsA: number; pointsB: number; reason?: string } | null;
  finalPointsA: number;
  finalPointsB: number;
}

/** Per-game and set awards for the given point system. */
function awardsFor(sys: HistoricalPointSystem) {
  return sys === 7
    ? { win: 2, tie: 1, setWin: 1, setTie: 0.5 }
    : { win: 1, tie: 0.5, setWin: 1, setTie: 0.5 };
}

function hasScores(side: HistoricalSideInput): boolean {
  if (side.participation.status !== "absent") {
    return side.gameScores.every((g) => typeof g === "number");
  }
  return !!side.participation.absentScores;
}

function normalizeScores(side: HistoricalSideInput): [number, number, number] {
  if (side.participation.status === "absent") {
    return side.participation.absentScores ?? [0, 0, 0];
  }
  return [
    side.gameScores[0] ?? 0,
    side.gameScores[1] ?? 0,
    side.gameScores[2] ?? 0,
  ];
}

export function computeHistoricalMatch(input: {
  pointSystem: HistoricalPointSystem;
  sideA: HistoricalSideInput;
  sideB: HistoricalSideInput;
  override?: { pointsA: number; pointsB: number; reason?: string } | null;
}): HistoricalMatchOutcome {
  const aw = awardsFor(input.pointSystem);
  const hasA = hasScores(input.sideA);
  const hasB = hasScores(input.sideB);

  const rawA = normalizeScores(input.sideA);
  const rawB = normalizeScores(input.sideB);
  const hcpA: [number, number, number] = hasA
    ? [rawA[0] + input.sideA.handicap, rawA[1] + input.sideA.handicap, rawA[2] + input.sideA.handicap]
    : [0, 0, 0];
  const hcpB: [number, number, number] = hasB
    ? [rawB[0] + input.sideB.handicap, rawB[1] + input.sideB.handicap, rawB[2] + input.sideB.handicap]
    : [0, 0, 0];

  const gaA: [number, number, number] = [0, 0, 0];
  const gaB: [number, number, number] = [0, 0, 0];
  let gpA = 0, gpB = 0;
  let setA = 0, setB = 0;

  if (hasA && hasB) {
    for (let i = 0; i < 3; i++) {
      if (hcpA[i] > hcpB[i]) { gaA[i] = aw.win; gpA += aw.win; }
      else if (hcpB[i] > hcpA[i]) { gaB[i] = aw.win; gpB += aw.win; }
      else { gaA[i] = aw.tie; gaB[i] = aw.tie; gpA += aw.tie; gpB += aw.tie; }
    }
    const totA = hcpA[0] + hcpA[1] + hcpA[2];
    const totB = hcpB[0] + hcpB[1] + hcpB[2];
    if (totA > totB) { setA = aw.setWin; setB = 0; }
    else if (totB > totA) { setA = 0; setB = aw.setWin; }
    else { setA = aw.setTie; setB = aw.setTie; }
  }

  const totalA = gpA + setA;
  const totalB = gpB + setB;

  const override = input.override && input.override.pointsA >= 0 && input.override.pointsB >= 0
    ? input.override
    : null;
  const finalA = override ? override.pointsA : totalA;
  const finalB = override ? override.pointsB : totalB;
  const winner: "A" | "B" | "T" =
    finalA > finalB ? "A" : finalB > finalA ? "B" : "T";

  const a: HistoricalPointsResult = {
    gameScoresScratch: hasA ? rawA : [0, 0, 0],
    gameScoresHandicap: hcpA,
    scratchTotal: hasA ? rawA[0] + rawA[1] + rawA[2] : 0,
    handicapTotal: hasA ? hcpA[0] + hcpA[1] + hcpA[2] : 0,
    gameAwards: gaA,
    gamePoints: gpA,
    setPoint: setA,
    totalPoints: totalA,
  };
  const b: HistoricalPointsResult = {
    gameScoresScratch: hasB ? rawB : [0, 0, 0],
    gameScoresHandicap: hcpB,
    scratchTotal: hasB ? rawB[0] + rawB[1] + rawB[2] : 0,
    handicapTotal: hasB ? hcpB[0] + hcpB[1] + hcpB[2] : 0,
    gameAwards: gaB,
    gamePoints: gpB,
    setPoint: setB,
    totalPoints: totalB,
  };
  return {
    pointSystem: input.pointSystem,
    a, b, winner, override,
    finalPointsA: finalA, finalPointsB: finalB,
  };
}

// ---------------- Detail-mode helpers ----------------

export type HistoricalDetailMode = "full_linescore" | "game_scores" | "summary_only";

/** True when the row supplies enough data to compute per-game / per-frame
 *  advanced statistics (mark %, strike %, pins lost, etc.). */
export function supportsAdvancedStats(mode: HistoricalDetailMode): boolean {
  return mode === "full_linescore";
}

/** True when the row supplies per-game scratch scores (feeds averages and
 *  high game/set), which both full and game-score modes do. */
export function supportsPerGameScores(mode: HistoricalDetailMode): boolean {
  return mode === "full_linescore" || mode === "game_scores";
}

// ---------------- Detail-mode aggregation ----------------

export interface DetailModeAggregate {
  games: number | null;         // null = unavailable (never zero)
  scratchPinfall: number | null;
  average: number | null;
  highGame: number | null;
  highSet: number | null;
  advancedAvailable: boolean;
}

/** Combine one bowler's cross-mode contributions across many matches +
 *  one optional summary-only row. Every field stays null when nothing
 *  contributed it — we NEVER fabricate zero for a missing statistic. */
export function aggregateAcrossModes(input: {
  perMatch: Array<{
    mode: HistoricalDetailMode;
    scratchGames?: [number, number, number]; // only when supportsPerGameScores
  }>;
  summary?: {
    games?: number | null;
    scratchPinfall?: number | null;
    highGame?: number | null;
    highSet?: number | null;
  } | null;
}): DetailModeAggregate {
  let games: number | null = null;
  let pinfall: number | null = null;
  let highGame: number | null = null;
  let highSet: number | null = null;
  let advanced = false;

  for (const m of input.perMatch) {
    if (m.mode === "full_linescore") advanced = true;
    if (supportsPerGameScores(m.mode) && m.scratchGames) {
      const g1 = m.scratchGames[0], g2 = m.scratchGames[1], g3 = m.scratchGames[2];
      const set = g1 + g2 + g3;
      games = (games ?? 0) + 3;
      pinfall = (pinfall ?? 0) + set;
      const maxGame = Math.max(g1, g2, g3);
      highGame = highGame === null ? maxGame : Math.max(highGame, maxGame);
      highSet = highSet === null ? set : Math.max(highSet, set);
    }
  }

  // Summary-only fields serve as a fallback for missing weekly data. Never
  // add them to a running per-match total; a null in summary stays null.
  if (input.summary) {
    if (games === null && typeof input.summary.games === "number") games = input.summary.games;
    if (pinfall === null && typeof input.summary.scratchPinfall === "number") pinfall = input.summary.scratchPinfall;
    if (highGame === null && typeof input.summary.highGame === "number") highGame = input.summary.highGame;
    if (highSet === null && typeof input.summary.highSet === "number") highSet = input.summary.highSet;
  }

  const average = games !== null && pinfall !== null && games > 0 ? pinfall / games : null;
  return { games, scratchPinfall: pinfall, average, highGame, highSet, advancedAvailable: advanced };
}
