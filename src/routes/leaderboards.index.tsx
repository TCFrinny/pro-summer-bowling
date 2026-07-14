import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  WEEKS,
  formatPoints,
  formatRecord,
  getStandardLeaderboards,
  type ScratchGameRow,
  type ScratchSetRow,
  type AverageRow,
  type CreditedSeasonRow,
  type VolumeRow,
} from "@/lib/mock-data";
import { useLeagueSnapshot } from "@/lib/league-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, type ReactNode } from "react";
import { Trophy } from "lucide-react";

type Scope = "season" | number;

export const Route = createFileRoute("/leaderboards/")({
  head: () => ({
    meta: [
      { title: "Leaderboards — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Scratch (roster-only) and points/HCP (credited) leaders for the 2026 Summer season.",
      },
    ],
  }),
  component: LeaderboardsPage,
});

function LeaderboardsPage() {
  useLeagueSnapshot(); // subscribe: re-render when admin saves rebuild the snapshot
  const [scope, setScope] = useState<Scope>("season");
  const boards = getStandardLeaderboards(scope);
  const completed = WEEKS.filter((w) => w.completed);

  return (
    <AppShell>
      <PageHeader
        title="Leaderboards"
        subtitle="Scratch roster-only · Points/HCP credited to scheduled bowler"
      >
        <Select
          value={scope === "season" ? "season" : String(scope)}
          onValueChange={(v) => setScope(v === "season" ? "season" : Number(v))}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="season">Season (overall)</SelectItem>
            {completed.map((w) => (
              <SelectItem key={w.week} value={String(w.week)}>
                Week {w.week}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link
          to="/leaderboards/advanced"
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
        >
          Advanced →
        </Link>
      </PageHeader>

      <Section title="Scratch Leaders (Actual — Roster Only)">
        <Board title="High Game (Top 5)">
          <GameTable rows={boards.scratchHighGame} field="scratch" />
        </Board>
        <Board title="High Series (Top 5)">
          <SetTable rows={boards.scratchHighSeries} field="scratchSet" />
        </Board>
        <Board title="Top Averages (Scratch)">
          <AveragesTable rows={boards.topScratchAverages} />
        </Board>
      </Section>

      <Section title="Points / HCP Leaders (Credited — Scheduled Bowler)">
        <Board title="High Game (HCP)">
          <GameTable rows={boards.hcpHighGame} field="handicap" />
        </Board>
        <Board title="High Series (HCP)">
          <SetTable rows={boards.hcpHighSeries} field="handicapSet" />
        </Board>
        <Board title="Top Total Points">
          <PointsTable rows={boards.topTotalPoints} />
        </Board>
      </Section>

      <Section title="Volume (Roster Only)">
        <Board title="Most Strikes">
          <VolumeTable rows={boards.mostStrikes} field="strikes" />
        </Board>
        <Board title="Most Spares">
          <VolumeTable rows={boards.mostSpares} field="spares" />
        </Board>
        <Board title="Fewest Opens (min 3 games)">
          <VolumeTable rows={boards.fewestOpens} field="opens" ascending />
        </Board>
      </Section>

      <p className="mt-6 text-[11px] text-muted-foreground">
        Scratch performances and averages belong to the ACTUAL bowler who
        rolled and exclude off-roster substitutes. League points and
        handicap pinfall are credited to the SCHEDULED (rostered) bowler.
        All numbers derive from every saved frame linescore.
      </p>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 font-display text-lg uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function Board({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Trophy className="h-4 w-4 text-gold" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function bowlerLink(id: string, name: string) {
  return (
    <Link
      to="/bowlers/$bowlerId"
      params={{ bowlerId: id }}
      className="hover:text-primary"
    >
      {name}
    </Link>
  );
}

function GameTable({
  rows,
  field,
}: {
  rows: ScratchGameRow[];
  field: "scratch" | "handicap";
}) {
  if (rows.length === 0)
    return <EmptyBoard label="No games recorded in this scope." />;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border">
        {rows.map((r, i) => (
          <tr key={`${r.matchId}-${r.bowlerId}-${i}`}>
            <td className="py-1.5 text-xs text-muted-foreground w-6">
              {i + 1}.
            </td>
            <td className="py-1.5">{bowlerLink(r.bowlerId, r.bowlerName)}</td>
            <td className="py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Wk {r.week} · {r.opponent}
            </td>
            <td className="py-1.5 text-right font-display text-lg tabular-nums text-gold">
              {r[field]}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SetTable({
  rows,
  field,
}: {
  rows: ScratchSetRow[];
  field: "scratchSet" | "handicapSet";
}) {
  if (rows.length === 0)
    return <EmptyBoard label="No sets recorded in this scope." />;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border">
        {rows.map((r, i) => (
          <tr key={`${r.matchId}-${r.bowlerId}-${i}`}>
            <td className="py-1.5 w-6 text-xs text-muted-foreground">
              {i + 1}.
            </td>
            <td className="py-1.5">{bowlerLink(r.bowlerId, r.bowlerName)}</td>
            <td className="py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Wk {r.week} · {r.opponent}
            </td>
            <td className="py-1.5 text-right font-display text-lg tabular-nums text-gold">
              {r[field]}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AveragesTable({ rows }: { rows: AverageRow[] }) {
  if (rows.length === 0)
    return <EmptyBoard label="No bowlers with 3+ games rolled yet." />;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border">
        {rows.map((r, i) => (
          <tr key={r.bowlerId}>
            <td className="py-1.5 w-6 text-xs text-muted-foreground">
              {i + 1}.
            </td>
            <td className="py-1.5">
              {bowlerLink(r.bowlerId, r.bowlerName)}
              <div className="text-[10px] uppercase text-muted-foreground">
                {r.games} g · {r.scratchPinfall.toLocaleString()} pins
              </div>
            </td>
            <td className="py-1.5 text-right font-display text-lg tabular-nums text-gold">
              {r.scratchAverage.toFixed(3)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PointsTable({ rows }: { rows: CreditedSeasonRow[] }) {
  if (rows.length === 0)
    return <EmptyBoard label="No matches completed in this scope." />;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border">
        {rows.map((r, i) => (
          <tr key={r.bowlerId}>
            <td className="py-1.5 w-6 text-xs text-muted-foreground">
              {i + 1}.
            </td>
            <td className="py-1.5">
              {bowlerLink(r.bowlerId, r.bowlerName)}
              <div className="text-[10px] uppercase text-muted-foreground">
                {r.matches} matches
              </div>
            </td>
            <td className="py-1.5 text-right font-display text-lg tabular-nums text-gold">
              {formatPoints(r.points)}
              <div className="text-[10px] font-normal uppercase text-muted-foreground">
                {formatRecord(r.points, r.pointsLost)}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VolumeTable({
  rows,
  field,
  ascending,
}: {
  rows: VolumeRow[];
  field: "strikes" | "spares" | "opens";
  ascending?: boolean;
}) {
  if (rows.length === 0)
    return <EmptyBoard label="Not enough data yet." />;
  const sorted = [...rows].sort((a, b) =>
    ascending ? a[field] - b[field] : b[field] - a[field],
  );
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border">
        {sorted.slice(0, 10).map((r, i) => (
          <tr key={r.bowlerId}>
            <td className="py-1.5 w-6 text-xs text-muted-foreground">
              {i + 1}.
            </td>
            <td className="py-1.5">
              {bowlerLink(r.bowlerId, r.bowlerName)}
              <div className="text-[10px] uppercase text-muted-foreground">
                {r.games} g
              </div>
            </td>
            <td className="py-1.5 text-right font-display text-lg tabular-nums text-gold">
              {r[field]}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyBoard({ label }: { label: string }) {
  return (
    <div className="py-6 text-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}
