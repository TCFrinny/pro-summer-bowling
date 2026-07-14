import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  WEEKS,
  getAdvancedLeaderboards,
  type AdvancedRow,
} from "@/lib/mock-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

type Scope = "season" | number;

export const Route = createFileRoute("/leaderboards/advanced")({
  head: () => ({
    meta: [
      { title: "Advanced Leaderboards — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Mark %, strike %, spare conversion %, pins-lost, and consistency — computed from every saved frame linescore.",
      },
    ],
  }),
  component: AdvancedLeaderboardsPage,
});

function AdvancedLeaderboardsPage() {
  const [scope, setScope] = useState<Scope>("season");
  const boards = getAdvancedLeaderboards(scope);
  const completed = WEEKS.filter((w) => w.completed);
  const rows = boards.rows;

  return (
    <AppShell>
      <PageHeader
        title="Advanced Leaderboards"
        subtitle="Roster-only · substitutes excluded · derived from frame records"
      >
        <Select
          value={scope === "season" ? "season" : String(scope)}
          onValueChange={(v) => setScope(v === "season" ? "season" : Number(v))}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="season">Season (overall)</SelectItem>
            {completed.map((w) => (
              <SelectItem key={w.week} value={String(w.week)}>
                Week {w.week}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link
          to="/leaderboards"
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
        >
          ← Standard
        </Link>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Board
          title="Mark %"
          help={`(Strikes + Spares) ÷ Frames × 100 · min ${boards.minGamesForPct} games`}
        >
          <MetricTable rows={rows} pick={(r) => r.markPct} suffix="%" digits={1} />
        </Board>
        <Board
          title="Strike %"
          help={`Strikes ÷ Frames × 100 · min ${boards.minGamesForPct} games`}
        >
          <MetricTable rows={rows} pick={(r) => r.strikePct} suffix="%" digits={1} />
        </Board>
        <Board
          title="Spare Conversion %"
          help={`Spares ÷ (Spares + Opens) × 100 · min ${boards.minGamesForPct} games`}
        >
          <MetricTable
            rows={rows}
            pick={(r) => r.spareConversionPct}
            suffix="%"
            digits={1}
          />
        </Board>
        <Board
          title="Open % (lower is better)"
          help={`Opens ÷ Frames × 100 · min ${boards.minGamesForPct} games`}
        >
          <MetricTable
            rows={rows}
            pick={(r) => r.openPct}
            suffix="%"
            digits={1}
            ascending
          />
        </Board>
        <Board
          title="Pins Lost (lower is better)"
          help="Average pins standing on open frames after ball 3."
        >
          <MetricTable
            rows={rows}
            pick={(r) => r.pinsLost}
            digits={2}
            ascending
          />
        </Board>
        <Board
          title="Consistency (lower is better)"
          help={
            boards.consistencyEligible
              ? `Std. dev. of scratch game scores · min ${boards.minGamesForConsistency} games`
              : "Hidden for single-week views (needs 6+ games)."
          }
        >
          {boards.consistencyEligible ? (
            <MetricTable
              rows={rows.filter((r) => r.consistency > 0)}
              pick={(r) => r.consistency}
              digits={2}
              ascending
            />
          ) : (
            <EmptyBoard label="Switch to Season view to rank consistency." />
          )}
        </Board>
        <Board title="Total Marks" help="Strikes + Spares.">
          <MetricTable rows={rows} pick={(r) => r.marks} digits={0} />
        </Board>
        <Board title="Raw Strikes" help="Total strikes (regulation frames).">
          <MetricTable rows={rows} pick={(r) => r.strikes} digits={0} />
        </Board>
        <Board title="Raw Spares" help="Total spares (regulation frames).">
          <MetricTable rows={rows} pick={(r) => r.spares} digits={0} />
        </Board>
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground">
        All boards use regulation frames only — the tenth-frame bonus balls
        never inflate the denominator. Substitute performances are excluded.
        {" "}Metrics reconcile with the underlying frame rows for every match.
      </p>
    </AppShell>
  );
}

function Board({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-gold" /> {title}
        </CardTitle>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {help}
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function MetricTable({
  rows,
  pick,
  digits,
  suffix,
  ascending,
}: {
  rows: AdvancedRow[];
  pick: (r: AdvancedRow) => number;
  digits: number;
  suffix?: string;
  ascending?: boolean;
}) {
  if (rows.length === 0)
    return <EmptyBoard label="Not enough eligible bowlers." />;
  const sorted = [...rows].sort((a, b) =>
    ascending ? pick(a) - pick(b) : pick(b) - pick(a),
  );
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border">
        {sorted.slice(0, 10).map((r, i) => (
          <tr key={r.bowlerId}>
            <td className="py-1.5 w-6 text-xs text-muted-foreground">
              {i + 1}.
            </td>
            <td className="py-1.5">
              <Link
                to="/bowlers/$bowlerId"
                params={{ bowlerId: r.bowlerId }}
                className="hover:text-primary"
              >
                {r.bowlerName}
              </Link>
              <div className="text-[10px] uppercase text-muted-foreground">
                {r.games} g · {r.frames} fr
              </div>
            </td>
            <td className="py-1.5 text-right font-display text-lg tabular-nums text-gold">
              {pick(r).toFixed(digits)}
              {suffix ?? ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyBoard({ label }: { label: string }) {
  return (
    <div className="py-6 text-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}
