import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  formatPoints,
  getEliminationSnapshot,
  getStandingsSnapshot,
  type EliminationRow,
  type EliminationSnapshot,
  type EliminationStatus,
} from "@/lib/mock-data";
import { sortEliminationRowsByStandings } from "@/lib/elimination-order";
import { useLeagueSnapshot } from "@/lib/league-store";
import { snapshotQueryOptions } from "@/lib/public-snapshot";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { saveFullEliminationResult } from "@/lib/elimination-repo.functions";
import { useSession } from "@/hooks/use-session";
import { getIsAdmin } from "@/lib/auth.functions";
import {
  boundsNoticeCopy,
  countByStatus,
  displayLabelForStatus,
  holdingCardCopy,
  shouldAutoRunFull,
  shouldShowFullResults,
  type CalculationMode,
  type RunPhase,
} from "@/lib/elimination-auto-run";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2, XCircle, Circle, HelpCircle, Loader2, Scale, PlayCircle, AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/elimination")({
  head: () => ({
    meta: [
      { title: "Elimination — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Saved elimination proofs: clinched, alive, eliminated, tiebreaker only, and not proven within limit.",
      },
    ],
  }),
  component: EliminationPage,
});

const STATUS: Record<
  EliminationStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  calculating: {
    label: "Calculating",
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    className: "bg-accent text-muted-foreground",
  },
  clinched: {
    label: "Proven Clinched",
    icon: <CheckCircle2 className="h-4 w-4" />,
    className: "bg-gold text-gold-foreground",
  },
  eliminated: {
    label: "Proven Eliminated",
    icon: <XCircle className="h-4 w-4" />,
    className: "bg-primary/25 text-primary",
  },
  alive: {
    label: "Alive",
    icon: <Circle className="h-4 w-4" />,
    className: "bg-emerald-500/20 text-emerald-300",
  },
  tiebreaker_only: {
    label: "Tiebreaker Only",
    icon: <Scale className="h-4 w-4" />,
    className: "bg-amber-500/20 text-amber-300",
  },
  not_proven: {
    label: "Not Proven Within Limit",
    icon: <HelpCircle className="h-4 w-4" />,
    className: "bg-secondary text-secondary-foreground",
  },
};

type RunState =
  | { kind: "idle" }
  | { kind: "running"; note: string }
  | { kind: "saving" }
  | { kind: "error"; message: string; stale: boolean }
  | { kind: "success" };

function phaseOf(state: RunState): RunPhase {
  return state.kind;
}

