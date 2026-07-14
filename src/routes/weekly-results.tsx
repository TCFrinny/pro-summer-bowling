import { createFileRoute } from "@tanstack/react-router";
import { AppShell, EmptyState, PageHeader } from "@/components/layout/AppShell";
import {
  WEEKS,
  formatPoints,
  getBowler,
  getMatchesForWeek,
  type GameAward,
  type Match,
  type SetAward,
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
          "Match cards for the Pro Summer Singles duckpin league: per-game points, set points, and total points on the 7-point system.",
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
        subtitle="Each card is a saved match on the 7-point system (2+2+2 games + 1 set). Nothing is recomputed here."
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
  const aWin = r.winner === "A";
  const bWin = r.winner === "B";

  return (
    <Card className="bg-card">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
          <span>Lanes {m.lanePair}</span>
          <span>Week {m.week}</span>
        </div>

        <Side
          name={a.name}
          sub={r.subA}
          games={r.gamesA}
          hdcp={r.handicapA}
          awards={r.gameAwardsA}
          gp={r.gamePointsA}
          sp={r.setPointA}
          hdcpTotal={r.handicapTotalA}
          total={r.totalPointsA}
          winner={aWin}
        />
        <div className="my-2 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>
            Final {formatPoints(r.totalPointsA)}–{formatPoints(r.totalPointsB)}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <Side
          name={b.name}
          sub={r.subB}
          games={r.gamesB}
          hdcp={r.handicapB}
          awards={r.gameAwardsB}
          gp={r.gamePointsB}
          sp={r.setPointB}
          hdcpTotal={r.handicapTotalB}
          total={r.totalPointsB}
          winner={bWin}
        />
      </CardContent>
    </Card>
  );
}

function Side({
  name,
  sub,
  games,
  hdcp,
  awards,
  gp,
  sp,
  hdcpTotal,
  total,
  winner,
}: {
  name: string;
  sub?: string;
  games: [number, number, number];
  hdcp: number;
  awards: [GameAward, GameAward, GameAward];
  gp: number;
  sp: SetAward;
  hdcpTotal: number;
  total: number;
  winner: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md p-2",
        winner && "bg-primary/10 ring-1 ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium">
          {winner && <Crown className="h-4 w-4 text-gold" />}
          <span>{name}</span>
          {sub && (
            <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              sub
            </span>
          )}
        </div>
        <span className="font-display text-lg text-gold">
          {formatPoints(total)}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-6 gap-1 text-center text-xs tabular-nums">
        {games.map((g, i) => (
          <div
            key={i}
            className={cn(
              "rounded py-1",
              awards[i] === 2
                ? "bg-primary/25 ring-1 ring-primary/40"
                : awards[i] === 1
                  ? "bg-gold/25"
                  : "bg-accent/60",
            )}
          >
            <div className="text-[10px] uppercase text-muted-foreground">
              G{i + 1}
            </div>
            <div className="font-semibold">{g}</div>
            <div className="text-[10px] font-semibold text-gold">
              +{awards[i]}
            </div>
          </div>
        ))}
        <div className="rounded bg-accent/60 py-1">
          <div className="text-[10px] uppercase text-muted-foreground">Hdcp</div>
          <div className="font-semibold">{hdcp}</div>
        </div>
        <div
          className={cn(
            "rounded py-1",
            sp === 1
              ? "bg-primary/25 ring-1 ring-primary/40"
              : sp === 0.5
                ? "bg-gold/25"
                : "bg-accent/60",
          )}
          title={`Handicap total ${hdcpTotal}`}
        >
          <div className="text-[10px] uppercase text-muted-foreground">
            Set
          </div>
          <div className="font-semibold">{hdcpTotal}</div>
          <div className="text-[10px] font-semibold text-gold">
            +{formatPoints(sp)}
          </div>
        </div>
        <div className="rounded bg-primary/25 py-1 ring-1 ring-primary/40">
          <div className="text-[10px] uppercase text-muted-foreground">
            GP · SP
          </div>
          <div className="font-semibold">
            {gp}·{formatPoints(sp)}
          </div>
          <div className="text-[10px] font-semibold text-gold">
            ={formatPoints(total)}
          </div>
        </div>
      </div>
    </div>
  );
}
