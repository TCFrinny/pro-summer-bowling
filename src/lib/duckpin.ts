/**
 * Duckpin frame-level scoring engine.
 *
 * Frames 1–9 allow up to three balls; the frame ends early on a strike (first
 * ball knocks all 10) or spare (first two balls total 10). Frame 10 allows
 * bonus deliveries: strike → 2 bonus balls (re-rack after each strike);
 * spare → 1 bonus ball; otherwise up to a third ball on the remaining pins.
 *
 * Scoring bonuses:
 *   - strike (frames 1–9): + next 2 delivered balls
 *   - spare  (frames 1–9): + next 1 delivered ball
 *   - open   (frames 1–9): frame pinfall only
 *   - frame 10: no forward bonus; framePinfall already includes bonus balls.
 *
 * Every frame is classified as exactly one of {strike, spare, open} using its
 * INITIAL mark (frame 10 is classified by ball 1 / ball 1+2 as well; bonus
 * marks in the tenth are notated but never inflate the frame denominator).
 */

/** A single ball's pin count (0..10). */
export type Roll = number;

export interface Frame {
  /** 1..10 */
  frameNumber: number;
  /** Pins per delivered ball. Length 1..3 (up to 3 in frame 10 as well). */
  rolls: Roll[];
  /** Per-ball display glyph ("X", "/", "-", or digit string). */
  ballDisplay: string[];
  isStrike: boolean;
  isSpare: boolean;
  isOpen: boolean;
  /** Sum of rolls in this frame (bonus NOT included). */
  framePinfall: number;
  /** Bonus applied to this frame from later balls (0 in frame 10). */
  bonus: number;
  /** Running cumulative scratch score through this frame. */
  cumulative: number;
}

export interface GameLinescore {
  frames: Frame[]; // length 10
  scratchTotal: number;
  /** Regulation-frame strikes (frame's initial mark). Bonus strikes in the 10th are NOT counted. */
  strikes: number;
  spares: number;
  opens: number;
  /** Pins left on open frames: sum(10 - framePinfall) over open frames. */
  openPinsLeft: number;
  marks: number; // strikes + spares
}

// ---------------------------------------------------------------------------
// Deterministic frame generator (mock data).
// ---------------------------------------------------------------------------

function pickBall(
  remaining: number,
  skill: number,
  rand: () => number,
): number {
  if (remaining <= 0) return 0;
  // Target mean fraction of remaining pins, biased by skill.
  const target = 0.55 + skill * 0.32; // ~0.55..0.87
  const noise = (rand() - 0.5) * 0.55;
  const frac = Math.min(1, Math.max(0, target + noise));
  return Math.round(remaining * frac);
}

function tryStrike(skill: number, rand: () => number): boolean {
  // Occasional strike bonus outside the normal distribution.
  return rand() < 0.04 + skill * 0.08;
}

function ballGlyph(pins: number, isFirstOfFrame: boolean, previousInFrame: number): string {
  if (pins === 10 && isFirstOfFrame) return "X";
  if (!isFirstOfFrame && previousInFrame + pins === 10 && previousInFrame < 10)
    return "/";
  if (pins === 0) return "-";
  return String(pins);
}

/** Produce a fresh Frame from a list of rolls. Does not fill cumulative/bonus. */
function frameFromRolls(frameNumber: number, rolls: number[]): Frame {
  const isTenth = frameNumber === 10;
  const isStrike = rolls[0] === 10;
  const isSpare =
    !isStrike && rolls.length >= 2 && rolls[0] + rolls[1] === 10;
  const isOpen = !isStrike && !isSpare;
  const ballDisplay: string[] = [];
  if (isTenth) {
    // 10th frame: independent racks after strike/spare on bonus balls.
    for (let i = 0; i < rolls.length; i++) {
      const p = rolls[i];
      if (i === 0) {
        ballDisplay.push(p === 10 ? "X" : p === 0 ? "-" : String(p));
      } else if (i === 1) {
        if (rolls[0] === 10) {
          // First bonus after strike: fresh rack.
          ballDisplay.push(p === 10 ? "X" : p === 0 ? "-" : String(p));
        } else {
          // Second ball of open/spare pair.
          ballDisplay.push(
            rolls[0] + p === 10 ? "/" : p === 0 ? "-" : String(p),
          );
        }
      } else {
        // 3rd ball.
        if (rolls[0] === 10) {
          // We're in the bonus-after-strike sequence.
          if (rolls[1] === 10) {
            // Second bonus after strike + strike: fresh rack.
            ballDisplay.push(p === 10 ? "X" : p === 0 ? "-" : String(p));
          } else {
            // Second bonus completes a pair of pins.
            ballDisplay.push(
              rolls[1] + p === 10 ? "/" : p === 0 ? "-" : String(p),
            );
          }
        } else if (rolls[0] + rolls[1] === 10) {
          // Bonus after spare: fresh rack.
          ballDisplay.push(p === 10 ? "X" : p === 0 ? "-" : String(p));
        } else {
          // Open frame's third ball.
          ballDisplay.push(p === 0 ? "-" : String(p));
        }
      }
    }
  } else {
    for (let i = 0; i < rolls.length; i++) {
      ballDisplay.push(ballGlyph(rolls[i], i === 0, rolls[i - 1] ?? 0));
    }
  }
  return {
    frameNumber,
    rolls: [...rolls],
    ballDisplay,
    isStrike,
    isSpare,
    isOpen,
    framePinfall: rolls.reduce((s, x) => s + x, 0),
    bonus: 0,
    cumulative: 0,
  };
}

