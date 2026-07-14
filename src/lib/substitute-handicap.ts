/**
 * Pure, shared "effective scoring identity per side" resolver.
 *
 * League rule (v6): when a substitute rolls a match, the scoring handicap
 * for that side is derived from the SUBSTITUTE'S own Starting Average
 * (not the scheduled bowler's). Rostered and Absent sides continue to use
 * the SCHEDULED bowler's entry average and handicap.
 *
 * W-L points and match handicap pinfall are still credited to the
 * scheduled bowler in standings — that credit rule lives in
 * `buildSnapshot` / `computeMatchResult` and is unrelated to which
 * handicap value is used to score the three games.
 *
 * This module intentionally has ZERO imports from the app runtime so it
 * can be reused by both the server function (`schedule-repo.functions`)
 * and the admin UI (`admin.results.tsx`) and covered by strict
 * deterministic tests.
 */

import { computeHandicap, type ParticipationStatus } from "@/lib/mock-data";

export interface ResolveSideInput {
  status: ParticipationStatus;
  /** Scheduled bowler's frozen/current entry average for this match. */
  scheduledEntryAverage: number;
  /**
   * Per-match Starting Average submitted by the admin for the sub, if any.
   * Prefer this when finite and in range. Ignored for non-substitute sides.
   */
  submittedSubStartingAverage?: number | null;
  /**
   * The selected substitute pool row's stored `starting_average`, if any.
   * Used as the fallback when no per-match override is submitted.
   * Ignored for non-substitute sides.
   */
  poolSubStartingAverage?: number | null;
}

export interface ResolvedSide {
  /**
   * Effective entry average FROZEN onto the MatchResult (`entryAverageA/B`).
   * Substitute → sub's Starting Average. Rostered/Absent → scheduled avg.
   */
  entry: number;
  /** Effective per-game handicap for this side's scoring. */
  hcp: number;
}

export type ResolveSideResult =
  | { ok: true; value: ResolvedSide }
  | { ok: false; error: string };

const MIN_AVG = 1;
const MAX_AVG = 300;

function validAverage(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= MIN_AVG && v <= MAX_AVG;
}

/**
 * Deterministic resolver for the effective scoring identity of one side.
 * Callers that already validated inputs upstream still get a consistent
 * result and a clear error string on invalid substitute inputs.
 */
export function resolveEffectiveScoring(input: ResolveSideInput): ResolveSideResult {
  if (input.status === "rostered" || input.status === "absent") {
    if (!validAverage(input.scheduledEntryAverage)) {
      return { ok: false, error: "scheduled bowler entry average is invalid" };
    }
    return {
      ok: true,
      value: { entry: input.scheduledEntryAverage, hcp: computeHandicap(input.scheduledEntryAverage) },
    };
  }
  // substitute
  const submitted = input.submittedSubStartingAverage;
  const pool = input.poolSubStartingAverage;
  const eff = validAverage(submitted)
    ? submitted
    : validAverage(pool)
      ? pool
      : null;
  if (eff == null) {
    return {
      ok: false,
      error:
        "substitute Starting Average is required (1–300) — none submitted and the selected pool row has no stored average",
    };
  }
  return { ok: true, value: { entry: eff, hcp: computeHandicap(eff) } };
}

/**
 * UI-preview helper. Returns the effective per-game handicap for a side
 * given the current draft state. Never silently falls back to the
 * scheduled handicap when a substitute's Starting Average is missing —
 * returns 0 in that case so the preview is obviously pending until the
 * admin fills it in (validation blocks saving in that state).
 */
export function effectiveHandicapForUi(input: {
  status: ParticipationStatus;
  scheduledEntryAverage: number;
  subStartAvgRaw?: string;
}): number {
  if (input.status !== "substitute") {
    return validAverage(input.scheduledEntryAverage)
      ? computeHandicap(input.scheduledEntryAverage)
      : 0;
  }
  const raw = (input.subStartAvgRaw ?? "").trim();
  if (raw === "") return 0;
  const n = Number(raw);
  return validAverage(n) ? computeHandicap(n) : 0;
}

// ---------------------------------------------------------------------------
// Deterministic self-tests (run at module load).
// ---------------------------------------------------------------------------

(function selfTest() {
  const errs: string[] = [];
  const eq = (a: unknown, b: unknown, msg: string) => {
    if (a !== b) errs.push(`${msg}: expected ${String(b)} got ${String(a)}`);
  };

  // rostered → scheduled hcp
  const r1 = resolveEffectiveScoring({ status: "rostered", scheduledEntryAverage: 120 });
  eq(r1.ok, true, "rostered ok");
  if (r1.ok) { eq(r1.value.entry, 120, "rostered entry"); eq(r1.value.hcp, 32, "rostered hcp"); }

  // absent → scheduled hcp
  const r2 = resolveEffectiveScoring({ status: "absent", scheduledEntryAverage: 140 });
  eq(r2.ok, true, "absent ok");
  if (r2.ok) { eq(r2.value.entry, 140, "absent entry"); eq(r2.value.hcp, 16, "absent hcp"); }

  // substitute with submitted override, avg 100 → hcp 48; scheduled 120 IGNORED
  const r3 = resolveEffectiveScoring({
    status: "substitute", scheduledEntryAverage: 120,
    submittedSubStartingAverage: 100, poolSubStartingAverage: 130,
  });
  eq(r3.ok, true, "sub submitted ok");
  if (r3.ok) { eq(r3.value.entry, 100, "sub uses submitted"); eq(r3.value.hcp, 48, "sub hcp 48"); }

  // substitute falls back to pool when no override
  const r4 = resolveEffectiveScoring({
    status: "substitute", scheduledEntryAverage: 120,
    poolSubStartingAverage: 130,
  });
  eq(r4.ok, true, "sub pool ok");
  if (r4.ok) { eq(r4.value.entry, 130, "sub uses pool"); eq(r4.value.hcp, 24, "sub hcp 24"); }

  // substitute rejects when neither submitted nor pool average is valid
  const r5 = resolveEffectiveScoring({ status: "substitute", scheduledEntryAverage: 120 });
  eq(r5.ok, false, "sub missing avg rejected");

  // Invalid submitted (0) falls back to pool
  const r6 = resolveEffectiveScoring({
    status: "substitute", scheduledEntryAverage: 120,
    submittedSubStartingAverage: 0, poolSubStartingAverage: 150,
  });
  eq(r6.ok, true, "sub invalid submitted falls back");
  if (r6.ok) eq(r6.value.entry, 150, "sub falls back to pool");

  // UI helper: sub with blank avg → 0 (pending), NOT scheduled hcp
  eq(effectiveHandicapForUi({ status: "substitute", scheduledEntryAverage: 120, subStartAvgRaw: "" }),
    0, "ui sub blank → 0");
  eq(effectiveHandicapForUi({ status: "substitute", scheduledEntryAverage: 120, subStartAvgRaw: "100" }),
    48, "ui sub 100 → 48");
  eq(effectiveHandicapForUi({ status: "rostered", scheduledEntryAverage: 120 }),
    32, "ui rostered → scheduled hcp");
  eq(effectiveHandicapForUi({ status: "absent", scheduledEntryAverage: 140 }),
    16, "ui absent → scheduled hcp");

  if (errs.length) throw new Error("substitute-handicap self-test failed:\n" + errs.join("\n"));
})();
