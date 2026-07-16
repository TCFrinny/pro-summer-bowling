import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { useSession } from "@/hooks/use-session";
import { getIsAdmin, ensureCurrentSeason } from "@/lib/auth.functions";
import { rebuildCurrentSeasonSnapshot } from "@/lib/league-repo.functions";
import { SNAPSHOT_QUERY_KEY } from "@/lib/public-snapshot";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ShieldAlert, LogOut, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/admin")({
  // Supabase session lives in localStorage; only the browser can read it.
  // Prerender/SSR would always see "signed out" and flash the login redirect.
  ssr: false,
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: AdminLayout,
});

type GateState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "not-admin"; email: string | undefined }
  | { kind: "check-failed"; email: string | undefined }
  | { kind: "admin" };

function AdminLayout() {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [gate, setGate] = useState<GateState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (loading) {
      setGate({ kind: "loading" });
      return;
    }
    if (!session) {
      setGate({ kind: "signed-out" });
      // Preserve where the user was trying to go.
      const redirect = encodeURIComponent(pathname);
      navigate({ to: "/admin-login", search: { redirect } as never, replace: true });
      return;
    }
    setGate({ kind: "loading" });
    getIsAdmin()
      .then(async (r) => {
        if (cancelled) return;
        if (!r.isAdmin) {
          setGate({ kind: "not-admin", email: session.user.email });
          return;
        }
        // Best-effort season bootstrap. Never blocks admin from working.
        ensureCurrentSeason().catch((err) =>
          console.warn("ensureCurrentSeason failed", err),
        );
        setGate({ kind: "admin" });
      })
      .catch((err) => {
        console.error("getIsAdmin threw", err);
        if (cancelled) return;
        // A thrown exception (network failure, missing SUPABASE_* runtime
        // variables on the Worker, RPC error) is NOT the same as a legitimate
        // { isAdmin: false } response. Surface a distinct state so admins can
        // tell "you lack the role" apart from "the server can't tell right now".
        setGate({ kind: "check-failed", email: session.user.email });
      });
    return () => {
      cancelled = true;
    };
  }, [session, loading, navigate, pathname]);

  if (gate.kind === "loading" || gate.kind === "signed-out") {
    return (
      <AppShell>
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Checking admin access…
        </div>
      </AppShell>
    );
  }

  if (gate.kind === "not-admin" || gate.kind === "check-failed") {
    const isFailure = gate.kind === "check-failed";
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <h1 className="font-display text-xl font-semibold">
            {isFailure ? "Admin verification unavailable" : "Not authorized"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isFailure ? (
              <>
                The server could not verify your admin access. Check the
                Cloudflare runtime variables and try again. You're signed in
                as <span className="font-mono">{gate.email ?? "unknown"}</span>.
              </>
            ) : (
              <>
                You're signed in as <span className="font-mono">{gate.email ?? "unknown"}</span>,
                but that account doesn't have the admin role. Ask a league
                administrator to grant your account access.
              </>
            )}
          </p>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/admin-login", replace: true });
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <AdminHeaderBar
        onSignOut={async () => {
          await supabase.auth.signOut();
          navigate({ to: "/", replace: true });
        }}
      />
      <Outlet />
    </AppShell>
  );
}

/** Admin-only header bar. Rendered only after positive admin verification
 *  (gate.kind === "admin"). Hosts nav, snapshot rebuild, and sign-out. */
export function AdminHeaderBar({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  const queryClient = useQueryClient();
  const [rebuildState, setRebuildState] = useState<
    { kind: "idle" }
    | { kind: "running" }
    | { kind: "success" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleRebuild() {
    setRebuildState({ kind: "running" });
    try {
      // Cheap bounds-only rebuild on the server. The full elimination
      // solver stays on the elimination page (browser worker) and is NOT
      // triggered here.
      await rebuildCurrentSeasonSnapshot();
      await queryClient.invalidateQueries({ queryKey: SNAPSHOT_QUERY_KEY });
      setRebuildState({ kind: "success" });
      window.setTimeout(() => {
        setRebuildState((s) => (s.kind === "success" ? { kind: "idle" } : s));
      }, 3000);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Rebuild failed. Please try again.";
      setRebuildState({ kind: "error", message });
    }
  }

  const running = rebuildState.kind === "running";
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-accent/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold uppercase tracking-widest text-gold">
          Admin
        </span>
        <Link to="/admin/bowlers" className="hover:underline">Bowlers</Link>
        <Link to="/admin/schedule" className="hover:underline">Schedule</Link>
        <Link to="/admin/results" className="hover:underline">Results</Link>
        <Link to="/admin/live-scoring" className="hover:underline">Live Scoring</Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {rebuildState.kind === "success" && (
          <span className="text-emerald-600 dark:text-emerald-400" role="status">
            Snapshot rebuilt.
          </span>
        )}
        {rebuildState.kind === "error" && (
          <span className="text-destructive" role="alert">
            {rebuildState.message}
          </span>
        )}
        <button
          type="button"
          onClick={handleRebuild}
          disabled={running}
          aria-busy={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rebuilding…
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" /> Rebuild Snapshot
            </>
          )}
        </button>
        <button
          onClick={onSignOut}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 hover:bg-accent"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </div>
  );
}
