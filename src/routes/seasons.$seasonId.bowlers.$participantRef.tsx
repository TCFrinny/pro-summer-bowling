/** PUBLIC archived-season per-bowler profile. */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { EmptyState } from "@/components/layout/AppShell";

export const Route = createFileRoute("/seasons/$seasonId/bowlers/$participantRef")({
  component: SeasonBowlerPage,
});

function SeasonBowlerPage() {
  const { seasonId, participantRef } = Route.useParams();
  const q = useQuery({
    queryKey: ["seasons", "public", "historical-snapshot", seasonId],
    queryFn: () => getPublicHistoricalSnapshot({ data: { seasonId } }),
  });
  const snap = q.data?.snapshot;
  if (!snap) return <EmptyState title="Not available" description="No cached snapshot for this season." />;
  const p = snap.participants.find((x) => x.ref === participantRef);
  const s = snap.standings.find((x) => x.participantRef === participantRef);
  const summary = snap.summaryRecords.find((x) => x.participantRef === participantRef);
  if (!p && !summary) {
    return <EmptyState title="Bowler not found" description="No matching participant in this season." />;
  }
  const matches = snap.weeks.flatMap((w) => w.matches.filter(
    (m) => m.actualA === participantRef || m.actualB === participantRef
        || m.scheduledA === participantRef || m.scheduledB === participantRef,
  ).map((m) => ({ w, m })));
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          {p?.displayName ?? summary?.displayName ?? participantRef}
          {p?.bowlerNumber && <span className="ml-2 text-xs text-muted-foreground">#{p.bowlerNumber}</span>}
        </h2>
        {p?.personId && (
          <Link to="/people/$personId" params={{ personId: p.personId }} className="text-sm underline">
            Career profile
          </Link>
        )}
      </header>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-6 text-sm">
        <Stat label="Points" value={s?.points ?? summary?.points ?? "—"} />
        <Stat label="Games" value={s?.games ?? summary?.games ?? "—"} />
        <Stat label="Avg" value={s?.scratchAverage != null ? s.scratchAverage.toFixed(1) : (summary?.average != null ? summary.average.toFixed(1) : "—")} />
        <Stat label="High G" value={s?.highGame ?? summary?.highGame ?? "—"} />
        <Stat label="High S" value={s?.highSet ?? summary?.highSet ?? "—"} />
        <Stat label="Finish" value={summary?.finalFinish ?? "—"} />
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-3 text-sm font-semibold">Match history</div>
        {matches.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No matches recorded.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-accent/30 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-1 text-left">Wk</th>
                <th className="px-3 py-1 text-left">Opponent</th>
                <th className="px-2 py-1 text-right">Scratch</th>
                <th className="px-2 py-1 text-right">HDCP set</th>
                <th className="px-2 py-1 text-right">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {matches.map(({ w, m }) => {
                const isA = m.actualA === participantRef || m.scheduledA === participantRef;
                const mine = isA
                  ? { has: m.hasGameDataA, scr: m.scratchTotalA, hdcp: m.handicapTotalA, pts: m.finalPointsA, oppName: m.actualNameB || m.scheduledB }
                  : { has: m.hasGameDataB, scr: m.scratchTotalB, hdcp: m.handicapTotalB, pts: m.finalPointsB, oppName: m.actualNameA || m.scheduledA };
                return (
                  <tr key={m.slotId}>
                    <td className="px-3 py-1">{w.weekNumber}</td>
                    <td className="px-3 py-1">{mine.oppName}</td>
                    <td className="px-2 py-1 text-right">{mine.has ? mine.scr : "—"}</td>
                    <td className="px-2 py-1 text-right">{mine.has ? mine.hdcp : "—"}</td>
                    <td className="px-2 py-1 text-right font-semibold">{mine.pts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-base">{value}</div>
    </div>
  );
}
