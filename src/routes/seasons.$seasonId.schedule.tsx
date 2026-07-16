/** PUBLIC archived-season Schedule. Shows EVERY scheduled slot (played or
 *  not) using the frozen scheduled bowler names, sorted by natural lane
 *  pair order. Weekly Results shows only saved results. */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { EmptyState } from "@/components/layout/AppShell";
import { compareLanePairSlotCamel } from "@/lib/lane-pair-order";

export const Route = createFileRoute("/seasons/$seasonId/schedule")({
  component: SchedulePage,
});

function SchedulePage() {
  const { seasonId } = Route.useParams();
  const q = useQuery({
    queryKey: ["seasons", "public", "historical-snapshot", seasonId],
    queryFn: () => getPublicHistoricalSnapshot({ data: { seasonId } }),
  });
  const snap = q.data?.snapshot;
  if (!snap) return <EmptyState title="Schedule unavailable" description="No cached snapshot for this season." />;
  if (snap.weeks.length === 0) {
    return <EmptyState title="No weeks yet" description="Schedule has not been entered for this season." />;
  }
  return (
    <div className="space-y-4">
      {snap.weeks.map((w) => {
        const rows = [...(w.schedule ?? [])].sort(compareLanePairSlotCamel);
        return (
          <section key={w.weekNumber} className="rounded-lg border border-border bg-card">
            <header className="flex items-baseline justify-between border-b border-border p-3">
              <h2 className="text-sm font-semibold">Week {w.weekNumber}</h2>
              <span className="text-xs text-muted-foreground">
                {w.date ?? "—"}{w.published ? "" : " · unpublished"}
              </span>
            </header>
            {rows.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No slots.</p>
            ) : (
              <table className="min-w-full text-sm">
                <tbody className="divide-y divide-border">
                  {rows.map((s) => (
                    <tr key={s.slotId} data-testid={`archived-slot-${s.slotId}`}>
                      <td className="px-3 py-1 font-mono text-xs">{s.lanePair}·{s.slot}</td>
                      <td className="px-3 py-1">{s.nameA}</td>
                      <td className="px-1 text-center text-muted-foreground">vs</td>
                      <td className="px-3 py-1">{s.nameB}</td>
                      <td className="px-3 py-1 text-right text-[10px] uppercase text-muted-foreground">
                        {s.hasResult ? "played" : "scheduled"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
