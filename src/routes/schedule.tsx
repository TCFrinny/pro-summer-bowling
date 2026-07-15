import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  LANE_PAIRS,
  WEEKS,
  formatPoints,
  formatScheduleName,
  getBowler,
  getMatchesForWeek,
  getSnapshot,
} from "@/lib/mock-data";
import { useLeagueSnapshot } from "@/lib/league-store";
import { useState } from "react";
import { pickDefaultScheduleWeek } from "@/lib/schedule-default-week";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { title: "Schedule — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Weekly schedule of matches across lane pairs for the Pro Summer Singles duckpin league.",
      },
    ],
  }),
  component: SchedulePage,
});

function SchedulePage() {
  useLeagueSnapshot(); // subscribe: re-render when admin saves rebuild the snapshot
  const [week, setWeek] = useState<number>(WEEKS[0].week);
  const matches = getMatchesForWeek(week);

  return (
    <AppShell>
      <PageHeader
        title="Schedule"
        subtitle="18 matches per week across six lane pairs, three matches per pair."
      >
        <Select
          value={String(week)}
          onValueChange={(v) => setWeek(Number(v))}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEEKS.map((w) => (
              <SelectItem key={w.week} value={String(w.week)}>
                Week {w.week}
                {w.completed ? "" : " (upcoming)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        {LANE_PAIRS.map((lp) => {
          const rows = matches.filter((m) => m.lanePair === lp);
          return (
            <Card key={lp} className="bg-card">
              <CardHeader>
                <CardTitle className="flex items-baseline justify-between font-display text-xl">
                  <span>Lanes {lp}</span>
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    {rows.length} matches
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                {rows.map((m, i) => {
                  const a = getBowler(m.bowlerA);
                  const b = getBowler(m.bowlerB);
                  const r = m.result;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 py-2.5 text-sm"
                    >
                      <span className="w-5 text-xs text-muted-foreground">
                        {i + 1}.
                      </span>
                      <span className="flex-1 truncate font-medium">
                        {a ? formatScheduleName(a.name, m.bowlerNumberA) : "—"}
                      </span>
                      {r ? (
                        <Link
                          to="/weekly-results"
                          className="rounded bg-accent px-2 py-0.5 font-display text-xs text-gold tabular-nums hover:bg-primary/20"
                          title="View full linescore"
                        >
                          {formatPoints(r.totalPointsA)}–
                          {formatPoints(r.totalPointsB)}
                        </Link>
                      ) : (
                        <span className="px-2 text-xs uppercase tracking-widest text-muted-foreground">
                          vs
                        </span>
                      )}
                      <span className="flex-1 truncate text-right font-medium">
                        {b ? formatScheduleName(b.name, m.bowlerNumberB) : "—"}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
