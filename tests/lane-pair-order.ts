/**
 * Lane-pair ordering: labels must sort numerically, not lexicographically.
 * "11-12" must come after "9-10", never between "1-2" and "3-4".
 */
import {
  compareLanePairLabel,
  compareLanePairSlotSnake,
  compareLanePairSlotCamel,
  laneNumberFromLabel,
} from "../src/lib/lane-pair-order";

function assertEqual<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n  expected ${b}\n  got      ${a}`);
}

const LABELS = ["1-2", "3-4", "5-6", "7-8", "9-10", "11-12"] as const;

// Baseline sanity: laneNumberFromLabel extracts the leading integer.
for (const [label, n] of [
  ["1-2", 1], ["3-4", 3], ["5-6", 5], ["7-8", 7], ["9-10", 9], ["11-12", 11],
] as const) {
  assertEqual(laneNumberFromLabel(label), n, `laneNumberFromLabel(${label})`);
}
assertEqual(laneNumberFromLabel("xx"), null, "laneNumberFromLabel(non-numeric)");

// The offending case: lexicographic sort places "11-12" right after "1-2".
// Confirm the natural comparator sorts every reasonable permutation back
// into 1-2, 3-4, 5-6, 7-8, 9-10, 11-12.
const permutations: string[][] = [
  ["11-12", "1-2", "3-4", "5-6", "7-8", "9-10"],
  ["9-10", "7-8", "5-6", "3-4", "1-2", "11-12"],
  ["3-4", "11-12", "1-2", "9-10", "5-6", "7-8"],
  [...LABELS].reverse(),
];
for (const perm of permutations) {
  const sorted = perm.slice().sort(compareLanePairLabel);
  assertEqual(sorted, [...LABELS], `compareLanePairLabel sort of ${JSON.stringify(perm)}`);
}

// Lexicographic sort would produce a WRONG order — assert that so a
// regression that reverts to localeCompare is caught immediately.
const lex = [...LABELS].slice().sort((a, b) => a.localeCompare(b));
if (JSON.stringify(lex) === JSON.stringify([...LABELS])) {
  throw new Error("test setup wrong: lexicographic sort should NOT equal numeric order");
}

// Snake-case comparator: sort by lane_pair, then slot.
const snakeRows = [
  { lane_pair: "11-12", slot: 2 },
  { lane_pair: "1-2",   slot: 3 },
  { lane_pair: "9-10",  slot: 1 },
  { lane_pair: "1-2",   slot: 1 },
  { lane_pair: "3-4",   slot: 2 },
];
snakeRows.sort(compareLanePairSlotSnake);
assertEqual(
  snakeRows.map((r) => `${r.lane_pair}#${r.slot}`),
  ["1-2#1", "1-2#3", "3-4#2", "9-10#1", "11-12#2"],
  "compareLanePairSlotSnake",
);

// Camel-case comparator: sort by lanePair, then slot.
const camelRows = [
  { lanePair: "11-12", slot: 1 },
  { lanePair: "9-10",  slot: 2 },
  { lanePair: "1-2",   slot: 4 },
  { lanePair: "1-2",   slot: 2 },
];
camelRows.sort(compareLanePairSlotCamel);
assertEqual(
  camelRows.map((r) => `${r.lanePair}#${r.slot}`),
  ["1-2#2", "1-2#4", "9-10#2", "11-12#1"],
  "compareLanePairSlotCamel",
);

console.log("lane-pair-order tests passed");
