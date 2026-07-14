/**
 * Admin save path for the full schedule-aware elimination result.
 *
 * Architecture: heavy solver runs in the ADMIN'S BROWSER (Web Worker at
 * `src/lib/elimination.worker.ts`); this file only validates the payload
 * and writes it back into `public_snapshots.snapshot.elimination`.
 *
 * The pure `validateAndMergeFullElimination` helper is exported so
 * deterministic tests exercise validation without a live DB.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type {
  EliminationRow,
  EliminationSnapshot,
  EliminationStatus,
  PublicSnapshot,
} from "@/lib/mock-data";

const ALLOWED_STATUS: ReadonlySet<EliminationStatus> = new Set([
  "clinched", "eliminated", "alive", "tiebreaker_only", "not_proven",
]);

export interface IncomingFullRow {
  bowlerId: string;
  status: EliminationStatus;
  note?: string;
  maxFinalPoints?: number;
  nextOpponent?: string;
  bestMargin?: number;
}
export interface IncomingFullElimination {
  weeksRemaining: number;
  rows: IncomingFullRow[];
  /** Optional; server always overwrites with server clock. */
  lastCalculatedAt?: string;
}

export type MergeResult =
  | { ok: true; elimination: EliminationSnapshot }
  | { ok: false; code: "stale" | "invalid"; error: string };

