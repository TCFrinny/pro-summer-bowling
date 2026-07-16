/**
 * PUBLIC archived-season overview leaf (URL: `/seasons/$seasonId`).
 * Renders under the layout in `seasons.$seasonId.tsx`.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getPublicSeasonDetail, type SeasonLanePairRow } from "@/lib/history-repo.functions";
import { getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { summarizeLanePairs, type SeasonRecord } from "@/lib/season-history";
import { compareLanePairLabel } from "@/lib/lane-pair-order";

export const Route = createFileRoute("/seasons/$seasonId/")({
  component: OverviewPage,
});

function OverviewPage() {
  const { seasonId } = Route.useParams();
  const detail = useQuery({
    queryKey: ["seasons", "public", "detail", seasonId],
    queryFn: () => getPublicSeasonDetail({ data: { seasonId } }),
  });
  const snap = useQuery({
    queryKey: ["seasons", "public", "historical-snapshot", seasonId],
    queryFn: () => getPublicHistoricalSnapshot({ data: { seasonId } }),
  });
  if (!detail.data?.available || !detail.data.season) return null;
  return (
    <OverviewBody
      season={detail.data.season}
      lanePairs={detail.data.lanePairs}
      rosteredCount={detail.data.rosteredCount}
      substituteCount={detail.data.substituteCount}
      champion={detail.data.champion}
      hasSnapshot={!!snap.data?.snapshot}
      snapshotBuiltAt={snap.data?.snapshot ? snap.data.builtAt ?? null : null}
    />
  );
}

function OverviewBody({
  season, lanePairs, rosteredCount, substituteCount, champion, hasSnapshot, snapshotBuiltAt,
}: {
  season: SeasonRecord; lanePairs: SeasonLanePairRow[];
  rosteredCount: number; substituteCount: number;
  champion: { id: string; displayName: string } | null;
  hasSnapshot: boolean; snapshotBuiltAt: string | null;
}) {
  const totals = summarizeLanePairs(lanePairs);
  const sortedLanes = [...lanePairs].sort((a, b) => compareLanePairLabel(a.label, b.label));
  return (
    <section className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Overview</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Point system</dt><dd>{season.pointSystem ?? "—"}</dd>
          <dt className="text-muted-foreground">Total weeks</dt><dd>{season.totalWeeks ?? "—"}</dd>
          <dt className="text-muted-foreground">Start</dt><dd>{season.startDate ? new Date(season.startDate).toLocaleDateString() : "—"}</dd>
          <dt className="text-muted-foreground">End</dt><dd>{season.endDate ? new Date(season.endDate).toLocaleDateString() : "—"}</dd>
          <dt className="text-muted-foreground">Rostered</dt><dd>{rosteredCount}</dd>
          <dt className="text-muted-foreground">Substitutes</dt><dd>{substituteCount}</dd>
          <dt className="text-muted-foreground">Champion</dt>
          <dd>{champion
            ? <Link to="/people/$personId" params={{ personId: champion.id }} className="underline">{champion.displayName}</Link>
            : "—"}</dd>
        </dl>
        {season.description && <p className="mt-3 text-sm text-muted-foreground">{season.description}</p>}
        {!hasSnapshot && (
          <p className="mt-3 rounded border border-dashed border-border p-2 text-xs text-muted-foreground">
            No cached snapshot yet. Some tabs may be empty until an admin rebuilds it.
          </p>
        )}
        {snapshotBuiltAt && (
          <p className="mt-2 text-[10px] text-muted-foreground">Snapshot built {new Date(snapshotBuiltAt).toLocaleString()}</p>
        )}
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Lane pair capacity</h2>
          <span className="text-xs text-muted-foreground">{totals.totalMatchups} matchups · {totals.bowlerCapacity} bowlers</span>
        </div>
        {sortedLanes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not configured yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {sortedLanes.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-1.5">
                <span className="font-mono">{p.label}</span><span>{p.matchupCapacity} matchups</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
