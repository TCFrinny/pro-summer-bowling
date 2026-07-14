import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  formatPoints,
  formatRecord,
  getBowler,
  getBowlerHistory,
  getBowlerSeasonExtras,
  type BowlerHistoryRow,
} from "@/lib/mock-data";
import { useLeagueSnapshot } from "@/lib/league-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronLeft, ChevronUp } from "lucide-react";
import { useState } from "react";
import { ThreeGameLinescore } from "@/components/linescore/ThreeGameLinescore";

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
  useLeagueSnapshot();
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
          label="Actual Games (Roster)"
          value={bowler.actualGamesRolled.toString()}
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
        <Stat label="Strikes" value={extras.strikes.toString()} />
        <Stat label="Spares" value={extras.spares.toString()} />
        <Stat label="Opens" value={extras.opens.toString()} />
        <Stat label="Total Marks" value={extras.marks.toString()} />
        <Stat label="Frames Rolled" value={extras.framesRolled.toString()} />
        <Stat label="Mark %" value={`${extras.markPct.toFixed(1)}%`} />
        <Stat label="Strike %" value={`${extras.strikePct.toFixed(1)}%`} />
        <Stat
          label="Spare Conv. %"
          value={`${extras.spareConversionPct.toFixed(1)}%`}
        />
        <Stat label="Open %" value={`${extras.openPct.toFixed(1)}%`} />
        <Stat label="Pins Lost" value={extras.pinsLost.toFixed(2)} />
        <Stat label="Consistency (σ)" value={extras.consistency.toFixed(2)} />
        <Stat label="Season POA" value={formatSigned(extras.seasonPOA)} />
        <Stat
          label="First 5 / match"
          value={extras.first5PerMatch.toFixed(1)}
        />
        <Stat
          label="Last 5 / match"
          value={extras.last5PerMatch.toFixed(1)}
        />
        <Stat
          label="Big Opening / match"
          value={extras.bigOpeningPerMatch.toFixed(1)}
        />
        <Stat
          label="Big Finish / match"
          value={extras.bigFinishPerMatch.toFixed(1)}
        />
        <Stat
          label="Clutch % (Fr 9–10)"
          value={`${extras.clutchPct.toFixed(1)}%`}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 bg-card">
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Weekly history · full linescores
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.map((h) => (
              <WeekRow key={h.week} h={h} />
            ))}
            {history.length === 0 && (
              <div className="py-6 text-center text-muted-foreground text-sm">
                No completed weeks yet.
              </div>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Roster-only advanced stats (mark %, spare %, opens, pins lost)
              exclude any weeks when a substitute rolled on your behalf.
              League points and handicap pinfall are still credited to the
              scheduled bowler for those weeks.
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

function WeekRow({ h }: { h: BowlerHistoryRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-md border border-border/60 bg-background/40"
      data-testid={`history-week-${h.week}`}
      data-scores={h.absent ? "" : h.scores.join(",")}
      data-scratch-total={h.scratchTotal}
      data-handicap-total={h.handicapTotal}
      data-total-points={h.totalPoints}
      data-result={h.result}
      data-absent={h.absent ? "1" : "0"}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent/40"
      >
        <span className="w-10 text-xs font-semibold uppercase text-muted-foreground">
          Wk {h.week}
        </span>
        <span className="w-14 text-xs text-muted-foreground">
          Lanes {h.lanePair}
        </span>
        <span className="flex-1 truncate">
          vs {h.opponent}
          {h.absent && (
            <span className="ml-2 rounded bg-destructive/20 px-1.5 text-[9px] uppercase tracking-widest text-destructive">
              absent
            </span>
          )}
          {h.isSub && (
            <span className="ml-2 rounded bg-primary/25 px-1.5 text-[9px] uppercase tracking-widest text-primary">
              sub — {h.actualBowler}
            </span>
          )}
        </span>
        <span className="tabular-nums text-xs text-muted-foreground">
          {h.absent ? "—" : `${h.scores.join(" · ")} = ${h.scratchTotal}`}
        </span>
        <span className="rounded px-2 py-0.5 font-display text-sm text-gold tabular-nums">
          {formatPoints(h.totalPoints)} – {formatPoints(h.pointsLost)}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/60 p-3 space-y-4">
          {h.absent ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] leading-snug text-destructive">
              Absent — no linescore, no scratch or advanced stats credited.
              {h.pointsOverridden && h.overrideReason && (
                <> Awarded W-L via manual override: “{h.overrideReason}”.</>
              )}
            </div>
          ) : h.linescore ? (
            <>
              {h.isSub && (
                <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] leading-snug text-primary">
                  Sub performance shown below; excluded from this bowler’s
                  roster-only season scratch and advanced totals. W-L points and
                  handicap pinfall remain credited.
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-[10px] uppercase tracking-widest text-muted-foreground md:grid-cols-4">
                <span>Strikes <span className="text-gold">{h.weekStrikes}</span></span>
                <span>Spares <span className="text-gold">{h.weekSpares}</span></span>
                <span>Opens <span className="text-gold">{h.weekOpens}</span></span>
                <span>Marks <span className="text-gold">{h.weekMarks}</span></span>
                <span>Mark % <span className="text-gold">{h.weekMarkPct.toFixed(1)}%</span></span>
                <span>Strike % <span className="text-gold">{h.weekStrikePct.toFixed(1)}%</span></span>
                <span>Spare Conv <span className="text-gold">{h.weekSpareConversionPct.toFixed(1)}%</span></span>
                <span>Open % <span className="text-gold">{h.weekOpenPct.toFixed(1)}%</span></span>
                <span>Pins Lost <span className="text-gold">{h.weekPinsLost.toFixed(2)}</span></span>
                <span>First 5 <span className="text-gold">{h.weekFirst5}</span></span>
                <span>Last 5 <span className="text-gold">{h.weekLast5}</span></span>
                <span>Big Opening <span className="text-gold">{h.weekBigOpening}</span></span>
                <span>Big Finish <span className="text-gold">{h.weekBigFinish}</span></span>
                <span>Clutch (9–10) <span className="text-gold">{h.weekClutchMarks}/{h.weekClutchOpportunities} · {h.weekClutchPct.toFixed(0)}%</span></span>
                <span>Hdcp set <span className="text-gold">{h.handicapTotal}</span></span>
                <span>POA (set) <span className="text-gold">{formatSigned(h.poaSet)}</span></span>
                <span>Result <span className="text-gold">{h.result}</span></span>
              </div>
              <ThreeGameLinescore linescore={h.linescore} />
            </>
          ) : null}
        </div>
      )}
    </div>
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
