import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  WEEKS,
  getSeasonLaneSummaries,
  getWeekLaneSummaries,
} from "@/lib/mock-data";
import { useLeagueSnapshot } from "@/lib/league-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/lane-data")({
  head: () => ({
    meta: [
      { title: "Lane Data — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Season and weekly lane-pair scoring summaries for the Pro Summer Singles duckpin league.",
      },
    ],
  }),
  component: LaneDataPage,
});

function LaneDataPage() {
  useLeagueSnapshot(); // subscribe: re-render when admin saves rebuild the snapshot
  const season = getSeasonLaneSummaries();
  const completed = WEEKS.filter((w) => w.completed);
  const [week, setWeek] = useState<number>(
    completed[completed.length - 1]?.week ?? 1,
  );
  const weekRows = getWeekLaneSummaries(week);

  const seasonAvgPOA =
    season.reduce((s, r) => s + r.plusMinusPOA, 0) / season.length;

  return (
    <AppShell>
      <PageHeader
        title="Lane Data"
        subtitle="Pre-computed lane-pair summaries — no calculation runs on this page."
      />

      <Card className="mb-6 bg-card">
        <CardHeader>
          <CardTitle className="font-display text-xl">
            Season Overall by Lane Pair (
            <span className="text-gold">
              {seasonAvgPOA >= 0 ? "+" : ""}
              {seasonAvgPOA.toFixed(2)} POA
            </span>
            )
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Lane Pair</th>
                <th className="px-3 py-2 text-right">Games</th>
                <th className="px-3 py-2 text-right">Average</th>
                <th className="px-3 py-2 text-right">POA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {season.map((r) => (
                <tr key={r.lanePair} className="hover:bg-accent/30">
                  <td className="px-3 py-2 font-medium">Lanes {r.lanePair}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.games}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.average.toFixed(3)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.plusMinusPOA >= 0 ? "text-emerald-400" : "text-primary"
                    }`}
                  >
                    {r.plusMinusPOA >= 0 ? "+" : ""}
                    {r.plusMinusPOA.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-display text-xl">
            Weekly Lane Pair Summary
          </CardTitle>
          <Select value={String(week)} onValueChange={(v) => setWeek(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {completed.map((w) => (
                <SelectItem key={w.week} value={String(w.week)}>
                  Week {w.week}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Lane Pair</th>
                <th className="px-3 py-2 text-right">Games</th>
                <th className="px-3 py-2 text-right">Average</th>
                <th className="px-3 py-2 text-right">POA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {weekRows.map((r) => (
                <tr key={r.lanePair} className="hover:bg-accent/30">
                  <td className="px-3 py-2 font-medium">Lanes {r.lanePair}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.games}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.average.toFixed(3)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.plusMinusPOA >= 0 ? "text-emerald-400" : "text-primary"
                    }`}
                  >
                    {r.plusMinusPOA >= 0 ? "+" : ""}
                    {r.plusMinusPOA.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
