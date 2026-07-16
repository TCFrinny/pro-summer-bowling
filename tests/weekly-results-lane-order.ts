/**
 * Regression: the public Weekly Results page must render match cards in
 * natural lane-pair order (1-2, 3-4, 5-6, 7-8, 9-10, 11-12), never the
 * lexicographic order that puts "11-12" immediately after "1-2".
 *
 * Source-level assertion: the route must sort matches with the shared
 * `compareLanePairSlotCamel` before rendering, so that even a legacy
 * snapshot whose `matchesByWeek` was persisted in insertion order still
 * displays lanes in the correct sequence.
 *
 * Behavioral assertion: feed the exact "wrong" order into the shared
 * comparator and confirm it comes back correct.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compareLanePairSlotCamel } from "../src/lib/lane-pair-order";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`weekly-results-lane-order: ${msg}`);
}

const SRC = readFileSync(
  resolve(__dirname, "../src/routes/weekly-results.tsx"),
  "utf8",
);

// The route must import and apply the shared natural comparator.
assert(
  SRC.includes('from "@/lib/lane-pair-order"'),
  "weekly-results.tsx must import from @/lib/lane-pair-order",
);
assert(
  SRC.includes("compareLanePairSlotCamel"),
  "weekly-results.tsx must apply compareLanePairSlotCamel",
);
assert(
  /getMatchesForWeek\(week\)[\s\S]{0,200}\.sort\(compareLanePairSlotCamel\)/.test(SRC),
  "weekly-results.tsx must sort getMatchesForWeek(...) results with compareLanePairSlotCamel",
);
// Regression guard against a lazy re-introduction of localeCompare.
assert(
  !/lanePair\.localeCompare/.test(SRC),
  "weekly-results.tsx must never sort lane pairs with localeCompare",
);

// Behavioral: simulate a snapshot whose matches were persisted in a
// jumbled or lexicographic order. After sorting, they must render as
// 1-2, 3-4, 5-6, 7-8, 9-10, 11-12.
type Row = { lanePair: string; slot: number; id: string };
const jumbled: Row[] = [
  { lanePair: "11-12", slot: 1, id: "a" }, // lex-sort would place this second
  { lanePair: "1-2",   slot: 1, id: "b" },
  { lanePair: "3-4",   slot: 1, id: "c" },
  { lanePair: "9-10",  slot: 1, id: "d" },
  { lanePair: "5-6",   slot: 1, id: "e" },
  { lanePair: "7-8",   slot: 1, id: "f" },
];
const sorted = jumbled.slice().sort(compareLanePairSlotCamel);
const gotOrder = sorted.map((r) => r.lanePair);
const wantOrder = ["1-2", "3-4", "5-6", "7-8", "9-10", "11-12"];
assert(
  JSON.stringify(gotOrder) === JSON.stringify(wantOrder),
  `weekly-results order wrong: got ${JSON.stringify(gotOrder)}`,
);

// And confirm the lexicographic order really would have been wrong,
// so this test cannot silently pass if someone reverts the comparator.
const lex = jumbled.slice().sort((a, b) => a.lanePair.localeCompare(b.lanePair));
assert(
  JSON.stringify(lex.map((r) => r.lanePair)) !== JSON.stringify(wantOrder),
  "test premise broken: lexicographic sort accidentally matches natural order",
);

console.log("weekly-results-lane-order tests passed");
