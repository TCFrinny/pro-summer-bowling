import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/AppShell";
import {
  computeHandicap,
  formatPoints,
  validatePointsOverride,
  type MatchResult,
  type ParticipationStatus,
} from "@/lib/mock-data";
import {
  getAdminScheduleData,
  saveMatchResult,
} from "@/lib/schedule-repo.functions";
import {
  SideLinescoreEditor,
  computeSideDerived,
  emptySideEditorState,
  type SideEditorState,
} from "@/components/linescore/MatchLinescoreEditor";
import { emptyGameEditorState, type GameEditorState } from "@/components/linescore/GameEditor";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, PenSquare, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/results")({
  head: () => ({
    meta: [
      { title: "Admin — Weekly Result Entry" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminResultsPage,
});

interface SideDraft {
  status: ParticipationStatus;
  subId: string;
  subName: string;
  subStartAvg: string;
  linescore: SideEditorState;
}
interface Draft {
  sideA: SideDraft;
  sideB: SideDraft;
  overrideEnabled: boolean;
  overrideA: string;
  overrideB: string;
  overrideReason: string;
}

function emptySide(): SideDraft {
  return {
    status: "rostered",
    subId: "", subName: "", subStartAvg: "",
    linescore: emptySideEditorState(),
  };
}
function emptyDraft(): Draft {
  return {
    sideA: emptySide(), sideB: emptySide(),
    overrideEnabled: false, overrideA: "0", overrideB: "0", overrideReason: "",
  };
}

function draftFromResult(r: MatchResult): Draft {
  const sideFromResult = (isA: boolean): SideDraft => {
    const p = isA ? r.participationA : r.participationB;
    const ls = isA ? r.linescoreA : r.linescoreB;
    const games: [GameEditorState, GameEditorState, GameEditorState] = [
      emptyGameEditorState(), emptyGameEditorState(), emptyGameEditorState(),
    ];
    if (ls) {
      for (let g = 0; g < 3; g++) {
        const game = ls.games[g];
        for (let f = 0; f < 10; f++) {
          games[g].marks[f] = game.frames[f].mark;
          games[g].cumulatives[f] = String(game.frames[f].cumulativeScore);
        }
      }
    }
    const isSub = p.status === "substitute";
    const savedSubStartAvg = isSub
      ? String(isA ? r.entryAverageA : r.entryAverageB) : "";
    return {
      status: p.status,
      subId: isSub && p.actualId ? p.actualId : "",
      subName: isSub && !p.actualId ? p.actualName : "",
      subStartAvg: savedSubStartAvg,
      linescore: { games },
    };
  };
  return {
    sideA: sideFromResult(true),
    sideB: sideFromResult(false),
    overrideEnabled: !!r.pointsOverride?.enabled,
    overrideA: r.pointsOverride ? String(r.pointsOverride.pointsA) : "0",
    overrideB: r.pointsOverride ? String(r.pointsOverride.pointsB) : "0",
    overrideReason: r.pointsOverride?.reason ?? "",
  };
}

interface ScheduleMatch {
  id: string; // schedule_slot_id
  week: number;
  lanePair: string;
  slot: number;
  bowlerA: { id: string; name: string; entryAverage: number };
  bowlerB: { id: string; name: string; entryAverage: number };
  result: MatchResult | null;
}

function AdminResultsPage() {
  const qc = useQueryClient();
  const load = useServerFn(getAdminScheduleData);
  const save = useServerFn(saveMatchResult);

  const query = useQuery({
    queryKey: ["admin", "schedule"],
    queryFn: () => load(),
  });

  const [week, setWeek] = useState(1);
  const [matchId, setMatchId] = useState<string>("");

  const rosterById = useMemo(() => {
    const m = new Map<string, { id: string; name: string; entryAverage: number }>();
    for (const r of query.data?.roster ?? []) {
      m.set(r.id, { id: r.id, name: r.name, entryAverage: r.entry_average });
    }
    return m;
  }, [query.data]);

  const weekList = useMemo(
    () => (query.data?.weeks ?? []).slice().sort((a, b) => a.week_number - b.week_number),
    [query.data],
  );

  const matches: ScheduleMatch[] = useMemo(() => {
    if (!query.data) return [];
    const wk = weekList.find((w) => w.week_number === week);
    if (!wk) return [];
    const slots = query.data.slots.filter((s) => s.week_id === wk.id);
    const resultBySlot = new Map<string, MatchResult>();
    for (const r of query.data.results) {
      if (r.derived) resultBySlot.set(r.schedule_slot_id, r.derived as unknown as MatchResult);
    }
    const list: ScheduleMatch[] = [];
    for (const s of slots) {
      if (!s.bowler_a_id || !s.bowler_b_id) continue;
      const ba = rosterById.get(s.bowler_a_id) ?? { id: s.bowler_a_id, name: s.name_a ?? s.bowler_a_id, entryAverage: 0 };
      const bb = rosterById.get(s.bowler_b_id) ?? { id: s.bowler_b_id, name: s.name_b ?? s.bowler_b_id, entryAverage: 0 };
      list.push({
        id: s.id, week: wk.week_number,
        lanePair: s.lane_pair, slot: s.slot,
        bowlerA: ba, bowlerB: bb,
        result: resultBySlot.get(s.id) ?? null,
      });
    }
    list.sort((a, b) => a.lanePair === b.lanePair ? a.slot - b.slot : a.lanePair.localeCompare(b.lanePair));
    return list;
  }, [query.data, weekList, week, rosterById]);

  useEffect(() => {
    if (matches.length === 0) { setMatchId(""); return; }
    if (!matches.find((m) => m.id === matchId)) setMatchId(matches[0].id);
  }, [matches, matchId]);

  const currentMatch = matches.find((m) => m.id === matchId);
  const savedResult = currentMatch?.result ?? null;
  const isEditingSaved = !!savedResult;

  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    setDraft(savedResult ? draftFromResult(savedResult) : emptyDraft());
    setFlash(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const activeSubs = useMemo(
    () => (query.data?.subs ?? []).filter((s) => s.active && !s.archived)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [query.data],
  );

  const setSide = (side: "A" | "B", patch: Partial<SideDraft>) => {
    setDraft((d) => ({
      ...d,
      [side === "A" ? "sideA" : "sideB"]: { ...d[side === "A" ? "sideA" : "sideB"], ...patch },
    }));
  };

  const eitherAbsent = draft.sideA.status === "absent" || draft.sideB.status === "absent";

  const subHandicapFromAvg = (raw: string): number | null => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return computeHandicap(n);
  };

  const effHandicapA = draft.sideA.status === "substitute"
    ? (subHandicapFromAvg(draft.sideA.subStartAvg) ?? 0)
    : (currentMatch ? computeHandicap(currentMatch.bowlerA.entryAverage) : 0);
  const effHandicapB = draft.sideB.status === "substitute"
    ? (subHandicapFromAvg(draft.sideB.subStartAvg) ?? 0)
    : (currentMatch ? computeHandicap(currentMatch.bowlerB.entryAverage) : 0);

  const derivedA = useMemo(
    () => computeSideDerived(draft.sideA.linescore, effHandicapA),
    [draft.sideA.linescore, effHandicapA],
  );
  const derivedB = useMemo(
    () => computeSideDerived(draft.sideB.linescore, effHandicapB),
    [draft.sideB.linescore, effHandicapB],
  );

  const validation = useMemo(() => {
    const errors: string[] = [];
    for (const [label, s, d] of [
      ["A", draft.sideA, derivedA],
      ["B", draft.sideB, derivedB],
    ] as const) {
      if (s.status === "substitute") {
        if (!s.subId && !s.subName.trim()) {
          errors.push(`Side ${label}: pick a substitute or type a name`);
        }
        const avg = Number(s.subStartAvg);
        if (!s.subStartAvg.trim() || !Number.isFinite(avg) || avg <= 0 || avg > 300) {
          errors.push(`Side ${label}: substitute Starting Average required (1–300)`);
        }
      }
      if (s.status !== "absent" && !d.valid) {
        errors.push(`Side ${label}: linescore incomplete or invalid`);
      }
    }
    if (eitherAbsent && !draft.overrideEnabled) {
      errors.push("An absent side requires a manual points override with a reason.");
    }
    if (draft.overrideEnabled) {
      const check = validatePointsOverride({
        enabled: true,
        pointsA: Number(draft.overrideA),
        pointsB: Number(draft.overrideB),
        reason: draft.overrideReason,
      });
      if (!check.ok) errors.push(`Override: ${check.error}`);
    }
    return errors;
  }, [draft, derivedA, derivedB, eitherAbsent]);

  const previewNormal = useMemo(() => {
    if (
      eitherAbsent || !derivedA.valid || !derivedB.valid ||
      !derivedA.games.every(Boolean) || !derivedB.games.every(Boolean)
    ) return null;
    let ptsA = 0, ptsB = 0;
    for (let i = 0; i < 3; i++) {
      const ga = derivedA.games[i]!.scratchTotal + effHandicapA;
      const gb = derivedB.games[i]!.scratchTotal + effHandicapB;
      if (ga > gb) ptsA += 2;
      else if (gb > ga) ptsB += 2;
      else { ptsA += 1; ptsB += 1; }
    }
    const hsA = derivedA.handicapSet ?? 0;
    const hsB = derivedB.handicapSet ?? 0;
    if (hsA > hsB) ptsA += 1;
    else if (hsB > hsA) ptsB += 1;
    else { ptsA += 0.5; ptsB += 0.5; }
    return { ptsA, ptsB };
  }, [derivedA, derivedB, effHandicapA, effHandicapB, eitherAbsent]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!currentMatch) throw new Error("No match selected");
      const buildGames = (s: SideDraft, d: typeof derivedA) => {
        if (s.status === "absent") return undefined;
        const g = d.games;
        if (!g[0] || !g[1] || !g[2]) return undefined;
        return [g[0], g[1], g[2]].map((game) => ({
          frames: game.frames.map((f) => ({
            frameNumber: f.frameNumber,
            mark: f.mark,
            cumulativeScore: f.cumulativeScore,
          })),
        }));
      };
      const subStartAvgOrUndef = (raw: string): number | undefined => {
        const n = Number(raw);
        return Number.isFinite(n) && raw.trim() !== "" ? n : undefined;
      };
      return save({
        data: {
          slotId: currentMatch.id,
          sideA: {
            status: draft.sideA.status,
            substituteId: draft.sideA.subId || undefined,
            substituteName: draft.sideA.subName.trim() || undefined,
            substituteStartingAverage: draft.sideA.status === "substitute"
              ? subStartAvgOrUndef(draft.sideA.subStartAvg) : undefined,
            games: buildGames(draft.sideA, derivedA) as never,
          },
          sideB: {
            status: draft.sideB.status,
            substituteId: draft.sideB.subId || undefined,
            substituteName: draft.sideB.subName.trim() || undefined,
            substituteStartingAverage: draft.sideB.status === "substitute"
              ? subStartAvgOrUndef(draft.sideB.subStartAvg) : undefined,
            games: buildGames(draft.sideB, derivedB) as never,
          },
          override: draft.overrideEnabled ? {
            enabled: true,
            pointsA: Number(draft.overrideA),
            pointsB: Number(draft.overrideB),
            reason: draft.overrideReason,
          } : null,
        },
      });
    },
    onSuccess: () => {
      setFlash("Result saved. Standings and leaderboards updated.");
      qc.invalidateQueries({ queryKey: ["admin", "schedule"] });
    },
    onError: (e: Error) => setFlash("Save failed: " + e.message),
  });

  const handleReset = () => {
    setDraft(savedResult ? draftFromResult(savedResult) : emptyDraft());
    setFlash(null);
  };

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="Admin · Weekly Result Entry" subtitle="Loading…" />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title="Admin · Weekly Result Entry" subtitle="Error" />
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {(query.error as Error).message}
        </div>
      </>
    );
  }
  if (weekList.length === 0) {
    return (
      <>
        <PageHeader title="Admin · Weekly Result Entry" subtitle="No schedule yet" />
        <p className="text-sm text-muted-foreground">
          Create a week's schedule on the Manual Schedule Editor first.
        </p>
      </>
    );
  }
  if (!currentMatch) {
    return (
      <>
        <PageHeader title="Admin · Weekly Result Entry" subtitle={`Week ${week}`} />
        <WeekPicker weekList={weekList} week={week} setWeek={setWeek} />
        <p className="mt-4 text-sm text-muted-foreground">
          No matches scheduled for week {week}.
        </p>
      </>
    );
  }

  const a = currentMatch.bowlerA;
  const b = currentMatch.bowlerB;

  return (
    <>
      <PageHeader
        title="Admin · Weekly Result Entry"
        subtitle="Enter frame-by-frame linescores. W-L points derive from handicap totals unless a manual override is applied."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[160px_1fr]" data-testid="admin-results-toolbar">
        <WeekPicker weekList={weekList} week={week} setWeek={setWeek} />
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Matchup</div>
          <Select value={matchId} onValueChange={setMatchId}>
            <SelectTrigger data-testid="match-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {matches.map((m) => {
                const done = m.result ? " ✓" : "";
                return (
                  <SelectItem key={m.id} value={m.id}>
                    Lanes {m.lanePair} · Slot {m.slot} — {m.bowlerA.name} vs {m.bowlerB.name}{done}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isEditingSaved && (
        <div
          data-testid="editing-saved-banner"
          className="mb-3 flex items-center gap-2 rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-xs text-gold"
        >
          <PenSquare className="h-4 w-4" />
          <span className="font-semibold uppercase tracking-widest">Editing saved result</span>
          <span className="text-muted-foreground">— re-saving replaces the existing match record.</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2" data-testid="admin-results-sides">
        <SidePanel
          testId="side-A"
          label={`Side A — ${a.name}`}
          handicap={effHandicapA}
          scheduledHandicap={computeHandicap(a.entryAverage)}
          side={draft.sideA}
          subs={activeSubs}
          onChange={(patch) => setSide("A", patch)}
        />
        <SidePanel
          testId="side-B"
          label={`Side B — ${b.name}`}
          handicap={effHandicapB}
          scheduledHandicap={computeHandicap(b.entryAverage)}
          side={draft.sideB}
          subs={activeSubs}
          onChange={(patch) => setSide("B", patch)}
        />
      </div>

      {previewNormal && (
        <Card className="mt-4 bg-card">
          <CardContent className="p-3 text-xs">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Frame-derived preview (both sides bowled, no override)
            </div>
            <div className="mt-1 font-display text-lg text-gold" data-testid="preview-points">
              {formatPoints(previewNormal.ptsA)} – {formatPoints(previewNormal.ptsB)}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className={cn("mt-4", eitherAbsent && "border-gold/60 bg-gold/5")}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <input
              id="override-toggle-cb"
              type="checkbox"
              data-testid="override-toggle"
              checked={draft.overrideEnabled}
              onChange={(e) => setDraft((d) => ({ ...d, overrideEnabled: e.target.checked }))}
            />
            <label htmlFor="override-toggle-cb">Manual Points Override</label>
          </div>
          {eitherAbsent && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gold">
              <AlertTriangle className="h-3.5 w-3.5" />
              One side is absent — a manual override is required before saving.
            </div>
          )}
          {draft.overrideEnabled && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <NumberInput
                label="Side A awarded (0–7, step 0.5)"
                testId="override-a"
                value={draft.overrideA}
                onChange={(v) => setDraft((d) => ({ ...d, overrideA: v }))}
              />
              <NumberInput
                label="Side B awarded (0–7, step 0.5)"
                testId="override-b"
                value={draft.overrideB}
                onChange={(v) => setDraft((d) => ({ ...d, overrideB: v }))}
              />
              <div>
                <Label>Reason (required)</Label>
                <Input
                  data-testid="override-reason"
                  value={draft.overrideReason}
                  onChange={(e) => setDraft((d) => ({ ...d, overrideReason: e.target.value }))}
                  placeholder="e.g. Forfeit — opponent absent"
                />
              </div>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Combined awarded points must be ≤ 7 in 0.5-point increments.
          </p>
        </CardContent>
      </Card>

      {validation.length > 0 && (
        <Card className="mt-4 border-destructive/50 bg-destructive/5">
          <CardContent className="p-3" data-testid="validation-errors">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-destructive">
              <AlertTriangle className="h-4 w-4" /> Validation ({validation.length})
            </div>
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {validation.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          data-testid="save-result"
          disabled={validation.length > 0 || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold",
            validation.length > 0 || saveMutation.isPending
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "Saving…" : "Save result"}
        </button>
        <button
          data-testid="reset-editor"
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-accent/40"
          title={isEditingSaved ? "Reset editor to last-saved values" : "Clear the editor"}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {isEditingSaved ? "Reset to saved" : "Clear editor"}
        </button>
        {flash && (
          <span
            data-testid="save-flash"
            className="inline-flex items-center gap-1.5 text-xs text-primary"
          >
            <CheckCircle2 className="h-4 w-4" /> {flash}
          </span>
        )}
      </div>
    </>
  );
}

function WeekPicker({
  weekList, week, setWeek,
}: {
  weekList: { week_number: number; published: boolean }[];
  week: number;
  setWeek: (w: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Week</div>
      <Select value={String(week)} onValueChange={(v) => setWeek(Number(v))}>
        <SelectTrigger data-testid="week-select"><SelectValue /></SelectTrigger>
        <SelectContent>
          {weekList.map((w) => (
            <SelectItem key={w.week_number} value={String(w.week_number)}>
              Week {w.week_number}{w.published ? " ✓" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type SubRecord = {
  id: string; name: string;
  starting_average: number | null;
  active: boolean; archived: boolean;
  bowler_number: string | null;
};

function SidePanel({
  label, handicap, scheduledHandicap, side, subs, onChange, testId,
}: {
  label: string;
  handicap: number;
  scheduledHandicap: number;
  side: SideDraft;
  subs: SubRecord[];
  onChange: (patch: Partial<SideDraft>) => void;
  testId?: string;
}) {
  const disabled = side.status === "absent";
  return (
    <Card className="bg-card" data-testid={testId}>
      <CardContent className="p-4">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-xs uppercase tracking-widest text-muted-foreground">
          <span>{label}</span>
          {side.status === "substitute" && (
            <span className="normal-case tracking-normal text-[10px] text-muted-foreground">
              Scheduled hcp {scheduledHandicap} · Sub hcp <b className="text-foreground">{handicap}</b>
            </span>
          )}
        </div>
        <div className="mb-3 grid grid-cols-3 gap-1 text-xs">
          {(["rostered", "substitute", "absent"] as const).map((s) => (
            <button
              key={s}
              data-testid={`${testId}-status-${s}`}
              onClick={() => onChange({ status: s })}
              className={cn(
                "rounded-md border px-2 py-1.5 capitalize",
                side.status === s
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-border hover:bg-accent/40",
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {side.status === "substitute" && (
          <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_140px]">
            <div>
              <Label className="text-[10px]">Pick from pool</Label>
              <Select
                value={side.subId || undefined}
                onValueChange={(v) => {
                  const found = subs.find((s) => s.id === v);
                  onChange({
                    subId: v,
                    subName: found?.name ?? side.subName,
                    subStartAvg: side.subStartAvg
                      ? side.subStartAvg
                      : (found?.starting_average != null ? String(found.starting_average) : ""),
                  });
                }}
              >
                <SelectTrigger data-testid={`${testId}-sub-select`}>
                  <SelectValue placeholder="Choose sub…" />
                </SelectTrigger>
                <SelectContent>
                  {subs.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{s.starting_average != null ? ` · avg ${s.starting_average}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Or type a name</Label>
              <Input
                data-testid={`${testId}-sub-name`}
                value={side.subName}
                onChange={(e) => onChange({ subId: "", subName: e.target.value })}
                placeholder="Walk-on substitute"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Add subs with ID numbers via Manage Bowlers.
              </p>
            </div>
            <div>
              <Label className="text-[10px]">Starting Average</Label>
              <Input
                data-testid={`${testId}-sub-start-avg`}
                type="number"
                min={1} max={300} step={1}
                value={side.subStartAvg}
                onChange={(e) => onChange({ subStartAvg: e.target.value })}
                placeholder="e.g. 138"
              />
            </div>
          </div>
        )}

        <SideLinescoreEditor
          label="Linescore"
          handicap={handicap}
          disabled={disabled}
          state={side.linescore}
          onChange={(next) => onChange({ linescore: next })}
          testPrefix={testId}
        />

        {disabled && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            No linescore recorded for an absent side.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function NumberInput({
  label, value, onChange, testId,
}: {
  label: string; value: string; onChange: (v: string) => void; testId?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        data-testid={testId}
        type="number"
        min={0} max={7} step={0.5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
