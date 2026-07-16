/** PUBLIC archived-season Standings. */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { EmptyState } from "@/components/layout/AppShell";

export const Route = createFileRoute("/seasons/$seasonId/standings")({
  component: StandingsPage,
});

function StandingsPage() {
  const { seasonId } = Route.useParams();
  const q = useQuery({
    queryKey: ["seasons", "public", "historical-snapshot", seasonId],
    queryFn: () => getPublicHistoricalSnapshot({ data: { seasonId } }),
  });
  const snap = q.data?.snapshot;
  if (!snap) return <EmptyState title="No standings yet" description="No cached snapshot for this season." />;
  const partById = new Map(snap.participants.map((p) => [p.ref, p] as const));
  // Sort by points desc, then pinfall desc; NULLs last. Assign natural rank.
  const rows = [...snap.standings].sort((a, b) => {
    const ap = a.points ?? -Infinity, bp = b.points ?? -Infinity;
    if (bp !== ap) return bp - ap;
    const api = a.scratchPinfall ?? -Infinity, bpi = b.scratchPinfall ?? -Infinity;
    return bpi - api;
  });
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full text-sm">
        <thead className="bg-accent/40 text-xs uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Bowler</th>
            <th className="px-3 py-2 text-right">Matches</th>
            <th className="px-3 py-2 text-right">Points</th>
            <th className="px-3 py-2 text-right">Points lost</th>
            <th className="px-3 py-2 text-right">Games</th>
            <th className="px-3 py-2 text-right">Pinfall</th>
            <th className="px-3 py-2 text-right">Avg</th>
            <th className="px-3 py-2 text-right">High G / S</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => {
            const p = partById.get(r.participantRef);
            return (
              <tr key={r.participantRef}>
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2">
                  {p?.personId
                    ? <Link to="/people/$personId" params={{ personId: p.personId }} className="underline">{r.displayName}</Link>
                    : r.displayName}
                  {r.fromSummaryOnly && <span className="ml-1 text-[10px] text-muted-foreground">(summary)</span>}
                </td>
                <td className="px-3 py-2 text-right">{r.matchesPlayed}</td>
                <td className="px-3 py-2 text-right">{r.points ?? "—"}</td>
                <td className="px-3 py-2 text-right">{r.pointsLost ?? "—"}</td>
                <td className="px-3 py-2 text-right">{r.games ?? "—"}</td>
                <td className="px-3 py-2 text-right">{r.scratchPinfall ?? "—"}</td>
                <td className="px-3 py-2 text-right">{r.scratchAverage != null ? r.scratchAverage.toFixed(1) : "—"}</td>
                <td className="px-3 py-2 text-right">{(r.highGame ?? "—") + " / " + (r.highSet ?? "—")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
