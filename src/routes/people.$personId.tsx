import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader, EmptyState } from "@/components/layout/AppShell";
import { Loader2 } from "lucide-react";
import { getCareerProfile } from "@/lib/history-repo.functions";
import { getHistoricalCareerContributions, getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { formatRecord } from "@/lib/mock-data";
import {
  aggregateCareerTotals,
  mergeHistoricalIntoCareer,
  type CareerSeasonRow,
} from "@/lib/season-history";
import {
  aggregateCareerAdvanced,
  mergeCareerAdvancedContributions,
  type CareerAdvancedContribution,
  type CareerAdvancedTotals,
} from "@/lib/career-advanced";
import { RatingsSection } from "@/components/ratings/RatingsSection";
import { careerRatingQuality, combineAliasRatings, computeCareerRatings, computeSeasonRatings } from "@/lib/ratings";
import { ratingGamesFromCurrentSeason, ratingGamesFromHistoricalSnapshot } from "@/lib/ratings-extract";
import { useCurrentPublicSnapshot } from "@/lib/public-snapshot";
import { useMemo } from "react";




export const Route = createFileRoute("/people/$personId")({
  head: () => ({
    meta: [
      { title: "Career — Pro Summer Singles" },
      { name: "description", content: "Permanent career profile across every season." },
    ],
  }),
  component: PersonPage,
});

function PersonPage() {
  const { personId } = Route.useParams();
  const q = useQuery({
    queryKey: ["people", "career", personId],
    queryFn: () => getCareerProfile({ data: { personId } }),
  });
  const hist = useQuery({
    queryKey: ["people", "career-historical", personId],
    queryFn: () => getHistoricalCareerContributions({ data: { personId } }),
  });
  return (
    <AppShell>
      {q.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}
      {q.data && !q.data.available && (
        <>
          <PageHeader title="Career profile" />
          <EmptyState
            title="Career profiles not available yet"
            description="Apply the pending multi-season history migration to enable permanent people and cross-season profiles."
          />
        </>
      )}
      {q.data && q.data.available && !q.data.person && (
        <>
          <PageHeader title="Person not found" />
          <EmptyState title="This person does not exist" description="They may have been merged into another record." />
        </>
      )}
      {q.data && q.data.available && q.data.person && (
        <>
          <PageHeader
            title={q.data.person.displayName}
            subtitle="All publicly visible seasons this person has been linked to."
          >
            <Link to="/bowlers" className="text-sm underline">Roster</Link>
          </PageHeader>
          <CareerBody
            rows={mergeHistoricalIntoCareer(q.data.rows, hist.data?.rows ?? [])}
            advancedContribs={mergeCareerAdvancedContributions(
              q.data.advancedContributions ?? [],
              hist.data?.advancedContributions ?? [],
            )}
          />
          <CareerRatingsPanel personId={personId} />
          {q.data.person.notes && (
            <p className="mt-4 text-sm text-muted-foreground">{q.data.person.notes}</p>
          )}
        </>
      )}
    </AppShell>
  );
}

/** Fetch each contributing archived season snapshot, compute its 100-centered
 *  ratings, then aggregate a game-weighted career rating for this permanent
 *  person. Uses the same public snapshot loader as archived pages. */
function CareerRatingsPanel({ personId }: { personId: string }) {
  const snap = useCurrentPublicSnapshot();
  const hist = useQuery({
    queryKey: ["people", "career-historical", personId],
    queryFn: () => getHistoricalCareerContributions({ data: { personId } }),
  });
  const seasonIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of hist.data?.rows ?? []) set.add(r.seasonId);
    return Array.from(set);
  }, [hist.data]);
  const snapshots = useQueries({
    queries: seasonIds.map((sid) => ({
      queryKey: ["seasons", "public", "historical-snapshot", sid],
      queryFn: () => getPublicHistoricalSnapshot({ data: { seasonId: sid } }),
    })),
  });
  const currentContribution = useMemo(() => {
    if (!snap) return null;
    const refs = new Set<string>();
    for (const b of snap.bowlers) if (b.personId === personId) refs.add(b.id);
    for (const s of snap.substitutes ?? []) if (s.personId === personId) refs.add(s.id);
    if (refs.size === 0) return null;
    const publishedWeeks = new Set(snap.weeks.filter((w) => w.published).map((w) => w.week));
    const rows = ratingGamesFromCurrentSeason("current", snap.matchesByWeek, publishedWeeks);
    const all = computeSeasonRatings(rows);
    const contribs = all.filter((r) => refs.has(r.personRef));
    const combined = combineAliasRatings(contribs);
    if (!combined || combined.actualGames === 0) return null;
    return { ...combined, seasonId: "current", seasonLabel: "2026 Summer" };
  }, [snap, personId]);
  const perSeason = useMemo(() => {
    const out: Array<{ seasonId: string; seasonLabel?: string; offense: number | null;
      defense: number | null; actualGames: number; opponentGames: number; fullLinescoreGames: number }> = [];
    if (currentContribution) out.push(currentContribution);
    snapshots.forEach((qi, idx) => {
      const s = qi.data?.snapshot;
      if (!s) return;
      const rows = ratingGamesFromHistoricalSnapshot(s);
      const all = computeSeasonRatings(rows);
      const refs = new Set<string>();
      for (const p of s.participants) if (p.personId === personId) refs.add(p.ref);
      const contribs = all.filter((r) => refs.has(r.personRef));
      const combined = combineAliasRatings(contribs);
      if (combined && combined.actualGames > 0) {
        out.push({ ...combined, seasonId: seasonIds[idx], seasonLabel: s.seasonLabel });
      }
    });
    return out;
  }, [snapshots, personId, seasonIds, currentContribution]);
  if (perSeason.length === 0) return null;
  const career = computeCareerRatings(personId, perSeason);
  return (
    <RatingsSection

      offense={career.offensiveRating}
      defense={career.matchupDefense}
      twoWay={career.twoWayRating}
      quality={careerRatingQuality(career)}
      careerContributions={career.contributions}
    />
  );
}


