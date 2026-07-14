/**
 * Duckpin frame-level linescore model — RESULT + CUMULATIVE ONLY.
 *
 * A saved linescore contains NO individual ball information. Each frame stores
 * only the score-sheet mark (X / spare "/" / open "-") and the running
 * cumulative scratch total through that frame. This mirrors what an admin will
 * actually type in: 10 marks and 10 cumulative totals per game.
 *
 * Classification (used for strikes/spares/opens counts and derived %):
 *   frames 1–9 : mark === "X" → strike, "/" → spare, "-" → open
 *   frame 10   : classify by the INITIAL mark character. Bonus marks in the
 *                10th are display notation only — they never inflate frame,
 *                strike, spare, or denominator counts.
 *
 * Pins Lost (no ball data required):
 *   For an open frame, openPinfall = cumulativeScore[i] - cumulativeScore[i-1]
 *   (frame 1 uses cumulativeScore[0] - 0). openPinsStanding = 10 - openPinfall.
 *   Pins Lost metric = sum(openPinsStanding) / (# open frames).
 */

export interface FrameLinescore {
  /** 1..10 */
  frameNumber: number;
  /**
   * Score-sheet mark string. NO individual ball counts are stored.
   *   frames 1–9 : "X" | "/" | "-"
   *   frame 10   : one of the seven allowed saved combos —
   *                "XXX" | "XX" | "X/" | "/X" | "X" | "/" | "-"
   * Only the LEADING character is used to classify the tenth as one
   * regulation strike / spare / open frame (max one mark).
   */
  mark: string;
  /** Running cumulative scratch total through this frame. Non-negative, non-decreasing. */
  cumulativeScore: number;
}

export type FrameClass = "strike" | "spare" | "open";

export interface GameSegments {
  /** Cumulative score after frame 5. */
  first5: number;
  /** Final score minus cumulative through frame 5. */
  last5: number;
  /** Cumulative score after frame 3. */
  bigOpening: number;
  /** Final score minus cumulative through frame 7. */
  bigFinish: number;
  /** Marked (strike or spare) regulation frames among frames 9 and 10. */
  clutchMarks: number;
}

export interface GameLinescore {
  frames: FrameLinescore[]; // length 10
  scratchTotal: number;
  strikes: number;
  spares: number;
  opens: number;
  marks: number;
  /** Sum(10 - openPinfall) over open frames — derived from cumulative diffs. */
  openPinsLeft: number;
  segments: GameSegments;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyFrame(frameNumber: number, mark: string): FrameClass {
  const first = mark.charAt(0);
  if (first === "X") return "strike";
  if (first === "/") return "spare";
  if (frameNumber >= 1 && frameNumber <= 9) {
    if (mark === "/") return "spare";
    return "open";
  }
  return "open";
}

// ---------------------------------------------------------------------------
// Mark notation validators
// ---------------------------------------------------------------------------

const REG_MARK = /^(X|\/|-)$/; // frames 1..9
/** Exact allowed set of saved tenth-frame result strings. */
export const TENTH_MARK_SET: ReadonlySet<string> = new Set([
  "XXX",
  "XX",
  "X/",
  "/X",
  "X",
  "/",
  "-",
]);

export function isValidRegulationMark(mark: string): boolean {
  return REG_MARK.test(mark);
}
export function isValidTenthMark(mark: string): boolean {
  return TENTH_MARK_SET.has(mark);
}

// ---------------------------------------------------------------------------
// Derive segments / counts from frames.
// ---------------------------------------------------------------------------

export function summarizeGame(frames: FrameLinescore[]): GameLinescore {
  if (frames.length !== 10) throw new Error("game must have 10 frames");
  let strikes = 0, spares = 0, opens = 0, openPinsLeft = 0, clutch = 0;
  for (let i = 0; i < 10; i++) {
    const f = frames[i];
    const cls = classifyFrame(f.frameNumber, f.mark);
    if (cls === "strike") strikes++;
    else if (cls === "spare") spares++;
    else {
      opens++;
      const prev = i === 0 ? 0 : frames[i - 1].cumulativeScore;
      const diff = f.cumulativeScore - prev;
      openPinsLeft += Math.max(0, 10 - diff);
    }
    if ((i === 8 || i === 9) && cls !== "open") clutch++;
  }
  const final = frames[9].cumulativeScore;
  const cum5 = frames[4].cumulativeScore;
  const cum3 = frames[2].cumulativeScore;
  const cum7 = frames[6].cumulativeScore;
  return {
    frames,
    scratchTotal: final,
    strikes, spares, opens,
    marks: strikes + spares,
    openPinsLeft,
    segments: {
      first5: cum5,
      last5: final - cum5,
      bigOpening: cum3,
      bigFinish: final - cum7,
      clutchMarks: clutch,
    },
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateGame(g: GameLinescore, ctx: string): void {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`[${ctx}] ${msg}`);
  };
  check(g.frames.length === 10, `expected 10 frames, got ${g.frames.length}`);
  let prev = 0;
  let strikes = 0, spares = 0, opens = 0;
  for (let i = 0; i < 10; i++) {
    const f = g.frames[i];
    check(f.frameNumber === i + 1, `frame ${i + 1} numbered ${f.frameNumber}`);
    check(Number.isInteger(f.cumulativeScore) && f.cumulativeScore >= 0,
      `frame ${i + 1}: cumulative must be a non-negative integer`);
    check(f.cumulativeScore >= prev,
      `frame ${i + 1}: cumulative not monotonic (${prev} → ${f.cumulativeScore})`);
    if (i < 9) {
      check(isValidRegulationMark(f.mark),
        `frame ${i + 1}: illegal regulation mark "${f.mark}"`);
    } else {
      check(isValidTenthMark(f.mark),
        `frame 10: illegal mark "${f.mark}"`);
    }
    const cls = classifyFrame(f.frameNumber, f.mark);
    if (cls === "strike") strikes++;
    else if (cls === "spare") spares++;
    else opens++;
    const diff = f.cumulativeScore - prev;
    if (i < 9) {
      if (cls === "open") {
        check(diff >= 0 && diff <= 9,
          `frame ${i + 1} open contribution ${diff} outside 0..9`);
      } else if (cls === "spare") {
        check(diff >= 10 && diff <= 20,
          `frame ${i + 1} spare contribution ${diff} outside 10..20`);
      } else {
        check(diff >= 10 && diff <= 30,
          `frame ${i + 1} strike contribution ${diff} outside 10..30`);
      }
    } else {
      // frame 10 contribution includes any bonus balls.
      if (cls === "open") {
        check(diff >= 0 && diff <= 9,
          `frame 10 open contribution ${diff} outside 0..9`);
      } else {
        check(diff >= 10 && diff <= 30,
          `frame 10 ${cls} contribution ${diff} outside 10..30`);
      }
    }
    prev = f.cumulativeScore;
  }
  check(g.frames[9].cumulativeScore === g.scratchTotal,
    `final cumulative ≠ scratchTotal`);
  check(strikes === g.strikes, `strike count mismatch`);
  check(spares === g.spares, `spare count mismatch`);
  check(opens === g.opens, `open count mismatch`);
  check(strikes + spares + opens === 10, `classifications must total 10`);
  // Segment reconciliation.
  const s = g.segments;
  check(s.first5 + s.last5 === g.scratchTotal,
    `First5 + Last5 ≠ final (${s.first5}+${s.last5}≠${g.scratchTotal})`);
  check(s.bigOpening === g.frames[2].cumulativeScore,
    `BigOpening ≠ cumulative after frame 3`);
  check(s.bigFinish === g.scratchTotal - g.frames[6].cumulativeScore,
    `BigFinish ≠ final - cumulative after frame 7`);
}

// ---------------------------------------------------------------------------
// Population standard deviation (used for consistency metric).
// ---------------------------------------------------------------------------

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / xs.length;
  return Math.sqrt(v);
}

