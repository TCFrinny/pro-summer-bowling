/** PUBLIC archived-season Statistics / leaderboards. */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { EmptyState } from "@/components/layout/AppShell";

export const Route = createFileRoute("/seasons/$seasonId/statistics")({
  component: StatsPage,
});

function StatsPage() {
  const { seasonId } = Route.useParams();
  const q = useQuery({
    queryKey: ["seasons", "public", "historical-snapshot", seasonId],
    queryFn: () => getPublicHistoricalSnapshot({ data: { seasonId } }),
  });
  const snap = q.data?.snapshot;
  if (!snap) return <EmptyState title="Statistics unavailable" description="No cached snapshot." />;
  const rows = snap.standings.filter((r) => r.games != null && r.games > 0);
  const byAvg = [...rows].sort((a, b) => (b.scratchAverage ?? 0) - (a.scratchAverage ?? 0)).slice(0, 10);
  const byHigh = [...rows].filter((r) => r.highGame != null).sort((a, b) => (b.highGame ?? 0) - (a.highGame ?? 0)).slice(0, 10);
  const bySet = [...rows].filter((r) => r.highSet != null).sort((a, b) => (b.highSet ?? 0) - (a.highSet ?? 0)).slice(0, 10);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Board title="Scratch Average" rows={byAvg} value={(r) => r.scratchAverage != null ? r.scratchAverage.toFixed(1) : "—"} seasonId={seasonId} />
      <Board title="High Game" rows={byHigh} value={(r) => r.highGame ?? "—"} seasonId={seasonId} />
      <Board title="High Set" rows={bySet} value={(r) => r.highSet ?? "—"} seasonId={seasonId} />
    </div>
  );
}

type Row = import("@/lib/historical-snapshot").HistoricalStandingRow;

function Board({ title, rows, value, seasonId }: {
  title: string; rows: Row[]; value: (r: Row) => string | number; seasonId: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-3 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">—</p>
      ) : (
        <ol className="divide-y divide-border text-sm">
          {rows.map((r, i) => (
            <li key={r.participantRef} className="flex items-center justify-between px-3 py-1.5">
              <span>
                <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                <Link to="/seasons/$seasonId/bowlers/$participantRef" params={{ seasonId, participantRef: r.participantRef }}
                  className="underline">{r.displayName}</Link>
              </span>
              <span className="font-mono">{value(r)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
