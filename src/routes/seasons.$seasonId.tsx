/**
 * PUBLIC archived-season layout.
 *
 * Renders a shared season banner + tab nav around <Outlet /> so every
 * sub-route (/overview, /standings, /schedule, /results, /statistics,
 * /bowlers/$participantRef) reads from the same server-authorized public
 * archive detail. The current 2026 season is served via the top-level
 * `/`, `/standings`, `/schedule`, `/weekly-results`, `/statistics`, and
 * `/bowlers` routes — those are unchanged.
 */
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader, EmptyState } from "@/components/layout/AppShell";
import { getPublicSeasonDetail } from "@/lib/history-repo.functions";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/seasons/$seasonId")({
  head: () => ({
    meta: [
      { title: "Archived season — Pro Summer Singles" },
      { name: "description", content: "Historical duckpin bowling season data." },
    ],
  }),
  component: SeasonArchiveLayout,
});

function SeasonArchiveLayout() {
  const { seasonId } = Route.useParams();
  const q = useQuery({
    queryKey: ["seasons", "public", "detail", seasonId],
    queryFn: () => getPublicSeasonDetail({ data: { seasonId } }),
  });
  return (
    <AppShell>
      {q.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}
      {q.data && q.data.forbidden && (
        <>
          <PageHeader title="Season not available" />
          <EmptyState
            title="This season isn't publicly visible"
            description="Draft and privately archived seasons are not available on the public site."
          />
          <div className="mt-4"><Link to="/seasons" className="text-sm underline">Back to seasons</Link></div>
        </>
      )}
      {q.data && !q.data.forbidden && (!q.data.available || !q.data.season) && (
        <>
          <PageHeader title="Season not available" />
          <EmptyState
            title="Historical season setup is not available yet"
            description="This season is not yet configured, or the multi-season history schema hasn't been applied."
          />
          <div className="mt-4"><Link to="/seasons" className="text-sm underline">Back to seasons</Link></div>
        </>
      )}
      {q.data && q.data.available && q.data.season && (
        <>
          <PageHeader title={q.data.season.label} subtitle="Archived season">
            <Link to="/seasons" className="text-sm underline">All seasons</Link>
          </PageHeader>
          <ArchivedTabs seasonId={seasonId} />
          <Outlet />
        </>
      )}
    </AppShell>
  );
}

function ArchivedTabs({ seasonId }: { seasonId: string }) {
  const tabs: Array<{ to: string; label: string }> = [
    { to: `/seasons/${seasonId}`, label: "Overview" },
    { to: `/seasons/${seasonId}/standings`, label: "Standings" },
    { to: `/seasons/${seasonId}/schedule`, label: "Schedule" },
    { to: `/seasons/${seasonId}/results`, label: "Results" },
    { to: `/seasons/${seasonId}/statistics`, label: "Statistics" },
  ];
  return (
    <nav className="mb-4 flex flex-wrap gap-2 border-b border-border pb-2 text-sm">
      {tabs.map((t) => (
        <a key={t.to} href={t.to}
          className="rounded-md px-3 py-1 hover:bg-accent/40 text-muted-foreground [&.active]:bg-primary [&.active]:text-primary-foreground"
        >{t.label}</a>
      ))}
    </nav>
  );
}
