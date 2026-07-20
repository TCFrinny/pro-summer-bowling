/** PUBLIC archived-season per-bowler profile.
 *
 *  League attribution rules (per spec):
 *    - Points + handicap pinfall credit go to the SCHEDULED bowler even
 *      when a substitute rolled or the bowler was absent.
 *    - Scratch games / high game / high set / frame linescore / advanced
 *      stats stay with the ACTUAL bowler who physically rolled. Absent
 *      never contributes personal scratch stats.
 *
 *  So a single match can appear on this page in two shapes:
 *    (a) "credit" — this bowler was scheduled but a sub rolled or they
 *        were absent. Show points/hdcp credit only. NO scratch total.
 *        NO frame linescore.
 *    (b) "personal" — this bowler physically rolled (self on their own
 *        card or as a substitute for someone else). Show scratch stats
 *        and frame linescore when available.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getPublicHistoricalSnapshot } from "@/lib/historical-repo.functions";
import { EmptyState } from "@/components/layout/AppShell";
import { GameLinescore } from "@/components/linescore/GameLinescore";
import type { HistoricalMatch, HistoricalWeekSummary } from "@/lib/historical-snapshot";
import { RatingsSection } from "@/components/ratings/RatingsSection";
import { computeSeasonRatings } from "@/lib/ratings";
import { ratingGamesFromHistoricalSnapshot } from "@/lib/ratings-extract";
import { useMemo } from "react";

export const Route = createFileRoute("/seasons/$seasonId/bowlers/$participantRef")({
  component: SeasonBowlerPage,
});

function SeasonBowlerPage() {
  const { seasonId, participantRef } = Route.useParams();
  const q = useQuery({
    queryKey: ["seasons", "public", "historical-snapshot", seasonId],
    queryFn: () => getPublicHistoricalSnapshot({ data: { seasonId } }),
  });
  const snap = q.data?.snapshot ?? null;
  // Hooks must run in the same order on every render — compute BEFORE any
  // conditional return. `useMemo` returns null when the snapshot is not yet
  // loaded so the following render bails out safely.
  const rating = useMemo(() => {
    if (!snap) return null;
    const rows = ratingGamesFromHistoricalSnapshot(snap);
    return computeSeasonRatings(rows).find((r) => r.personRef === participantRef) ?? null;
  }, [snap, participantRef]);

  if (!snap) return <EmptyState title="Not available" description="No cached snapshot for this season." />;
  const p = snap.participants.find((x) => x.ref === participantRef);
  const s = snap.standings.find((x) => x.participantRef === participantRef);
  const personal = (snap.participantStats ?? []).find((x) => x.participantRef === participantRef) ?? null;
  const summary = snap.summaryRecords.find((x) => x.participantRef === participantRef);
  if (!p && !summary) {
    return <EmptyState title="Bowler not found" description="No matching participant in this season." />;
  }
  const matches: Array<{ w: HistoricalWeekSummary; m: HistoricalMatch }> = snap.weeks.flatMap((w) =>
    w.matches
      .filter((m) => m.actualA === participantRef || m.actualB === participantRef
                  || m.scheduledA === participantRef || m.scheduledB === participantRef)
      .map((m) => ({ w, m })),
  );

  const adv = personal?.advanced ?? null;

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          {p?.displayName ?? summary?.displayName ?? participantRef}
          {p?.bowlerNumber && <span className="ml-2 text-xs text-muted-foreground">#{p.bowlerNumber}</span>}
        </h2>
        {p?.personId && (
          <Link to="/people/$personId" params={{ personId: p.personId }} className="text-sm underline">
            Career profile
          </Link>
        )}
      </header>

      {rating && (
        <RatingsSection
          offense={rating.offensiveRating}
          defense={rating.matchupDefense}
          twoWay={rating.twoWayRating}
          quality={rating.quality}
          details={rating.details}
        />
      )}



      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Scheduled credit — points & handicap-pinfall credit assigned to the scheduled bowler
        </h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 text-sm">
          <Stat label="Points" value={s?.points ?? summary?.points ?? "—"} />
          <Stat label="Points Lost" value={s?.pointsLost ?? summary?.pointsLost ?? "—"} />
          <Stat label="Hdcp Pinfall" value={s?.handicapPinfall ?? "—"} />
          <Stat label="Matches (credit)" value={s?.matchesPlayed ?? "—"} />
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Personal bowling — this bowler's own physical performance (rostered or substitute)
        </h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 text-sm">
          <Stat label="Games" value={personal?.games ?? summary?.games ?? "—"} />
          <Stat label="Scratch Pinfall" value={personal?.scratchPinfall ?? summary?.scratchPinfall ?? "—"} />
          <Stat label="Avg" value={personal?.scratchAverage != null ? personal.scratchAverage.toFixed(1) : (summary?.average != null ? summary.average.toFixed(1) : "—")} />
          <Stat label="High G" value={personal?.highGame ?? summary?.highGame ?? "—"} />
          <Stat label="High S" value={personal?.highSet ?? summary?.highSet ?? "—"} />
          <Stat label="Season POA" value={personal?.seasonPOA != null ? personal.seasonPOA.toFixed(1) : "—"} />
          <Stat label="Best Game POA" value={personal?.bestGamePOA != null ? personal.bestGamePOA.toFixed(1) : "—"} />
          <Stat label="Best Set POA" value={personal?.bestSetPOA != null ? personal.bestSetPOA.toFixed(1) : "—"} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-3 text-xs">
        <div className="mb-1 font-semibold uppercase tracking-widest text-muted-foreground">
          Advanced (frame-linescore games only)
        </div>
        {adv ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="Games" value={adv.games} />
            <Stat label="Frames" value={adv.framesRolled} />
            <Stat label="Strikes" value={adv.strikes} />
            <Stat label="Spares" value={adv.spares} />
            <Stat label="Opens" value={adv.opens} />
            <Stat label="Marks" value={adv.marks} />
            <Stat label="Clean Frames" value={adv.cleanFrames} />
            <Stat label="Clean Games" value={adv.cleanGames} />
            <Stat label="Mark %" value={`${adv.markPct.toFixed(1)}%`} />
            <Stat label="Strike %" value={`${adv.strikePct.toFixed(1)}%`} />
            <Stat label="Spare %" value={`${adv.sparePct.toFixed(1)}%`} />
            <Stat label="Open %" value={`${adv.openPct.toFixed(1)}%`} />
            <Stat label="Spare Conv %" value={`${adv.spareConversionPct.toFixed(1)}%`} />
            <Stat label="Pins Lost / G" value={adv.pinsLostPerGame.toFixed(2)} />
            <Stat label="Consistency (σ)" value={adv.consistency.toFixed(2)} />
            <Stat label="Open Pins Left" value={adv.openPinsLeft} />
            <Stat label="First 5 (total)" value={adv.first5Total} />
            <Stat label="First 5 / G" value={adv.first5PerGame.toFixed(1)} />
            <Stat label="Last 5 (total)" value={adv.last5Total} />
            <Stat label="Last 5 / G" value={adv.last5PerGame.toFixed(1)} />
            <Stat label="Big Opening (total)" value={adv.bigOpeningTotal} />
            <Stat label="Big Opening / G" value={adv.bigOpeningPerGame.toFixed(1)} />
            <Stat label="Big Finish (total)" value={adv.bigFinishTotal} />
            <Stat label="Big Finish / G" value={adv.bigFinishPerGame.toFixed(1)} />
            <Stat label="Clutch %" value={`${adv.clutchPct.toFixed(1)}% (${adv.clutchMarks}/${adv.clutchOpportunities})`} />
          </div>
        ) : (
          <p className="text-muted-foreground">Unavailable — no full-linescore games recorded for this bowler.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-3 text-sm font-semibold">Match history</div>
        {matches.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No matches recorded.</p>
        ) : (
          <div className="divide-y divide-border">
            {matches.map(({ w, m }) => (
              <MatchLine key={m.slotId} weekNumber={w.weekNumber} m={m} participantRef={participantRef} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MatchLine({ weekNumber, m, participantRef }: {
  weekNumber: number; m: HistoricalMatch; participantRef: string;
}) {
  const scheduledSide: "A" | "B" | null =
    m.scheduledA === participantRef ? "A" : m.scheduledB === participantRef ? "B" : null;
  const actualSide: "A" | "B" | null =
    m.actualA === participantRef ? "A" : m.actualB === participantRef ? "B" : null;

  // Personal stats ONLY when this bowler physically rolled (not sub for
  // this slot means they're on their own scheduled side; sub means their
  // ref is the actual on the other's scheduled side).
  const rolledA = actualSide === "A" && !m.absentA && !!m.scratchGamesA;
  const rolledB = actualSide === "B" && !m.absentB && !!m.scratchGamesB;
  const personal = rolledA
    ? { scr: m.scratchTotalA, hdcp: m.handicapTotalA, line: m.linescoreA,
        oppName: m.actualNameB || m.scheduledNameB,
        subFor: m.isSubA ? m.scheduledNameA : null,
        detailMode: m.detailMode }
    : rolledB
    ? { scr: m.scratchTotalB, hdcp: m.handicapTotalB, line: m.linescoreB,
        oppName: m.actualNameA || m.scheduledNameA,
        subFor: m.isSubB ? m.scheduledNameB : null,
        detailMode: m.detailMode }
    : null;

  // Credit-only row when scheduled here but did NOT roll (sub took the
  // card, or absent). Suppress when personal already covers it (self on
  // own scheduled side): rolledSelfOnScheduled below.
  const scheduledButDidNotRoll =
    (scheduledSide === "A" && (m.isSubA || m.absentA)) ||
    (scheduledSide === "B" && (m.isSubB || m.absentB));
  const credit = scheduledButDidNotRoll ? {
    pts: scheduledSide === "A" ? m.finalPointsA : m.finalPointsB,
    hdcpPinfall: scheduledSide === "A" ? m.handicapTotalA : m.handicapTotalB,
    hasHdcp: scheduledSide === "A" ? m.hasGameDataA : m.hasGameDataB,
    oppName: scheduledSide === "A" ? (m.actualNameB || m.scheduledNameB) : (m.actualNameA || m.scheduledNameA),
    subbedBy: scheduledSide === "A" ? (m.isSubA ? m.actualNameA : null) : (m.isSubB ? m.actualNameB : null),
    absent: scheduledSide === "A" ? m.absentA : m.absentB,
  } : null;

  const pointsForSelf =
    scheduledSide === "A" ? m.finalPointsA :
    scheduledSide === "B" ? m.finalPointsB :
    null;

  const [open, setOpen] = useState(false);
  return (
    <div className="p-3 text-sm" data-testid={`archived-bowler-match-${m.slotId}`}>
      {personal && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="mr-2 text-xs text-muted-foreground">Wk {weekNumber}</span>
              vs <span className="font-medium">{personal.oppName}</span>
              {personal.subFor && (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  (sub for {personal.subFor})
                </span>
              )}
              {!personal.subFor && pointsForSelf !== null && (
                <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  self on own card
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span>scratch {personal.scr} · hdcp {personal.hdcp}</span>
              {pointsForSelf !== null && !personal.subFor && (
                <span className="font-display text-sm text-gold">{pointsForSelf}</span>
              )}
            </div>
          </div>
          {personal.line ? (
            <div className="mt-2">
              <button onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded border border-border/60 px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:bg-accent/40">
                <span>View frame linescore</span>
                {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {open && (
                <div className="mt-2 grid gap-2">
                  {personal.line.map((g, i) => <GameLinescore key={i} game={g} index={i} />)}
                </div>
              )}
            </div>
          ) : personal.detailMode === "game_scores" ? (
            <div className="mt-2 rounded border border-dashed border-primary/50 px-2 py-1 text-[10px] uppercase tracking-widest text-primary">
              Frame linescore / advanced stats unavailable — game-scores-only entry.
            </div>
          ) : null}
        </div>
      )}
      {credit && (
        <div className={personal ? "mt-2 border-t border-border/60 pt-2" : ""}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="mr-2 text-xs text-muted-foreground">Wk {weekNumber}</span>
              <span className="font-medium">Credit</span> vs {credit.oppName}
              {credit.subbedBy && (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  substitute {credit.subbedBy} rolled — personal scratch stats stay with the substitute
                </span>
              )}
              {credit.absent && (
                <span className="ml-2 text-[10px] text-destructive">absent — no personal scratch stats</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span>hdcp {credit.hasHdcp ? credit.hdcpPinfall : "—"}</span>
              <span className="font-display text-sm text-gold">{credit.pts}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-base">{value}</div>
    </div>
  );
}
