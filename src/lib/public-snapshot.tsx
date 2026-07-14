/**
 * Public snapshot bridge.
 *
 * Source of truth for public pages after the Supabase migration:
 *   1. Fetch the single `public_snapshots` row for the current season.
 *   2. When present, install it into the mock-data `_snapshotProvider` so
 *      every existing `getStandingsSnapshot()` / `getBowlerHistory(id)` /
 *      etc. call transparently reads DB data.
 *   3. When absent (fresh DB, pre-import), fall back to the local seeded
 *      league-store snapshot so admin / development flows keep working, and
 *      the `PublicSnapshotGate` renders a friendly "being prepared" state
 *      on public routes.
 *   4. Subscribe once (at the root) to postgres_changes on
 *      `public.public_snapshots`; on any change, invalidate the query so
 *      every open browser refreshes without a reload.
 */

import { useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import {
  _installSnapshotProvider,
  type PublicSnapshot,
} from "@/lib/mock-data";
import { getLeagueState } from "@/lib/league-store";
import { AppShell, EmptyState, PageHeader } from "@/components/layout/AppShell";

// ---------------------------------------------------------------------------
// Provider installation
// ---------------------------------------------------------------------------

const localProvider = (): PublicSnapshot => getLeagueState().snapshot;

let currentDbSnapshot: PublicSnapshot | null = null;

/** Install (or clear) the DB snapshot as the active provider. Idempotent —
 *  safe to call on every render. */
function installDbSnapshot(snap: PublicSnapshot | null): void {
  currentDbSnapshot = snap;
  if (snap) {
    _installSnapshotProvider(() => currentDbSnapshot ?? snap);
  } else {
    _installSnapshotProvider(localProvider);
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export const SNAPSHOT_QUERY_KEY = ["public-snapshot", "current"] as const;

/** Minimal shape check. We don't re-validate every field — the writer is
 *  the same admin server fn that produced the object — but we do refuse a
 *  payload missing structural keys, so a stray/corrupt row can't crash the
 *  aggregation getters. */
function isPublicSnapshot(value: unknown): value is PublicSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.bowlers) &&
    Array.isArray(v.weeks) &&
    typeof v.bowlersById === "object" &&
    typeof v.matchesByWeek === "object" &&
    Array.isArray(v.standings) &&
    typeof v.history === "object"
  );
}

async function fetchCurrentSnapshot(): Promise<PublicSnapshot | null> {
  // Anon SELECT is allowed on both `seasons` and `public_snapshots`.
  const season = await supabase
    .from("seasons")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  if (season.error) {
    console.error("[public-snapshot] load season failed", season.error);
    return null;
  }
  if (!season.data) return null;
  const row = await supabase
    .from("public_snapshots")
    .select("snapshot")
    .eq("season_id", season.data.id)
    .maybeSingle();
  if (row.error) {
    console.error("[public-snapshot] load snapshot failed", row.error);
    return null;
  }
  if (!row.data) return null;
  return isPublicSnapshot(row.data.snapshot) ? row.data.snapshot : null;
}

export const snapshotQueryOptions = queryOptions({
  queryKey: SNAPSHOT_QUERY_KEY,
  queryFn: fetchCurrentSnapshot,
  // Snapshot is push-invalidated via realtime; keep it fresh in cache
  // between navigations so re-visiting a public route doesn't refetch.
  staleTime: 5 * 60_000,
});

// ---------------------------------------------------------------------------
// Realtime subscription (root-level, single instance)
// ---------------------------------------------------------------------------

export function useSnapshotRealtime(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("public-snapshots")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "public_snapshots" },
        () => {
          queryClient.invalidateQueries({ queryKey: SNAPSHOT_QUERY_KEY });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/** Public route wrapper. Fetches (or reads cached) DB snapshot, installs it
 *  into the mock-data provider, and either renders children or a friendly
 *  empty state when no snapshot row exists for the current season. */
export function PublicSnapshotGate({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useQuery(snapshotQueryOptions);

  // Install/uninstall on every render — cheap, avoids stale closures.
  installDbSnapshot(data ?? null);

  if (isLoading) return <>{children}</>; // let route render with local fallback until first fetch settles

  if (isError || !data) {
    return (
      <AppShell>
        <PageHeader title="Season data is being prepared" />
        <EmptyState
          title="No published season data yet"
          description="Standings, schedule, and results will appear here once the league admin publishes the current season. Check back soon."
        />
      </AppShell>
    );
  }

  return <>{children}</>;
}

/** Convenience: wraps `<Outlet />` from the root, gating only non-admin,
 *  non-auth paths. Admin routes must stay reachable without the gate. */
export function RootPublicGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPublic =
    !pathname.startsWith("/admin") && pathname !== "/admin-login";
  if (!isPublic) return <>{children}</>;
  return <PublicSnapshotGate>{children}</PublicSnapshotGate>;
}
