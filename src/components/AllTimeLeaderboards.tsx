/**
 * Public All-Time Leaderboards — compact selector + Top 10 table.
 * Reads the aggregated `AllTimeRow[]` from `getAllTimeLeaderboards` and
 * renders one category at a time.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { getAllTimeLeaderboards } from "@/lib/leaderboards-repo.functions";
import {
  LEADERBOARD_CATEGORIES,
  buildLeaderboard,
  type LeaderboardCategoryId,
  type LeaderboardGroup,
} from "@/lib/leaderboards";

const GROUP_LABELS: Record<LeaderboardGroup, string> = {
  records: "Records",
  scoring: "Scoring",
  frame: "Frame Stats",
  ratings: "Ratings",
};
const GROUP_ORDER: LeaderboardGroup[] = ["records", "scoring", "frame", "ratings"];

export function AllTimeLeaderboards() {
  const q = useQuery({
    queryKey: ["all-time-leaderboards", "v1"],
    queryFn: () => getAllTimeLeaderboards(),
    staleTime: 60_000,
  });

  const [group, setGroup] = useState<LeaderboardGroup>("records");
  const catsInGroup = useMemo(
    () => LEADERBOARD_CATEGORIES.filter((c) => c.group === group),
    [group],
  );
  const [categoryId, setCategoryId] = useState<LeaderboardCategoryId>(
    catsInGroup[0]?.id ?? "gameWins",
  );
  // Reset the active category when the group changes.
  const activeCat = useMemo(() => {
    const found = catsInGroup.find((c) => c.id === categoryId);
    return found ?? catsInGroup[0];
  }, [catsInGroup, categoryId]);

  const board = useMemo(() => {
    if (!q.data || !activeCat) return null;
    return buildLeaderboard(q.data.rows, activeCat.id, 10);
  }, [q.data, activeCat]);

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
          {/* Group selector */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {GROUP_ORDER.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGroup(g);
                  const first = LEADERBOARD_CATEGORIES.find((c) => c.group === g);
                  if (first) setCategoryId(first.id);
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
          {/* Category selector */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {catsInGroup.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
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

          {/* Table */}
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
                      key={`${e.identity.key}-${i}`}
                      className="border-t border-border/60"
                    >
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{e.rank}</td>
                      <td className="px-2 py-1.5">
                        <NameLink identity={e.identity} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                        {e.primaryDisplay}
                      </td>
                      <td className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground sm:table-cell">
                        {e.sampleDisplay}
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
  identity: { displayName: string; personId: string | null; unlinkedSeasonId: string | null; unlinkedParticipantRef: string | null };
}) {
  if (identity.personId) {
    return (
      <Link
        to="/people/$personId"
        params={{ personId: identity.personId }}
        className="text-foreground hover:text-primary hover:underline"
      >
        {identity.displayName}
      </Link>
    );
  }
  if (identity.unlinkedSeasonId && identity.unlinkedParticipantRef) {
    return (
      <Link
        to="/seasons/$seasonId/bowlers/$participantRef"
        params={{
          seasonId: identity.unlinkedSeasonId,
          participantRef: identity.unlinkedParticipantRef,
        }}
        className="text-foreground hover:text-primary hover:underline"
      >
        {identity.displayName}
      </Link>
    );
  }
  return <span>{identity.displayName}</span>;
}
