import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  formatPoints,
  formatRecord,
  getBowler,
  getBowlerHistory,
  getBowlerSeasonExtras,
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
  const extras = getBowlerSeasonExtras(bowler.id);
  const maxUsage = Math.max(1, ...extras.lanePairUsage.map((u) => u.count));

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
        <Stat
          label="Record (W - L)"
          value={formatRecord(bowler.points, bowler.pointsLost)}
          accent
        />
        <Stat
          label="Matches / Games"
          value={`${bowler.matchesPlayed} / ${bowler.gamesPlayed}`}
        />
        <Stat
          label="Scratch Pinfall"
          value={bowler.scratchPinfall.toLocaleString()}
        />
        <Stat
          label="Handicap Pinfall"
          value={bowler.handicapPinfall.toLocaleString()}
        />
        <Stat label="High Game" value={bowler.highGame.toString()} />
        <Stat label="High Set" value={bowler.highSet.toString()} />
        <Stat
          label="Season POA"
          value={formatSigned(extras.seasonPOA)}
        />
        <Stat
          label="Best Game POA"
          value={formatSigned(extras.bestGamePOA)}
        />
        <Stat label="Best Set POA" value={formatSigned(extras.bestSetPOA)} />
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
                  <th className="px-2 py-2 text-right">Hdcp</th>
                  <th className="px-2 py-2 text-right">G1</th>
                  <th className="px-2 py-2 text-right">G2</th>
                  <th className="px-2 py-2 text-right">G3</th>
                  <th className="px-2 py-2 text-right">Scr Set</th>
                  <th className="px-2 py-2 text-right">Hdcp Set</th>
                  <th className="px-2 py-2 text-right">W - L</th>
                  <th className="px-2 py-2 text-right">Res</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((h) => (
                  <tr key={h.week}>
                    <td className="px-2 py-1.5">{h.week}</td>
                    <td className="px-2 py-1.5">{h.lanePair}</td>
                    <td className="px-2 py-1.5">
                      {h.opponent}
                      {h.isSub && (
                        <span className="ml-1 rounded bg-accent px-1 text-[9px] uppercase tracking-widest text-muted-foreground">
                          sub
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {h.handicap}
                    </td>
                    {h.scores.map((s, i) => (
                      <td
                        key={i}
                        className="px-2 py-1.5 text-right tabular-nums"
                        title={`Game point: ${h.gameAwards[i]}`}
                      >
                        {s}
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          ·{h.gameAwards[i]}
                        </span>
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                      {h.scratchTotal}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {h.handicapTotal}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold text-gold tabular-nums">
                      {formatPoints(h.totalPoints)} - {formatPoints(h.pointsLost)}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs">
                      {h.result}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td
                      colSpan={12}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No completed weeks yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Each game: 2 pts win / 1 pt tie / 0 loss. Higher 3-game handicap
              total wins 1 set pt (½ each on a tie). Every match distributes
              exactly 7 pts, so W - L above is a per-match points record.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="font-display text-xl">Lane-pair use</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {extras.lanePairUsage.map(({ lanePair, count }) => (
              <div key={lanePair}>
                <div className="flex justify-between text-xs">
                  <span>Lanes {lanePair}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded bg-accent">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${(count / maxUsage) * 100}%` }}
                  />
                </div>
              </div>
            ))}
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

function formatSigned(n: number): string {
  const rounded = Number(n.toFixed(2));
  if (rounded === 0) return "±0";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toFixed(2).replace(/\.?0+$/, "")}`;
}
