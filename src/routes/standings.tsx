import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  BOWLERS,
  computePointsBehind,
  formatPoints,
  formatRecord,
  getStandingsSnapshot,
  type Bowler,
} from "@/lib/mock-data";
import { useLeagueSnapshot } from "@/lib/league-store";
import { ArrowDown, ArrowUp, Minus, Search, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/standings")({
  head: () => ({
    meta: [
      { title: "Standings — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Advanced 7-point standings for the Pro Summer Singles duckpin league. Points, pinfall, and averages.",
      },
    ],
  }),
  component: StandingsPage,
});

function Movement({ n }: { n: number }) {
  if (n === 0)
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3 w-3" /> 0
      </span>
    );
  if (n > 0)
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <ArrowUp className="h-3 w-3" /> {n}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-primary">
      <ArrowDown className="h-3 w-3" /> {Math.abs(n)}
    </span>
  );
}

type SortKey =
  | "rank"
  | "record"
  | "pointsBehind"
  | "scratchPinfall"
  | "handicapPinfall"
  | "scratchAverage"
  | "highGame"
  | "highSet"
  | "movement"
  | "name";

interface StandingsDisplayRow {
  officialRank: number;
  bowler: Bowler;
  movement: number;
  pointsBehind: number;
  isLeader: boolean;
}

const COLUMNS: {
  key: SortKey;
  label: string;
  short?: string;
  align: "left" | "right";
  numeric?: boolean;
  render: (row: StandingsDisplayRow) => React.ReactNode;
}[] = [
  {
    key: "record",
    label: "Record (W - L)",
    short: "W - L",
    align: "right",
    numeric: true,
    render: (r) => (
      <span className="font-display text-base text-gold">
        {formatRecord(r.bowler.points, r.bowler.pointsLost)}
      </span>
    ),
  },
  {
    key: "pointsBehind",
    label: "Points Behind",
    short: "PB",
    align: "right",
    numeric: true,
    render: (r) =>
      r.isLeader ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        formatPoints(r.pointsBehind)
      ),
  },
  {
    key: "scratchPinfall",
    label: "Scratch Pinfall",
    short: "Scr Pins",
    align: "right",
    numeric: true,
    render: (r) => r.bowler.scratchPinfall.toLocaleString(),
  },
  {
    key: "handicapPinfall",
    label: "Handicap Pinfall",
    short: "Hdcp Pins",
    align: "right",
    numeric: true,
    render: (r) => r.bowler.handicapPinfall.toLocaleString(),
  },
  {
    key: "scratchAverage",
    label: "Scratch Avg",
    short: "Avg",
    align: "right",
    numeric: true,
    render: (r) => r.bowler.scratchAverage.toFixed(3),
  },
  {
    key: "highGame",
    label: "High Game",
    short: "HG",
    align: "right",
    numeric: true,
    render: (r) => r.bowler.highGame,
  },
  {
    key: "highSet",
    label: "High Set",
    short: "HS",
    align: "right",
    numeric: true,
    render: (r) => r.bowler.highSet,
  },
  {
    key: "movement",
    label: "Move",
    align: "right",
    render: (r) => <Movement n={r.movement} />,
  },
];

