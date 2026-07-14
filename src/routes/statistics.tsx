import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { BOWLERS, formatPoints, type Bowler } from "@/lib/mock-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Trophy } from "lucide-react";

export const Route = createFileRoute("/statistics")({
  head: () => ({
    meta: [
      { title: "Statistics — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Season leaders and sortable statistics for average, points, pinfall, high game, and high set.",
      },
    ],
  }),
  component: StatisticsPage,
});

type Metric = keyof Pick<
  Bowler,
  "scratchAverage" | "points" | "scratchPinfall" | "highGame" | "highSet"
>;

const METRICS: { key: Metric; label: string; format: (b: Bowler) => string }[] =
  [
    {
      key: "scratchAverage",
      label: "Average",
      format: (b) => b.scratchAverage.toFixed(3),
    },
    { key: "points", label: "Points", format: (b) => formatPoints(b.points) },
    {
      key: "scratchPinfall",
      label: "Scratch Pinfall",
      format: (b) => b.scratchPinfall.toLocaleString(),
    },
    { key: "highGame", label: "High Game", format: (b) => b.highGame.toString() },
    { key: "highSet", label: "High Set", format: (b) => b.highSet.toString() },
  ];

function StatisticsPage() {
  const [sort, setSort] = useState<Metric>("scratchAverage");

  const sorted = [...BOWLERS].sort((a, b) => (b[sort] as number) - (a[sort] as number));

  return (
    <AppShell>
      <PageHeader
        title="Statistics"
        subtitle="Season leaders and sortable tables — all values are stored, not recomputed here."
      />

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {METRICS.map((m) => {
          const leader = [...BOWLERS].sort(
            (a, b) => (b[m.key] as number) - (a[m.key] as number),
          )[0];
          return (
            <Card key={m.key} className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                  <Trophy className="h-3.5 w-3.5 text-gold" /> {m.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-2xl text-gold">
                  {m.format(leader)}
                </div>
                <Link
                  to="/bowlers/$bowlerId"
                  params={{ bowlerId: leader.id }}
                  className="text-sm hover:text-primary"
                >
                  {leader.name}
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-8 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-accent/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3 text-left">Bowler</th>
              {METRICS.map((m) => (
                <th key={m.key} className="px-3 py-3 text-right">
                  <button
                    onClick={() => setSort(m.key)}
                    className={cn(
                      "transition-colors",
                      sort === m.key ? "text-gold" : "hover:text-foreground",
                    )}
                  >
                    {m.label} {sort === m.key ? "▾" : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((b) => (
              <tr key={b.id} className="hover:bg-accent/30">
                <td className="px-3 py-2">
                  <Link
                    to="/bowlers/$bowlerId"
                    params={{ bowlerId: b.id }}
                    className="hover:text-primary"
                  >
                    {b.name}
                  </Link>
                </td>
                {METRICS.map((m) => (
                  <td
                    key={m.key}
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      sort === m.key && "font-semibold text-gold",
                    )}
                  >
                    {m.format(b)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