// ---------------------------------------------------------------------------
// Private mock generator.
// Produces internally consistent marks + cumulative totals. Does NOT emit or
// depend on ball-level data. Skill in [0..1] shapes distribution.
// ---------------------------------------------------------------------------

function pickInRange(lo: number, hi: number, rand: () => number, skill: number): number {
  const mean = lo + (hi - lo) * (0.35 + skill * 0.5);
  const noise = (rand() - 0.5) * (hi - lo) * 0.7;
  let v = Math.round(mean + noise);
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return v;
}

function pickMarkClass(rand: () => number, skill: number): FrameClass {
  const strikeP = 0.05 + skill * 0.18;
  const spareP = 0.20 + skill * 0.25;
  const r = rand();
  if (r < strikeP) return "strike";
  if (r < strikeP + spareP) return "spare";
  return "open";
}

function generateTenth(
  rand: () => number,
  skill: number,
): { mark: string; contribution: number } {
  const first = pickMarkClass(rand, skill);
  if (first === "open") {
    return { mark: "-", contribution: pickInRange(0, 9, rand, skill) };
  }
  if (first === "spare") {
    // bonus ball on fresh rack: strike → "/X", otherwise "/"
    if (rand() < 0.2 + skill * 0.25) return { mark: "/X", contribution: 20 };
    return { mark: "/", contribution: 10 + pickInRange(0, 9, rand, skill) };
  }
  // strike
  const b1 = pickMarkClass(rand, skill);
  if (b1 === "strike") {
    const b2 = pickMarkClass(rand, skill);
    if (b2 === "strike") return { mark: "XXX", contribution: 30 };
    return { mark: "XX", contribution: 20 + pickInRange(0, 9, rand, skill) };
  }
  // 1st bonus not a strike: 2nd bonus may complete a spare
  if (rand() < 0.3 + skill * 0.3) return { mark: "X/", contribution: 20 };
  return { mark: "X", contribution: 10 + pickInRange(0, 9, rand, skill) };
}

export function rollMockGame(rand: () => number, skill: number): GameLinescore {
  const frames: FrameLinescore[] = [];
  let cum = 0;

  // Frames 1..9
  for (let i = 1; i <= 9; i++) {
    const cls = pickMarkClass(rand, skill);
    const mark = cls === "strike" ? "X" : cls === "spare" ? "/" : "-";
    let contribution: number;
    if (cls === "open") contribution = pickInRange(0, 9, rand, skill);
    else if (cls === "spare") contribution = pickInRange(10, 20, rand, skill);
    else contribution = pickInRange(10, 30, rand, skill);
    cum += contribution;
    frames.push({ frameNumber: i, mark, cumulativeScore: cum });
  }
  // Frame 10
  const tenth = generateTenth(rand, skill);
  cum += tenth.contribution;
  frames.push({ frameNumber: 10, mark: tenth.mark, cumulativeScore: cum });

  return summarizeGame(frames);
}