function StandingsPage() {
  useLeagueSnapshot(); // subscribe: re-render when admin saves rebuild the snapshot
  // Snapshot is pre-saved — no recomputation here. The official leader (used
  // for Points Behind) is simply the top entry in the pre-sorted snapshot.
  const snapshot = getStandingsSnapshot();
  const leaderBowler = snapshot[0]?.bowler;
  const officialRows: StandingsDisplayRow[] = snapshot.map((r) => ({
    officialRank: r.rank,
    bowler: r.bowler,
    movement: r.movement,
    pointsBehind: leaderBowler
      ? computePointsBehind(leaderBowler, r.bowler)
      : 0,
    isLeader: leaderBowler ? r.bowler.id === leaderBowler.id : false,
  }));

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("rank");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    if (!query.trim()) return officialRows;
    const q = query.trim().toLowerCase();
    return officialRows.filter((r) => r.bowler.name.toLowerCase().includes(q));
  }, [officialRows, query]);

  const displayed = useMemo(() => {
    const rows = [...filtered];
    if (sort === "rank") {
      rows.sort((a, b) => a.officialRank - b.officialRank);
      return rows;
    }
    const mul = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sort === "name") return mul * a.bowler.name.localeCompare(b.bowler.name);
      if (sort === "movement") return mul * (a.movement - b.movement);
      if (sort === "pointsBehind") return mul * (a.pointsBehind - b.pointsBehind);
      if (sort === "record") return mul * (a.bowler.points - b.bowler.points);
      const av = a.bowler[sort as keyof Bowler] as number;
      const bv = b.bowler[sort as keyof Bowler] as number;
      return mul * (av - bv);
    });
    return rows;
  }, [filtered, sort, dir]);

  const isCustomSort = sort !== "rank";

  const leader = officialRows[0];
  const topScratchAvg = [...BOWLERS].sort(
    (a, b) => b.scratchAverage - a.scratchAverage,
  )[0];
  const topScratchPins = [...BOWLERS].sort(
    (a, b) => b.scratchPinfall - a.scratchPinfall,
  )[0];
  const topHdcpPins = [...BOWLERS].sort(
    (a, b) => b.handicapPinfall - a.handicapPinfall,
  )[0];

  function onHeaderClick(key: SortKey) {
    if (sort === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setDir(key === "name" || key === "pointsBehind" ? "asc" : "desc");
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Standings"
        subtitle="Official rank: total points DESC, then handicap pinfall DESC. Snapshot from the last published week."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Current leader"
          bowlerId={leader?.bowler.id}
          headline={leader?.bowler.name ?? "—"}
          sub={
            leader
              ? formatRecord(leader.bowler.points, leader.bowler.pointsLost)
              : ""
          }
        />
        <SummaryCard
          label="Top scratch average"
          bowlerId={topScratchAvg?.id}
          headline={topScratchAvg?.scratchAverage.toFixed(3) ?? "—"}
          sub={topScratchAvg?.name ?? ""}
        />
        <SummaryCard
          label="Top scratch pinfall"
          bowlerId={topScratchPins?.id}
          headline={topScratchPins?.scratchPinfall.toLocaleString() ?? "—"}
          sub={topScratchPins?.name ?? ""}
        />
        <SummaryCard
          label="Top handicap pinfall"
          bowlerId={topHdcpPins?.id}
          headline={topHdcpPins?.handicapPinfall.toLocaleString() ?? "—"}
          sub={topHdcpPins?.name ?? ""}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bowlers…"
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "rounded-full px-2 py-1",
              isCustomSort
                ? "bg-accent"
                : "bg-primary/15 text-primary ring-1 ring-primary/40",
            )}
          >
            {isCustomSort
              ? `Sorted by ${sort} (${dir}) — official rank shown`
              : "Official standings order"}
          </span>
          {isCustomSort && (
            <button
              className="rounded-full border border-border px-2 py-1 hover:bg-accent"
              onClick={() => {
                setSort("rank");
                setDir("desc");
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-accent/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3 text-left">
                <SortButton
                  active={sort === "rank"}
                  dir={dir}
                  onClick={() => onHeaderClick("rank")}
                >
                  Rank
                </SortButton>
              </th>
              <th className="px-3 py-3 text-left">
                <SortButton
                  active={sort === "name"}
                  dir={dir}
                  onClick={() => onHeaderClick("name")}
                >
                  Bowler
                </SortButton>
              </th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-3 py-3",
                    c.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  <SortButton
                    active={sort === c.key}
                    dir={dir}
                    onClick={() => onHeaderClick(c.key)}
                    align={c.align}
                  >
                    {c.short ?? c.label}
                  </SortButton>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {displayed.map((r) => (
              <tr key={r.bowler.id} className="hover:bg-accent/30">
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      "inline-flex h-7 min-w-7 items-center justify-center rounded px-2 font-display text-sm",
                      r.officialRank <= 3
                        ? "bg-gold"
                        : "text-muted-foreground",
                    )}
                  >
                    {r.officialRank}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <Link
                    to="/bowlers/$bowlerId"
                    params={{ bowlerId: r.bowler.id }}
                    className="font-medium hover:text-primary"
                  >
                    {r.bowler.name}
                  </Link>
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2.5",
                      c.align === "right" ? "text-right" : "text-left",
                      c.numeric && "tabular-nums",
                      sort === c.key && "bg-accent/20",
                    )}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {displayed.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length + 2}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No bowlers match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="grid gap-2 md:hidden">
        {displayed.map((r) => (
          <div
            key={r.bowler.id}
            className="rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "inline-flex h-8 min-w-8 items-center justify-center rounded px-2 font-display",
                    r.officialRank <= 3
                      ? "bg-gold"
                      : "bg-accent text-muted-foreground",
                  )}
                >
                  {r.officialRank}
                </span>
                <Link
                  to="/bowlers/$bowlerId"
                  params={{ bowlerId: r.bowler.id }}
                  className="font-medium hover:text-primary"
                >
                  {r.bowler.name}
                </Link>
              </div>
              <span className="font-display text-lg text-gold tabular-nums">
                {formatRecord(r.bowler.points, r.bowler.pointsLost)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] tabular-nums">
              <MobileCell
                label="PB"
                value={r.isLeader ? "—" : formatPoints(r.pointsBehind)}
              />
              <MobileCell label="Avg" value={r.bowler.scratchAverage.toFixed(3)} />
              <MobileCell
                label="Scr Pins"
                value={r.bowler.scratchPinfall.toLocaleString()}
              />
              <MobileCell
                label="Hdcp Pins"
                value={r.bowler.handicapPinfall.toLocaleString()}
              />
            </div>
            <div className="mt-2 flex justify-end text-xs">
              <Movement n={r.movement} />
            </div>
          </div>
        ))}
        {displayed.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No bowlers match “{query}”.
          </div>
        )}
      </div>

      <Card className="mt-6 bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base">
            <Trophy className="h-4 w-4 text-gold" /> Scoring legend
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Each matchup awards <strong>7 points</strong>: three games worth
            <strong> 2 points</strong> each (2 for a win, 1 each on a tie) plus
            <strong> 1 point</strong> for the higher 3-game total handicap
            pinfall (0.5 each on a tie). A bowler's match total can be 0, 0.5,
            1, 1.5 … up to 7.
          </p>
          <p className="mt-2 text-xs">
            <strong>Record (W - L)</strong> counts league points won and lost
            across completed matches; each match distributes exactly 7 points,
            so a bowler's losses equal 7 minus points earned.{" "}
            <strong>Points Behind (PB)</strong> uses the standard games-behind
            formula on points won/lost:{" "}
            <code>((leaderW − W) + (L − leaderL)) / 2</code>. The leader shows
            “—”.
          </p>
          <p className="mt-2 text-xs">
            Handicap = <code>floor(0.80 × (160 − entry average))</code>, minimum
            0. Season averages are scratch only, to three decimals. Official
            standings tiebreaker: total points DESC, then total handicap pinfall
            DESC.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function SortButton({
  active,
  dir,
  onClick,
  children,
  align = "left",
}: {
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 transition-colors",
        align === "right" && "justify-end",
        active ? "text-gold" : "hover:text-foreground",
      )}
    >
      {children}
      <span className="text-[10px]">
        {active ? (dir === "asc" ? "▴" : "▾") : ""}
      </span>
    </button>
  );
}

function SummaryCard({
  label,
  headline,
  sub,
  bowlerId,
}: {
  label: string;
  headline: string;
  sub: string;
  bowlerId?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-display text-2xl text-gold">
        {headline}
      </div>
      {bowlerId ? (
        <Link
          to="/bowlers/$bowlerId"
          params={{ bowlerId }}
          className="text-xs text-muted-foreground hover:text-primary"
        >
          {sub}
        </Link>
      ) : (
        <div className="text-xs text-muted-foreground">{sub}</div>
      )}
    </div>
  );
}

function MobileCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-accent/50 px-2 py-1">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