/** Generate a legal duckpin game deterministically from `rand`. */
export function rollDuckpinGame(
  rand: () => number,
  skill: number,
): GameLinescore {
  const frames: Frame[] = [];

  for (let f = 1; f <= 9; f++) {
    const rolls: number[] = [];
    let remaining = 10;
    const b1 = tryStrike(skill, rand) ? 10 : pickBall(remaining, skill, rand);
    rolls.push(b1);
    remaining -= b1;
    if (b1 !== 10) {
      const b2 = pickBall(remaining, skill, rand);
      rolls.push(b2);
      remaining -= b2;
      if (b1 + b2 < 10) {
        const b3 = pickBall(remaining, skill, rand);
        rolls.push(b3);
      }
    }
    frames.push(frameFromRolls(f, rolls));
  }

  // Frame 10
  const rolls10: number[] = [];
  const first = tryStrike(skill, rand) ? 10 : pickBall(10, skill, rand);
  rolls10.push(first);
  if (first === 10) {
    // strike → 2 bonus balls, fresh rack semantics
    const bonus1 = tryStrike(skill, rand) ? 10 : pickBall(10, skill, rand);
    rolls10.push(bonus1);
    if (bonus1 === 10) {
      const bonus2 = tryStrike(skill, rand) ? 10 : pickBall(10, skill, rand);
      rolls10.push(bonus2);
    } else {
      const bonus2 = pickBall(10 - bonus1, skill, rand);
      rolls10.push(bonus2);
    }
  } else {
    const second = pickBall(10 - first, skill, rand);
    rolls10.push(second);
    if (first + second === 10) {
      // spare → 1 bonus ball on fresh rack
      const bonus = tryStrike(skill, rand) ? 10 : pickBall(10, skill, rand);
      rolls10.push(bonus);
    } else if (first + second < 10) {
      // duckpin open third ball on remaining pins
      const third = pickBall(10 - first - second, skill, rand);
      rolls10.push(third);
    }
  }
  frames.push(frameFromRolls(10, rolls10));

  return scoreGame(frames);
}

/** Apply strike/spare bonuses across frame boundaries and finalize a GameLinescore. */
export function scoreGame(frames: Frame[]): GameLinescore {
  if (frames.length !== 10) throw new Error(`game must have 10 frames`);
  const allBalls: number[] = [];
  const frameStart: number[] = [];
  {
    let idx = 0;
    for (const f of frames) {
      frameStart.push(idx);
      idx += f.rolls.length;
      allBalls.push(...f.rolls);
    }
  }
  let cum = 0;
  for (let i = 0; i < 9; i++) {
    const f = frames[i];
    let bonus = 0;
    if (f.isStrike) {
      bonus = (allBalls[frameStart[i] + 1] ?? 0) + (allBalls[frameStart[i] + 2] ?? 0);
    } else if (f.isSpare) {
      bonus = allBalls[frameStart[i] + 2] ?? 0;
    }
    f.bonus = bonus;
    cum += f.framePinfall + bonus;
    f.cumulative = cum;
  }
  const f10 = frames[9];
  f10.bonus = 0;
  cum += f10.framePinfall;
  f10.cumulative = cum;

  let strikes = 0;
  let spares = 0;
  let opens = 0;
  let openPinsLeft = 0;
  for (const f of frames) {
    if (f.isStrike) strikes++;
    else if (f.isSpare) spares++;
    else {
      opens++;
      openPinsLeft += 10 - f.framePinfall;
    }
  }
  return {
    frames,
    scratchTotal: cum,
    strikes,
    spares,
    opens,
    openPinsLeft,
    marks: strikes + spares,
  };
}

