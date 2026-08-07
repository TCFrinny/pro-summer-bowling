import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/AppShell";
import { LANE_PAIRS, TOTAL_WEEKS, type LanePair } from "@/lib/mock-data";
import {
  getAdminScheduleData,
  saveWeekSchedule,
  setWeekPublished,
  deleteWeek,
} from "@/lib/schedule-repo.functions";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, Save, Trash2, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { sortPersonOptions } from "@/lib/person-sort";
import {
  FINAL_WEEK_REPEAT_NOTE,
  pairKeyFor,
  resolveFinalWeek,
  validateWeekDraft,
} from "@/lib/schedule-week-validation";

export const Route = createFileRoute("/admin/schedule")({
  head: () => ({
    meta: [
      { title: "Admin — Manual Schedule Editor" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminSchedulePage,
});

interface DraftSlot {
  lanePair: LanePair;
  slot: number;
  bowlerA: string;
  bowlerB: string;
}

const WEEK_NUMBERS = Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1);

function emptyDraft(): DraftSlot[] {
  const rows: DraftSlot[] = [];
  for (const lp of LANE_PAIRS) {
    for (let slot = 1; slot <= 3; slot++) {
      rows.push({ lanePair: lp, slot, bowlerA: "", bowlerB: "" });
    }
  }
  return rows;
}

function AdminSchedulePage() {
  const qc = useQueryClient();
  const load = useServerFn(getAdminScheduleData);
  const saveWk = useServerFn(saveWeekSchedule);
  const publishWk = useServerFn(setWeekPublished);
  const delWk = useServerFn(deleteWeek);

  const query = useQuery({
    queryKey: ["admin", "schedule"],
    queryFn: () => load(),
  });

  const [week, setWeek] = useState<number>(1);
  const [draft, setDraft] = useState<DraftSlot[]>(() => emptyDraft());
  const [dateStr, setDateStr] = useState<string>("");
  const [flash, setFlash] = useState<string | null>(null);

  const roster = query.data?.roster ?? [];
  const activeRoster = useMemo(
    () => sortPersonOptions(
      roster.filter((r) => r.active && !r.archived).map((r) => ({
        id: r.id, name: r.name, bowlerNumber: r.bowler_number,
      })),
    ).map((s) => roster.find((r) => r.id === s.id)!),
    [roster],
  );

  // Hydrate draft when week changes or data loads.
  useEffect(() => {
    if (!query.data) return;
    const wk = query.data.weeks.find((w) => w.week_number === week);
    const rows = emptyDraft();
    if (wk) {
      const wkSlots = query.data.slots.filter((s) => s.week_id === wk.id);
      for (const s of wkSlots) {
        const target = rows.find((r) => r.lanePair === s.lane_pair && r.slot === s.slot);
        if (target) {
          target.bowlerA = s.bowler_a_id ?? "";
          target.bowlerB = s.bowler_b_id ?? "";
        }
      }
      setDateStr(wk.date ? wk.date.slice(0, 10) : "");
    } else {
      setDateStr("");
    }
    setDraft(rows);
    setFlash(null);
  }, [week, query.data]);

  const currentWeek = query.data?.weeks.find((w) => w.week_number === week);

  const priorPairKeys = useMemo(() => {
    const set = new Set<string>();
    if (!query.data) return set;
    for (const w of query.data.weeks) {
      if (w.week_number >= week) continue;
      for (const s of query.data.slots) {
        if (s.week_id !== w.id) continue;
        if (s.bowler_a_id && s.bowler_b_id) set.add(pairKeyFor(s.bowler_a_id, s.bowler_b_id));
      }
    }
    return set;
  }, [query.data, week]);

  const usedBowlers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of draft) {
      if (r.bowlerA) counts.set(r.bowlerA, (counts.get(r.bowlerA) ?? 0) + 1);
      if (r.bowlerB) counts.set(r.bowlerB, (counts.get(r.bowlerB) ?? 0) + 1);
    }
    return counts;
  }, [draft]);

  const filledSlots = useMemo(
    () => draft.filter((r) => r.bowlerA && r.bowlerB),
    [draft],
  );

  const finalWeek = useMemo(
    () => resolveFinalWeek(
      query.data?.seasonTotalWeeks ?? null,
      (query.data?.weeks ?? []).map((w) => w.week_number),
    ),
    [query.data],
  );
  const isFinalWeekSelected = week === finalWeek;

  const warnings = useMemo(
    () => validateWeekDraft({
      weekNumber: week,
      finalWeek,
      rows: draft,
      activeBowlers: activeRoster.map((b) => ({ id: b.id, name: b.name })),
      priorPairKeys,
    }),
    [week, finalWeek, draft, activeRoster, priorPairKeys],
  );

  const setSlot = (idx: number, patch: Partial<DraftSlot>) => {
    setDraft((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: (publish: boolean) => saveWk({
      data: {
        weekNumber: week,
        date: dateStr ? new Date(dateStr).toISOString() : null,
        publish,
        slots: filledSlots.map((r) => ({
          lanePair: r.lanePair, slot: r.slot,
          bowlerA: r.bowlerA, bowlerB: r.bowlerB,
        })),
      },
    }),
    onSuccess: (_r, publish) => {
      setFlash(publish
        ? `Week ${week} published (${filledSlots.length} matches).`
        : `Draft saved (${filledSlots.length}/18 slots).`);
      qc.invalidateQueries({ queryKey: ["admin", "schedule"] });
    },
    onError: (e: Error) => setFlash("Save failed: " + e.message),
  });

  const publishMutation = useMutation({
    mutationFn: (published: boolean) => publishWk({ data: { weekNumber: week, published } }),
    onSuccess: (_r, published) => {
      setFlash(published ? `Week ${week} published.` : `Week ${week} unpublished.`);
      qc.invalidateQueries({ queryKey: ["admin", "schedule"] });
    },
    onError: (e: Error) => setFlash("Publish failed: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => delWk({ data: { weekNumber: week } }),
    onSuccess: () => {
      setFlash(`Week ${week} deleted.`);
      qc.invalidateQueries({ queryKey: ["admin", "schedule"] });
    },
    onError: (e: Error) => setFlash("Delete failed: " + e.message),
  });

  return (
    <>
      <PageHeader
        title="Admin · Manual Schedule Editor"
        subtitle="Administrators set every week's schedule by hand. Warnings surface duplicates and repeat pairings but never rewrite your choices. Final-week position round: repeat opponents are allowed."
      />

      {query.isLoading && (
        <div className="mb-4 text-sm text-muted-foreground">Loading roster…</div>
      )}
      {query.isError && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {(query.error as Error).message}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Week</div>
          <Select value={String(week)} onValueChange={(v) => setWeek(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WEEK_NUMBERS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Week {n}{query.data?.weeks.find((w) => w.week_number === n)?.published ? " ✓" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Date</div>
          <Input
            type="date"
            className="w-44"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
        </div>
        {currentWeek && (
          <div className="text-xs text-muted-foreground">
            Status:{" "}
            <span className={cn(
              "font-semibold",
              currentWeek.published ? "text-primary" : "text-gold",
            )}>
              {currentWeek.published ? "Published" : "Draft"}
            </span>
            {currentWeek.completed && " · Completed"}
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            disabled={saveMutation.isPending || activeRoster.length === 0}
            onClick={() => saveMutation.mutate(false)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-accent/40 px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> Save draft
          </button>
          <button
            disabled={warnings.length > 0 || saveMutation.isPending || filledSlots.length === 0}
            onClick={() => saveMutation.mutate(true)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold",
              warnings.length > 0 || filledSlots.length === 0
                ? "cursor-not-allowed bg-muted text-muted-foreground"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            <UploadCloud className="h-4 w-4" /> Save & publish
          </button>
          {currentWeek?.published && (
            <button
              disabled={publishMutation.isPending}
              onClick={() => publishMutation.mutate(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-accent/40 disabled:opacity-50"
            >
              Unpublish
            </button>
          )}
          {currentWeek && (
            <button
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (window.confirm(`Delete week ${week}? This removes all draft slots.`)) {
                  deleteMutation.mutate();
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete week
            </button>
          )}
        </div>
      </div>

      {isFinalWeekSelected && (
        <div className="mb-4 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          {FINAL_WEEK_REPEAT_NOTE}
        </div>
      )}

      {flash && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-accent/40 px-3 py-2 text-xs">
          <CheckCircle2 className="h-4 w-4 text-primary" /> {flash}
        </div>
      )}

      {activeRoster.length === 0 && !query.isLoading && (
        <Card className="mb-4 border-gold/40 bg-gold/5">
          <CardContent className="p-3 text-xs text-muted-foreground">
            No active roster bowlers yet. Add bowlers on the{" "}
            <span className="font-semibold">Manage Bowlers</span> page first.
          </CardContent>
        </Card>
      )}

      {warnings.length > 0 && (
        <Card className="mb-4 border-gold/40 bg-gold/5">
          <CardContent className="p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-gold">
              <AlertTriangle className="h-4 w-4" /> Warnings ({warnings.length})
            </div>
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {LANE_PAIRS.map((lp) => (
          <Card key={lp} className="bg-card">
            <CardContent className="p-4">
              <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                Lanes {lp}
              </div>
              <div className="grid gap-2">
                {draft.filter((r) => r.lanePair === lp).map((r) => {
                  const idx = draft.indexOf(r);
                  const dupSelf = r.bowlerA && r.bowlerA === r.bowlerB;
                  const dupA = r.bowlerA && (usedBowlers.get(r.bowlerA) ?? 0) > 1;
                  const dupB = r.bowlerB && (usedBowlers.get(r.bowlerB) ?? 0) > 1;
                  return (
                    <div key={r.slot} className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Slot {r.slot}
                      </span>
                      <BowlerSelect
                        value={r.bowlerA}
                        onChange={(v) => setSlot(idx, { bowlerA: v })}
                        invalid={Boolean(dupSelf || dupA)}
                        options={activeRoster}
                      />
                      <span className="text-xs text-muted-foreground">vs</span>
                      <BowlerSelect
                        value={r.bowlerB}
                        onChange={(v) => setSlot(idx, { bowlerB: v })}
                        invalid={Boolean(dupSelf || dupB)}
                        options={activeRoster}
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function BowlerSelect({
  value, onChange, invalid, options,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  options: { id: string; name: string; bowler_number: string | null }[];
}) {
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v)}>
      <SelectTrigger className={cn(invalid && "border-destructive")}>
        <SelectValue placeholder="Select bowler…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.bowler_number ? `${b.name} (ID ${b.bowler_number})` : b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
