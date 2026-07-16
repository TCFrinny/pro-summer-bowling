import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/layout/AppShell";
import { listSeasons } from "@/lib/history-repo.functions";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/seasons")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: AdminSeasonsPage,
});

function AdminSeasonsPage() {
  const q = useQuery({ queryKey: ["admin", "seasons"], queryFn: () => listSeasons() });
  return (
    <>
      <PageHeader
        title="Seasons"
        subtitle="Create, configure, and archive seasons. Historical season editing is scaffolded here; full historical results land in the next phase."
      />
      {q.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}
      {q.data && !q.data.available && (
        <EmptyState
          title="Historical season setup is not available yet"
          description="Apply the pending migration `db/pending-migrations/20260716_120000_seasons_people_phase.sql` to enable season history management."
        />
      )}
      {q.data && q.data.available && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-accent/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Label</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Visibility</th>
                <th className="px-3 py-2 text-right">Points</th>
                <th className="px-3 py-2 text-right">Weeks</th>
                <th className="px-3 py-2 text-left">Dates</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.seasons.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium">{s.label}</td>
                  <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                  <td className="px-3 py-2 text-xs">{s.publicVisible ? "Public" : "Private"}</td>
                  <td className="px-3 py-2 text-right">{s.pointSystem ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{s.totalWeeks ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.startDate ? new Date(s.startDate).toLocaleDateString() : "—"}
                    {" – "}
                    {s.endDate ? new Date(s.endDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link to="/seasons/$seasonId" params={{ seasonId: s.id }} className="text-xs underline">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Full season create/edit/lane-pair configuration forms will be added in the next phase. Backing tables and safe reads are wired now so the current season is never disturbed.
      </p>
    </>
  );
}

function StatusBadge({ status }: { status: "current" | "draft" | "archived" }) {
  const cls =
    status === "current"
      ? "bg-primary text-primary-foreground"
      : status === "archived"
        ? "bg-accent text-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${cls}`}>
      {status}
    </span>
  );
}
