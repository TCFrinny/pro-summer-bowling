/** PUBLIC archived-season per-bowler profile. */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { EmptyState } from "@/components/layout/AppShell";
import { GameLinescore } from "@/components/linescore/GameLinescore";
import type { HistoricalMatch, HistoricalWeekSummary } from "@/lib/historical-snapshot";

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
  const matches: Array<{ w: HistoricalWeekSummary; m: HistoricalMatch }> = snap.weeks.flatMap((w) =>
    w.matches
      .filter((m) => m.actualA === participantRef || m.actualB === participantRef
                  || m.scheduledA === participantRef || m.scheduledB === participantRef)
      .map((m) => ({ w, m })),
  );
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
          <div className="divide-y divide-border">
            {matches.map(({ w, m }) => (
              <MatchLine key={m.slotId} weekNumber={w.weekNumber} m={m} participantRef={participantRef} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MatchLine({ weekNumber, m, participantRef }: {
  weekNumber: number; m: HistoricalMatch; participantRef: string;
}) {
  const isA = m.actualA === participantRef || m.scheduledA === participantRef;
  const mine = isA
    ? { has: m.hasGameDataA, scr: m.scratchTotalA, hdcp: m.handicapTotalA, pts: m.finalPointsA,
        oppName: m.actualNameB || m.scheduledNameB, line: m.linescoreA, absent: m.absentA }
    : { has: m.hasGameDataB, scr: m.scratchTotalB, hdcp: m.handicapTotalB, pts: m.finalPointsB,
        oppName: m.actualNameA || m.scheduledNameA, line: m.linescoreB, absent: m.absentB };
  const [open, setOpen] = useState(false);
  return (
    <div className="p-3 text-sm" data-testid={`archived-bowler-match-${m.slotId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="mr-2 text-xs text-muted-foreground">Wk {weekNumber}</span>
          vs <span className="font-medium">{mine.oppName}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span>{mine.has ? `scratch ${mine.scr} · hdcp ${mine.hdcp}` : "—"}</span>
          <span className="font-display text-sm text-gold">{mine.pts}</span>
        </div>
      </div>
      {mine.line ? (
        <div className="mt-2">
          <button onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded border border-border/60 px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:bg-accent/40">
            <span>View frame linescore</span>
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {open && (
            <div className="mt-2 grid gap-2">
              {mine.line.map((g, i) => <GameLinescore key={i} game={g} index={i} />)}
            </div>
          )}
        </div>
      ) : m.detailMode === "game_scores" && !mine.absent ? (
        <div className="mt-2 rounded border border-dashed border-primary/50 px-2 py-1 text-[10px] uppercase tracking-widest text-primary">
          Frame linescore / advanced stats unavailable — game-scores-only entry.
        </div>
      ) : null}
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
