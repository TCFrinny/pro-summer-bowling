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
      <div className="mb-4 flex items-center justify-between gap-2 rounded-md border border-border bg-accent/40 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold uppercase tracking-widest text-gold">
            Admin
          </span>
          <Link to="/admin/bowlers" className="hover:underline">Bowlers</Link>
          <Link to="/admin/schedule" className="hover:underline">Schedule</Link>
          <Link to="/admin/results" className="hover:underline">Results</Link>
        </div>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/", replace: true });
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 hover:bg-accent"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
      <Outlet />
    </AppShell>
  );
}
