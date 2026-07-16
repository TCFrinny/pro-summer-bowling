import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader, EmptyState } from "@/components/layout/AppShell";
import { getPublicSeasonDetail, type SeasonLanePairRow } from "@/lib/history-repo.functions";
import { summarizeLanePairs, type SeasonRecord } from "@/lib/season-history";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/seasons/$seasonId")({
  head: () => ({
    meta: [
      { title: "Season — Pro Summer Singles" },
      { name: "description", content: "Historical season summary." },
    ],
  }),
  component: SeasonDetailPage,
});

function SeasonDetailPage() {
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
          <div className="mt-4">
            <Link to="/seasons" className="text-sm underline">Back to seasons</Link>
          </div>
        </>
      )}
      {q.data && !q.data.forbidden && (!q.data.available || !q.data.season) && (
        <>
          <PageHeader title="Season not available" />
          <EmptyState
            title="Historical season setup is not available yet"
            description="This season is not yet configured, or the multi-season history schema hasn't been applied."
          />
          <div className="mt-4">
            <Link to="/seasons" className="text-sm underline">Back to seasons</Link>
          </div>
        </>
      )}
      {q.data && q.data.available && q.data.season && (
        <SeasonDetailBody
          season={q.data.season}
          lanePairs={q.data.lanePairs}
          rosteredCount={q.data.rosteredCount}
          substituteCount={q.data.substituteCount}
          champion={q.data.champion}
        />
      )}
    </AppShell>
  );
}

function SeasonDetailBody({
  season,
  lanePairs,
  rosteredCount,
  substituteCount,
  champion,
}: {
  season: SeasonRecord;
  lanePairs: SeasonLanePairRow[];
  rosteredCount: number;
  substituteCount: number;
  champion: { id: string; displayName: string } | null;
}) {
  const totals = summarizeLanePairs(lanePairs);
  return (
    <>
      <PageHeader
        title={season.label}
        subtitle={season.status === "current" ? "Current season" : "Archived season"}
      >
        <Link to="/seasons" className="text-sm underline">All seasons</Link>
      </PageHeader>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Overview</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Point system</dt>
            <dd>{season.pointSystem ?? "—"}</dd>
            <dt className="text-muted-foreground">Total weeks</dt>
            <dd>{season.totalWeeks ?? "—"}</dd>
            <dt className="text-muted-foreground">Start</dt>
            <dd>{season.startDate ? new Date(season.startDate).toLocaleDateString() : "—"}</dd>
            <dt className="text-muted-foreground">End</dt>
            <dd>{season.endDate ? new Date(season.endDate).toLocaleDateString() : "—"}</dd>
            <dt className="text-muted-foreground">Rostered</dt>
            <dd>{rosteredCount}</dd>
            <dt className="text-muted-foreground">Substitutes</dt>
            <dd>{substituteCount}</dd>
            <dt className="text-muted-foreground">Champion</dt>
            <dd>
              {champion ? (
                <Link to="/people/$personId" params={{ personId: champion.id }} className="underline">
                  {champion.displayName}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </dl>
          {season.description && (
            <p className="mt-3 text-sm text-muted-foreground">{season.description}</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Lane pair capacity</h2>
            <span className="text-xs text-muted-foreground">
              {totals.totalMatchups} matchups · {totals.bowlerCapacity} bowlers
            </span>
          </div>
          {lanePairs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not configured yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {lanePairs.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-1.5">
                  <span className="font-mono">{p.label}</span>
                  <span>{p.matchupCapacity} matchups</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="mt-6 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Historical results, weekly linescores, and full standings for this season land in the next phase.
      </section>
    </>
  );
}
