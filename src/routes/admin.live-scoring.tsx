import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/AppShell";
import {
  getLiveScoringData,
  saveLiveGameBatch,
  deleteLiveMatch,
} from "@/lib/live-scoring.functions";
import {
  pairCompletedMask,
  liveStatusLabel,
  remainingPointsForLive,
  type LiveMatchRow,
} from "@/lib/live-scoring";
import { SNAPSHOT_QUERY_KEY } from "@/lib/public-snapshot";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Loader2, Save, Trash2 } from "lucide-react";

export const Route = createFileRoute("/admin/live-scoring")({
  head: () => ({
    meta: [
      { title: "Admin — Final Week Live Scoring" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLiveScoringPage,
});

type SideStatus = "rostered" | "substitute";
interface SideDraft {
  status: SideStatus;
  subId: string;
  subStartAvg: string;
}
interface RowDraft {
  slotId: string;
  scheduledA: string;
  scheduledB: string;
  scheduledNameA: string;
  scheduledNameB: string;
  hasFullResult: boolean;
  sideA: SideDraft;
  sideB: SideDraft;
  scores: {
    a: [string, string, string];
    b: [string, string, string];
  };
  mask: [boolean, boolean, boolean];
}

function toNum(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 300) return null;
  return n;
}

function AdminLiveScoringPage() {
  const qc = useQueryClient();
  const load = useServerFn(getLiveScoringData);
  const save = useServerFn(saveLiveGameBatch);
  const del = useServerFn(deleteLiveMatch);

  const q = useQuery({
    queryKey: ["admin", "live-scoring"],
    queryFn: () => load(),
  });

  const [rows, setRows] = useState<RowDraft[] | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    if (!q.data) return;
    const liveById = new Map<string, LiveMatchRow>();
    for (const r of q.data.liveRows) liveById.set(r.schedule_slot_id, r);
    const fullSet = new Set(q.data.fullResultSlotIds);
    const drafts: RowDraft[] = (q.data.slots ?? []).map((s) => {
      const live = liveById.get(s.id);
      const mask = live
        ? pairCompletedMask(live)
        : ([false, false, false] as [boolean, boolean, boolean]);
      const sideA: SideDraft = live
        ? { status: live.side_a.status, subId: live.side_a.status === "substitute" ? (live.side_a.actualId ?? "") : "", subStartAvg: "" }
        : { status: "rostered", subId: "", subStartAvg: "" };
      const sideB: SideDraft = live
        ? { status: live.side_b.status, subId: live.side_b.status === "substitute" ? (live.side_b.actualId ?? "") : "", subStartAvg: "" }
        : { status: "rostered", subId: "", subStartAvg: "" };
      return {
        slotId: s.id,
        scheduledA: s.bowler_a_id ?? "",
        scheduledB: s.bowler_b_id ?? "",
        scheduledNameA: s.name_a ?? "",
        scheduledNameB: s.name_b ?? "",
        hasFullResult: fullSet.has(s.id),
        sideA, sideB,
        scores: {
          a: [
            live?.a_game1 != null ? String(live.a_game1) : "",
            live?.a_game2 != null ? String(live.a_game2) : "",
            live?.a_game3 != null ? String(live.a_game3) : "",
          ],
          b: [
            live?.b_game1 != null ? String(live.b_game1) : "",
            live?.b_game2 != null ? String(live.b_game2) : "",
            live?.b_game3 != null ? String(live.b_game3) : "",
          ],
        },
        mask,
      };
    });
    setRows(drafts);
  }, [q.data]);

  const saveMut = useMutation({
    mutationFn: async (game: 1 | 2 | 3) => {
      if (!rows) throw new Error("Not loaded");
      const matches = rows
        .filter((r) => !r.hasFullResult)
        .map((r) => {
          const a = toNum(r.scores.a[game - 1]);
          const b = toNum(r.scores.b[game - 1]);
          return {
            slotId: r.slotId,
            sideA: {
              scheduledId: r.scheduledA,
              status: r.sideA.status,
              substituteId: r.sideA.status === "substitute" ? (r.sideA.subId || null) : null,
              substituteStartingAverage:
                r.sideA.status === "substitute" && r.sideA.subStartAvg.trim()
                  ? Number(r.sideA.subStartAvg)
                  : null,
            },
            sideB: {
              scheduledId: r.scheduledB,
              status: r.sideB.status,
              substituteId: r.sideB.status === "substitute" ? (r.sideB.subId || null) : null,
              substituteStartingAverage:
                r.sideB.status === "substitute" && r.sideB.subStartAvg.trim()
                  ? Number(r.sideB.subStartAvg)
                  : null,
            },
            scoreA: a,
            scoreB: b,
          };
        })
        // Only send matches where at least one side has a score for this game
        // (avoids clobbering with nulls for untouched rows).
        .filter((m) => m.scoreA != null || m.scoreB != null);
      if (matches.length === 0) throw new Error("No scores entered for this game");
      return save({ data: { gameNumber: game, matches } });
    },
    onSuccess: async (_r, game) => {
      setBanner({ kind: "ok", msg: `Game ${game} saved.` });
      await qc.invalidateQueries({ queryKey: ["admin", "live-scoring"] });
      await qc.invalidateQueries({ queryKey: SNAPSHOT_QUERY_KEY });
    },
    onError: (err) => setBanner({ kind: "err", msg: (err as Error).message }),
  });

  const delMut = useMutation({
    mutationFn: (slotId: string) => del({ data: { slotId } }),
    onSuccess: async () => {
      setBanner({ kind: "ok", msg: "Live entry removed." });
      await qc.invalidateQueries({ queryKey: ["admin", "live-scoring"] });
      await qc.invalidateQueries({ queryKey: SNAPSHOT_QUERY_KEY });
    },
    onError: (err) => setBanner({ kind: "err", msg: (err as Error).message }),
  });

  const subs = q.data?.subs ?? [];
  const week = q.data?.week;

  const summary = useMemo(() => {
    if (!rows) return { pending: 0, total: 0, awarded: 0 };
    let awarded = 0;
    let total = 0;
    for (const r of rows) {
      if (r.hasFullResult) continue;
      total += 7;
      awarded += 7 - remainingPointsForLive(r.mask);
    }
    return { pending: total - awarded, total, awarded };
  }, [rows]);

  if (q.isLoading) {
    return (
      <>
        <PageHeader title="Final Week Live Scoring" description="Compact per-game entry." />
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      </>
    );
  }

  if (q.data?.migrationRequired) {
    return (
      <>
        <PageHeader title="Final Week Live Scoring" />
        <Card><CardContent className="p-6 text-sm">
          Live scoring migration has not been applied to this database yet.
        </CardContent></Card>
      </>
    );
  }

  if (!week) {
    return (
      <>
        <PageHeader title="Final Week Live Scoring" />
        <Card><CardContent className="p-6 text-sm">
          No scheduled final week exists yet. Publish or draft a week with slots first.
        </CardContent></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Final Week Live Scoring — Week ${week.weekNumber}`}
        description="Enter scratch scores per game. Points award automatically as pairs complete."
      />
      {banner && (
        <div
          className={
            banner.kind === "ok"
              ? "mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
              : "mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
          role={banner.kind === "err" ? "alert" : "status"}
        >
          {banner.msg}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>
          {summary.awarded}/{summary.total} points awarded ({summary.pending} pending)
        </div>
        <div className="flex gap-2">
          {[1, 2, 3].map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => saveMut.mutate(g as 1 | 2 | 3)}
              disabled={saveMut.isPending || !rows}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 hover:bg-accent disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" /> Save Game {g}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Bowlers</th>
              <th className="p-2 text-center">G1</th>
              <th className="p-2 text-center">G2</th>
              <th className="p-2 text-center">G3</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows?.map((r, idx) => (
              <tr
                key={r.slotId}
                className={r.hasFullResult ? "opacity-60" : "border-t border-border/60"}
              >
                <td className="p-2 align-top">
                  <SideRow
                    label={r.scheduledNameA}
                    side={r.sideA}
                    subs={subs}
                    onChange={(sd) => setRows((cur) => cur?.map((x, i) => i === idx ? { ...x, sideA: sd } : x) ?? cur)}
                    disabled={r.hasFullResult}
                  />
                  <SideRow
                    label={r.scheduledNameB}
                    side={r.sideB}
                    subs={subs}
                    onChange={(sd) => setRows((cur) => cur?.map((x, i) => i === idx ? { ...x, sideB: sd } : x) ?? cur)}
                    disabled={r.hasFullResult}
                  />
                </td>
                {[0, 1, 2].map((gi) => (
                  <td key={gi} className="p-1 align-top">
                    <div className="flex flex-col gap-1">
                      <Input
                        inputMode="numeric"
                        className="h-8 w-16 text-center tabular-nums"
                        value={r.scores.a[gi]}
                        disabled={r.hasFullResult}
                        onChange={(e) => setRows((cur) => cur?.map((x, i) => {
                          if (i !== idx) return x;
                          const a: [string, string, string] = [...x.scores.a] as [string, string, string];
                          a[gi] = e.target.value;
                          return { ...x, scores: { ...x.scores, a } };
                        }) ?? cur)}
                      />
                      <Input
                        inputMode="numeric"
                        className="h-8 w-16 text-center tabular-nums"
                        value={r.scores.b[gi]}
                        disabled={r.hasFullResult}
                        onChange={(e) => setRows((cur) => cur?.map((x, i) => {
                          if (i !== idx) return x;
                          const b: [string, string, string] = [...x.scores.b] as [string, string, string];
                          b[gi] = e.target.value;
                          return { ...x, scores: { ...x.scores, b } };
                        }) ?? cur)}
                      />
                    </div>
                  </td>
                ))}
                <td className="p-2 align-top text-xs text-muted-foreground">
                  {r.hasFullResult ? (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3.5 w-3.5" /> Full result exists
                    </span>
                  ) : (
                    liveStatusLabel(r.mask)
                  )}
                </td>
                <td className="p-2 align-top">
                  {!r.hasFullResult && (
                    <button
                      type="button"
                      title="Delete live entry"
                      onClick={() => delMut.mutate(r.slotId)}
                      disabled={delMut.isPending}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SideRow({
  label, side, subs, onChange, disabled,
}: {
  label: string;
  side: SideDraft;
  subs: Array<{ id: string; name: string; starting_average: number | null; active: boolean; archived: boolean }>;
  onChange: (sd: SideDraft) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
      <span className="w-32 truncate font-medium">{label}</span>
      <Select
        value={side.status}
        onValueChange={(v) => onChange({ ...side, status: v as SideStatus })}
        disabled={disabled}
      >
        <SelectTrigger className="h-7 w-28"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="rostered">Rostered</SelectItem>
          <SelectItem value="substitute">Substitute</SelectItem>
        </SelectContent>
      </Select>
      {side.status === "substitute" && (
        <>
          <Select
            value={side.subId}
            onValueChange={(v) => onChange({ ...side, subId: v })}
            disabled={disabled}
          >
            <SelectTrigger className="h-7 w-40"><SelectValue placeholder="Select sub" /></SelectTrigger>
            <SelectContent>
              {subs.filter((s) => s.active && !s.archived).map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label className="sr-only">Starting avg override</Label>
          <Input
            className="h-7 w-16 text-center"
            placeholder="avg"
            inputMode="numeric"
            value={side.subStartAvg}
            disabled={disabled}
            onChange={(e) => onChange({ ...side, subStartAvg: e.target.value })}
          />
        </>
      )}
    </div>
  );
}
