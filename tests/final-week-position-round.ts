/**
 * v2.0.11 — final-week position round schedule validation.
 *
 * Repeat opponents are allowed in the dynamically determined final week
 * only; every other integrity rule still applies.
 */
import { LANE_PAIRS } from "../src/lib/mock-data";
import {
  pairKeyFor,
  resolveFinalWeek,
  validateWeekDraft,
  type DraftRowLike,
} from "../src/lib/schedule-week-validation";

function assert(c: boolean, m: string): void {
  if (!c) throw new Error("final-week-position-round: " + m);
}

// 36 active bowlers → 18 slots (6 lane pairs × 3 slots).
const bowlers = Array.from({ length: 36 }, (_, i) => ({
  id: `b${i + 1}`,
  name: `Bowler ${String(i + 1).padStart(2, "0")}`,
}));

function fullRows(): DraftRowLike[] {
  const rows: DraftRowLike[] = [];
  let i = 0;
  for (const lp of LANE_PAIRS) {
    for (let slot = 1; slot <= 3; slot++) {
      rows.push({
        lanePair: lp, slot,
        bowlerA: bowlers[i++]!.id,
        bowlerB: bowlers[i++]!.id,
      });
    }
  }
  return rows;
}

const repeatKey = pairKeyFor("b1", "b2"); // rows[0] pairing
const prior = new Set<string>([repeatKey]);

function run(weekNumber: number, finalWeek: number, rows = fullRows(), priorPairKeys = prior) {
  return validateWeekDraft({
    weekNumber, finalWeek, rows, activeBowlers: bowlers, priorPairKeys,
  });
}

const FINAL = 11;

// 1. Repeat rejected in a non-final week.
{
  const w = run(5, FINAL);
  assert(w.some((x) => x.includes("repeat matchup")), "1: non-final repeat must warn");
}

// 2. Same repeat accepted in the final week.
{
  const w = run(FINAL, FINAL);
  assert(w.length === 0, "2: final week must be clean, got " + JSON.stringify(w));
}

// 3. Self-matchup still rejected in the final week.
{
  const rows = fullRows();
  rows[3] = { ...rows[3]!, bowlerB: rows[3]!.bowlerA };
  const w = run(FINAL, FINAL, rows);
  assert(w.some((x) => x.includes("face themself")), "3: self-matchup must warn");
}

// 4. Bowler in two matches still rejected in the final week.
{
  const rows = fullRows();
  rows[4] = { ...rows[4]!, bowlerA: rows[0]!.bowlerA };
  const w = run(FINAL, FINAL, rows);
  assert(w.some((x) => x.startsWith("Duplicate bowlers")), "4: duplicate bowler must warn");
}

// 5. Missing active bowler still rejected in the final week.
{
  const rows = fullRows();
  rows[2] = { ...rows[2]!, bowlerB: "" };
  const w = run(FINAL, FINAL, rows);
  assert(w.some((x) => x.includes("incomplete")), "5: incomplete must warn");
  assert(w.some((x) => x.startsWith("Active bowler(s) not scheduled")), "5: omission must warn");
}

// 6. Invalid lane / slot structure still rejected in the final week.
{
  const bad = fullRows();
  bad[0] = { ...bad[0]!, lanePair: "99-100" };
  assert(run(FINAL, FINAL, bad).some((x) => x.startsWith("Invalid lane pair")), "6: bad lane");
  const badSlot = fullRows();
  badSlot[1] = { ...badSlot[1]!, slot: 7 };
  assert(run(FINAL, FINAL, badSlot).some((x) => x.includes("invalid slot")), "6: bad slot");
}

// 7. A season with a different length applies the exception to ITS final week.
{
  assert(resolveFinalWeek(8, [1, 2, 3]) === 8, "7: total_weeks 8 wins");
  assert(resolveFinalWeek(null, []) === 11, "7: fallback constant");
  assert(run(8, 8).length === 0, "7: week 8 is final for an 8-week season");
  assert(run(11, 8).some((x) => x.includes("repeat matchup")), "7: week 11 not final here");
}

// 8. Final-week generator pairings that are unavoidable repeats validate clean.
{
  // Standings order pairing 1v2, 3v4, … where 1v2 already met earlier.
  const rows: DraftRowLike[] = [];
  let i = 0;
  for (const lp of LANE_PAIRS) {
    for (let slot = 1; slot <= 3; slot++) {
      rows.push({ lanePair: lp, slot, bowlerA: bowlers[i++]!.id, bowlerB: bowlers[i++]!.id });
    }
  }
  const allPrior = new Set(rows.map((r) => pairKeyFor(r.bowlerA, r.bowlerB)));
  assert(run(FINAL, FINAL, rows, allPrior).length === 0, "8: all-repeat final week publishable");
}

// 9. Non-final generator behavior still avoids repeats.
{
  const rows = fullRows();
  const allPrior = new Set(rows.map((r) => pairKeyFor(r.bowlerA, r.bowlerB)));
  const w = run(FINAL - 1, FINAL, rows, allPrior);
  assert(w.filter((x) => x.includes("repeat matchup")).length === 18, "9: all 18 flagged pre-final");
}

// eslint-disable-next-line no-console
console.log("final-week position round validation OK");
