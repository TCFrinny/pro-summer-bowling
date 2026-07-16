/** PUBLIC archived-season Weekly Results — renders saved results only.
 *  FULL_LINESCORE rows show the frame-by-frame linescore using the shared
 *  GameLinescore component. GAME_SCORES rows show a clear "frame linescore
 *  unavailable" placeholder. */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { EmptyState } from "@/components/layout/AppShell";
import { compareLanePairSlotCamel } from "@/lib/lane-pair-order";
import { GameLinescore } from "@/components/linescore/GameLinescore";
import type { HistoricalMatch } from "@/lib/historical-snapshot";

export const Route = createFileRoute("/seasons/$seasonId/weekly-results")({
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
  const anyResults = snap.weeks.some((w) => w.matches.length > 0);
  if (!anyResults) return <EmptyState title="No results" description="No match results have been entered yet." />;
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
            <div className="divide-y divide-border">
              {sorted.map((m) => <MatchBlock key={m.slotId} m={m} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MatchBlock({ m }: { m: HistoricalMatch }) {
  const [openA, setOpenA] = useState(false);
  const [openB, setOpenB] = useState(false);
  return (
    <div className="p-3 text-sm" data-testid={`archived-match-${m.slotId}`}>
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
        <span className="font-mono">{m.lanePair}·{m.slot}</span>
        <span>Final <span className="font-display text-sm text-gold">{m.finalPointsA}–{m.finalPointsB}</span></span>
      </div>
      <SideRow label={m.actualNameA || m.scheduledNameA} scheduledName={m.scheduledNameA}
        isSub={m.isSubA} absent={m.absentA} hasData={m.hasGameDataA}
        scratch={m.scratchGamesA} scratchTotal={m.scratchTotalA} hdcpTotal={m.handicapTotalA}
        points={m.finalPointsA}
        linescore={m.linescoreA} open={openA} onToggle={() => setOpenA((v) => !v)}
        detailMode={m.detailMode} />
      <SideRow label={m.actualNameB || m.scheduledNameB} scheduledName={m.scheduledNameB}
        isSub={m.isSubB} absent={m.absentB} hasData={m.hasGameDataB}
        scratch={m.scratchGamesB} scratchTotal={m.scratchTotalB} hdcpTotal={m.handicapTotalB}
        points={m.finalPointsB}
        linescore={m.linescoreB} open={openB} onToggle={() => setOpenB((v) => !v)}
        detailMode={m.detailMode} />
      {m.overrideEnabled && (
        <div className="mt-2 text-[10px] text-gold">Manual points override applied.</div>
      )}
    </div>
  );
}

function SideRow({
  label, scheduledName, isSub, absent, hasData, scratch, scratchTotal, hdcpTotal, points, linescore, open, onToggle, detailMode,
}: {
  label: string; scheduledName: string; isSub: boolean; absent: boolean; hasData: boolean;
  scratch: [number, number, number] | null;
  scratchTotal: number; hdcpTotal: number; points: number;
  linescore: HistoricalMatch["linescoreA"];
  open: boolean; onToggle: () => void;
  detailMode: HistoricalMatch["detailMode"];
}) {
  return (
    <div className="mb-2 rounded-md border border-border/60 p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1">
          <span className="font-medium">{label}</span>
          {isSub && <span className="ml-1 text-[10px] text-muted-foreground">(sub for {scheduledName})</span>}
          {absent && !hasData && <span className="ml-1 text-[10px] text-destructive">absent</span>}
        </div>
        <div className="flex items-center gap-3 text-xs">
          {hasData && scratch ? (
            <span>{scratch[0]} · {scratch[1]} · {scratch[2]} · scratch <b>{scratchTotal}</b> · hdcp <b>{hdcpTotal}</b></span>
          ) : (
            <span className="text-muted-foreground">— · — · — · —</span>
          )}
          <span className="font-display text-sm text-gold">{points}</span>
        </div>
      </div>
      {linescore ? (
        <div className="mt-2">
          <button onClick={onToggle} className="flex w-full items-center justify-between rounded border border-border/60 px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:bg-accent/40">
            <span>View frame linescore</span>
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {open && (
            <div className="mt-2 grid gap-2">
              {linescore.map((g, i) => <GameLinescore key={i} game={g} index={i} />)}
            </div>
          )}
        </div>
      ) : detailMode === "game_scores" && !absent ? (
        <div className="mt-2 rounded border border-dashed border-primary/50 px-2 py-1 text-[10px] uppercase tracking-widest text-primary">
          Frame linescore / advanced frame stats unavailable — game-scores-only entry.
        </div>
      ) : null}
    </div>
  );
}