function EliminationPage() {
  useLeagueSnapshot(); // re-render when snapshot refreshes
  const snap = getEliminationSnapshot();
  const standings = getStandingsSnapshot();
  const orderedRows = sortEliminationRowsByStandings(snap.rows, standings);
  const counts = countByStatus(snap.rows);
  const mode: CalculationMode = snap.calculationMode ?? "bounds_only";

  return (
    <AppShell>
      <PageHeader
        title="Elimination"
        subtitle="Displays the last saved elimination proof set. Recalculation only runs when the admin publishes new results."
      />

      <AdminAutoRun mode={mode} lastCalculatedAt={snap.lastCalculatedAt} />

      <Card className="mb-6 bg-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 font-display text-xl">
            <span>Snapshot</span>
            <span className="text-xs font-normal text-muted-foreground">
              Last calculated {new Date(snap.lastCalculatedAt).toLocaleString()} ·{" "}
              {snap.weeksRemaining} weeks remaining
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          {(Object.keys(STATUS) as EliminationStatus[]).map((s) => (
            <div key={s} className={`rounded-md p-3 text-sm ${STATUS[s].className}`}>
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest opacity-90">
                {STATUS[s].icon} {displayLabelForStatus(s, mode, STATUS[s].label)}
              </div>
              <div className="font-display text-2xl">{counts[s] ?? 0}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-accent/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3 text-left">Bowler</th>
              <th className="px-3 py-3 text-right">Points</th>
              <th className="px-3 py-3 text-left">Status</th>
              <th className="px-3 py-3 text-left">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orderedRows.map((r) => (
              <tr key={r.bowler.id} className="align-top hover:bg-accent/30">
                <td className="px-3 py-2 font-medium">{r.bowler.name}</td>
                <td className="px-3 py-2 text-right font-display text-base text-gold">
                  {formatPoints(r.bowler.points)}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${STATUS[r.status].className}`}>
                    {STATUS[r.status].icon}{" "}
                    {displayLabelForStatus(r.status, mode, STATUS[r.status].label)}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.note ?? "—"}
                  {(r.maxFinalPoints != null || r.nextOpponent || r.bestMargin != null) && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] uppercase tracking-widest opacity-75">
                      {r.maxFinalPoints != null && <span>Max {formatPoints(r.maxFinalPoints)}</span>}
                      {r.nextOpponent && <span>Next {r.nextOpponent}</span>}
                      {r.bestMargin != null && <span>Margin {formatPoints(r.bestMargin)}</span>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Notice + admin auto-run controls
// ---------------------------------------------------------------------------

interface AdminAutoRunProps {
  mode: CalculationMode;
  lastCalculatedAt: string;
}

function AdminAutoRun({ mode, lastCalculatedAt }: AdminAutoRunProps) {
  const { session, loading: sessionLoading } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckPending, setAdminCheckPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (sessionLoading) { setAdminCheckPending(true); return; }
    if (!session) {
      setIsAdmin(false); setAdminCheckPending(false); return;
    }
    setAdminCheckPending(true);
    getIsAdmin()
      .then((r) => { if (!cancelled) { setIsAdmin(!!r.isAdmin); setAdminCheckPending(false); } })
      .catch(() => { if (!cancelled) { setIsAdmin(false); setAdminCheckPending(false); } });
    return () => { cancelled = true; };
  }, [session, sessionLoading]);

  const queryClient = useQueryClient();
  const { data: snapshot } = useQuery(snapshotQueryOptions);
  const saveFn = useServerFn(saveFullEliminationResult);
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const lastAutoRunBuiltAtRef = useRef<number | null>(null);

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null; }, []);

  const runFull = useCallback(async () => {
    if (!snapshot) return;
    setState({ kind: "running", note: "Starting calculation…" });
    try {
      const worker = new Worker(
        new URL("../lib/elimination.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;
      const totalWeeks = Math.max(snapshot.weeks.length, 11);
      const result = await new Promise<EliminationSnapshot>((resolve, reject) => {
        worker.onmessage = (evt: MessageEvent<
          { kind: "result"; snapshot: EliminationSnapshot } | { kind: "error"; error: string }
        >) => {
          if (evt.data.kind === "result") resolve(evt.data.snapshot);
          else reject(new Error(evt.data.error));
        };
        worker.onerror = (e) => reject(new Error(e.message || "Worker error"));
        worker.postMessage({
          kind: "run",
          input: {
            activeBowlers: snapshot.bowlers,
            weeks: snapshot.weeks,
            matchesByWeek: snapshot.matchesByWeek,
            totalWeeks,
          },
        });
      });
      worker.terminate();
      workerRef.current = null;

      setState({ kind: "saving" });
      await saveFn({
        data: {
          builtAt: snapshot.builtAt,
          elimination: {
            weeksRemaining: result.weeksRemaining,
            rows: result.rows.map((r: EliminationRow) => ({
              bowlerId: r.bowler.id,
              status: r.status,
              note: r.note,
              maxFinalPoints: r.maxFinalPoints,
              nextOpponent: r.nextOpponent,
              bestMargin: r.bestMargin,
              // diagnostics intentionally omitted
            })),
          },
        },
      });

      setState({ kind: "success" });
      await queryClient.invalidateQueries({ queryKey: snapshotQueryOptions.queryKey });
    } catch (err) {
      workerRef.current?.terminate();
      workerRef.current = null;
      const msg = err instanceof Error ? err.message : String(err);
      const stale = /League data changed/i.test(msg);
      setState({ kind: "error", message: msg, stale });
    }
  }, [snapshot, saveFn, queryClient]);

  // Auto-run: once per builtAt when eligible. The ref guard prevents
  // re-launch loops when React double-invokes effects in dev, when the
  // query object changes identity, or when a successful save invalidates
  // the query and returns a `full`-mode snapshot (that path fails the
  // mode guard anyway, but the ref keeps the invariant explicit).
  useEffect(() => {
    const builtAt = snapshot?.builtAt ?? null;
    const eligible = shouldAutoRunFull({
      isAdmin,
      adminCheckPending,
      mode,
      builtAt,
      lastAutoRunBuiltAt: lastAutoRunBuiltAtRef.current,
      phase: phaseOf(state),
    });
    if (!eligible || builtAt === null) return;
    lastAutoRunBuiltAtRef.current = builtAt;
    void runFull();
  }, [snapshot, isAdmin, adminCheckPending, mode, state, runFull]);

  const phase = phaseOf(state);
  const notice = boundsNoticeCopy({ mode, isAdmin, phase, lastCalculatedAt });
  const running = phase === "running" || phase === "saving";

  return (
    <>
      <div
        className={`mb-4 flex items-start gap-2 rounded-md border p-3 text-xs ${
          mode === "bounds_only"
            ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
        }`}
      >
        {mode === "bounds_only" ? (
          <AlertTriangle className="mt-0.5 h-4 w-4" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4" />
        )}
        <div>
          <div className="font-semibold">{notice.heading}</div>
          <div className="opacity-80">{notice.detail}</div>
        </div>
      </div>

      {isAdmin && snapshot && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-accent/30 p-3 text-xs">
          <button
            onClick={runFull}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Run Full Calculation
          </button>
          {phase === "running" && (
            <span className="text-muted-foreground">
              Calculating full schedule scenarios in your browser…
            </span>
          )}
          {phase === "saving" && <span className="text-muted-foreground">Saving results…</span>}
          {state.kind === "success" && <span className="text-emerald-300">Full calculation saved.</span>}
          {state.kind === "error" && (
            <span className="text-destructive">
              {state.stale
                ? "League data changed while the calculation was running. Please run it again."
                : `Failed: ${state.message}`}
            </span>
          )}
        </div>
      )}
    </>
  );
}