function finiteNonNeg(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Pure — no DB access. Validates incoming full-solver output against the
 *  currently-stored snapshot (concurrency token, active roster, enum
 *  fields, numeric bounds), rebuilds each row's `bowler` from the stored
 *  snapshot (never trusting client-supplied bowler objects), and strips
 *  `diagnostics` so the persisted snapshot stays compact. */
export function validateAndMergeFullElimination(params: {
  currentSnapshot: PublicSnapshot;
  builtAtToken: number;
  incoming: IncomingFullElimination;
  now?: () => Date;
}): MergeResult {
  const { currentSnapshot, builtAtToken, incoming } = params;
  const now = (params.now ?? (() => new Date()))().toISOString();

  if (currentSnapshot.builtAt !== builtAtToken) {
    return {
      ok: false, code: "stale",
      error:
        "League data changed while the calculation was running. Please run the full calculation again.",
    };
  }
  if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.rows)) {
    return { ok: false, code: "invalid", error: "Missing or malformed rows payload." };
  }
  if (!Number.isInteger(incoming.weeksRemaining) || incoming.weeksRemaining < 0) {
    return { ok: false, code: "invalid", error: "weeksRemaining must be a non-negative integer." };
  }

  const activeIds = new Set(currentSnapshot.bowlers.map((b) => b.id));
  const seen = new Set<string>();
  const rows: EliminationRow[] = [];

  for (const raw of incoming.rows) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, code: "invalid", error: "Row is not an object." };
    }
    if (typeof raw.bowlerId !== "string" || raw.bowlerId.length === 0) {
      return { ok: false, code: "invalid", error: "Row missing bowlerId." };
    }
    if (!activeIds.has(raw.bowlerId)) {
      return { ok: false, code: "invalid", error: `Unknown or inactive bowler id: ${raw.bowlerId}` };
    }
    if (seen.has(raw.bowlerId)) {
      return { ok: false, code: "invalid", error: `Duplicate row for bowler id: ${raw.bowlerId}` };
    }
    seen.add(raw.bowlerId);
    if (!ALLOWED_STATUS.has(raw.status)) {
      return { ok: false, code: "invalid", error: `Invalid status: ${String(raw.status)}` };
    }
    if (raw.maxFinalPoints !== undefined && !finiteNonNeg(raw.maxFinalPoints)) {
      return { ok: false, code: "invalid", error: "maxFinalPoints must be a finite non-negative number." };
    }
    if (raw.bestMargin !== undefined && (typeof raw.bestMargin !== "number" || !Number.isFinite(raw.bestMargin))) {
      return { ok: false, code: "invalid", error: "bestMargin must be a finite number." };
    }
    if (raw.note !== undefined && typeof raw.note !== "string") {
      return { ok: false, code: "invalid", error: "note must be a string." };
    }
    if (raw.nextOpponent !== undefined && typeof raw.nextOpponent !== "string") {
      return { ok: false, code: "invalid", error: "nextOpponent must be a string." };
    }

    const bowler = currentSnapshot.bowlersById[raw.bowlerId];
    if (!bowler) {
      return { ok: false, code: "invalid", error: `Bowler not present in snapshot: ${raw.bowlerId}` };
    }

    const row: EliminationRow = {
      bowler, // rebuild from current snapshot; never trust client
      status: raw.status,
    };
    if (raw.note !== undefined) row.note = raw.note;
    if (raw.maxFinalPoints !== undefined) row.maxFinalPoints = raw.maxFinalPoints;
    if (raw.nextOpponent !== undefined) row.nextOpponent = raw.nextOpponent;
    if (raw.bestMargin !== undefined) row.bestMargin = raw.bestMargin;
    // NOTE: diagnostics is intentionally not copied.
    rows.push(row);
  }

  if (seen.size !== activeIds.size) {
    const missing: string[] = [];
    for (const id of activeIds) if (!seen.has(id)) missing.push(id);
    return {
      ok: false, code: "invalid",
      error: `Missing rows for bowler id(s): ${missing.join(", ")}`,
    };
  }

  return {
    ok: true,
    elimination: {
      lastCalculatedAt: now,
      weeksRemaining: incoming.weeksRemaining,
      rows,
      calculationMode: "full",
      sourceBuiltAt: currentSnapshot.builtAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

const rowSchema = z.object({
  bowlerId: z.string().min(1),
  status: z.enum(["clinched", "eliminated", "alive", "tiebreaker_only", "not_proven"]),
  note: z.string().optional(),
  maxFinalPoints: z.number().finite().optional(),
  nextOpponent: z.string().optional(),
  bestMargin: z.number().finite().optional(),
});
const payloadSchema = z.object({
  builtAt: z.number().finite(),
  elimination: z.object({
    weeksRemaining: z.number().int().nonnegative(),
    rows: z.array(rowSchema),
    lastCalculatedAt: z.string().optional(),
  }),
});

type Sb = SupabaseClient<Database>;

async function ensureAdmin(sb: Sb): Promise<void> {
  const { data, error } = await sb.rpc("current_user_is_admin");
  if (error) throw new Error(`admin check failed: ${error.message}`);
  if (data !== true) throw new Error("Forbidden: admin role required");
}

export const saveFullEliminationResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => payloadSchema.parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as Sb;
    await ensureAdmin(sb);

    const season = await sb
      .from("seasons").select("id").eq("is_current", true).maybeSingle();
    if (season.error) throw new Error(season.error.message);
    if (!season.data) throw new Error("No current season configured.");

    const row = await sb
      .from("public_snapshots")
      .select("snapshot")
      .eq("season_id", season.data.id)
      .maybeSingle();
    if (row.error) throw new Error(row.error.message);
    if (!row.data) throw new Error("No public snapshot exists yet — rebuild first.");

    const currentSnapshot = row.data.snapshot as unknown as PublicSnapshot;
    const merged = validateAndMergeFullElimination({
      currentSnapshot,
      builtAtToken: data.builtAt,
      incoming: data.elimination,
    });
    if (!merged.ok) {
      const err = new Error(merged.error) as Error & { code?: string };
      err.code = merged.code;
      throw err;
    }

    const nextSnapshot: PublicSnapshot = {
      ...currentSnapshot,
      elimination: merged.elimination,
    };

    const up = await sb
      .from("public_snapshots")
      .update({
        snapshot: nextSnapshot as unknown as Database["public"]["Tables"]["public_snapshots"]["Update"]["snapshot"],
      })
      .eq("season_id", season.data.id);
    if (up.error) throw new Error(up.error.message);

    return { ok: true, mode: merged.elimination.calculationMode, sourceBuiltAt: merged.elimination.sourceBuiltAt };
  });
