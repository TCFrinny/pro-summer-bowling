/**
 * Duckpin 10th-frame symbol-counting tests (v2.0.3).
 *
 * Verifies the required counting for every saved tenth-frame mark:
 *   "/"   → 0 strikes, 1 spare,  1 total mark
 *   "X"   → 1 strike,  0 spares, 1 total mark
 *   "/X"  → 1 strike,  1 spare,  2 total marks
 *   "X/"  → 1 strike,  1 spare,  2 total marks
 *   "XX"  → 2 strikes, 0 spares, 2 total marks
 *   "XXX" → 3 strikes, 0 spares, 3 total marks
 *   "-"   → 0 strikes, 0 spares, 0 total marks
 *
 * Also verifies frames 1–9 still contribute at most one symbol per frame,
 * that opens still classify per-frame (frame denominator unchanged), and
 * that multi-mark 10ths flow through summarizeGame totals into a
 * downstream percentage-producing aggregation (substitute profile).
 */
import {
  countFrameMarks,
  summarizeGame,
  type FrameLinescore,
} from "../src/lib/duckpin";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("duckpin-tenth: " + msg);
}

// --- 1. Per-value counting via countFrameMarks + summarizeGame -------------
// For each tenth mark, build a game where frames 1–9 are all "-" (open, 0
// pinfall) and frame 10 carries the tested mark with a valid cumulative
// score. Then assert strikes / spares / marks / opens exactly.
type Case = { mark: string; s: number; p: number; m: number; tenthPins: number };
const CASES: Case[] = [
  { mark: "-",   s: 0, p: 0, m: 0, tenthPins: 0 },
  { mark: "/",   s: 0, p: 1, m: 1, tenthPins: 10 },
  { mark: "X",   s: 1, p: 0, m: 1, tenthPins: 10 },
  { mark: "/X",  s: 1, p: 1, m: 2, tenthPins: 20 },
  { mark: "X/",  s: 1, p: 1, m: 2, tenthPins: 20 },
  { mark: "XX",  s: 2, p: 0, m: 2, tenthPins: 20 },
  { mark: "XXX", s: 3, p: 0, m: 3, tenthPins: 30 },
];

for (const c of CASES) {
  const cf = countFrameMarks(10, c.mark);
  assert(cf.strikes === c.s && cf.spares === c.p,
    `countFrameMarks(10, "${c.mark}") = ${cf.strikes}/${cf.spares}, expected ${c.s}/${c.p}`);

  const frames: FrameLinescore[] = [];
  for (let i = 1; i <= 9; i++) frames.push({ frameNumber: i, mark: "-", cumulativeScore: 0 });
  frames.push({ frameNumber: 10, mark: c.mark, cumulativeScore: c.tenthPins });
  const g = summarizeGame(frames);
  assert(g.strikes === c.s,
    `"${c.mark}": strikes=${g.strikes}, expected ${c.s}`);
  assert(g.spares === c.p,
    `"${c.mark}": spares=${g.spares}, expected ${c.p}`);
  assert(g.marks === c.m,
    `"${c.mark}": marks=${g.marks}, expected ${c.m}`);
  // Frame denominator invariant: exactly one open OR one strike-family/spare
  // frame in the 10th, plus 9 open regulation frames → 9 or 10 opens.
  const expectedOpens = c.mark === "-" ? 10 : 9;
  assert(g.opens === expectedOpens,
    `"${c.mark}": opens=${g.opens}, expected ${expectedOpens}`);
}

// --- 2. Frames 1–9 regression: each contributes at most one symbol ---------
{
  // Nine strikes in the first nine frames, tenth open.
  const frames: FrameLinescore[] = [];
  let cum = 0;
  for (let i = 1; i <= 9; i++) {
    cum += 30; // upper bound; valid because next frames also strike
    frames.push({ frameNumber: i, mark: "X", cumulativeScore: cum });
  }
  frames.push({ frameNumber: 10, mark: "-", cumulativeScore: cum });
  const g = summarizeGame(frames);
  assert(g.strikes === 9, `frames 1–9 give exactly 9 strikes (got ${g.strikes})`);
  assert(g.spares === 0, `no spurious spare symbols in frames 1–9 (got ${g.spares})`);
  assert(g.marks === 9, `total marks = 9 for 9-strike prefix + open 10th`);
  // countFrameMarks on regulation frames must never exceed 1 symbol total.
  for (let fn = 1; fn <= 9; fn++) {
    for (const m of ["X", "/", "-"] as const) {
      const c = countFrameMarks(fn, m);
      assert(c.strikes + c.spares <= 1,
        `frames 1–9 must count ≤1 symbol (got ${c.strikes + c.spares} for "${m}")`);
    }
  }
}