// ---------------------------------------------------------------------------
// Validators (dev-time; run at module load in mock-data).
// ---------------------------------------------------------------------------

export function validateGame(g: GameLinescore, ctx: string): void {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`[${ctx}] ${msg}`);
  };
  check(g.frames.length === 10, `expected 10 frames, got ${g.frames.length}`);
  let prevCum = 0;
  for (let i = 0; i < 10; i++) {
    const f = g.frames[i];
    check(f.frameNumber === i + 1, `frame ${i + 1} numbered ${f.frameNumber}`);
    // Each roll legal (0..10) and remaining pins respected.
    if (i < 9) {
      // regulation frame: 1..3 balls, pins conserved
      check(f.rolls.length >= 1 && f.rolls.length <= 3, `frame ${i + 1}: 1..3 balls`);
      let remaining = 10;
      for (let b = 0; b < f.rolls.length; b++) {
        const p = f.rolls[b];
        check(p >= 0 && p <= remaining, `frame ${i + 1} ball ${b + 1}: illegal ${p} vs remaining ${remaining}`);
        remaining -= p;
      }
      if (f.rolls[0] === 10) {
        check(f.rolls.length === 1, `frame ${i + 1}: strike must end frame`);
      } else if ((f.rolls[0] + (f.rolls[1] ?? 0)) === 10) {
        check(f.rolls.length === 2, `frame ${i + 1}: spare must end frame`);
      } else {
        check(f.rolls.length === 3, `frame ${i + 1}: open must have 3 balls`);
      }
    } else {
      // frame 10 legality: 2..3 balls, fresh-rack semantics
      check(f.rolls.length >= 2 && f.rolls.length <= 3, `frame 10: 2..3 balls`);
      const [b1, b2, b3] = [f.rolls[0], f.rolls[1] ?? 0, f.rolls[2] ?? 0];
      if (b1 === 10) {
        check(f.rolls.length === 3, `frame 10 strike: needs 2 bonus balls`);
        // bonus1 on fresh rack (0..10). bonus2: if bonus1===10 fresh (0..10), else on 10-bonus1.
        check(b2 >= 0 && b2 <= 10, `frame 10 bonus1 illegal`);
        const remaining3 = b2 === 10 ? 10 : 10 - b2;
        check(b3 >= 0 && b3 <= remaining3, `frame 10 bonus2 illegal`);
      } else if (b1 + b2 === 10) {
        check(f.rolls.length === 3, `frame 10 spare: needs 1 bonus ball`);
        check(b3 >= 0 && b3 <= 10, `frame 10 spare bonus illegal`);
      } else {
        check(b1 + b2 < 10, `frame 10 open cannot exceed 10`);
        check(f.rolls.length === 3, `frame 10 open: needs 3 balls`);
        check(b3 >= 0 && b3 <= 10 - b1 - b2, `frame 10 open third ball illegal`);
      }
    }
    // exactly-one classification
    const cls = Number(f.isStrike) + Number(f.isSpare) + Number(f.isOpen);
    check(cls === 1, `frame ${i + 1}: must classify as exactly one of strike/spare/open`);
    // monotonic cumulative
    check(f.cumulative >= prevCum, `frame ${i + 1}: cumulative not monotonic (${prevCum} → ${f.cumulative})`);
    prevCum = f.cumulative;
  }
  check(g.frames[9].cumulative === g.scratchTotal, `final cumulative ≠ scratchTotal`);
  // strike/spare/open counts reconcile
  let strikes = 0, spares = 0, opens = 0;
  for (const f of g.frames) {
    if (f.isStrike) strikes++;
    else if (f.isSpare) spares++;
    else opens++;
  }
  check(strikes === g.strikes, `strike count mismatch`);
  check(spares === g.spares, `spare count mismatch`);
  check(opens === g.opens, `open count mismatch`);
  check(strikes + spares + opens === 10, `classifications must total 10 frames`);
}

/** Population standard deviation. Returns 0 for length < 2. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance =
    xs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / xs.length;
  return Math.sqrt(variance);
}