function CareerBody({
  rows,
  advancedContribs,
}: {
  rows: CareerSeasonRow[];
  advancedContribs: CareerAdvancedContribution[];
}) {
  const sorted = [...rows].sort((a, b) => a.seasonLabel.localeCompare(b.seasonLabel));
  const totals = aggregateCareerTotals(sorted);
  const adv = aggregateCareerAdvanced(advancedContribs);
  if (sorted.length === 0) {
    return <EmptyState title="No public seasons yet" description="This person has no public rostered or substitute record." />;
  }
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Seasons" value={totals.seasonsCount} />
        <Stat label="Championships" value={totals.championships} />
        <Stat label="Games" value={totals.totalGames || "—"} />
        <Stat label="Scratch Avg" value={totals.average != null ? totals.average.toFixed(3) : "—"} />
        <Stat label="Seasons w/ Game Data" value={totals.seasonsWithGameData} />
      </section>

      <CareerAdvancedCards totals={adv} totalsBasic={totals} />

      <p className="text-xs text-muted-foreground">
        Basic stats include game-score-only historical rows. Frame-derived stats
        (marks, pins lost, first 5 / last 5, clutch, consistency) come only from
        full-linescore data and show <span aria-label="unavailable">—</span> when
        unavailable. Record (points won – points lost), handicap pinfall are
        roster credit only; substitute weeks contribute personal stats only.
      </p>


      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-3 text-sm font-semibold">Season history</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-accent/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Season</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Name / #</th>
                <th className="px-3 py-2 text-right">Start Avg</th>
                <th className="px-3 py-2 text-right">HDCP</th>
                <th className="px-3 py-2 text-right">Games</th>
                <th className="px-3 py-2 text-right">Avg</th>
                <th className="px-3 py-2 text-right">High G / S</th>
                <th className="px-3 py-2 text-right">Points</th>
                <th className="px-3 py-2 text-right">Finish</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((r, i) => (
                <tr key={`${r.seasonId}-${r.role}-${i}`}>
                  <td className="px-3 py-2">
                    <Link to="/seasons/$seasonId" params={{ seasonId: r.seasonId }} className="underline">
                      {r.seasonLabel}
                    </Link>
                    {r.isChampion && <span className="ml-1 text-gold" aria-label="Champion">★</span>}
                  </td>
                  <td className="px-3 py-2 capitalize">{r.role}</td>
                  <td className="px-3 py-2">
                    {r.seasonalName}
                    {r.bowlerNumber && <span className="ml-1 text-xs text-muted-foreground">#{r.bowlerNumber}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{r.startingAverage ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.handicap ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.games ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.average != null ? r.average.toFixed(1) : "—"}</td>
                  <td className="px-3 py-2 text-right">{(r.highGame ?? "—") + " / " + (r.highSet ?? "—")}</td>
                  <td className="px-3 py-2 text-right">{r.points ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.finalFinish ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border p-3 text-xs text-muted-foreground">
          Season data comes from that season's saved public snapshot or historical archive. Missing values are dashes, never zero.
        </p>
      </section>
    </div>
  );
}

function CareerAdvancedCards({
  totals,
  totalsBasic,
}: {
  totals: CareerAdvancedTotals;
  totalsBasic: ReturnType<typeof aggregateCareerTotals>;
}) {
  const dash = (v: number | null | undefined) => (v == null ? "—" : v);
  const fixed = (v: number | null, digits = 1) => (v == null ? "—" : v.toFixed(digits));
  const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
  const loc = (v: number | null | undefined) =>
    v == null ? "—" : v.toLocaleString();
  const record =
    totals.pointsCredited != null || totals.pointsLost != null
      ? formatRecord(totals.pointsCredited ?? 0, totals.pointsLost ?? 0)
      : "—";
  const poa = (() => {
    const v = totals.careerPOA;
    if (v == null) return "—";
    const rounded = Number(v.toFixed(2));
    if (rounded === 0) return "0.00";
    const sign = rounded > 0 ? "+" : "-";
    return `${sign}${Math.abs(rounded).toFixed(2)}`;
  })();
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
      <Stat label="Record (W - L)" value={record} />
      <Stat label="Scratch Pinfall" value={loc(totalsBasic.totalScratchPinfall || null)} />
      <Stat label="Handicap Pinfall" value={loc(totals.handicapPinfall)} />
      <Stat label="High Game" value={dash(totalsBasic.highGame)} />
      <Stat label="High Set" value={dash(totalsBasic.highSet)} />
      <Stat label="Strikes" value={loc(totals.strikes)} />
      <Stat label="Spares" value={loc(totals.spares)} />
      <Stat label="Opens" value={loc(totals.opens)} />
      <Stat label="Total Marks" value={loc(totals.marks)} />
      <Stat label="Frames Rolled" value={loc(totals.framesRolled)} />
      <Stat label="Mark %" value={pct(totals.markPct)} />
      <Stat label="Strike %" value={pct(totals.strikePct)} />
      <Stat label="Spare Conv. %" value={pct(totals.spareConversionPct)} />
      <Stat label="Open %" value={pct(totals.openPct)} />
      <Stat label="Pins Lost / Game" value={fixed(totals.pinsLostPerGame, 2)} />
      <Stat
        label="Consistency (σ)"
        value={totals.consistencyAvailable ? fixed(totals.consistency, 2) : "—"}
      />
      <Stat label="Career POA" value={poa} />
      <Stat label="First 5 / Game" value={fixed(totals.first5PerGame)} />
      <Stat label="Last 5 / Game" value={fixed(totals.last5PerGame)} />
      <Stat label="Big Opening / Game" value={fixed(totals.bigOpeningPerGame)} />
      <Stat label="Big Finish / Game" value={fixed(totals.bigFinishPerGame)} />
      <Stat label="Clutch % (Fr 9–10)" value={pct(totals.clutchPct)} />
    </section>
  );
}


function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{value}</div>
    </div>
  );
}
