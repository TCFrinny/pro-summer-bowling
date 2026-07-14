import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, EmptyState, PageHeader } from "@/components/layout/AppShell";
import {
  WEEKS,
  formatPoints,
  getAwardedPoints,
  getBowler,
  getMatchesForWeek,
  type Match,
} from "@/lib/mock-data";
import { useLeagueSnapshot } from "@/lib/league-store";
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
import { ChevronDown, ChevronUp, Crown } from "lucide-react";
import { ThreeGameLinescore } from "@/components/linescore/ThreeGameLinescore";

export const Route = createFileRoute("/weekly-results")({
  head: () => ({
    meta: [
      { title: "Weekly Results — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Full frame linescores for every completed match — three 10-frame duckpin games per bowler, plus 7-point match breakdown.",
      },
    ],
  }),
  component: WeeklyResultsPage,
});

function WeeklyResultsPage() {
  useLeagueSnapshot(); // subscribe: re-render when admin saves rebuild the snapshot
  // A week appears here as soon as it has ANY saved match — admins do
  // not have to complete all 18 matches before results are visible.
  const withResults = WEEKS.filter(
    (w) => (getMatchesForWeek(w.week) ?? []).some((m) => !!m.result),
  );
  const [week, setWeek] = useState<number>(
    withResults[withResults.length - 1]?.week ?? 1,
  );
  const matches = getMatchesForWeek(week).filter((m) => m.result);

  return (
    <AppShell>
      <PageHeader
        title="Weekly Results"
        subtitle="Every score, W-L point, and season aggregate is derived from these frame linescores."
      >
        <Select value={String(week)} onValueChange={(v) => setWeek(Number(v))}>
          <SelectTrigger className="w-40" data-testid="wr-week-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {withResults.map((w) => (
              <SelectItem key={w.week} value={String(w.week)}>
                Week {w.week}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link
          to="/leaderboards"
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
        >
          Leaderboards →
        </Link>
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
  const r = m.result!;
  // Prefer FROZEN scheduled names from the saved result so a later
  // roster rename does not rewrite completed weekly-results history.
  const a = { name: r.scheduledNameA ?? getBowler(m.bowlerA)?.name ?? "—" };
  const b = { name: r.scheduledNameB ?? getBowler(m.bowlerB)?.name ?? "—" };
  const [openA, setOpenA] = useState(false);
  const [openB, setOpenB] = useState(false);

  return (
    <Card className="bg-card" data-testid={`wr-match-${m.id}`}>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
          <span>Lanes {m.lanePair}</span>
          <span>Week {m.week}</span>
          <span>
            Final{" "}
            <span className="font-display text-sm text-gold">
              {formatPoints(getAwardedPoints(r).pointsA)}–{formatPoints(getAwardedPoints(r).pointsB)}
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
              <SummaryRow side="A" m={m} name={a.name} />
              <SummaryRow side="B" m={m} name={b.name} />
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid gap-2">
          {r.linescoreA ? (
            <ExpandRow
              label={`View full linescore — ${a.name}`}
              open={openA}
              onToggle={() => setOpenA((v) => !v)}
            >
              <ThreeGameLinescore linescore={r.linescoreA} />
            </ExpandRow>
          ) : (
            <AbsentPlaceholder name={a.name} />
          )}
          {r.linescoreB ? (
            <ExpandRow
              label={`View full linescore — ${b.name}`}
              open={openB}
              onToggle={() => setOpenB((v) => !v)}
            >
              <ThreeGameLinescore linescore={r.linescoreB} />
            </ExpandRow>
          ) : (
            <AbsentPlaceholder name={b.name} />
          )}
        </div>

        {r.pointsOverride && (
          <div className="mt-3 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-[11px] leading-snug">
            <span className="inline-block rounded bg-gold px-1.5 py-0.5 font-display text-[10px] uppercase tracking-widest text-background">
              Manual points override
            </span>{" "}
            <span className="text-muted-foreground">{r.pointsOverride.reason}</span>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>2 pts / game win · 1 pt tie · higher hdcp set wins +1</span>
          <span>Exactly 7 pts per match</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ExpandRow({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/60">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:bg-accent/40"
      >
        <span>{label}</span>
        {open ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>
      {open && <div className="border-t border-border/60 p-3">{children}</div>}
    </div>
  );
}

function AbsentPlaceholder({ name }: { name: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground">
      {name} — Absent (no linescore)
    </div>
  );
}

function SummaryRow({
  side,
  m,
  name,
}: {
  side: "A" | "B";
  m: Match;
  name: string;
}) {
  const r = m.result!;
  const isA = side === "A";
  const participation = isA ? r.participationA : r.participationB;
  const absent = participation.status === "absent";
  const games = isA ? r.gamesA : r.gamesB;
  const awards = isA ? r.gameAwardsA : r.gameAwardsB;
  const hdcp = isA ? r.handicapA : r.handicapB;
  const scratchTotal = isA ? r.scratchTotalA : r.scratchTotalB;
  const hdcpTotal = isA ? r.handicapTotalA : r.handicapTotalB;
  const gp = isA ? r.gamePointsA : r.gamePointsB;
  const sp = isA ? r.setPointA : r.setPointB;
  const awarded = getAwardedPoints(r);
  const total = isA ? awarded.pointsA : awarded.pointsB;
  const isSub = isA ? r.isSubA : r.isSubB;
  const actualName = isA ? r.actualNameA : r.actualNameB;
  const winner = r.winner === side;
  const setWinner = sp === 1;
  const setTied = sp === 0.5;

  return (
    <tr className={cn(winner && "bg-primary/10")} data-testid={`wr-row-${m.id}-${side}`}>
      <td className="py-1.5 pr-2">
        <div className="flex items-center gap-1.5 font-medium">
          {winner && <Crown className="h-3.5 w-3.5 text-gold" />}
          <span>{name}</span>
          {isSub && (
            <span
              title={`Rolled by ${actualName}`}
              className="rounded bg-primary/25 px-1.5 text-[9px] uppercase tracking-widest text-primary"
            >
              sub
            </span>
          )}
          {absent && (
            <span className="rounded bg-destructive/20 px-1.5 text-[9px] uppercase tracking-widest text-destructive">
              absent
            </span>
          )}
        </div>
        {isSub && (
          <div className="text-[10px] text-muted-foreground">
            rolled by {actualName}
          </div>
        )}
      </td>
      {absent ? (
        <td colSpan={6} className="py-1.5 text-center text-[11px] uppercase tracking-widest text-muted-foreground">
          — Absent —
        </td>
      ) : (
        <>
          <td className="py-1.5 text-right">{hdcp}</td>
          {games.map((g, i) => (
            <td key={i} className="py-1.5 text-right" data-testid={`wr-row-${m.id}-${side}-g${i + 1}`}>
              <div className="font-semibold">{g}</div>
              <div
                className={cn(
                  "mt-0.5 text-[9px] font-semibold uppercase",
                  awards[i] === 2
                    ? "text-primary"
                    : awards[i] === 1
                      ? "text-gold"
                      : "text-muted-foreground",
                )}
              >
                +{awards[i]}
              </div>
            </td>
          ))}
          <td className="py-1.5 text-right font-semibold" data-testid={`wr-row-${m.id}-${side}-scratch`}>{scratchTotal}</td>
          <td
            className={cn(
              "py-1.5 text-right font-semibold",
              setWinner
                ? "text-primary"
                : setTied
                  ? "text-gold"
                  : "text-muted-foreground",
            )}
            data-testid={`wr-row-${m.id}-${side}-hdcp`}
          >
            {hdcpTotal}
            <div className="text-[9px] font-normal uppercase text-muted-foreground">
              set +{formatPoints(sp)}
            </div>
          </td>
        </>
      )}
      <td className="py-1.5 text-right">
        <span
          className={cn(
            "inline-block rounded px-1.5 font-display text-sm",
            winner ? "bg-gold text-background" : "text-gold",
          )}
        >
          {formatPoints(total)}
        </span>
        {!absent && (
          <div className="text-[9px] font-normal uppercase text-muted-foreground">
            {gp} game · {formatPoints(sp)} set
          </div>
        )}
      </td>
    </tr>
  );
}
