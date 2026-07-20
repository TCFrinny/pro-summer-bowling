import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  BOWLERS,
  formatPoints,
  formatRecord,
  getBowlerSeasonExtras,
  type Bowler,
} from "@/lib/mock-data";
import { useLeagueSnapshot, getLeagueState } from "@/lib/league-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Trophy } from "lucide-react";
import { computeSeasonRatings, leaderboardOffense, leaderboardDefense, leaderboardTwoWay, formatRating } from "@/lib/ratings";
import { ratingGamesFromCurrentSeason } from "@/lib/ratings-extract";

export const Route = createFileRoute("/statistics")({
  head: () => ({
    meta: [
      { title: "Statistics — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Season leaders and sortable statistics derived from every saved match linescore.",
      },
    ],
  }),
  component: StatisticsPage,
});

/** A bowler row extended with linescore-derived POA fields. */
interface StatRow {
  bowler: Bowler;
  seasonPOA: number;
  bestGamePOA: number;
  bestSetPOA: number;
}

type Metric =
  | "scratchAverage"
  | "record"
  | "scratchPinfall"
  | "handicapPinfall"
  | "highGame"
  | "highSet"
  | "seasonPOA"
  | "bestGamePOA"
  | "bestSetPOA";

interface MetricDef {
  key: Metric;
  label: string;
  /** value used for sorting (higher = better). */
  value: (r: StatRow) => number;
  /** display string in cells. */
  format: (r: StatRow) => string;
}

const METRICS: MetricDef[] = [
  {
    key: "scratchAverage",
    label: "Scratch Avg",
    value: (r) => r.bowler.scratchAverage,
    format: (r) => r.bowler.scratchAverage.toFixed(3),
  },
  {
    key: "record",
    label: "Points Won (W - L)",
    value: (r) => r.bowler.points,
    format: (r) => formatRecord(r.bowler.points, r.bowler.pointsLost),
  },
  {
    key: "scratchPinfall",
    label: "Scratch Pinfall",
    value: (r) => r.bowler.scratchPinfall,
    format: (r) => r.bowler.scratchPinfall.toLocaleString(),
  },
  {
    key: "handicapPinfall",
    label: "Handicap Pinfall",
    value: (r) => r.bowler.handicapPinfall,
    format: (r) => r.bowler.handicapPinfall.toLocaleString(),
  },
  {
    key: "highGame",
    label: "High Game",
    value: (r) => r.bowler.highGame,
    format: (r) => r.bowler.highGame.toString(),
  },
  {
    key: "highSet",
    label: "High Set",
    value: (r) => r.bowler.highSet,
    format: (r) => r.bowler.highSet.toString(),
  },
  {
    key: "seasonPOA",
    label: "Season POA",
    value: (r) => r.seasonPOA,
    format: (r) => formatSigned(r.seasonPOA),
  },
  {
    key: "bestGamePOA",
    label: "Best Game POA",
    value: (r) => r.bestGamePOA,
    format: (r) => formatSigned(r.bestGamePOA),
  },
  {
    key: "bestSetPOA",
    label: "Best Set POA",
    value: (r) => r.bestSetPOA,
    format: (r) => formatSigned(r.bestSetPOA),
  },
];

