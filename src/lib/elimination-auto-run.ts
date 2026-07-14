/**
 * Pure helpers for the `/elimination` auto-run UX.
 *
 * All logic in this file is dependency-free and side-effect-free so it can
 * be exercised by the deterministic test suite. The route file is
 * responsible for wiring these decisions into React state.
 */

import type { EliminationRow, EliminationStatus } from "@/lib/mock-data";

export type CalculationMode = "bounds_only" | "full";

export type RunPhase = "idle" | "running" | "saving" | "error" | "success";

export interface AutoRunEligibilityInput {
  /** Whether the admin verification server call has resolved to true. */
  isAdmin: boolean;
  /** Session/admin-check still in-flight. When true, DO NOT auto-run. */
  adminCheckPending: boolean;
  /** The snapshot's stored calculation mode. */
  mode: CalculationMode;
  /** Current builtAt token of the loaded snapshot, or null when absent. */
  builtAt: number | null;
  /** Last builtAt for which an auto-run has already been launched this
   *  session. `null` means "never". */
  lastAutoRunBuiltAt: number | null;
  /** Current runtime phase of the AdminRunControls state machine. */
  phase: RunPhase;
}

/** Decide whether the admin browser should auto-launch the full solver
 *  right now. All conditions must be true:
 *   - snapshot loaded (builtAt !== null)
 *   - admin verification resolved AND positive
 *   - stored mode is bounds_only
 *   - no run/save currently in flight
 *   - we have not already launched an auto-run for this exact builtAt
 *
 *  We deliberately re-enable after a manual `error` so a subsequent
 *  builtAt (produced by any mutation) will retry, but the same builtAt
 *  will NOT retry automatically — the user must click the manual button.
 */
export function shouldAutoRunFull(input: AutoRunEligibilityInput): boolean {
  if (input.builtAt === null) return false;
  if (input.adminCheckPending) return false;
  if (!input.isAdmin) return false;
  if (input.mode !== "bounds_only") return false;
  if (input.phase === "running" || input.phase === "saving") return false;
  if (input.lastAutoRunBuiltAt === input.builtAt) return false;
  return true;
}

/** Display label for a status badge / summary tile. Only overrides the
 *  visible copy for `not_proven` while the snapshot is in `bounds_only`
 *  mode — every other status and the `full` mode keep the canonical
 *  labels defined in the route's STATUS map. */
export function displayLabelForStatus(
  status: EliminationStatus,
  mode: CalculationMode,
  fallback: string,
): string {
  if (mode === "bounds_only" && status === "not_proven") {
    return "Pending Full Calculation";
  }
  return fallback;
}

/** Notice copy shown above the table, tailored to viewer + phase. */
export function boundsNoticeCopy(input: {
  mode: CalculationMode;
  isAdmin: boolean;
  phase: RunPhase;
  lastCalculatedAt: string;
}): { heading: string; detail: string } {
  if (input.mode === "full") {
    return {
      heading: "Full schedule calculation completed.",
      detail: `Result computed ${new Date(input.lastCalculatedAt).toLocaleString()}.`,
    };
  }
  if (input.isAdmin) {
    if (input.phase === "running" || input.phase === "saving") {
      return {
        heading: "Full calculation in progress.",
        detail: "Calculating full schedule scenarios in your browser…",
      };
    }
    return {
      heading: "Full calculation pending.",
      detail: "Full calculation is starting automatically for administrators.",
    };
  }
  return {
    heading: "Full calculation pending.",
    detail:
      "Proven clinches and eliminations are shown. A full admin calculation is pending.",
  };
}

/** Convenience: count rows by status (used by the summary tiles). */
export function countByStatus(
  rows: readonly EliminationRow[],
): Record<EliminationStatus, number> {
  const acc = {} as Record<EliminationStatus, number>;
  for (const r of rows) acc[r.status] = (acc[r.status] ?? 0) + 1;
  return acc;
}
