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
  isValidTenthMark,
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
 * Accepts: X, /, -, or a single digit 0..9 (treated as open with that pinfall).
 */
export function parseRegulationMark(raw: string): ParsedFrame | FrameParseError {
  const m = normalizeMarkInput(raw);
  if (m === "") return { error: "Empty mark" };
  if (m === "X") return { mark: "X", impliedContribution: null, classification: "strike" };
  if (m === "/") return { mark: "/", impliedContribution: null, classification: "spare" };
  if (m === "-") return { mark: "-", impliedContribution: 0, classification: "open" };
  if (/^[0-9]$/.test(m)) {
    // Numeric digit shorthand for an open frame.
    return { mark: "-", impliedContribution: Number(m), classification: "open" };
  }
  // Two-digit open like "72" (7 + 2 pins) => open with 9 pins.
  if (/^[0-9][0-9]$/.test(m)) {
    const a = Number(m[0]);
    const b = Number(m[1]);
    if (a + b > 9) return { error: `Two-ball open cannot exceed 9 pins ("${raw}")` };
    return { mark: "-", impliedContribution: a + b, classification: "open" };
  }
  // "N/" spare notation shorthand.
  if (/^[0-9]\/$/.test(m)) return { mark: "/", impliedContribution: 10, classification: "spare" };
  return { error: `Illegal regulation mark "${raw}"` };
}

/**
 * Normalize a tenth-frame admin input into one of the seven allowed
 * saved display strings. Returns null when the input is not interpretable.
 */
export function normalizeTenthMark(raw: string): string | null {
  const m = normalizeMarkInput(raw);
  if (m === "") return null;
  if (TENTH_MARK_SET.has(m)) return m;
  // Common shorthand → normalize.
  //  X + digit + digit   -> "XX" (bonus pins recorded via cumulative)
  //  X + digit + "/"     -> "X/"
  //  digit + "/" + X     -> "/X"
  //  digit + "/" + digit -> "/"
  //  digit + "-"         -> "-"
  //  X + X + digit       -> "XX"
  //  X + X + "-"         -> "XX"
  //  digit + digit       -> "-"
  //  X + digit           -> "X"
  //  digit + "/"         -> "/"
  if (/^X[0-9][0-9]$/.test(m)) return "XX";
  if (/^X[0-9]\/$/.test(m)) return "X/";
  if (/^[0-9]\/X$/.test(m)) return "/X";
  if (/^[0-9]\/[0-9-]$/.test(m)) return "/";
  if (/^XX[0-9]$/.test(m)) return "XX";
  if (/^XX-$/.test(m)) return "XX";
  if (/^X-[0-9]$/.test(m)) return "X";
  if (/^X-$/.test(m)) return "X";
  if (/^X-\/$/.test(m)) return "X/";
  if (/^[0-9][0-9]$/.test(m)) {
    const a = Number(m[0]); const b = Number(m[1]);
    if (a + b > 9) return null;
    return "-";
  }
  if (/^[0-9]-$/.test(m)) return "-";
  if (/^-[0-9]$/.test(m)) return "-";
  if (/^X[0-9]$/.test(m)) return "X";
  if (/^[0-9]\/$/.test(m)) return "/";
  if (/^[0-9]$/.test(m)) return "-";
  if (isValidTenthMark(m)) return m;
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
      if (frameNumber <= 9) {
        if (cls === "open" && (diff < 0 || diff > 9))
          errors.push(`Frame ${frameNumber}: open contribution ${diff} outside 0..9`);
        else if (cls === "spare" && (diff < 10 || diff > 20))
          errors.push(`Frame ${frameNumber}: spare contribution ${diff} outside 10..20`);
        else if (cls === "strike" && (diff < 10 || diff > 30))
          errors.push(`Frame ${frameNumber}: strike contribution ${diff} outside 10..30`);
      } else {
        if (cls === "open" && (diff < 0 || diff > 9))
          errors.push(`Frame 10: open contribution ${diff} outside 0..9`);
        else if (cls !== "open" && (diff < 10 || diff > 30))
          errors.push(`Frame 10: ${cls} contribution ${diff} outside 10..30`);
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
  // Regulation shorthand.
  const digit = parseRegulationMark("7");
  if ("error" in digit || digit.mark !== "-" || digit.impliedContribution !== 7) {
    throw new Error("frame-input: regulation digit shorthand broken");
  }
  // Tenth normalization fixtures.
  const fixtures: Array<[string, string | null]> = [
    ["X", "X"], ["XXX", "XXX"], ["XX7", "XX"], ["X9/", "X/"], ["9/X", "/X"],
    ["9/-", "/"], ["9/7", "/"], ["x", "X"], [" xxx ", "XXX"], ["/-", null],
    ["--", "-"], ["8-", "-"], ["-8", "-"], ["ZZ", null], ["99", null], ["72", "-"],
  ];
  for (const [input, expected] of fixtures) {
    const got = normalizeTenthMark(input);
    if (got !== expected) {
      throw new Error(`frame-input: normalizeTenthMark("${input}") -> ${got}, expected ${expected}`);
    }
  }
  // End-to-end: three frames, striker → spare → open (12+16+6 = 34).
  //   f1 strike, ball1 f2 = 6 pins, ball2 spare (=10). f1 = 10 + 6 + spare's completion? For a spare we can't infer strike bonus fully;
  // We just verify cumulative flow when marks match contributions the admin types.
  const gb = buildGameFromInput({
    marks: ["X","/","-", "-","-","-","-","-","-","-"],
    cumulatives: [20, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  });
  if (gb.game == null) {
    throw new Error("frame-input: expected valid game, got errors: " + gb.errors.join("; "));
  }
  // Frame-10 example: XXX totals 30 in a solo game.
  const gb10 = buildGameFromInput({
    marks: ["-","-","-","-","-","-","-","-","-","XXX"],
    cumulatives: [0,0,0,0,0,0,0,0,0,30],
  });
  if (gb10.game == null) {
    throw new Error("frame-input: XXX tenth broken: " + gb10.errors.join("; "));
  }
})();
