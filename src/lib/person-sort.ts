/**
 * Shared, pure helper for ordering person-selection dropdown options.
 *
 * Every bowler / substitute / person option list rendered anywhere in the
 * application (public and admin) MUST be sorted through `sortPersonOptions`
 * or `comparePersonOptions` so users always see names alphabetically.
 *
 * Rules encoded here (do not silently change without updating tests):
 *  - Locale-aware, case-insensitive compare on the DISPLAYED name.
 *    Whitespace is trimmed for the compare only — display strings are NOT
 *    mutated.
 *  - Deterministic tie-breakers:
 *      1. displayed bowler number, numeric when both parse as numbers,
 *         else lexicographic; a row with a number sorts before one without.
 *      2. stable id / ref string compare.
 *  - Source arrays are never mutated. Callers get a fresh array back.
 *  - Placeholders / sentinels ("— none —", "Select bowler", "Absent", …)
 *    are NEVER included in the input to this helper; they stay in their
 *    intended fixed position in JSX.
 *  - Non-person dropdowns (weeks, lane pairs, seasons, statuses, scoring
 *    modes) MUST NOT be routed through this helper — they have their own
 *    domain ordering.
 */

export interface PersonSortOption {
  id: string;
  /** Preferred display field for rostered / substitute rows. */
  name?: string | null;
  /** Preferred display field for permanent people. Either is accepted. */
  displayName?: string | null;
  /** Bowler ID / jersey number as displayed. Optional. */
  bowlerNumber?: string | number | null;
}

/** Case-insensitive, trimmed substring match on the DISPLAYED name OR the
 *  displayed league ID Number. Used by public person lists so a visitor can
 *  search either way. Internal row ids / person UUIDs are never matched. */
export function personMatchesQuery(
  option: { name?: string | null; displayName?: string | null; bowlerNumber?: string | number | null },
  query: string,
): boolean {
  const needle = (query ?? "").trim().toLowerCase();
  if (needle.length === 0) return true;
  const name = String(option.name ?? option.displayName ?? "").toLowerCase();
  if (name.includes(needle)) return true;
  const num = option.bowlerNumber == null ? "" : String(option.bowlerNumber).trim().toLowerCase();
  return num.length > 0 && num.includes(needle);
}

function displayNameOf(o: PersonSortOption): string {
  const raw = o.name ?? o.displayName ?? "";
  return String(raw).trim();
}

function numberOf(o: PersonSortOption): string {
  const raw = o.bowlerNumber;
  if (raw == null) return "";
  return String(raw).trim();
}

export function comparePersonOptions(
  a: PersonSortOption,
  b: PersonSortOption,
): number {
  const nameCmp = displayNameOf(a).localeCompare(displayNameOf(b), undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (nameCmp !== 0) return nameCmp;

  const bnA = numberOf(a);
  const bnB = numberOf(b);
  if (bnA && !bnB) return -1;
  if (!bnA && bnB) return 1;
  if (bnA && bnB) {
    const nA = Number(bnA);
    const nB = Number(bnB);
    if (Number.isFinite(nA) && Number.isFinite(nB) && nA !== nB) return nA - nB;
    const strCmp = bnA.localeCompare(bnB, undefined, { numeric: true });
    if (strCmp !== 0) return strCmp;
  }

  return String(a.id).localeCompare(String(b.id));
}

/**
 * Returns a NEW array of the given rows sorted for dropdown display.
 * The input array is never mutated.
 */
export function sortPersonOptions<T extends PersonSortOption>(
  rows: readonly T[] | null | undefined,
): T[] {
  if (!rows || rows.length === 0) return [];
  return [...rows].sort(comparePersonOptions);
}

// ---------- Deterministic self-tests -----------------------------------
// Executed on module import via tests/deterministic.ts.

(function selfTest() {
  const roster = [
    { id: "r3", name: "Zach"   },
    { id: "r1", name: "alice"  },
    { id: "r2", name: "  Bob " },
  ];
  const rosterOut = sortPersonOptions(roster).map((r) => r.name);
  if (rosterOut.join("|") !== "alice|  Bob |Zach") {
    throw new Error("person-sort: roster order regression: " + rosterOut.join(","));
  }
  // Source untouched.
  if (roster[0].id !== "r3") {
    throw new Error("person-sort: mutated source array");
  }

  const subs = [
    { id: "s2", name: "Diana"  },
    { id: "s1", name: "carla"  },
  ];
  const subsOut = sortPersonOptions(subs).map((s) => s.name);
  if (subsOut.join("|") !== "carla|Diana") {
    throw new Error("person-sort: substitute order regression");
  }

  const combined = [
    { id: "s1", name: "Bob",   bowlerNumber: null   },
    { id: "r1", name: "alice", bowlerNumber: "12"   },
    { id: "s2", name: "carla", bowlerNumber: null   },
    { id: "r2", name: "Bob",   bowlerNumber: "3"    },
  ];
  const combinedOut = sortPersonOptions(combined).map((c) => c.id);
  // alice, then the two Bobs (numeric #3 before "no number"), then carla.
  if (combinedOut.join("|") !== "r1|r2|s1|s2") {
    throw new Error("person-sort: combined order regression: " + combinedOut.join(","));
  }

  const tie = [
    { id: "b", displayName: "Sam" },
    { id: "a", displayName: "sam" },
  ];
  const tieOut = sortPersonOptions(tie).map((t) => t.id);
  if (tieOut.join("|") !== "a|b") {
    throw new Error("person-sort: id tie-breaker regression");
  }
})();

(function selfTestQuery() {
  const roster = { id: "b01", name: "Alice", bowlerNumber: "01234" };
  const sub = { id: "s01", name: "Bob", bowlerNumber: "07777" };
  if (!personMatchesQuery(roster, " 0123 ")) throw new Error("person-sort: roster ID search must match");
  if (!personMatchesQuery(sub, "7777")) throw new Error("person-sort: sub ID search must match");
  if (!personMatchesQuery(roster, "ALI")) throw new Error("person-sort: name search must stay case-insensitive");
  if (personMatchesQuery(roster, "b01")) throw new Error("person-sort: internal row id must not match");
  if (personMatchesQuery(sub, "s01")) throw new Error("person-sort: internal sub id must not match");
  if (!personMatchesQuery(roster, "")) throw new Error("person-sort: empty query matches all");
  if (!personMatchesQuery({ id: "b02", name: "Cara", bowlerNumber: null }, "cara")) {
    throw new Error("person-sort: missing ID must stay safe");
  }
  if (personMatchesQuery({ id: "b02", name: "Cara", bowlerNumber: null }, "01")) {
    throw new Error("person-sort: missing ID must not match numeric query");
  }
  // Filtering by ID must not disturb alphabetical ordering.
  const pool = [
    { id: "b03", name: "Zoe",   bowlerNumber: "01001" },
    { id: "b01", name: "alice", bowlerNumber: "01002" },
    { id: "b02", name: "Bob",   bowlerNumber: "02001" },
  ];
  const filtered = sortPersonOptions(pool.filter((p) => personMatchesQuery(p, "010")));
  if (filtered.map((f) => f.name).join("|") !== "alice|Zoe") {
    throw new Error("person-sort: ID filter must preserve alphabetical order");
  }
})();
