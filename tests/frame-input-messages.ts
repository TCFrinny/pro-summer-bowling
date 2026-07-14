/**
 * Focused tests for the improved linescore validation messages.
 * Ensures messages include cumulative arithmetic and remain strict.
 */

import { buildGameFromInput } from "../src/lib/frame-input";

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error("frame-input message test failed: " + msg);
}

// 1. Open frame that adds 10 pins → helpful message.
{
  // Frames all "-" but frame 3 cumulative jumps by 10 (from 27 to 37).
  const marks = ["-","-","-","-","-","-","-","-","-","-"];
  const cums =  [9,  18, 27, 37, 37, 37, 37, 37, 37, 37]; // cum[2]=27, cum[3]=37 -> diff 10 on frame 4
  // Frames 1..3 opens add 9 each (0..9). Frame 4 open adds 10 → error.
  const r = buildGameFromInput({ marks, cumulatives: cums });
  expect(r.game == null, "should reject a 10-pin open frame");
  const msg = r.errors.find((e) => e.includes("Frame 4"));
  expect(msg && msg.includes("open"), `expected open-frame message, got ${msg}`);
  expect(msg && msg.includes("10 pins"), `expected '10 pins' in message: ${msg}`);
  expect(msg && msg.includes("(37 − 27)"), `expected arithmetic '(37 − 27)': ${msg}`);
  expect(msg && (msg.includes("/") && msg.includes("X")), `expected spare/strike guidance: ${msg}`);
}

// 2. Spare marked as open (contribution 10 in tenth frame) — tenth message.
{
  const marks = ["-","-","-","-","-","-","-","-","-","-"];
  const cums =  [0,  0,  0,  0,  0,  0,  0,  0,  0,  10];
  const r = buildGameFromInput({ marks, cumulatives: cums });
  expect(r.game == null, "should reject tenth open with 10 pins");
  const msg = r.errors.find((e) => e.startsWith("Frame 10"));
  expect(msg && msg.includes("(10 − 0)"), `tenth arithmetic missing: ${msg}`);
}

// 3. Cumulative decreased.
{
  const marks = ["-","-","-","-","-","-","-","-","-","-"];
  const cums =  [5,  4,  4,  4,  4,  4,  4,  4,  4,  4];
  const r = buildGameFromInput({ marks, cumulatives: cums });
  expect(r.game == null, "should reject a cumulative decrease");
  // The generic 'cumulative decreased' error still fires, plus the friendlier
  // per-frame open message. At least one of them must be present.
  expect(r.errors.some((e) => e.includes("decrease") || e.includes("dropped")), "expected decrease msg");
}

// 4. Valid game still parses.
{
  const r = buildGameFromInput({
    marks: ["X","/","-", "-","-","-","-","-","-","-"],
    cumulatives: [20, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  });
  expect(r.game != null, "existing valid game must still pass: " + r.errors.join("; "));
}

// eslint-disable-next-line no-console
console.log("frame-input message tests passed");
