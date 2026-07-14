import { createFileRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { BOWLERS } from "@/lib/mock-data";
import { Input } from "@/components/ui/input";
import { useState } from "react";

export const Route = createFileRoute("/bowlers")({
  head: () => ({
    meta: [
      { title: "Bowlers — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Roster of Pro Summer Singles duckpin bowlers with averages and profile links.",
      },
    ],
  }),
  component: BowlersLayout,
});

function BowlersLayout() {
  const matches = useMatches();
  const onChild = matches.some((m) => m.routeId === "/bowlers/$bowlerId");
  if (onChild) return <Outlet />;
  return <BowlersIndex />;
}

function BowlersIndex() {
  const [q, setQ] = useState("");
  const filtered = BOWLERS.filter((b) =>
    b.name.toLowerCase().includes(q.toLowerCase()),
  ).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <AppShell>
      <PageHeader title="Bowlers" subtitle={`${BOWLERS.length} on the roster`}>
        <Input
          placeholder="Search bowlers…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
        />
      </PageHeader>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((b) => (
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
    </AppShell>
  );
}
