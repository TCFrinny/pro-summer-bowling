/**
 * Frame-by-frame input helpers for the admin linescore editor.
 *
 * Admin input model: for each frame the admin types a compact MARK string and
 * the running CUMULATIVE total. From those two we validate and derive a
 * GameLinescore in the exact result+cumulative-only shape the rest of the
 * app already consumes.
 *
 *  - Frames 1..9: accept "X", "/", "-", or a single digit 0..9 (open pinfall
 *    normalized to "-" on the score sheet — we still record the digit's pin
 *    contribution via the running total).
 *  - Frame 10: accepts richer notation for admin convenience —
 *    "XXX", "XX7", "X9/", "9/X", "9/-", "X", "/", "-", digit+digit, etc.
 *    On save the stored mark is NORMALIZED to one of the seven allowed
 *    display strings from `TENTH_MARK_SET`; the exact pin totals live in
 *    the cumulative column.
 */

import {
  TENTH_MARK_SET,
  classifyFrame,
  isValidRegulationMark,
  summarizeGame,
  type FrameLinescore,
  type GameLinescore,
} from "./duckpin";


export interface ParsedFrame {
  mark: string;
  /** null when the mark alone doesn't imply a fixed pin contribution
   *  (e.g. tenth-frame strikes with bonus balls we can't uniquely infer). */
  impliedContribution: number | null;
  classification: "strike" | "spare" | "open";
}

export interface FrameParseError {
  error: string;
}

/** Normalize whitespace and lowercase-x. */
export function normalizeMarkInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Parse a regulation (frames 1..9) mark.
 * ONLY the league-established saved notation is accepted: X, /, or -.
 * Whitespace is trimmed and lowercase "x" normalized to "X". No digit-
 * based shorthand — the running-total field carries pin information.
 */
export function parseRegulationMark(raw: string): ParsedFrame | FrameParseError {
  const m = normalizeMarkInput(raw);
  if (m === "") return { error: "Empty mark" };
  if (m === "X") return { mark: "X", impliedContribution: null, classification: "strike" };
  if (m === "/") return { mark: "/", impliedContribution: null, classification: "spare" };
  if (m === "-") return { mark: "-", impliedContribution: 0, classification: "open" };
  return { error: `Illegal regulation mark "${raw}" — use X, /, or -` };
}

/**
 * Normalize a tenth-frame admin input into one of the seven allowed
 * saved display strings: XXX, XX, X/, /X, X, /, -. The only
 * transformations applied are whitespace trim and lowercase→uppercase.
 * Digit-based shorthand (e.g. "XX7", "X9/", "9/X") is REJECTED — the
 * running-total field carries pin information, not the mark.
 */
export function normalizeTenthMark(raw: string): string | null {
  const m = normalizeMarkInput(raw);
  if (m === "") return null;
  if (TENTH_MARK_SET.has(m)) return m;
  return null;
}


export interface GameBuildInput {
  /** length 10 — raw mark strings as typed by the admin. */
  marks: string[];
  /** length 10 — running cumulative totals as typed by the admin (numbers). */
  cumulatives: number[];
}

export interface GameBuildResult {
  game: GameLinescore | null;
  errors: string[];
}

/**
 * Build & validate a GameLinescore from admin frame inputs. Never throws —
 * returns a list of user-facing errors when invalid.
 */
