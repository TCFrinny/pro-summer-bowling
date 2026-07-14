/**
 * Focused tests for the improved linescore validation messages and
 * duckpin open-frame rules (three balls per frame; 10-pin open is legal).
 */

import { buildGameFromInput } from "../src/lib/frame-input";
import { summarizeGame, type FrameLinescore } from "../src/lib/duckpin";

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error("frame-input message test failed: " + msg);
}

// 1. Regulation open frame adding 10 pins is ACCEPTED and stays open.
{
  const marks = ["-","-","-","-","-","-","-","-","-","-"];
  //             frame 4 open adds 10 (37-27) — legal duckpin open.
  const cums =  [9,  18, 27, 37, 46, 55, 64, 73, 82, 91];
  const r = buildGameFromInput({ marks, cumulatives: cums });
  expect(r.game != null, "10-pin regulation open must be accepted: " + r.errors.join("; "));
  expect(r.game!.opens === 10, `all frames still classified open, got opens=${r.game!.opens}`);
  expect(r.game!.strikes === 0 && r.game!.spares === 0, "no strike/spare inferred");
  // openPinsLeft: frame 4 contributes 0; others contribute (10 - diff).
  // diffs: 9,9,9,10,9,9,9,9,9,9  → left: 1+1+1+0+1+1+1+1+1+1 = 9
  expect(r.game!.openPinsLeft === 9, `openPinsLeft=${r.game!.openPinsLeft}, expected 9`);
}

// 2. Tenth-frame open adding 10 pins is ACCEPTED and stays open.
{
  const marks = ["-","-","-","-","-","-","-","-","-","-"];
  const cums =  [0,  0,  0,  0,  0,  0,  0,  0,  0,  10];
  const r = buildGameFromInput({ marks, cumulatives: cums });
  expect(r.game != null, "10-pin tenth open must be accepted: " + r.errors.join("; "));
  expect(r.game!.opens === 10, "tenth still open");
  expect(r.game!.frames[9].mark === "-", "tenth mark stays '-'");
  expect(r.game!.scratchTotal === 10, `scratch=${r.game!.scratchTotal}`);
}

// 3. Regulation open frame adding 11 is REJECTED with arithmetic + 0–10 guidance.
{
  const marks = ["-","-","-","-","-","-","-","-","-","-"];
  const cums =  [0,  0,  11, 11, 11, 11, 11, 11, 11, 11];
  const r = buildGameFromInput({ marks, cumulatives: cums });
  expect(r.game == null, "11-pin open must be rejected");
  const msg = r.errors.find((e) => e.includes("Frame 3"));
  expect(!!msg, `expected Frame 3 error, got: ${r.errors.join(" | ")}`);
  expect(msg!.includes("11 pins"), `expected '11 pins' in message: ${msg}`);
  expect(msg!.includes("(11 − 0)"), `expected arithmetic '(11 − 0)': ${msg}`);
  expect(msg!.includes("0–10"), `expected '0–10' guidance: ${msg}`);
}

// 4. Tenth-frame open adding 11 is REJECTED with arithmetic + 0–10 guidance.
{
  const marks = ["-","-","-","-","-","-","-","-","-","-"];
  const cums =  [0,  0,  0,  0,  0,  0,  0,  0,  0,  11];
  const r = buildGameFromInput({ marks, cumulatives: cums });
  expect(r.game == null, "11-pin tenth open must be rejected");
  const msg = r.errors.find((e) => e.startsWith("Frame 10"));
  expect(!!msg, `expected Frame 10 error: ${r.errors.join(" | ")}`);
  expect(msg!.includes("(11 − 0)"), `tenth arithmetic missing: ${msg}`);
  expect(msg!.includes("0–10"), `expected '0–10' guidance: ${msg}`);
}

// 5. A 10-pin open contributes zero to openPinsLeft (via summarizeGame direct).
{
  const frames: FrameLinescore[] = [];
  for (let i = 1; i <= 9; i++) frames.push({ frameNumber: i, mark: "-", cumulativeScore: 0 });
  frames.push({ frameNumber: 10, mark: "-", cumulativeScore: 10 });
  const g = summarizeGame(frames);
  expect(g.opens === 10, `expected 10 opens, got ${g.opens}`);
  // frames 1..9 contribute (10 - 0) = 10 each → 90; frame 10 contributes 0.
  expect(g.openPinsLeft === 90, `openPinsLeft=${g.openPinsLeft}, expected 90 (tenth adds 0)`);
}

// 6. Cumulative decreased still errors.
{
  const marks = ["-","-","-","-","-","-","-","-","-","-"];
  const cums =  [5,  4,  4,  4,  4,  4,  4,  4,  4,  4];
  const r = buildGameFromInput({ marks, cumulatives: cums });
  expect(r.game == null, "should reject a cumulative decrease");
  expect(r.errors.some((e) => e.includes("decrease") || e.includes("dropped")), "expected decrease msg");
}

// 7. Existing valid strike/spare game still passes.
{
  const r = buildGameFromInput({
    marks: ["X","/","-", "-","-","-","-","-","-","-"],
    cumulatives: [20, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  });
  expect(r.game != null, "existing valid game must still pass: " + r.errors.join("; "));
}

// 8. Tenth-frame XXX still passes (strike-family unchanged).
{
  const r = buildGameFromInput({
    marks: ["-","-","-","-","-","-","-","-","-","XXX"],
    cumulatives: [0,0,0,0,0,0,0,0,0,30],
  });
  expect(r.game != null, "XXX tenth still valid: " + r.errors.join("; "));
}

// eslint-disable-next-line no-console
console.log("frame-input message tests passed");
