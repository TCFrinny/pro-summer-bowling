/**
 * Public All-Time Leaderboards — compact selector + Top 10 table.
 *
 * Career-aggregate categories (`AllTimeRow[]`) drive most tabs. The four
 * High Game / High Set boards are performance-level (`PerformanceRow[]`):
 *  - Scratch High Game / Scratch High Set: every 200+ / 500+ performance
 *    displayed, no top-N cap.
 *  - HDCP High Game / HDCP High Set: Top 10 performances plus every row
 *    tied at the 10th-place score.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { getAllTimeLeaderboards } from "@/lib/leaderboards-repo.functions";
import {
  LEADERBOARD_CATEGORIES,
  PERFORMANCE_LEADERBOARD_CATEGORIES,
  buildLeaderboard,
  buildPerformanceLeaderboard,
  type LeaderboardCategoryId,
  type LeaderboardGroup,
  type PerformanceCategoryId,
} from "@/lib/leaderboards";

const GROUP_LABELS: Record<LeaderboardGroup, string> = {
  records: "Records",
  scoring: "Scoring",
  frame: "Frame Stats",
  ratings: "Ratings",
};
const GROUP_ORDER: LeaderboardGroup[] = ["records", "scoring", "frame", "ratings"];

// Menu entries mix career and performance categories. Career "highGame"
// and "highSet" (person-level) are hidden from the UI in favor of the
// four performance-level replacements.
type MenuEntry =
  | {
      kind: "career";
      id: LeaderboardCategoryId;
      group: LeaderboardGroup;
      label: string;
      primaryLabel: string;
      secondaryLabel: string;
    }
  | {
      kind: "performance";
      id: PerformanceCategoryId;
      group: LeaderboardGroup;
      label: string;
      primaryLabel: string;
      secondaryLabel: string;
    };

const CAREER_HIDDEN_IDS: ReadonlySet<LeaderboardCategoryId> =
  new Set<LeaderboardCategoryId>(["highGame", "highSet"]);

const MENU: MenuEntry[] = (() => {
  const items: MenuEntry[] = [];
  for (const c of LEADERBOARD_CATEGORIES) {
    if (CAREER_HIDDEN_IDS.has(c.id)) continue;
    items.push({
      kind: "career", id: c.id, group: c.group, label: c.label,
      primaryLabel: c.primaryLabel, secondaryLabel: c.secondaryLabel,
    });
    if (c.id === "scratchPinfall") {
      // Insert performance-level HG/HS immediately after Scratch Pinfall.
      for (const p of PERFORMANCE_LEADERBOARD_CATEGORIES) {
        items.push({
          kind: "performance", id: p.id, group: p.group, label: p.label,
          primaryLabel: p.primaryLabel, secondaryLabel: p.secondaryLabel,
        });
      }
    }
  }
  return items;
})();

export function AllTimeLeaderboards() {
  const q = useQuery({
    queryKey: ["all-time-leaderboards", "v2"],
    queryFn: () => getAllTimeLeaderboards(),
    staleTime: 60_000,
  });

  const [group, setGroup] = useState<LeaderboardGroup>("records");
  const catsInGroup = useMemo(
    () => MENU.filter((c) => c.group === group),
    [group],
  );
  const [categoryKey, setCategoryKey] = useState<string>(
    catsInGroup[0]?.id ?? "gameWins",
  );
  const activeCat = useMemo(
    () => catsInGroup.find((c) => c.id === categoryKey) ?? catsInGroup[0],
    [catsInGroup, categoryKey],
  );

  const board = useMemo(() => {
    if (!q.data || !activeCat) return null;
    if (activeCat.kind === "career") {
      return buildLeaderboard(q.data.rows, activeCat.id, 10);
    }
    return buildPerformanceLeaderboard(q.data.performances, activeCat.id, 10);
  }, [q.data, activeCat]);

  const showProvenance =
    !!activeCat &&
    (activeCat.kind === "performance" ||
      activeCat.id === "highGame" ||
      activeCat.id === "highSet");

  return (
    <section className="mt-10 border-t border-border pt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">All-Time Leaderboards</h2>
        {q.data && (
          <span className="text-xs text-muted-foreground">
            {q.data.contributingSeasons} season{q.data.contributingSeasons === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {q.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading leaderboards…
        </div>
      )}
      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Couldn't load leaderboards. Please try again in a moment.
        </div>
      )}

      {q.data && activeCat && (
        <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {GROUP_ORDER.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGroup(g);
                  const first = MENU.find((c) => c.group === g);
                  if (first) setCategoryKey(first.id);
                }}
                className={
                  "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest transition-colors " +
                  (group === g
                    ? "bg-primary text-primary-foreground"
                    : "bg-accent/40 text-muted-foreground hover:bg-accent")
                }
              >
                {GROUP_LABELS[g]}
              </button>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {catsInGroup.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryKey(c.id)}
                className={
                  "rounded-md border px-2 py-1 text-xs transition-colors " +
                  (activeCat.id === c.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")
                }
              >
                {c.label}
              </button>
            ))}
          </div>

          {board && board.entries.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="bg-accent/40 text-xs uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Bowler</th>
                    <th className="px-2 py-2 text-right">{activeCat.primaryLabel}</th>
                    <th className="hidden px-2 py-2 text-right sm:table-cell">{activeCat.secondaryLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.entries.map((e, i) => (
                    <tr
                      key={`${e.identity.key}-${e.occurrenceKey ?? i}`}
                      className="border-t border-border/60"
                    >
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{e.rank}</td>
                      <td className="px-2 py-1.5">
                        <NameLink identity={e.identity} />
                        {showProvenance && e.provenance && (
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            {e.provenance.seasonLabel}
                            {" · "}
                            {e.provenance.week != null
                              ? `Week ${e.provenance.week}`
                              : "Week unavailable"}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                        {e.primaryDisplay}
                      </td>
                      <td className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground sm:table-cell">
                        {activeCat.kind === "performance" && e.provenance
                          ? `${e.provenance.seasonLabel}${e.provenance.week != null ? ` · Wk ${e.provenance.week}` : " · Wk —"}`
                          : e.sampleDisplay}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              No qualifying bowlers yet for this category.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NameLink({
  identity,
}: {
  identity: {
    displayName: string;
    personId: string | null;
    unlinkedSeasonId: string | null;
    unlinkedParticipantRef: string | null;
    hrefKind?: "person" | "current-roster" | "current-sub" | "historical";
  };
}) {
  const cls = "text-foreground hover:text-primary hover:underline";
  const kind = identity.hrefKind ?? (identity.personId ? "person" : "historical");
  if (kind === "person" && identity.personId) {
    return (
      <Link to="/people/$personId" params={{ personId: identity.personId }} className={cls}>
        {identity.displayName}
      </Link>
    );
  }
  if (kind === "current-roster" && identity.unlinkedParticipantRef) {
    return (
      <Link to="/bowlers/$bowlerId" params={{ bowlerId: identity.unlinkedParticipantRef }} className={cls}>
        {identity.displayName}
      </Link>
    );
  }
  if (kind === "current-sub" && identity.unlinkedParticipantRef) {
    return (
      <Link
        to="/bowlers/sub/$substituteId"
        params={{ substituteId: identity.unlinkedParticipantRef }}
        className={cls}
      >
        {identity.displayName}
      </Link>
    );
  }
  if (kind === "historical" && identity.unlinkedSeasonId && identity.unlinkedParticipantRef) {
    return (
      <Link
        to="/seasons/$seasonId/bowlers/$participantRef"
        params={{
          seasonId: identity.unlinkedSeasonId,
          participantRef: identity.unlinkedParticipantRef,
        }}
        className={cls}
      >
        {identity.displayName}
      </Link>
    );
  }
  return <span>{identity.displayName}</span>;
}