export function buildGameFromInput(input: GameBuildInput): GameBuildResult {
  const errors: string[] = [];
  if (input.marks.length !== 10 || input.cumulatives.length !== 10) {
    return { game: null, errors: ["Each game requires 10 frames"] };
  }
  const frames: FrameLinescore[] = [];
  let prev = 0;
  for (let i = 0; i < 10; i++) {
    const frameNumber = i + 1;
    const raw = input.marks[i] ?? "";
    const cum = input.cumulatives[i];
    if (!Number.isFinite(cum) || !Number.isInteger(cum) || cum < 0) {
      errors.push(`Frame ${frameNumber}: cumulative must be a non-negative integer`);
      continue;
    }
    if (cum < prev) {
      errors.push(`Frame ${frameNumber}: cumulative ${cum} decreased from ${prev}`);
    }
    let mark: string | null = null;
    if (frameNumber <= 9) {
      const parsed = parseRegulationMark(raw);
      if ("error" in parsed) {
        errors.push(`Frame ${frameNumber}: ${parsed.error}`);
      } else {
        mark = parsed.mark;
        if (!isValidRegulationMark(mark)) {
          errors.push(`Frame ${frameNumber}: illegal saved mark "${mark}"`);
        }
      }
    } else {
      const normalized = normalizeTenthMark(raw);
      if (!normalized) {
        errors.push(`Frame 10: illegal mark "${raw}"`);
      } else {
        mark = normalized;
      }
    }
    if (mark != null) {
      // Range check on this frame's contribution.
      const diff = cum - prev;
      const cls = classifyFrame(frameNumber, mark);
      // "Contribution" = current running total minus previous running total.
      // Include the arithmetic in every error message so an admin can see
      // exactly which cumulative total or mark they need to fix.
      const arith = `(${cum} − ${prev})`;
      const F = frameNumber === 10 ? "Frame 10" : `Frame ${frameNumber}`;
      if (frameNumber <= 9) {
        if (cls === "open" && (diff < 0 || diff > 9)) {
          if (diff === 10) {
            errors.push(
              `${F} is marked open (${mark}), but it adds 10 pins ${arith}. An open frame must add 0–9. Change the mark to / (spare) or X (strike), or correct the running total.`,
            );
          } else if (diff < 0) {
            errors.push(
              `${F} is marked open (${mark}), but the running total dropped by ${-diff} ${arith}. Running totals must never decrease.`,
            );
          } else {
            errors.push(
              `${F} is marked open (${mark}), but it adds ${diff} pins ${arith}. An open frame must add 0–9. Change the mark or correct the running total.`,
            );
          }
        } else if (cls === "spare" && (diff < 10 || diff > 20)) {
          errors.push(
            `${F} is marked spare (/), but it adds ${diff} pins ${arith}. A spare must add 10–20 (10 pins + the first ball of the next frame). Fix the mark or the running total.`,
          );
        } else if (cls === "strike" && (diff < 10 || diff > 30)) {
          errors.push(
            `${F} is marked strike (X), but it adds ${diff} pins ${arith}. A strike must add 10–30 (10 pins + the next two balls). Fix the mark or the running total.`,
          );
        }
      } else {
        if (cls === "open" && (diff < 0 || diff > 9)) {
          if (diff === 10) {
            errors.push(
              `${F} is marked open (${mark}), but it adds 10 pins ${arith}. An open tenth frame must add 0–9. Change the mark or correct the running total.`,
            );
          } else if (diff < 0) {
            errors.push(
              `${F} is marked open (${mark}), but the running total dropped by ${-diff} ${arith}. Running totals must never decrease.`,
            );
          } else {
            errors.push(
              `${F} is marked open (${mark}), but it adds ${diff} pins ${arith}. An open tenth frame must add 0–9.`,
            );
          }
        } else if (cls !== "open" && (diff < 10 || diff > 30)) {
          errors.push(
            `${F} is marked ${cls} (${mark}), but it adds ${diff} pins ${arith}. A ${cls} tenth frame must add 10–30. Fix the mark or the running total.`,
          );
        }
      }
      frames.push({ frameNumber, mark, cumulativeScore: cum });
    }
    prev = cum;
  }
  if (errors.length > 0 || frames.length !== 10) return { game: null, errors };
  try {
    const game = summarizeGame(frames);
    return { game, errors: [] };
  } catch (e) {
    return { game: null, errors: [(e as Error).message] };
  }
}

// ---------------------------------------------------------------------------
// Deterministic self-tests — run at module load so a break fails the build.
// ---------------------------------------------------------------------------

(function selfTest() {
  // Regulation marks: only X / - are accepted; digits and shorthand rejected.
  const dash = parseRegulationMark("-");
  if ("error" in dash || dash.mark !== "-") {
    throw new Error("frame-input: '-' should parse as open");
  }
  const lowerX = parseRegulationMark("x");
  if ("error" in lowerX || lowerX.mark !== "X") {
    throw new Error("frame-input: lowercase 'x' should normalize to 'X'");
  }
  const digit = parseRegulationMark("7");
  if (!("error" in digit)) {
    throw new Error("frame-input: digit '7' must be rejected in regulation frames");
  }
  const spareShort = parseRegulationMark("9/");
  if (!("error" in spareShort)) {
    throw new Error("frame-input: '9/' must be rejected — use '/' with running total");
  }
  // Tenth normalization fixtures — accept only the seven allowed strings
  // (plus whitespace / lowercase-x normalization). Reject digit shorthand.
  const fixtures: Array<[string, string | null]> = [
    ["X", "X"], ["XXX", "XXX"], ["XX", "XX"], ["X/", "X/"], ["/X", "/X"],
    ["/", "/"], ["-", "-"],
    ["x", "X"], [" xxx ", "XXX"], ["  x/  ", "X/"],
    // Digit / ball-level shorthand — MUST all be rejected.
    ["XX7", null], ["X9/", null], ["9/X", null], ["9/-", null], ["9/7", null],
    ["8-", null], ["-8", null], ["--", null], ["/-", null],
    ["72", null], ["99", null], ["ZZ", null],
  ];
  for (const [input, expected] of fixtures) {
    const got = normalizeTenthMark(input);
    if (got !== expected) {
      throw new Error(`frame-input: normalizeTenthMark("${input}") -> ${got}, expected ${expected}`);
    }
  }
  // End-to-end cumulative validation still works using only X / - marks.
  const gb = buildGameFromInput({
    marks: ["X","/","-", "-","-","-","-","-","-","-"],
    cumulatives: [20, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  });
  if (gb.game == null) {
    throw new Error("frame-input: expected valid game, got errors: " + gb.errors.join("; "));
  }
  // Frame-10 XXX totals 30 in a solo game.
  const gb10 = buildGameFromInput({
    marks: ["-","-","-","-","-","-","-","-","-","XXX"],
    cumulatives: [0,0,0,0,0,0,0,0,0,30],
  });
  if (gb10.game == null) {
    throw new Error("frame-input: XXX tenth broken: " + gb10.errors.join("; "));
  }
  // Frame-10 with a fill ball worth 7 pins is saved as "XX" — running total
  // 27 carries the pin information; the mark stays in the allowed set.
  const gbFill = buildGameFromInput({
    marks: ["-","-","-","-","-","-","-","-","-","XX"],
    cumulatives: [0,0,0,0,0,0,0,0,0,27],
  });
  if (gbFill.game == null) {
    throw new Error("frame-input: XX+7 fill via cumulative broken: " + gbFill.errors.join("; "));
  }
})();