// --- 3. Perfect duckpin game: 9 X + XXX = 12 strikes, 3 clutch marks -------
{
  const frames: FrameLinescore[] = [];
  let cum = 0;
  for (let i = 1; i <= 9; i++) {
    cum += 30;
    frames.push({ frameNumber: i, mark: "X", cumulativeScore: cum });
  }
  cum += 30;
  frames.push({ frameNumber: 10, mark: "XXX", cumulativeScore: cum });
  const g = summarizeGame(frames);
  assert(g.strikes === 12, `perfect game = 12 strikes (got ${g.strikes})`);
  assert(g.spares === 0 && g.marks === 12, `perfect game = 12 marks / 0 spares`);
  assert(g.opens === 0, `no open frames in a perfect game (got ${g.opens})`);
  // Clutch marks: frame 9 "X" (1) + frame 10 "XXX" (3) = 4 in a 2-opportunity window.
  assert(g.segments.clutchMarks === 4,
    `perfect game clutchMarks = 4 (frame 9 + XXX 10th), got ${g.segments.clutchMarks}`);
}

// --- 4. X/ 10th flowing through downstream aggregation (substitute profile).
//     Frame 10 "X/" must add 1 strike + 1 spare (2 marks) into the aggregate,
//     and mark % / strike % must reflect the corrected counts under the
//     existing markPct = marks/frames formula (frames denominator unchanged).
{
  const { buildSubstituteData } = await import("../src/lib/substitute-profiles");
  const { assembleSideLinescore } = await import("../src/lib/mock-data");

  // Build three identical games: frames 1–9 all "-" (0 pinfall), frame 10 "X/".
  function xSlashGame() {
    const frames: FrameLinescore[] = [];
    for (let i = 1; i <= 9; i++) frames.push({ frameNumber: i, mark: "-", cumulativeScore: 0 });
    frames.push({ frameNumber: 10, mark: "X/", cumulativeScore: 20 });
    return summarizeGame(frames);
  }
  const games: [ReturnType<typeof summarizeGame>, ReturnType<typeof summarizeGame>, ReturnType<typeof summarizeGame>] =
    [xSlashGame(), xSlashGame(), xSlashGame()];
  const sub = { id: "sub-alpha", name: "Alpha Sub" };
  const scheduled = { id: "sched-1", name: "Sched One" };
  const side = assembleSideLinescore({
    scheduled, actualId: sub.id, actualName: sub.name,
    isSub: true, entryAverage: 100, handicap: 20, games,
  });
  const data = buildSubstituteData([
    {
      week: 1, laneAssignment: "1-2",
      teamA: { scheduled, actual: sub, isSub: true, entryAverage: 100, handicap: 20,
        scratchGames: [20, 20, 20], handicapGames: [40, 40, 40],
        scratchTotal: 60, handicapTotal: 120, points: 0, linescore: side.linescoreA! },
      teamB: { scheduled: { id: "sB", name: "SB" }, actual: { id: "sB", name: "SB" },
        isSub: false, entryAverage: 100, handicap: 0,
        scratchGames: [0, 0, 0], handicapGames: [0, 0, 0],
        scratchTotal: 0, handicapTotal: 0, points: 7, linescore: null },
    } as unknown as Parameters<typeof buildSubstituteData>[0][number],
  ]);
  const p = data.profiles.find((x) => x.identity.id === sub.id);
  assert(p, "expected substitute profile for alpha");
  // 3 games × frame 10 "X/" = 3 strikes + 3 spares = 6 marks.
  assert(p!.strikes === 3, `sub strikes aggregate = 3 (got ${p!.strikes})`);
  assert(p!.spares === 3, `sub spares aggregate = 3 (got ${p!.spares})`);
  assert(p!.marks === 6, `sub marks aggregate = 6 (got ${p!.marks})`);
  // markPct denominator = 3 games × 10 regulation frames = 30. Percentage = 20%.
  assert(Math.abs(p!.markPct - 20) < 1e-9,
    `markPct = 20% via marks/frames (got ${p!.markPct})`);
  // strikePct = 3/30 = 10%.
  assert(Math.abs(p!.strikePct - 10) < 1e-9,
    `strikePct = 10% via strikes/frames (got ${p!.strikePct})`);
  // Clutch marks: frame 9 is "-" (0), frame 10 "X/" (2) per game × 3 = 6.
  // Clutch opportunities: 2 per game × 3 games = 6. clutchPct = 100%.
  assert(p!.clutchMarks === 6,
    `sub clutchMarks aggregate = 6 (got ${p!.clutchMarks})`);
  assert(p!.clutchOpportunities === 6,
    `sub clutchOpportunities preserved at 6 (got ${p!.clutchOpportunities})`);
  assert(Math.abs(p!.clutchPct - 100) < 1e-9,
    `sub clutchPct = 100% (got ${p!.clutchPct})`);
}

// --- 5. Percentages are NOT silently capped. -------------------------------
//     Nine strike frames + tenth "XXX" ⇒ 12 strikes / 10 frames = 120%.
{
  const frames: FrameLinescore[] = [];
  let cum = 0;
  for (let i = 1; i <= 9; i++) { cum += 30; frames.push({ frameNumber: i, mark: "X", cumulativeScore: cum }); }
  cum += 30;
  frames.push({ frameNumber: 10, mark: "XXX", cumulativeScore: cum });
  const g = summarizeGame(frames);
  const strikePct = (g.strikes / 10) * 100;
  assert(strikePct === 120,
    `strikePct must not be capped (got ${strikePct}, expected 120)`);
}

// eslint-disable-next-line no-console
console.log("duckpin tenth-frame mark tests passed");
