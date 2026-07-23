/**
 * Duckpin frame-level linescore model — RESULT + CUMULATIVE ONLY.
 *
 * A saved linescore contains NO individual ball information. Each frame stores
 * only the score-sheet mark (X / spare "/" / open "-") and the running
 * cumulative scratch total through that frame. This mirrors what an admin will
 * actually type in: 10 marks and 10 cumulative totals per game.
 *
 * Frame classification (used for `opens` counting and openPinsLeft):
 *   frames 1–9 : mark === "X" → strike, "/" → spare, "-" → open
 *   frame 10   : classify by the INITIAL mark character. The tenth is still
 *                exactly ONE regulation frame; it contributes at most one to
 *                the frame-classification totals (strikeFrames / spareFrames /
 *                opens) and to the frame denominator.
 *
 * Symbol-level counting (used for `strikes`, `spares`, `marks`, `clutchMarks`):
 *   Every "X" and "/" symbol in a frame's mark string counts. Tenth-frame
 *   bonus balls therefore inflate strike / spare / total-mark counts. For
 *   example: "X/" = 1 strike + 1 spare (2 marks); "XX" = 2 strikes; "XXX"
 *   = 3 strikes; "/X" = 1 strike + 1 spare. Frames 1–9 always contribute at
 *   most one symbol per frame by construction.
 *
 * Pins Lost (no ball data required):
 *   Duckpin bowlers get THREE balls per frame. An OPEN frame is any frame
 *   without a strike or spare; its pinfall is 0..10 (a 10-pin open occurs
 *   when the rack is cleared on the third ball — still no bonus).
 *   openPinfall = cumulativeScore[i] - cumulativeScore[i-1]
 *   (frame 1 uses cumulativeScore[0] - 0). openPinsStanding = max(0, 10 - openPinfall).
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
   * `classifyFrame` uses only the LEADING character (each frame is a
   * single regulation frame); `countFrameMarks` counts EVERY "X" and "/"
   * symbol so tenth-frame bonuses correctly inflate strike / spare /
   * mark totals.
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
  /**
   * Total marks (strikes + spares) counted symbol-by-symbol in frames
   * 9 and 10. A tenth of "XXX" contributes 3; "X/" contributes 2.
   */
  clutchMarks: number;
}

export interface GameLinescore {
  frames: FrameLinescore[]; // length 10
  scratchTotal: number;
  /**
   * Symbol counts (see file header). Every "X" and "/" in every frame's
   * mark string is counted, so tenth-frame bonus marks contribute here.
   */
  strikes: number;
  spares: number;
  opens: number; // frame classification (still per-frame; sum of strike-frames + spare-frames + opens === 10)
  marks: number; // strikes + spares (symbol-level total)
  /** Sum(10 - openPinfall) over open frames — derived from cumulative diffs. */
  openPinsLeft: number;
  segments: GameSegments;
}

// ---------------------------------------------------------------------------
// Classification (per frame — leading-character only, always <=1 mark).
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
// Symbol counting (per frame — counts every "X" and "/" in the mark string).
// Frames 1–9 always have at most one symbol; the tenth may carry up to 3.
// ---------------------------------------------------------------------------

export function countFrameMarks(
  frameNumber: number,
  mark: string,
): { strikes: number; spares: number } {
  if (frameNumber >= 1 && frameNumber <= 9) {
    if (mark === "X") return { strikes: 1, spares: 0 };
    if (mark === "/") return { strikes: 0, spares: 1 };
    return { strikes: 0, spares: 0 };
  }
  let s = 0, p = 0;
  for (let i = 0; i < mark.length; i++) {
    const ch = mark.charAt(i);
    if (ch === "X") s++;
    else if (ch === "/") p++;
  }
  return { strikes: s, spares: p };
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
    const { strikes: fs, spares: fp } = countFrameMarks(f.frameNumber, f.mark);
    strikes += fs;
    spares += fp;
    if (cls === "open") {
      opens++;
      const prev = i === 0 ? 0 : frames[i - 1].cumulativeScore;
      const diff = f.cumulativeScore - prev;
      openPinsLeft += Math.max(0, 10 - diff);
    }
    // Clutch marks: every "X" and "/" symbol in frames 9 and 10 counts,
    // so a tenth of "XXX" contributes 3 clutch marks. Clutch OPPORTUNITY
    // denominators (2 per completed game) are managed by the aggregators
    // that consume this value and are intentionally unchanged.
    if (i === 8 || i === 9) clutch += fs + fp;
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
  let strikeFrames = 0, spareFrames = 0;
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
    if (cls === "strike") strikeFrames++;
    else if (cls === "spare") spareFrames++;
    else opens++;
    const { strikes: fs, spares: fp } = countFrameMarks(f.frameNumber, f.mark);
    strikes += fs;
    spares += fp;
    const diff = f.cumulativeScore - prev;
    if (i < 9) {
      if (cls === "open") {
        // Duckpin: three balls per frame, an open frame may total 0..10.
        check(diff >= 0 && diff <= 10,
          `frame ${i + 1} open contribution ${diff} outside 0..10`);
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
        // Tenth-frame open still gets three balls; 0..10 allowed, no bonus.
        check(diff >= 0 && diff <= 10,
          `frame 10 open contribution ${diff} outside 0..10`);
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
  check(strikeFrames + spareFrames + opens === 10,
    `frame classifications must total 10`);
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
    // Duckpin open tenth: three balls, may total 0..10 (10-pin open is legal).
    return { mark: "-", contribution: pickInRange(0, 10, rand, skill) };
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
    if (cls === "open") contribution = pickInRange(0, 10, rand, skill);
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
