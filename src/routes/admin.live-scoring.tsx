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
  priorScores: {
    a: [number | null, number | null, number | null];
    b: [number | null, number | null, number | null];
  };
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
      // Prefill sub Starting Average from the FROZEN live row entry average
      // when the same substitute is still selected. Blank otherwise so a
      // fresh sub selection uses the pool default.
      const sideA: SideDraft = live
        ? {
            status: live.side_a.status,
            subId: live.side_a.status === "substitute" ? (live.side_a.actualId ?? "") : "",
            subStartAvg: live.side_a.status === "substitute" ? String(live.side_a.entryAverage) : "",
          }
        : { status: "rostered", subId: "", subStartAvg: "" };
      const sideB: SideDraft = live
        ? {
            status: live.side_b.status,
            subId: live.side_b.status === "substitute" ? (live.side_b.actualId ?? "") : "",
            subStartAvg: live.side_b.status === "substitute" ? String(live.side_b.entryAverage) : "",
          }
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
        // Track prior saved scores so we can flag overwrites at save time.
        priorScores: {
          a: [
            live?.a_game1 ?? null,
            live?.a_game2 ?? null,
            live?.a_game3 ?? null,
          ],
          b: [
            live?.b_game1 ?? null,
            live?.b_game2 ?? null,
            live?.b_game3 ?? null,
          ],
        },
      };
    });
    setRows(drafts);
  }, [q.data]);

  // Row-level validation: for a given game index, both scores must be
  // valid integers 0..300 OR both blank. Also flag identity changes
  // vs the frozen prior side (any game already saved → confirmation).
  const rowValidation = useMemo(() => {
    const map = new Map<string, { g1: string | null; g2: string | null; g3: string | null; anyInvalid: boolean }>();
    if (!rows) return map;
    for (const r of rows) {
      const games: (string | null)[] = [null, null, null];
      for (const gi of [0, 1, 2] as const) {
        const aRaw = r.scores.a[gi].trim();
        const bRaw = r.scores.b[gi].trim();
        const aVal = aRaw === "" ? null : toNum(r.scores.a[gi]);
        const bVal = bRaw === "" ? null : toNum(r.scores.b[gi]);
        const aFilled = aRaw !== "";
        const bFilled = bRaw !== "";
        if (aFilled !== bFilled) {
          games[gi] = "Both sides must be scored or both blank";
        } else if (aFilled && (aVal === null || bVal === null)) {
          games[gi] = "Scores must be integers 0–300";
        }
      }
      map.set(r.slotId, {
        g1: games[0], g2: games[1], g3: games[2],
        anyInvalid: games.some((v) => v != null),
      });
    }
    return map;
  }, [rows]);

  const gameHasInvalid = (game: 1 | 2 | 3): boolean => {
    if (!rows) return true;
    for (const r of rows) {
      if (r.hasFullResult) continue;
      const v = rowValidation.get(r.slotId);
      if (!v) continue;
      if ((game === 1 && v.g1) || (game === 2 && v.g2) || (game === 3 && v.g3)) return true;
    }
    return false;
  };

  const saveMut = useMutation({
    mutationFn: async (game: 1 | 2 | 3) => {
      if (!rows) throw new Error("Not loaded");
      // Collect overwrites for explicit confirmation.
      const overwrites: string[] = [];
      for (const r of rows) {
        if (r.hasFullResult) continue;
        const gi = game - 1;
        const priorA = r.priorScores.a[gi];
        const priorB = r.priorScores.b[gi];
        const nowA = toNum(r.scores.a[gi]);
        const nowB = toNum(r.scores.b[gi]);
        const hadPair = priorA != null && priorB != null;
        const hasNewPair = nowA != null && nowB != null;
        const changed = hasNewPair && hadPair && (priorA !== nowA || priorB !== nowB);
        if (changed) overwrites.push(r.scheduledNameA + " vs " + r.scheduledNameB);
      }
      if (overwrites.length > 0) {
        const ok = typeof window !== "undefined" && window.confirm(
          `Overwrite existing Game ${game} score(s) for:\n  • ${overwrites.join("\n  • ")}\n\nContinue?`,
        );
        if (!ok) throw new Error("Overwrite cancelled");
      }
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
        // A row is only submittable when BOTH sides have valid scores.
        // Skip untouched rows AND reject one-sided rows outright.
        .filter((m) => {
          if (m.scoreA == null && m.scoreB == null) return false;
          if (m.scoreA == null || m.scoreB == null) {
            throw new Error("A matchup has only one side scored — enter both or clear both");
          }
          return true;
        });
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
        <PageHeader title="Final Week Live Scoring" subtitle="Compact per-game entry." />
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
        subtitle="Enter scratch scores per game. Points award automatically as pairs complete."
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
        <div className="space-y-0.5">
          <div>{summary.awarded}/{summary.total} points awarded ({summary.pending} pending)</div>
          <div className="text-[11px]">
            {[1, 2, 3].map((g) => {
              let done = 0, total = 0;
              for (const r of (rows ?? [])) {
                if (r.hasFullResult) continue;
                total += 1;
                if (r.mask[g - 1]) done += 1;
              }
              return (
                <span key={g} className="mr-3">
                  {done}/{total} Game {g} matchups saved
                </span>
              );
            })}
          </div>
          <div className="text-[11px] text-amber-600">
            Absent matchups must be entered via normal Results / manual override.
          </div>
        </div>
        <div className="flex gap-2">
          {[1, 2, 3].map((g) => {
            const invalid = gameHasInvalid(g as 1 | 2 | 3);
            return (
              <button
                key={g}
                type="button"
                onClick={() => saveMut.mutate(g as 1 | 2 | 3)}
                disabled={saveMut.isPending || !rows || invalid}
                title={invalid ? "Fix validation errors below before saving" : ""}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 hover:bg-accent disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" /> Save Game {g}
              </button>
            );
          })}
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
                    <div>
                      <div>{liveStatusLabel(r.mask)}</div>
                      {(() => {
                        const v = rowValidation.get(r.slotId);
                        const msgs = [v?.g1, v?.g2, v?.g3].filter(Boolean) as string[];
                        if (msgs.length === 0) return null;
                        return (
                          <div className="mt-1 text-[11px] text-destructive">
                            {[...new Set(msgs)].join(" · ")}
                          </div>
                        );
                      })()}
                    </div>
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
