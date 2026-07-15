import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { getSubstituteProfile } from "@/lib/mock-data";
import { useLeagueSnapshot } from "@/lib/league-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronLeft, ChevronUp } from "lucide-react";
import { useState } from "react";
import { ThreeGameLinescore } from "@/components/linescore/ThreeGameLinescore";
import type { SubstituteProfile, SubstituteWeekRow } from "@/lib/substitute-profiles";

export const Route = createFileRoute("/bowlers/sub/$substituteId")({
  loader: ({ params }) => {
    const profile = getSubstituteProfile(params.substituteId);
    if (!profile) throw notFound();
    return { profile };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.profile.name} (Substitute) — Pro Summer Singles`
          : "Substitute — Pro Summer Singles",
      },
    ],
  }),
  errorComponent: ({ error, reset }) => (
    <AppShell>
      <div className="p-6 text-center text-sm text-muted-foreground">
        {error.message}{" "}
        <button className="text-primary underline" onClick={reset}>retry</button>
      </div>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <div className="p-10 text-center">
        <div className="font-display text-3xl">Substitute not found</div>
        <Link to="/bowlers" className="mt-3 inline-block text-primary underline">
          Back to bowlers
        </Link>
      </div>
    </AppShell>
  ),
  component: SubstituteProfilePage,
});

function SubstituteProfilePage() {
  useLeagueSnapshot();
  const { profile } = Route.useLoaderData() as { profile: SubstituteProfile };
  const maxUsage = Math.max(1, ...profile.lanePairUsage.map((u: { count: number }) => u.count));

  return (
    <AppShell>
      <Link
        to="/bowlers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> All bowlers
      </Link>
      <PageHeader
        title={profile.name}
        subtitle={`Substitute profile${profile.archived ? " · archived" : ""}`}
      />

      <div className="mb-4 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-[12px] leading-snug text-primary">
        Match W-L points and credited handicap pinfall from these
        appearances go to the SCHEDULED bowler in the league standings —
        they are not tallied here as this substitute's own record.
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          label="Starting Avg (current)"
          value={profile.currentStartingAverage != null ? profile.currentStartingAverage.toFixed(1) : "—"}
        />
        <Stat
          label="Handicap (current)"
          value={profile.currentHandicap != null ? profile.currentHandicap.toString() : "—"}
        />
        <Stat
          label="Scratch Avg"
          value={profile.gamesRolled > 0 ? profile.scratchAverage.toFixed(3) : "—"}
          accent
        />
        <Stat
          label="Matches / Games"
          value={`${profile.matchesSubbed} / ${profile.gamesRolled}`}
          accent
        />
        <Stat label="Scratch Pinfall" value={profile.scratchPinfall.toLocaleString()} />
        <Stat label="High Game" value={profile.highGame.toString()} />
        <Stat label="High Set" value={profile.highSet.toString()} />
        <Stat label="Season POA" value={formatSigned(profile.seasonPOA)} />
        <Stat label="Strikes" value={profile.strikes.toString()} />
        <Stat label="Spares" value={profile.spares.toString()} />
        <Stat label="Opens" value={profile.opens.toString()} />
        <Stat label="Total Marks" value={profile.marks.toString()} />
        <Stat label="Frames Rolled" value={profile.framesRolled.toString()} />
        <Stat label="Mark %" value={`${profile.markPct.toFixed(1)}%`} />
        <Stat label="Strike %" value={`${profile.strikePct.toFixed(1)}%`} />
        <Stat label="Spare Conv. %" value={`${profile.spareConversionPct.toFixed(1)}%`} />
        <Stat label="Open %" value={`${profile.openPct.toFixed(1)}%`} />
        <Stat label="Pins Lost / Game" value={profile.pinsLost.toFixed(2)} />
        <Stat label="Consistency (σ)" value={profile.consistency.toFixed(2)} />
        <Stat label="First 5 / game" value={profile.first5PerGame.toFixed(1)} />
        <Stat label="Last 5 / game" value={profile.last5PerGame.toFixed(1)} />
        <Stat label="Big Opening / game" value={profile.bigOpeningPerGame.toFixed(1)} />
        <Stat label="Big Finish / game" value={profile.bigFinishPerGame.toFixed(1)} />
        <Stat
          label="Clutch % (Fr 9–10)"
          value={`${profile.clutchPct.toFixed(1)}% (${profile.clutchMarks}/${profile.clutchOpportunities})`}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 bg-card">
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Weekly appearances · full linescores
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {profile.weeks.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No substitute appearances yet.
              </div>
            )}
            {profile.weeks.map((h: SubstituteWeekRow) => (
              <WeekRow key={`${h.week}-${h.matchId}`} h={h} />
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="font-display text-xl">Lane-pair use</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {profile.lanePairUsage.map(({ lanePair, count }: { lanePair: string; count: number }) => (
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

function WeekRow({ h }: { h: SubstituteWeekRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-md border border-border/60 bg-background/40"
      data-testid={`sub-history-week-${h.week}`}
      data-scratch-total={h.scratchTotal}
      data-handicap-total={h.handicapTotal}
      data-frozen-handicap={h.handicapAtMatch}
      data-frozen-avg={h.startingAverageAtMatch}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent/40"
      >
        <span className="w-10 text-xs font-semibold uppercase text-muted-foreground">
          Wk {h.week}
        </span>
        <span className="w-14 text-xs text-muted-foreground">Lanes {h.lanePair}</span>
        <span className="flex-1 truncate">
          Subbed for <span className="text-foreground">{h.scheduledForName}</span>
          {" "}vs <span className="text-foreground">{h.opponentName}</span>
        </span>
        <span className="tabular-nums text-xs text-muted-foreground">
          {h.scores.join(" · ")} = {h.scratchTotal}
        </span>
        <span className="tabular-nums text-xs text-muted-foreground">
          hdcp +{h.handicapAtMatch} · set {h.handicapTotal}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/60 p-3 space-y-4">
          <div className="grid grid-cols-2 gap-2 text-[10px] uppercase tracking-widest text-muted-foreground md:grid-cols-4">
            <span>Start avg <span className="text-gold">{h.startingAverageAtMatch.toFixed(1)}</span></span>
            <span>Hdcp used <span className="text-gold">+{h.handicapAtMatch}</span></span>
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
            <span>
              Clutch (9–10){" "}
              <span className="text-gold">
                {h.weekClutchMarks}/{h.weekClutchOpportunities} · {h.weekClutchPct.toFixed(0)}%
              </span>
            </span>
            <span>Hdcp set <span className="text-gold">{h.handicapTotal}</span></span>
            <span>POA (set) <span className="text-gold">{formatSigned(h.poaSet)}</span></span>
          </div>
          <ThreeGameLinescore linescore={h.linescore} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl ${accent ? "text-gold" : ""}`}>{value}</div>
    </div>
  );
}

function formatSigned(n: number): string {
  const rounded = Number(n.toFixed(2));
  if (rounded === 0) return "±0";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toFixed(2).replace(/\.?0+$/, "")}`;
}
