/** PUBLIC archived-season Schedule (all weeks; sorted by lane pair). */
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
  return (
    <div className="space-y-4">
      {snap.weeks.length === 0 && (
        <EmptyState title="No weeks yet" description="Schedule has not been entered for this season." />
      )}
      {snap.weeks.map((w) => {
        const sorted = [...w.matches].sort(compareLanePairSlotCamel);
        return (
          <section key={w.weekNumber} className="rounded-lg border border-border bg-card">
            <header className="flex items-baseline justify-between border-b border-border p-3">
              <h2 className="text-sm font-semibold">Week {w.weekNumber}</h2>
              <span className="text-xs text-muted-foreground">
                {w.date ?? "—"}{w.published ? "" : " · unpublished"}
              </span>
            </header>
            {sorted.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No slots.</p>
            ) : (
              <table className="min-w-full text-sm">
                <tbody className="divide-y divide-border">
                  {sorted.map((m) => (
                    <tr key={m.slotId}>
                      <td className="px-3 py-1 font-mono text-xs">{m.lanePair}·{m.slot}</td>
                      <td className="px-3 py-1">{m.actualNameA || m.scheduledA}{m.isSubA && <span className="ml-1 text-[10px] text-muted-foreground">(sub)</span>}</td>
                      <td className="px-1 text-center text-muted-foreground">vs</td>
                      <td className="px-3 py-1">{m.actualNameB || m.scheduledB}{m.isSubB && <span className="ml-1 text-[10px] text-muted-foreground">(sub)</span>}</td>
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
