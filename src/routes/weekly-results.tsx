import { createFileRoute } from "@tanstack/react-router";
import { AppShell, EmptyState, PageHeader } from "@/components/layout/AppShell";
import {
  WEEKS,
  formatPoints,
  getBowler,
  getMatchesForWeek,
  type GameAward,
  type Match,
  type MatchResult,
} from "@/lib/mock-data";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Crown } from "lucide-react";

export const Route = createFileRoute("/weekly-results")({
  head: () => ({
    meta: [
      { title: "Weekly Results — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Full match linescores for the Pro Summer Singles duckpin league: per-game scores, handicap totals, and 7-point match points.",
      },
    ],
  }),
  component: WeeklyResultsPage,
});

function WeeklyResultsPage() {
  const completed = WEEKS.filter((w) => w.completed);
  const [week, setWeek] = useState<number>(
    completed[completed.length - 1]?.week ?? 1,
  );
  const matches = getMatchesForWeek(week).filter((m) => m.result);

  return (
    <AppShell>
      <PageHeader
        title="Weekly Results"
        subtitle="Saved linescores are the source of truth for every score, W-L point, and average shown on the site."
      >
        <Select value={String(week)} onValueChange={(v) => setWeek(Number(v))}>
          <SelectTrigger className="w-40">
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
      </PageHeader>

      {matches.length === 0 ? (
        <EmptyState
          title="No results published for this week yet"
          description="Once the admin saves scores, the match cards appear here."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {matches.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function MatchCard({ m }: { m: Match }) {
  const a = getBowler(m.bowlerA)!;
  const b = getBowler(m.bowlerB)!;
  const r = m.result!;

  return (
    <Card className="bg-card">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
          <span>Lanes {m.lanePair}</span>
          <span>Week {m.week}</span>
          <span>
            Final{" "}
            <span className="font-display text-sm text-gold">
              {formatPoints(r.totalPointsA)}–{formatPoints(r.totalPointsB)}
            </span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums sm:text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="pb-1.5 text-left">Bowler</th>
                <th className="pb-1.5 text-right">Hdcp</th>
                <th className="pb-1.5 text-right">G1</th>
                <th className="pb-1.5 text-right">G2</th>
                <th className="pb-1.5 text-right">G3</th>
                <th className="pb-1.5 text-right">Scr</th>
                <th className="pb-1.5 text-right">Hdcp Tot</th>
                <th className="pb-1.5 text-right">Pts</th>
              </tr>
            </thead>
            <tbody>
              <SideRow side="A" m={m} r={r} name={a.name} />
              <SideRow side="B" m={m} r={r} name={b.name} />
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>Game pts &amp; set pt shown below each score</span>
          <span>
            Set: higher hdcp total wins 1 pt (½ each on a tie)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function SideRow({
  side,
  m,
  r,
  name,
}: {
  side: "A" | "B";
  m: Match;
  r: MatchResult;
  name: string;
}) {
  const isA = side === "A";
  const games = isA ? r.gamesA : r.gamesB;
  const awards = isA ? r.gameAwardsA : r.gameAwardsB;
  const hdcp = isA ? r.handicapA : r.handicapB;
  const scratchTotal = isA ? r.scratchTotalA : r.scratchTotalB;
  const hdcpTotal = isA ? r.handicapTotalA : r.handicapTotalB;
  const gp = isA ? r.gamePointsA : r.gamePointsB;
  const sp = isA ? r.setPointA : r.setPointB;
  const total = isA ? r.totalPointsA : r.totalPointsB;
  const isSub = isA ? r.isSubA : r.isSubB;
  const winner = r.winner === side;
  const setWinner = sp === 1;
  const setTied = sp === 0.5;
  void m;

  return (
    <>
      <tr className={cn(winner && "bg-primary/10")}>
        <td className="py-1.5 pr-2">
          <div className="flex items-center gap-1.5 font-medium">
            {winner && <Crown className="h-3.5 w-3.5 text-gold" />}
            <span>{name}</span>
            {isSub && (
              <span className="rounded bg-accent px-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">
                sub
              </span>
            )}
          </div>
        </td>
        <td className="py-1.5 text-right">{hdcp}</td>
        {games.map((g, i) => (
          <td key={i} className="py-1.5 text-right">
            <GameCell game={g} award={awards[i]} />
          </td>
        ))}
        <td className="py-1.5 text-right font-semibold">{scratchTotal}</td>
        <td
          className={cn(
            "py-1.5 text-right font-semibold",
            setWinner
              ? "text-primary"
              : setTied
                ? "text-gold"
                : "text-muted-foreground",
          )}
        >
          {hdcpTotal}
          <div className="text-[9px] font-normal uppercase text-muted-foreground">
            set +{formatPoints(sp)}
          </div>
        </td>
        <td className="py-1.5 text-right">
          <span
            className={cn(
              "inline-block rounded px-1.5 font-display text-sm",
              winner ? "bg-gold text-background" : "text-gold",
            )}
          >
            {formatPoints(total)}
          </span>
          <div className="text-[9px] font-normal uppercase text-muted-foreground">
            {gp} game · {formatPoints(sp)} set
          </div>
        </td>
      </tr>
    </>
  );
}

function GameCell({ game, award }: { game: number; award: GameAward }) {
  return (
    <div>
      <div className="font-semibold">{game}</div>
      <div
        className={cn(
          "mt-0.5 text-[9px] font-semibold uppercase",
          award === 2
            ? "text-primary"
            : award === 1
              ? "text-gold"
              : "text-muted-foreground",
        )}
      >
        +{award}
      </div>
    </div>
  );
}
