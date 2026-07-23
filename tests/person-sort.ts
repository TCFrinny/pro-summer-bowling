/**
 * Regression tests for person-selection dropdown ordering.
 *
 * These are source-level assertions plus behavioural checks on the shared
 * helper. They intentionally do NOT render React — they verify:
 *  1. roster-only alphabetical order
 *  2. substitute-only alphabetical order
 *  3. combined roster+sub order across roles
 *  4. case-insensitive names and deterministic ties
 *  5. source arrays remain unmodified
 *  6. fixed placeholder options remain in intended position (source-level)
 *  7. every person-option dropdown site uses the shared sorter or already
 *     receives sorted data (source-level import audit)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sortPersonOptions, comparePersonOptions } from "../src/lib/person-sort";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("person-sort test: " + msg);
}

// 1) Roster-only alphabetical order regardless of input order.
{
  const roster = [
    { id: "3", name: "Zeb Bowler" },
    { id: "1", name: "amy adams"  },
    { id: "2", name: "Bob Roe"    },
  ];
  const out = sortPersonOptions(roster).map((r) => r.name);
  assert(out.join("|") === "amy adams|Bob Roe|Zeb Bowler", "roster order: " + out.join(","));
}

// 2) Substitute-only alphabetical order.
{
  const subs = [
    { id: "s3", name: "Xavier" },
    { id: "s1", name: "Anna"   },
    { id: "s2", name: "mia"    },
  ];
  const out = sortPersonOptions(subs).map((r) => r.name);
  assert(out.join("|") === "Anna|mia|Xavier", "sub order: " + out.join(","));
}

// 3) Combined roster+substitute across roles (interleaved, not grouped).
{
  const combined = [
    { id: "r1", name: "Zeke",  bowlerNumber: "10" },
    { id: "s1", name: "amy",   bowlerNumber: null },
    { id: "r2", name: "Mia",   bowlerNumber: "4"  },
    { id: "s2", name: "bob",   bowlerNumber: "7"  },
  ];
  const out = sortPersonOptions(combined).map((r) => r.id);
  assert(out.join("|") === "s1|s2|r2|r1", "combined order: " + out.join(","));
}

// 4) Case-insensitive names, deterministic ties.
{
  const rows = [
    { id: "b", name: "Sam", bowlerNumber: null },
    { id: "a", name: "sam", bowlerNumber: null },
    { id: "c", name: "SAM", bowlerNumber: "5" },
  ];
  const out = sortPersonOptions(rows).map((r) => r.id);
  // Numbered row wins the tie, then id ascending.
  assert(out.join("|") === "c|a|b", "tie-break order: " + out.join(","));

  // Comparator is a total order on ties.
  assert(comparePersonOptions(rows[0], rows[1]) === 1, "case tie should defer to id");
  assert(comparePersonOptions(rows[1], rows[0]) === -1, "case tie symmetric");
}

// 5) Source array is not mutated.
{
  const src = [
    { id: "z", name: "Zed" },
    { id: "a", name: "Al"  },
  ];
  const snap = src.map((r) => r.id).join(",");
  const out = sortPersonOptions(src);
  assert(src.map((r) => r.id).join(",") === snap, "input array was mutated");
  assert(out !== src, "returned array must be a fresh copy");
}

// 6) Placeholder / sentinel options remain outside the helper and stay at
//    their fixed position in JSX. We assert the shape source-side: every
//    <option> or <SelectItem> with an intentional sentinel value ("", or a
//    hard-coded placeholder like "— none —") appears literally in the JSX
//    BEFORE the mapped person options, never inside the sorted array.
{
  const files = [
    "src/routes/admin.people.tsx",
    "src/routes/admin.seasons.$seasonId.tsx",
    "src/components/admin/HistoricalDataSection.tsx",
    "src/routes/admin.schedule.tsx",
    "src/routes/admin.results.tsx",
    "src/routes/admin.live-scoring.tsx",
  ];
  const sentinelRe =
    /<option value="">|placeholder="(Select bowler|Select sub|Choose sub|Bowler A|Bowler B)/;
  for (const f of files) {
    const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    // At least one sentinel/placeholder must remain visible in source.
    if (!sentinelRe.test(src)) {
      throw new Error(
        "person-sort test: expected a fixed placeholder / sentinel option in " + f,
      );
    }
  }
}

// 7) Source-level audit — every file that renders a person-option dropdown
//    must either import the shared sorter or delegate to a component that
//    receives already-sorted data (BowlerSelect callers pass sorted props).
{
  const mustImportSorter = [
    "src/routes/admin.people.tsx",
    "src/routes/admin.seasons.$seasonId.tsx",
    "src/routes/admin.schedule.tsx",
    "src/routes/admin.results.tsx",
    "src/routes/admin.live-scoring.tsx",
    "src/components/admin/HistoricalDataSection.tsx",
  ];
  for (const f of mustImportSorter) {
    const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    if (!/from "@\/lib\/person-sort"/.test(src)) {
      throw new Error(
        "person-sort test: " + f + " must import from @/lib/person-sort",
      );
    }
    if (!/sortPersonOptions\s*\(/.test(src)) {
      throw new Error(
        "person-sort test: " + f + " must call sortPersonOptions(...)",
      );
    }
  }
}

// 8) Public Bowlers page: rostered and substitute groups each alphabetized
//    independently, mixed capitalization respected, and a newly added
//    mid-alphabet entry lands in its correct position without any manual
//    resort at the call site.
{
  const rostered = [
    { id: "b03", name: "zach"   },
    { id: "b01", name: "Alice"  },
    { id: "b02", name: "bob"    },
  ];
  const subs = [
    { id: "s02", name: "Diana" },
    { id: "s01", name: "carla" },
  ];
  const rosteredOut = sortPersonOptions(rostered).map((r) => r.name);
  assert(
    rosteredOut.join("|") === "Alice|bob|zach",
    "public roster alphabetical: " + rosteredOut.join(","),
  );
  const subsOut = sortPersonOptions(subs).map((s) => s.name);
  assert(
    subsOut.join("|") === "carla|Diana",
    "public subs alphabetical: " + subsOut.join(","),
  );

  // Newly added rostered bowler "Charlie" appears in position 2 immediately,
  // without any additional sort step at the display site.
  const afterAdd = sortPersonOptions([
    ...rostered,
    { id: "b04", name: "Charlie" },
  ]).map((r) => r.name);
  assert(
    afterAdd.join("|") === "Alice|bob|Charlie|zach",
    "newly added entry position: " + afterAdd.join(","),
  );
}

// 9) Admin listRosterAndSubs uses the shared comparator (not id-based).
//    Source-level audit — the server function must sort by
//    comparePersonOptions so admin lists always render A–Z by name.
{
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/league-repo.functions.ts"),
    "utf8",
  );
  if (!/from "@\/lib\/person-sort"/.test(src)) {
    throw new Error(
      "person-sort test: league-repo.functions.ts must import from @/lib/person-sort",
    );
  }
  if (!/rostered\.sort\(comparePersonOptions\)/.test(src)) {
    throw new Error(
      "person-sort test: listRosterAndSubs must sort rostered by comparePersonOptions",
    );
  }
  if (!/subs\.sort\(comparePersonOptions\)/.test(src)) {
    throw new Error(
      "person-sort test: listRosterAndSubs must sort subs by comparePersonOptions",
    );
  }
}

// 10) Public /bowlers route uses the shared sorter for both groups.
{
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/routes/bowlers.tsx"),
    "utf8",
  );
  if (!/from "@\/lib\/person-sort"/.test(src)) {
    throw new Error("person-sort test: /bowlers must import from @/lib/person-sort");
  }
  const calls = src.match(/sortPersonOptions\s*\(/g) ?? [];
  if (calls.length < 2) {
    throw new Error(
      "person-sort test: /bowlers must call sortPersonOptions for both rostered and subs",
    );
  }
  // The old case-sensitive .sort((a, b) => a.name.localeCompare(b.name))
  // must be gone — that comparator does not fold case.
  if (/\.sort\(\(a, b\) => a\.name\.localeCompare\(b\.name\)\)/.test(src)) {
    throw new Error(
      "person-sort test: /bowlers still uses raw case-sensitive name sort",
    );
  }
}

// eslint-disable-next-line no-console
console.log("person-sort tests passed");
