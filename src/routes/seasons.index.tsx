import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader, EmptyState } from "@/components/layout/AppShell";
import { listPublicSeasons } from "@/lib/history-repo.functions";
import { filterPublicSeasons } from "@/lib/season-history";
import { AllTimeLeaderboards } from "@/components/AllTimeLeaderboards";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/seasons/")({
  component: SeasonsPage,
});


function SeasonsPage() {
  // listPublicSeasons already filters draft / archived-private on the SERVER.
  // filterPublicSeasons here is a defense-in-depth ordering helper only.
  const q = useQuery({ queryKey: ["seasons", "public", "list"], queryFn: () => listPublicSeasons() });
  return (
    <AppShell>
      <PageHeader title="Seasons" subtitle="Current season, then archived seasons in reverse order." />
      {q.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}
      {q.error && (
        <EmptyState title="Couldn't load seasons" description="Please try again in a moment." />
      )}
      {q.data && !q.data.available && q.data.seasons.length === 0 && (
        <EmptyState
          title="Historical season setup is not available yet"
          description="The multi-season history schema hasn't been applied to the database. Current-season pages continue to work normally."
        />
      )}
      {q.data && q.data.seasons.length > 0 && (
        <SeasonsList
          seasons={filterPublicSeasons(q.data.seasons)}
          bowlerCounts={q.data.bowlerCounts}
          champions={q.data.champions ?? {}}
          legacyOnly={!q.data.available}
        />
      )}
      <AllTimeLeaderboards />
    </AppShell>
  );
}


function SeasonsList({
  seasons,
  bowlerCounts,
  champions,
  legacyOnly,
}: {
  seasons: ReturnType<typeof filterPublicSeasons>;
  bowlerCounts: Record<string, number>;
  champions: Record<string, { displayName: string; personId: string | null }>;
  legacyOnly: boolean;
}) {
  if (seasons.length === 0) {
    return <EmptyState title="No public seasons yet" description="Archived seasons will appear here once published." />;
  }
  const current = seasons[0].status === "current" ? seasons[0] : null;
  const archived = current ? seasons.slice(1) : seasons;
  return (
    <div className="space-y-6">
      {legacyOnly && (
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Historical season history isn't fully configured yet — only the current season is shown. Archived season detail becomes available once the multi-season migration is applied.
        </div>
      )}
      {current && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Current</h2>
          <SeasonCard season={current} badge="Current" bowlerCount={bowlerCounts[current.id]} champion={null} />
        </section>
      )}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Archived</h2>
        {archived.length === 0 ? (
          <EmptyState title="No archived seasons yet" description="This is the league's first tracked season." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {archived.map((s) => (
              <SeasonCard key={s.id} season={s} badge="Archived" bowlerCount={bowlerCounts[s.id]} champion={champions[s.id] ?? null} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SeasonCard({
  season,
  badge,
  bowlerCount,
  champion,
}: {
  season: ReturnType<typeof filterPublicSeasons>[number];
  badge: "Current" | "Archived";
  bowlerCount?: number;
  champion: { displayName: string; personId: string | null } | null;
}) {
  return (
    <Link
      to="/seasons/$seasonId"
      params={{ seasonId: season.id }}
      className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg font-semibold">{season.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {season.startDate ? new Date(season.startDate).toLocaleDateString() : "—"}
            {" – "}
            {season.endDate ? new Date(season.endDate).toLocaleDateString() : "—"}
          </div>
        </div>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest " +
            (badge === "Current"
              ? "bg-primary text-primary-foreground"
              : "bg-accent text-foreground")
          }
        >
          {badge}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Points</dt>
          <dd>{season.pointSystem ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Weeks</dt>
          <dd>{season.totalWeeks ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Bowlers</dt>
          <dd>{bowlerCount ?? "—"}</dd>
        </div>
      </dl>
      {champion && (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          <span aria-hidden>🏆</span>
          <span className="text-muted-foreground">Champion:</span>
          <span className="font-medium">{champion.displayName}</span>
        </div>
      )}
      {season.description && (
        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{season.description}</p>
      )}
    </Link>
  );
}
