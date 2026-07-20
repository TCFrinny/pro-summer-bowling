/** PUBLIC archived-season Statistics / leaderboards. */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { EmptyState } from "@/components/layout/AppShell";
import {
  computeSeasonRatings, formatRating,
  leaderboardOffense, leaderboardDefense, leaderboardTwoWay,
} from "@/lib/ratings";
import { ratingGamesFromHistoricalSnapshot } from "@/lib/ratings-extract";

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
  const ratings = useMemo(() => {
    if (!snap) return null;
    const nameOf = (ref: string) =>
      snap.participants.find((p) => p.ref === ref)?.displayName ?? ref;
    const rows = ratingGamesFromHistoricalSnapshot(snap);
    const base = computeSeasonRatings(rows).map((r) => ({ ...r, displayName: nameOf(r.personRef) }));
    return {
      offense: leaderboardOffense(base).slice(0, 10),
      defense: leaderboardDefense(base).slice(0, 10),
      twoWay: leaderboardTwoWay(base).slice(0, 10),
    };
  }, [snap]);
  if (!snap) return <EmptyState title="Statistics unavailable" description="No cached snapshot." />;
  const rows = snap.standings.filter((r) => r.games != null && r.games > 0);
  const byAvg = [...rows].sort((a, b) => (b.scratchAverage ?? 0) - (a.scratchAverage ?? 0)).slice(0, 10);
  const byHigh = [...rows].filter((r) => r.highGame != null).sort((a, b) => (b.highGame ?? 0) - (a.highGame ?? 0)).slice(0, 10);
  const bySet = [...rows].filter((r) => r.highSet != null).sort((a, b) => (b.highSet ?? 0) - (a.highSet ?? 0)).slice(0, 10);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Board title="Scratch Average" rows={byAvg} value={(r) => r.scratchAverage != null ? r.scratchAverage.toFixed(1) : "—"} seasonId={seasonId} />
        <Board title="High Game" rows={byHigh} value={(r) => r.highGame ?? "—"} seasonId={seasonId} />
        <Board title="High Set" rows={bySet} value={(r) => r.highSet ?? "—"} seasonId={seasonId} />
      </div>

      {ratings && (
        <section className="rounded-lg border border-border bg-card/60 p-4">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg">
              Offense &amp; Matchup Defense
              <span className="ml-2 text-xs uppercase tracking-widest text-muted-foreground">Experimental</span>
            </h2>
          </header>
          <div className="grid gap-3 md:grid-cols-3">
            <RatingBoard title="Offense" seasonId={seasonId} rows={ratings.offense.map((r) => ({
              id: r.personRef, name: r.displayName, value: r.offensiveRating!, sample: r.details.actualGames }))} />
            <RatingBoard title="Matchup Defense" seasonId={seasonId} rows={ratings.defense.map((r) => ({
              id: r.personRef, name: r.displayName, value: r.matchupDefense!, sample: r.details.opponentGames }))} />
            <RatingBoard title="Two-Way" seasonId={seasonId} rows={ratings.twoWay.map((r) => ({
              id: r.personRef, name: r.displayName, value: r.twoWayRating!, sample: Math.min(r.details.actualGames, r.details.opponentGames) }))} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Ratings are centered at 100 (season average). Requires ≥6 games for offense, ≥6 opponent games for defense.
          </p>
        </section>
      )}
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

function RatingBoard({ title, rows, seasonId }: {
  title: string;
  seasonId: string;
  rows: Array<{ id: string; name: string; value: number; sample: number }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-3 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">Not enough data yet.</p>
      ) : (
        <ol className="divide-y divide-border text-sm">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-1.5">
              <span>
                <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                <Link to="/seasons/$seasonId/bowlers/$participantRef"
                  params={{ seasonId, participantRef: r.id }} className="underline">{r.name}</Link>
                <span className="ml-2 text-[10px] text-muted-foreground">{r.sample}g</span>
              </span>
              <span className="font-mono tabular-nums">{formatRating(r.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