function StatisticsPage() {
  useLeagueSnapshot(); // subscribe: re-render when admin saves rebuild the snapshot
  // Derive once from linescores — no per-render recomputation across the season.
  const rows: StatRow[] = useMemo(
    () =>
      BOWLERS.map((b) => {
        const extras = getBowlerSeasonExtras(b.id);
        return {
          bowler: b,
          seasonPOA: extras.seasonPOA,
          bestGamePOA: extras.bestGamePOA,
          bestSetPOA: extras.bestSetPOA,
        };
      }),
    [],
  );

  const [sort, setSort] = useState<Metric>("scratchAverage");
  const activeMetric = METRICS.find((m) => m.key === sort)!;
  const sorted = useMemo(
    () => [...rows].sort((a, b) => activeMetric.value(b) - activeMetric.value(a)),
    [rows, activeMetric],
  );

  const ratings = useMemo(() => {
    const games = ratingGamesFromCurrentSeason("current", getLeagueState().db.matchesByWeek);
    const base = computeSeasonRatings(games).map((r) => ({
      ...r,
      displayName: BOWLERS.find((b) => b.id === r.personRef)?.name ?? r.personRef,
    }));
    return {
      offense: leaderboardOffense(base).slice(0, 10),
      defense: leaderboardDefense(base).slice(0, 10),
      twoWay: leaderboardTwoWay(base).slice(0, 10),
    };
  }, []);

  return (
    <AppShell>
      <PageHeader
        title="Statistics"
        subtitle="Season leaders and sortable tables — derived once from saved match linescores, not recomputed on load."
      />



      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {METRICS.slice(0, 5).map((m) => {
          const leader = [...rows].sort((a, b) => m.value(b) - m.value(a))[0];
          return (
            <Card key={m.key} className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                  <Trophy className="h-3.5 w-3.5 text-gold" /> {m.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-2xl text-gold">
                  {m.format(leader)}
                </div>
                <Link
                  to="/bowlers/$bowlerId"
                  params={{ bowlerId: leader.bowler.id }}
                  className="text-sm hover:text-primary"
                >
                  {leader.bowler.name}
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-8 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-accent/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3 text-left">Bowler</th>
              {METRICS.map((m) => (
                <th key={m.key} className="px-3 py-3 text-right">
                  <button
                    onClick={() => setSort(m.key)}
                    className={cn(
                      "transition-colors",
                      sort === m.key ? "text-gold" : "hover:text-foreground",
                    )}
                  >
                    {m.label} {sort === m.key ? "▾" : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((r) => (
              <tr key={r.bowler.id} className="hover:bg-accent/30">
                <td className="px-3 py-2">
                  <Link
                    to="/bowlers/$bowlerId"
                    params={{ bowlerId: r.bowler.id }}
                    className="hover:text-primary"
                  >
                    {r.bowler.name}
                  </Link>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {r.bowler.matchesPlayed} mat · {r.bowler.gamesPlayed} g
                  </div>
                </td>
                {METRICS.map((m) => (
                  <td
                    key={m.key}
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      sort === m.key && "font-semibold text-gold",
                    )}
                  >
                    {m.format(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-10 rounded-lg border border-border bg-card/60 p-4">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg">
            Offense &amp; Matchup Defense
            <span className="ml-2 text-xs uppercase tracking-widest text-muted-foreground">Experimental</span>
          </h2>
        </header>
        <div className="grid gap-3 md:grid-cols-3">
          <RatingBoard title="Offense" rows={ratings.offense.map((r) => ({
            id: r.personRef, name: r.displayName ?? r.personRef, value: r.offensiveRating!, sample: r.details.actualGames }))} />
          <RatingBoard title="Matchup Defense" rows={ratings.defense.map((r) => ({
            id: r.personRef, name: r.displayName ?? r.personRef, value: r.matchupDefense!, sample: r.details.opponentGames }))} />
          <RatingBoard title="Two-Way" rows={ratings.twoWay.map((r) => ({
            id: r.personRef, name: r.displayName ?? r.personRef, value: r.twoWayRating!, sample: Math.min(r.details.actualGames, r.details.opponentGames) }))} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Ratings are centered at 100 (season average); ± scale ≈ 15 = 1 standard
          deviation. Requires ≥6 games for offense, ≥6 opponent games for defense.
        </p>
      </section>

      <p className="mt-3 text-[11px] text-muted-foreground">
        POA baseline (Phase 1) = entry average. Best Game/Set POA = best single
        game / 3-game set pinfall minus that baseline. Points Won (W - L) counts
        league points across every completed match; each match distributes
        exactly 7 combined points. All numbers derive from the saved linescores
        so standings, results, and leaderboards always agree.
      </p>
      {/* Silence unused import in some builds */}
      <span className="hidden">{formatPoints(0)}</span>
    </AppShell>
  );
}

function formatSigned(n: number): string {
  const rounded = Number(n.toFixed(2));
  if (rounded === 0) return "±0";
  const sign = rounded > 0 ? "+" : "−";
  const abs = Math.abs(rounded).toFixed(2).replace(/\.?0+$/, "");
  return `${sign}${abs}`;
}

function RatingBoard({ title, rows }: {
  title: string; rows: Array<{ id: string; name: string; value: number; sample: number }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-3 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">Not enough data yet.</p>
      ) : (
        <ol className="divide-y divide-border text-sm">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-1.5">
              <span>
                <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                <Link to="/bowlers/$bowlerId" params={{ bowlerId: r.id }} className="underline">{r.name}</Link>
                <span className="ml-2 text-[10px] text-muted-foreground">{r.sample}g</span>
              </span>
              <span className="font-mono tabular-nums">{formatRating(r.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

