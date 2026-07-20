/**
 * Adapters that project existing snapshots into `RatingGame[]` for the
 * experimental ratings module. Pure — takes explicit data in, no globals.
 */

import type { Match, MatchResult, BowlerMatchLinescore } from "./mock-data";
import type { HistoricalSnapshot, HistoricalMatch } from "./historical-snapshot";
import type { GameLinescore } from "./duckpin";
import type { RatingGame, RatingFrameStats } from "./ratings";

/** Convert a saved GameLinescore into the frame stats the rating module
 *  expects. Clutch = marks in regulation frames 9 and 10 only. */
export function frameStatsFromLinescore(g: GameLinescore): RatingFrameStats {
  const frames = g.frames.length;
  // frames 9 & 10 exist for full 10-frame games
  let clutchMarks = 0;
  let clutchOpportunities = 0;
  for (const f of g.frames) {
    if (f.frameNumber === 9 || f.frameNumber === 10) {
      clutchOpportunities += 1;
      const first = f.mark.charAt(0);
      if (first === "X" || first === "/") clutchMarks += 1;
    }
  }
  return {
    framesRolled: frames,
    strikes: g.strikes,
    spares: g.spares,
    opens: g.opens,
    clutchMarks,
    clutchOpportunities,
  };
}

interface SideProjection {
  personRef: string;
  entryAverage: number | null;
  scores: number[];
  frames: (RatingFrameStats | null)[];
  present: boolean;
}

function projectSide(
  scheduledId: string,
  scheduledName: string,
  ls: BowlerMatchLinescore | null,
  scoreOnly: boolean | undefined,
  pairCompleted: readonly boolean[] | undefined,
  scratchGames: [number, number, number],
  entryAverage: number,
  absent: boolean,
  actualPersonId: string | null | undefined,
): SideProjection {
  if (absent) return { personRef: scheduledId, entryAverage, scores: [], frames: [], present: false };
  // ACTUAL bowler attribution. Score-only rows have no linescore; read the
  // frozen actual person from participation. Substitute personal stats
  // belong to the sub in BOTH full-linescore and score-only paths.
  const person = ls?.actualId ?? actualPersonId ?? scheduledId;
  const entry = ls?.entryAverage ?? entryAverage;
  const scores: number[] = [];
  const frames: (RatingFrameStats | null)[] = [];
  if (ls && !scoreOnly) {
    for (let i = 0; i < 3; i++) {
      const g = ls.games[i];
      scores.push(g.scratchTotal);
      frames.push(frameStatsFromLinescore(g));
    }
  } else {
    const mask = pairCompleted ?? [true, true, true];
    for (let i = 0; i < 3; i++) {
      if (mask[i]) { scores.push(scratchGames[i]); frames.push(null); }
    }
  }
  void scheduledName;
  return { personRef: person, entryAverage: entry ?? null, scores, frames, present: true };
}

/** Build RatingGame rows from the CURRENT-season matches by week. Only
 *  completed weeks that are public should be passed in. Absent-side
 *  synthetic scores are excluded because we gate on `participation.status`. */
export function ratingGamesFromCurrentSeason(
  seasonId: string,
  matchesByWeek: Record<number, Match[]>,
): RatingGame[] {
  const rows: RatingGame[] = [];
  for (const [wkStr, matches] of Object.entries(matchesByWeek)) {
    const week = Number(wkStr);
    for (const m of matches) {
      if (m.status !== "completed" || !m.result) continue;
      const r: MatchResult = m.result;
      const absentA = r.participationA.status === "absent";
      const absentB = r.participationB.status === "absent";
      const A = projectSide(
        r.participationA.scheduledId, r.actualNameA, r.linescoreA,
        r.scoreOnly, r.pairCompleted, r.gamesA, r.entryAverageA, absentA,
      );
      const B = projectSide(
        r.participationB.scheduledId, r.actualNameB, r.linescoreB,
        r.scoreOnly, r.pairCompleted, r.gamesB, r.entryAverageB, absentB,
      );
      const lanePair = String(m.lanePair);
      // emit rows only for scores actually recorded on both sides so games
      // pair up. But we still emit even if opponent absent (opponentRef null)
      // so personal offense counts.
      const gamesCount = Math.max(A.scores.length, B.scores.length);
      for (let i = 0; i < gamesCount; i++) {
        if (A.present && i < A.scores.length) {
          rows.push({
            seasonId, weekNumber: week, lanePair,
            personRef: A.personRef,
            opponentRef: B.present && i < B.scores.length ? B.personRef : null,
            scratchScore: A.scores[i],
            entryAverage: A.entryAverage,
            frame: A.frames[i] ?? null,
          });
        }
        if (B.present && i < B.scores.length) {
          rows.push({
            seasonId, weekNumber: week, lanePair,
            personRef: B.personRef,
            opponentRef: A.present && i < A.scores.length ? A.personRef : null,
            scratchScore: B.scores[i],
            entryAverage: B.entryAverage,
            frame: B.frames[i] ?? null,
          });
        }
      }
    }
  }
  return rows;
}

/** Return the ACTUAL person ref for a historical match side — substitute
 *  attribution follows the actual person, falling back to permanent
 *  person id via the participants lookup when available. */
function historicalPersonRef(
  snap: HistoricalSnapshot,
  ref: string,
): string {
  const p = snap.participants.find((pp) => pp.ref === ref);
  return p?.personId ?? ref;
}

/** Build RatingGame rows from a PUBLIC filtered historical snapshot.
 *  Snapshot is already filtered to published weeks by the loader; we
 *  additionally gate on `hasGameData` and `!absent`. FULL_LINESCORE rows
 *  contribute frame stats; GAME_SCORES rows contribute score-only rows;
 *  SUMMARY_ONLY seasons have no matches to iterate. */
export function ratingGamesFromHistoricalSnapshot(snap: HistoricalSnapshot): RatingGame[] {
  const rows: RatingGame[] = [];
  for (const wk of snap.weeks) {
    if (!wk.published) continue;
    for (const m of wk.matches) {
      pushHistoricalSide(rows, snap, m, "A");
      pushHistoricalSide(rows, snap, m, "B");
    }
  }
  return rows;
}

function pushHistoricalSide(
  rows: RatingGame[],
  snap: HistoricalSnapshot,
  m: HistoricalMatch,
  side: "A" | "B",
): void {
  const absent = side === "A" ? m.absentA : m.absentB;
  const has = side === "A" ? m.hasGameDataA : m.hasGameDataB;
  const oppAbsent = side === "A" ? m.absentB : m.absentA;
  const oppHas = side === "A" ? m.hasGameDataB : m.hasGameDataA;
  if (absent || !has) return;
  const games = side === "A" ? m.scratchGamesA : m.scratchGamesB;
  if (!games) return;
  const ls = side === "A" ? m.linescoreA : m.linescoreB;
  const personRef = historicalPersonRef(snap, side === "A" ? m.actualA : m.actualB);
  const opponentRef = (oppAbsent || !oppHas)
    ? null
    : historicalPersonRef(snap, side === "A" ? m.actualB : m.actualA);
  const entryAverage = side === "A" ? m.entryAverageA : m.entryAverageB;
  for (let i = 0; i < 3; i++) {
    if (games[i] == null || games[i] === 0) continue;
    rows.push({
      seasonId: snap.seasonId,
      weekNumber: m.weekNumber,
      lanePair: m.lanePair,
      personRef,
      opponentRef,
      scratchScore: games[i],
      entryAverage: entryAverage || null,
      frame: ls ? frameStatsFromLinescore(ls[i]) : null,
    });
  }
}
