import { createFileRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { BOWLERS, getPublicSubstitutes, getSubstituteProfile } from "@/lib/mock-data";
import { useLeagueSnapshot } from "@/lib/league-store";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { sortPersonOptions } from "@/lib/person-sort";

export const Route = createFileRoute("/bowlers")({
  head: () => ({
    meta: [
      { title: "Bowlers — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Roster and substitute pool for Pro Summer Singles duckpin bowlers with averages and profile links.",
      },
    ],
  }),
  component: BowlersLayout,
});

function BowlersLayout() {
  useLeagueSnapshot();
  const matches = useMatches();
  const onChild = matches.some(
    (m) =>
      m.routeId === "/bowlers/$bowlerId" ||
      m.routeId === "/bowlers/sub/$substituteId",
  );
  if (onChild) return <Outlet />;
  return <BowlersIndex />;
}

function BowlersIndex() {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rostered = BOWLERS.filter((b) =>
    b.name.toLowerCase().includes(needle),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const subs = getPublicSubstitutes()
    .filter((s) => s.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <AppShell>
      <PageHeader
        title="Bowlers"
        subtitle={`${BOWLERS.length} on the roster · ${getPublicSubstitutes().length} in the substitute pool`}
      >
        <Input
          placeholder="Search bowlers or subs…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
        />
      </PageHeader>

      <section aria-labelledby="rostered-heading">
        <h2
          id="rostered-heading"
          className="mb-2 font-display text-sm uppercase tracking-widest text-muted-foreground"
        >
          Rostered bowlers
        </h2>
        {rostered.length === 0 ? (
          <p className="rounded border border-border bg-card/60 p-4 text-sm text-muted-foreground">
            No rostered bowlers match “{q}”.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rostered.map((b) => (
              <Link
                key={b.id}
                to="/bowlers/$bowlerId"
                params={{ bowlerId: b.id }}
                className="group rounded-lg border border-border bg-card p-4 transition hover:border-primary/60 hover:bg-accent/40"
              >
                <div className="flex items-baseline justify-between">
                  <div className="font-display text-lg group-hover:text-primary">
                    {b.name}
                  </div>
                  <div className="font-display text-xl text-gold">{b.points}</div>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>avg {b.scratchAverage.toFixed(3)}</span>
                  <span>hdcp {b.handicap}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="subs-heading" className="mt-8">
        <h2
          id="subs-heading"
          className="mb-2 font-display text-sm uppercase tracking-widest text-muted-foreground"
        >
          Substitutes
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          League points and handicap pinfall from sub appearances are credited
          to the scheduled bowler in standings.
        </p>
        {subs.length === 0 ? (
          <p className="rounded border border-border bg-card/60 p-4 text-sm text-muted-foreground">
            {needle
              ? `No substitutes match “${q}”.`
              : "No substitutes yet."}
          </p>
        ) : (
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="substitutes-grid"
          >
            {subs.map((s) => {
              const profile = getSubstituteProfile(s.id);
              const avg = profile && profile.gamesRolled > 0
                ? profile.scratchAverage.toFixed(3)
                : "—";
              const ref = s.handicap != null
                ? `hdcp ${s.handicap}`
                : s.startingAverage != null
                  ? `start avg ${s.startingAverage.toFixed(1)}`
                  : null;
              return (
                <Link
                  key={s.id}
                  to="/bowlers/sub/$substituteId"
                  params={{ substituteId: s.id }}
                  className="group rounded-lg border border-border bg-card p-4 transition hover:border-primary/60 hover:bg-accent/40"
                >
                  <div className="flex items-baseline justify-between">
                    <div className="font-display text-lg group-hover:text-primary">
                      {s.name}
                    </div>
                    <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-primary">
                      sub
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      avg {avg} · {profile?.matchesSubbed ?? 0} match
                      {(profile?.matchesSubbed ?? 0) === 1 ? "" : "es"}
                    </span>
                    <span>{ref ?? "—"}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
