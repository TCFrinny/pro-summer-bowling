import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  LANE_PAIRS,
  getBowler,
  getBowlerHistory,
  type LanePair,
} from "@/lib/mock-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/bowlers/$bowlerId")({
  loader: ({ params }) => {
    const bowler = getBowler(params.bowlerId);
    if (!bowler) throw notFound();
    return { bowler };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.bowler.name} — Pro Summer Singles`
          : "Bowler — Pro Summer Singles",
      },
    ],
  }),
  errorComponent: ({ error, reset }) => (
    <AppShell>
      <div className="p-6 text-center text-sm text-muted-foreground">
        {error.message}{" "}
        <button className="text-primary underline" onClick={reset}>
          retry
        </button>
      </div>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <div className="p-10 text-center">
        <div className="font-display text-3xl">Bowler not found</div>
        <Link to="/bowlers" className="mt-3 inline-block text-primary underline">
          Back to roster
        </Link>
      </div>
    </AppShell>
  ),
  component: BowlerProfile,
});

function BowlerProfile() {
  const { bowler } = Route.useLoaderData();
  const history = getBowlerHistory(bowler.id);

  const lanePairCounts: Record<LanePair, number> = Object.fromEntries(
    LANE_PAIRS.map((lp) => [lp, 0]),
  ) as Record<LanePair, number>;
  history.forEach((h) => (lanePairCounts[h.lanePair] += 1));

  return (
    <AppShell>
      <Link
        to="/bowlers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> All bowlers
      </Link>
      <PageHeader title={bowler.name} subtitle="Bowler profile" />

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Entry Avg" value={bowler.entryAverage.toString()} />
        <Stat label="Handicap" value={bowler.handicap.toString()} />
        <Stat
          label="Scratch Avg"
          value={bowler.scratchAverage.toFixed(3)}
          accent
        />
        <Stat label="Points" value={bowler.points.toString()} accent />
        <Stat label="Scratch Pinfall" value={bowler.scratchPinfall.toLocaleString()} />
        <Stat label="Handicap Pinfall" value={bowler.handicapPinfall.toLocaleString()} />
        <Stat label="High Game" value={bowler.highGame.toString()} />
        <Stat label="High Set" value={bowler.highSet.toString()} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 bg-card">
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Weekly history
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Wk</th>
                  <th className="px-2 py-2 text-left">Lanes</th>
                  <th className="px-2 py-2 text-left">Opponent</th>
                  <th className="px-2 py-2 text-right">G1</th>
                  <th className="px-2 py-2 text-right">G2</th>
                  <th className="px-2 py-2 text-right">G3</th>
                  <th className="px-2 py-2 text-right">Hdcp</th>
                  <th className="px-2 py-2 text-right">Pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((h) => (
                  <tr key={h.week}>
                    <td className="px-2 py-1.5">{h.week}</td>
                    <td className="px-2 py-1.5">{h.lanePair}</td>
                    <td className="px-2 py-1.5">{h.opponent}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {h.scores[0]}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {h.scores[1]}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {h.scores[2]}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {h.handicap}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold text-gold">
                      {h.points}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No completed weeks yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="font-display text-xl">Lane-pair use</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {LANE_PAIRS.map((lp) => {
              const n = lanePairCounts[lp];
              const max = Math.max(1, ...Object.values(lanePairCounts));
              return (
                <div key={lp}>
                  <div className="flex justify-between text-xs">
                    <span>Lanes {lp}</span>
                    <span className="text-muted-foreground">{n}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded bg-accent">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${(n / max) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 font-display text-2xl ${accent ? "text-gold" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
