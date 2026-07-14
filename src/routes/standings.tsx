import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { getStandingsSnapshot } from "@/lib/mock-data";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

export const Route = createFileRoute("/standings")({
  head: () => ({
    meta: [
      { title: "Standings — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Current standings for the Pro Summer Singles duckpin league. Rank, points, pinfall, and average.",
      },
    ],
  }),
  component: StandingsPage,
});

function Movement({ n }: { n: number }) {
  if (n === 0)
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3 w-3" /> 0
      </span>
    );
  if (n > 0)
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <ArrowUp className="h-3 w-3" /> {n}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-primary">
      <ArrowDown className="h-3 w-3" /> {Math.abs(n)}
    </span>
  );
}

function StandingsPage() {
  // Snapshot is pre-saved — no recomputation here.
  const rows = getStandingsSnapshot();

  return (
    <AppShell>
      <PageHeader
        title="Standings"
        subtitle="Sorted by points, then handicap pinfall. Snapshot from the last published week."
      />
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-accent/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3 text-left">Rank</th>
              <th className="px-3 py-3 text-left">Bowler</th>
              <th className="px-3 py-3 text-right">Points</th>
              <th className="px-3 py-3 text-right">Scratch Pinfall</th>
              <th className="px-3 py-3 text-right">Handicap Pinfall</th>
              <th className="px-3 py-3 text-right">Average</th>
              <th className="px-3 py-3 text-right">Move</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.bowler.id} className="hover:bg-accent/30">
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-flex h-7 min-w-7 items-center justify-center rounded font-display text-sm ${
                      r.rank <= 3
                        ? "bg-gold px-2"
                        : "text-muted-foreground"
                    }`}
                  >
                    {r.rank}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <Link
                    to="/bowlers/$bowlerId"
                    params={{ bowlerId: r.bowler.id }}
                    className="font-medium hover:text-primary"
                  >
                    {r.bowler.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right font-display text-base text-gold">
                  {r.bowler.points}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.bowler.scratchPinfall.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.bowler.handicapPinfall.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.bowler.scratchAverage.toFixed(3)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Movement n={r.movement} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
