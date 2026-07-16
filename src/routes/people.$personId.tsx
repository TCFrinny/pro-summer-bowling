import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader, EmptyState } from "@/components/layout/AppShell";
import { Loader2 } from "lucide-react";
import { getCareerProfile } from "@/lib/history-repo.functions";
import { getHistoricalCareerContributions } from "@/lib/historical-repo.functions";
import {
  aggregateCareerTotals,
  mergeHistoricalIntoCareer,
  type CareerSeasonRow,
} from "@/lib/season-history";

export const Route = createFileRoute("/people/$personId")({
  head: () => ({
    meta: [
      { title: "Career — Pro Summer Singles" },
      { name: "description", content: "Permanent career profile across every season." },
    ],
  }),
  component: PersonPage,
});

function PersonPage() {
  const { personId } = Route.useParams();
  const q = useQuery({
    queryKey: ["people", "career", personId],
    queryFn: () => getCareerProfile({ data: { personId } }),
  });
  const hist = useQuery({
    queryKey: ["people", "career-historical", personId],
    queryFn: () => getHistoricalCareerContributions({ data: { personId } }),
  });
  return (
    <AppShell>
      {q.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}
      {q.data && !q.data.available && (
        <>
          <PageHeader title="Career profile" />
          <EmptyState
            title="Career profiles not available yet"
            description="Apply the pending multi-season history migration to enable permanent people and cross-season profiles."
          />
        </>
      )}
      {q.data && q.data.available && !q.data.person && (
        <>
          <PageHeader title="Person not found" />
          <EmptyState title="This person does not exist" description="They may have been merged into another record." />
        </>
      )}
      {q.data && q.data.available && q.data.person && (
        <>
          <PageHeader
            title={q.data.person.displayName}
            subtitle="All publicly visible seasons this person has been linked to."
          >
            <Link to="/bowlers" className="text-sm underline">Roster</Link>
          </PageHeader>
          <CareerBody
            rows={mergeHistoricalIntoCareer(q.data.rows, hist.data ?? [])}
          />
          {q.data.person.notes && (
            <p className="mt-4 text-sm text-muted-foreground">{q.data.person.notes}</p>
          )}
        </>
      )}
    </AppShell>
  );
}

function CareerBody({ rows }: { rows: CareerSeasonRow[] }) {
  const sorted = [...rows].sort((a, b) => a.seasonLabel.localeCompare(b.seasonLabel));
  const totals = aggregateCareerTotals(sorted);
  if (sorted.length === 0) {
    return <EmptyState title="No public seasons yet" description="This person has no public rostered or substitute record." />;
  }
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Seasons" value={totals.seasonsCount} />
        <Stat label="Championships" value={totals.championships} />
        <Stat label="Games (avail.)" value={totals.totalGames || "—"} />
        <Stat label="Avg (avail.)" value={totals.average != null ? totals.average.toFixed(1) : "—"} />
        <Stat label="Seasons w/ game data" value={totals.seasonsWithGameData} />
      </section>
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-3 text-sm font-semibold">Season history</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-accent/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Season</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Name / #</th>
                <th className="px-3 py-2 text-right">Start Avg</th>
                <th className="px-3 py-2 text-right">HDCP</th>
                <th className="px-3 py-2 text-right">Games</th>
                <th className="px-3 py-2 text-right">Avg</th>
                <th className="px-3 py-2 text-right">High G / S</th>
                <th className="px-3 py-2 text-right">Points</th>
                <th className="px-3 py-2 text-right">Finish</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((r, i) => (
                <tr key={`${r.seasonId}-${r.role}-${i}`}>
                  <td className="px-3 py-2">
                    <Link to="/seasons/$seasonId" params={{ seasonId: r.seasonId }} className="underline">
                      {r.seasonLabel}
                    </Link>
                    {r.isChampion && <span className="ml-1 text-gold" aria-label="Champion">★</span>}
                  </td>
                  <td className="px-3 py-2 capitalize">{r.role}</td>
                  <td className="px-3 py-2">
                    {r.seasonalName}
                    {r.bowlerNumber && <span className="ml-1 text-xs text-muted-foreground">#{r.bowlerNumber}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{r.startingAverage ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.handicap ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.games ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.average != null ? r.average.toFixed(1) : "—"}</td>
                  <td className="px-3 py-2 text-right">{(r.highGame ?? "—") + " / " + (r.highSet ?? "—")}</td>
                  <td className="px-3 py-2 text-right">{r.points ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.finalFinish ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border p-3 text-xs text-muted-foreground">
          Season data comes from that season's saved public snapshot or historical archive. Missing values are dashes, never zero.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{value}</div>
    </div>
  );
}
