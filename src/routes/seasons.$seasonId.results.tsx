/** PUBLIC archived-season Weekly Results. */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { EmptyState } from "@/components/layout/AppShell";
import { compareLanePairSlotCamel } from "@/lib/lane-pair-order";

export const Route = createFileRoute("/seasons/$seasonId/results")({
  component: ResultsPage,
});

function ResultsPage() {
  const { seasonId } = Route.useParams();
  const q = useQuery({
    queryKey: ["seasons", "public", "historical-snapshot", seasonId],
    queryFn: () => getPublicHistoricalSnapshot({ data: { seasonId } }),
  });
  const snap = q.data?.snapshot;
  if (!snap) return <EmptyState title="Results unavailable" description="No cached snapshot for this season." />;
  return (
    <div className="space-y-4">
      {snap.weeks.map((w) => {
        const sorted = [...w.matches].sort(compareLanePairSlotCamel);
        if (sorted.length === 0) return null;
        return (
          <section key={w.weekNumber} className="rounded-lg border border-border bg-card">
            <header className="flex items-baseline justify-between border-b border-border p-3">
              <h2 className="text-sm font-semibold">Week {w.weekNumber}</h2>
              <span className="text-xs text-muted-foreground">{w.date ?? "—"} · {sorted.length} matches</span>
            </header>
            <table className="min-w-full text-sm">
              <thead className="bg-accent/30 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-1 text-left">Lane</th>
                  <th className="px-3 py-1 text-left">Bowler</th>
                  <th className="px-2 py-1 text-right">G1</th>
                  <th className="px-2 py-1 text-right">G2</th>
                  <th className="px-2 py-1 text-right">G3</th>
                  <th className="px-2 py-1 text-right">Scratch</th>
                  <th className="px-2 py-1 text-right">HDCP set</th>
                  <th className="px-2 py-1 text-right">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((m) => (
                  <MatchRows key={m.slotId} m={m} />
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {snap.weeks.every((w) => w.matches.length === 0) && (
        <EmptyState title="No results" description="No match results have been entered yet." />
      )}
    </div>
  );
}

function MatchRows({ m }: { m: import("@/lib/historical-snapshot").HistoricalMatch }) {
  const rowA = (
    <tr>
      <td rowSpan={2} className="px-3 py-1 align-top font-mono text-xs">{m.lanePair}·{m.slot}</td>
      <td className="px-3 py-1">
        {m.actualNameA || m.scheduledA}
        {m.isSubA && <span className="ml-1 text-[10px] text-muted-foreground">(sub for {m.scheduledA})</span>}
        {m.absentA && !m.hasGameDataA && <span className="ml-1 text-[10px] text-destructive">absent</span>}
      </td>
      {m.hasGameDataA ? <>
        <td className="px-2 py-1 text-right">{m.scratchGamesA ? m.scratchGamesA[0] : m.handicapGamesA[0] - m.handicapA}</td>
        <td className="px-2 py-1 text-right">{m.scratchGamesA ? m.scratchGamesA[1] : m.handicapGamesA[1] - m.handicapA}</td>
        <td className="px-2 py-1 text-right">{m.scratchGamesA ? m.scratchGamesA[2] : m.handicapGamesA[2] - m.handicapA}</td>
        <td className="px-2 py-1 text-right font-semibold">{m.scratchTotalA}</td>
        <td className="px-2 py-1 text-right">{m.handicapTotalA}</td>
      </> : <>
        <td className="px-2 py-1 text-right text-muted-foreground">—</td>
        <td className="px-2 py-1 text-right text-muted-foreground">—</td>
        <td className="px-2 py-1 text-right text-muted-foreground">—</td>
        <td className="px-2 py-1 text-right text-muted-foreground">—</td>
        <td className="px-2 py-1 text-right text-muted-foreground">—</td>
      </>}
      <td rowSpan={2} className="px-2 py-1 text-right align-middle font-semibold">
        {m.finalPointsA} <span className="text-muted-foreground">/</span> {m.finalPointsB}
        {m.overrideEnabled && <div className="text-[9px] text-muted-foreground">override</div>}
      </td>
    </tr>
  );
  const rowB = (
    <tr>
      <td className="px-3 py-1">
        {m.actualNameB || m.scheduledB}
        {m.isSubB && <span className="ml-1 text-[10px] text-muted-foreground">(sub for {m.scheduledB})</span>}
        {m.absentB && !m.hasGameDataB && <span className="ml-1 text-[10px] text-destructive">absent</span>}
      </td>
      {m.hasGameDataB ? <>
        <td className="px-2 py-1 text-right">{m.scratchGamesB ? m.scratchGamesB[0] : m.handicapGamesB[0] - m.handicapB}</td>
        <td className="px-2 py-1 text-right">{m.scratchGamesB ? m.scratchGamesB[1] : m.handicapGamesB[1] - m.handicapB}</td>
        <td className="px-2 py-1 text-right">{m.scratchGamesB ? m.scratchGamesB[2] : m.handicapGamesB[2] - m.handicapB}</td>
        <td className="px-2 py-1 text-right font-semibold">{m.scratchTotalB}</td>
        <td className="px-2 py-1 text-right">{m.handicapTotalB}</td>
      </> : <>
        <td className="px-2 py-1 text-right text-muted-foreground">—</td>
        <td className="px-2 py-1 text-right text-muted-foreground">—</td>
        <td className="px-2 py-1 text-right text-muted-foreground">—</td>
        <td className="px-2 py-1 text-right text-muted-foreground">—</td>
        <td className="px-2 py-1 text-right text-muted-foreground">—</td>
      </>}
    </tr>
  );
  return <>{rowA}{rowB}</>;
}
