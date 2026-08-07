/**
 * Pure validation for the Admin Manual Schedule Builder draft.
 *
 * v2.0.11 — final-week position round: repeat opponents are ALLOWED during
 * the season's final week only. Every other integrity rule (self-matchup,
 * duplicate bowler, missing active bowler, valid lane pair / slot) applies
 * in every week, final or not.
 *
 * The final week is resolved dynamically (season config → recorded weeks →
 * TOTAL_WEEKS fallback); Week 11 is never hard-coded here.
 */
import { LANE_PAIRS, TOTAL_WEEKS } from "@/lib/mock-data";

const LANE_SET: ReadonlySet<string> = new Set<string>(LANE_PAIRS);

export interface DraftRowLike {
  lanePair: string;
  slot: number;
  bowlerA: string;
  bowlerB: string;
}

export interface ValidateWeekDraftInput {
  weekNumber: number;
  finalWeek: number;
  rows: ReadonlyArray<DraftRowLike>;
  /** Active, non-archived roster (id → display name). */
  activeBowlers: ReadonlyArray<{ id: string; name: string }>;
  /** Pair keys (see `pairKeyFor`) played in any earlier week. */
  priorPairKeys: ReadonlySet<string>;
}

export function pairKeyFor(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Resolve the season's final week number.
 * Priority: explicit season `total_weeks` → highest recorded week number →
 * TOTAL_WEEKS constant.
 */
export function resolveFinalWeek(
  seasonTotalWeeks?: number | null,
  weekNumbers?: ReadonlyArray<number>,
): number {
  if (typeof seasonTotalWeeks === "number" && Number.isFinite(seasonTotalWeeks) && seasonTotalWeeks > 0) {
    return Math.floor(seasonTotalWeeks);
  }
  const maxRecorded = (weekNumbers ?? []).reduce((m, w) => (w > m ? w : m), 0);
  if (maxRecorded > 0) return Math.max(maxRecorded, TOTAL_WEEKS);
  return TOTAL_WEEKS;
}

export function isFinalWeek(weekNumber: number, finalWeek: number): boolean {
  return weekNumber === finalWeek;
}

/** Returns a list of blocking warnings. Empty list ⇒ publishable. */
export function validateWeekDraft(input: ValidateWeekDraftInput): string[] {
  const { weekNumber, finalWeek, rows, activeBowlers, priorPairKeys } = input;
  const final = isFinalWeek(weekNumber, finalWeek);
  const nameOf = (id: string) => activeBowlers.find((b) => b.id === id)?.name ?? id;
  const activeIds = new Set(activeBowlers.map((b) => b.id));
  const warnings: string[] = [];

  // Lane pair / slot structure.
  const slotKeys = new Set<string>();
  for (const r of rows) {
    if (!LANE_SET.has(r.lanePair)) {
      warnings.push(`Invalid lane pair: ${r.lanePair}`);
    }
    if (!Number.isInteger(r.slot) || r.slot < 1 || r.slot > 3) {
      warnings.push(`Lanes ${r.lanePair}: invalid slot ${r.slot}`);
    }
    const k = `${r.lanePair}#${r.slot}`;
    if (slotKeys.has(k)) warnings.push(`Duplicate slot ${k}`);
    slotKeys.add(k);
  }

  // Self matchups + incomplete slots.
  let incomplete = 0;
  for (const r of rows) {
    if (!r.bowlerA || !r.bowlerB) incomplete++;
    if (r.bowlerA && r.bowlerA === r.bowlerB) {
      warnings.push(`Lanes ${r.lanePair} slot ${r.slot}: bowler cannot face themself`);
    }
  }
  if (incomplete > 0) warnings.push(`${incomplete} matchup(s) incomplete`);

  // Duplicate / unknown bowlers.
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const id of [r.bowlerA, r.bowlerB]) {
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!activeIds.has(id)) warnings.push(`Bowler ${id} is not on the active roster`);
    }
  }
  const dupes: string[] = [];
  for (const [id, c] of counts) {
    if (c > 1) dupes.push(`${nameOf(id)}×${c}`);
  }
  if (dupes.length) warnings.push(`Duplicate bowlers in week: ${dupes.join(", ")}`);

  // Every active bowler must appear exactly once.
  const missing = activeBowlers.filter((b) => !counts.has(b.id)).map((b) => b.name);
  if (missing.length) warnings.push(`Active bowler(s) not scheduled: ${missing.join(", ")}`);

  // Repeat opponents — allowed during the final-week position round only.
  if (!final) {
    for (const r of rows) {
      if (!r.bowlerA || !r.bowlerB) continue;
      if (priorPairKeys.has(pairKeyFor(r.bowlerA, r.bowlerB))) {
        warnings.push(`Lanes ${r.lanePair} slot ${r.slot}: repeat matchup from an earlier week`);
      }
    }
  }

  return warnings;
}

export const FINAL_WEEK_REPEAT_NOTE =
  "Final-week position round: repeat opponents are allowed.";
