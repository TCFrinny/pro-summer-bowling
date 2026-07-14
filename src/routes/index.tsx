import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BOWLERS,
  LEAGUE_NAME,
  SEASON_LABEL,
  VENUE_NAME,
  WEEKS,
  formatPoints,
  getStandingsSnapshot,
} from "@/lib/mock-data";
import { ArrowRight, Trophy, Users, CalendarDays } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  // Read pre-saved snapshot — no recalculation happens on this page.
  const standings = getStandingsSnapshot().slice(0, 5);
  const latestWeek = [...WEEKS].reverse().find((w) => w.completed);

  return (
    <AppShell>
      <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-background to-accent/40 p-8 md:p-14">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-[color:var(--gold)]/10 blur-3xl" />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-gold px-3 py-1 text-xs uppercase tracking-widest text-gold">
            {SEASON_LABEL} · Duckpin Singles
          </div>
          <h1 className="mt-4 font-display text-5xl md:text-6xl font-bold leading-[0.95]">
            {LEAGUE_NAME}
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Singles duckpin league at <strong>{VENUE_NAME}</strong>. Standings,
            weekly results, lane data, and elimination tracking — all in one
            place.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/standings"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              View standings <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/weekly-results"
              className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent"
            >
              Latest week
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Bowlers"
          value={BOWLERS.length.toString()}
        />
        <StatCard
          icon={<CalendarDays className="h-5 w-5" />}
          label="Weeks completed"
          value={`${WEEKS.filter((w) => w.completed).length} / ${WEEKS.length}`}
        />
        <StatCard
          icon={<Trophy className="h-5 w-5" />}
          label="Current leader"
          value={standings[0]?.bowler.name ?? "—"}
        />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 bg-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display text-2xl">Top 5</CardTitle>
            <Link
              to="/standings"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Full standings →
            </Link>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {standings.map((r) => (
                <div
                  key={r.bowler.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full font-display font-bold ${
                        r.rank === 1
                          ? "bg-gold"
                          : "bg-accent text-accent-foreground"
                      }`}
                    >
                      {r.rank}
                    </span>
                    <Link
                      to="/bowlers/$bowlerId"
                      params={{ bowlerId: r.bowler.id }}
                      className="font-medium hover:text-primary"
                    >
                      {r.bowler.name}
                    </Link>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <span className="text-muted-foreground">
                      avg {r.bowler.scratchAverage.toFixed(3)}
                    </span>
                    <span className="font-display text-lg text-gold">
                      {formatPoints(r.bowler.points)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="font-display text-2xl">
              Latest week
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestWeek ? (
              <div>
                <div className="text-sm text-muted-foreground">Week</div>
                <div className="font-display text-5xl text-primary">
                  {latestWeek.week}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {new Date(latestWeek.date).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
                <Link
                  to="/weekly-results"
                  className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  See match cards <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Season hasn't started.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-2 font-display text-3xl">{value}</div>
    </div>
  );
}
