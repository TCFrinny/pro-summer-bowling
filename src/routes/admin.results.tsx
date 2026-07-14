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
  deleteMatchResult,
  getAdminScheduleData,
  saveMatchResult,
} from "@/lib/schedule-repo.functions";
import { effectiveHandicapForUi } from "@/lib/substitute-handicap";
import { SNAPSHOT_QUERY_KEY } from "@/lib/public-snapshot";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
import { AlertTriangle, CheckCircle2, PenSquare, RotateCcw, Save, Trash2 } from "lucide-react";
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
  /** Three numeric scratch scores entered when status === "absent".
   *  Stored as strings so the input can be cleared. */
  absentScores: [string, string, string];
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
    absentScores: ["", "", ""],
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
    const absentScores: [string, string, string] = p.absentScores
      ? [String(p.absentScores[0]), String(p.absentScores[1]), String(p.absentScores[2])]
      : ["", "", ""];
    return {
      status: p.status,
      subId: isSub && p.actualId ? p.actualId : "",
      subName: isSub && !p.actualId ? p.actualName : "",
      subStartAvg: savedSubStartAvg,
      linescore: { games },
      absentScores,
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
  const del = useServerFn(deleteMatchResult);


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

  // Effective per-side handicap for the LIVE PREVIEW. League rule v6:
  // substitutes score on the SUB'S handicap (from their Starting Average);
  // rostered/absent use the scheduled bowler's handicap. When a substitute
  // Starting Average is blank/invalid the preview shows 0 (pending) rather
  // than silently falling back to the scheduled handicap — validation
  // blocks saving in that state.
  const effHandicapA = currentMatch
    ? effectiveHandicapForUi({
        status: draft.sideA.status,
        scheduledEntryAverage: currentMatch.bowlerA.entryAverage,
        subStartAvgRaw: draft.sideA.subStartAvg,
      })
    : 0;
  const effHandicapB = currentMatch
    ? effectiveHandicapForUi({
        status: draft.sideB.status,
        scheduledEntryAverage: currentMatch.bowlerB.entryAverage,
        subStartAvgRaw: draft.sideB.subStartAvg,
      })
    : 0;

  const derivedA = useMemo(
    () => computeSideDerived(draft.sideA.linescore, effHandicapA),
    [draft.sideA.linescore, effHandicapA],
  );
  const derivedB = useMemo(
    () => computeSideDerived(draft.sideB.linescore, effHandicapB),
    [draft.sideB.linescore, effHandicapB],
  );

  const parseAbsentScores = (
    s: SideDraft,
  ): { ok: true; scores: [number, number, number] } | { ok: false; error: string } => {
    const nums: number[] = [];
    for (let i = 0; i < 3; i++) {
      const raw = s.absentScores[i].trim();
      if (raw === "") return { ok: false, error: "enter three scratch scores (0–300)" };
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 300) {
        return { ok: false, error: `Game ${i + 1} score must be an integer 0–300` };
      }
      nums.push(n);
    }
    return { ok: true, scores: [nums[0], nums[1], nums[2]] };
  };

  const validation = useMemo(() => {
    const errors: string[] = [];
    for (const [label, s, d] of [
      ["A", draft.sideA, derivedA],
      ["B", draft.sideB, derivedB],
    ] as const) {
      if (s.status === "substitute") {
        if (!s.subId) {
          errors.push(`Side ${label}: pick a substitute from the pool (walk-on names are not allowed)`);
        }
        const avg = Number(s.subStartAvg);
        if (!s.subStartAvg.trim() || !Number.isFinite(avg) || avg <= 0 || avg > 300) {
          errors.push(`Side ${label}: substitute Starting Average required (1–300)`);
        }
      }

      if (s.status === "absent") {
        const parsed = parseAbsentScores(s);
        if (!parsed.ok) errors.push(`Side ${label}: ${parsed.error}`);
      } else if (!d.valid) {
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
      const buildAbsentScores = (s: SideDraft): [number, number, number] | undefined => {
        if (s.status !== "absent") return undefined;
        const parsed = parseAbsentScores(s);
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.scores;
      };
      return save({
        data: {
          slotId: currentMatch.id,
          sideA: {
            status: draft.sideA.status,
            // Substitutes MUST be picked from the season pool — the
            // server rejects a substitute participation with no id.
            substituteId: draft.sideA.status === "substitute"
              ? (draft.sideA.subId || undefined) : undefined,
            substituteStartingAverage: draft.sideA.status === "substitute"
              ? subStartAvgOrUndef(draft.sideA.subStartAvg) : undefined,
            games: buildGames(draft.sideA, derivedA) as never,
            absentScores: buildAbsentScores(draft.sideA),
          },
          sideB: {
            status: draft.sideB.status,
            substituteId: draft.sideB.status === "substitute"
              ? (draft.sideB.subId || undefined) : undefined,
            substituteStartingAverage: draft.sideB.status === "substitute"
              ? subStartAvgOrUndef(draft.sideB.subStartAvg) : undefined,
            games: buildGames(draft.sideB, derivedB) as never,
            absentScores: buildAbsentScores(draft.sideB),
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

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!currentMatch) throw new Error("No match selected");
      return del({ data: { slotId: currentMatch.id } });
    },
    onSuccess: () => {
      setFlash("Saved result deleted. Standings and leaderboards updated.");
      setDraft(emptyDraft());
      qc.invalidateQueries({ queryKey: ["admin", "schedule"] });
      qc.invalidateQueries({ queryKey: SNAPSHOT_QUERY_KEY });
    },
    onError: (e: Error) => setFlash("Delete failed: " + e.message),
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
        {isEditingSaved && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                data-testid="delete-result"
                disabled={deleteMutation.isPending}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border-2 px-3 py-2 text-xs font-semibold",
                  "border-destructive/70 text-destructive hover:bg-destructive/10",
                  deleteMutation.isPending && "cursor-not-allowed opacity-60",
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleteMutation.isPending ? "Deleting…" : "Delete saved result"}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent data-testid="delete-result-confirm">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete saved result?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove the saved result for{" "}
                  <span className="font-semibold">
                    {currentMatch?.bowlerA.name} vs {currentMatch?.bowlerB.name}
                  </span>{" "}
                  (Week {currentMatch?.week}, Lanes {currentMatch?.lanePair}, Slot {currentMatch?.slot}).
                  The scheduled matchup remains; you can re-enter the result later.
                  Standings, leaderboards, and the public snapshot will be recomputed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  data-testid="delete-result-confirm-btn"
                  onClick={() => deleteMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete result
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

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
  // status === "absent" branches to a numeric-scores editor below.
  return (
    <Card className="bg-card" data-testid={testId}>
      <CardContent className="p-4">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-xs uppercase tracking-widest text-muted-foreground">
          <span>{label}</span>
          {side.status === "substitute" && (
            <span className="normal-case tracking-normal text-[10px] text-muted-foreground">
              Match hcp <b className="text-foreground">{scheduledHandicap}</b>
              {" "}(scheduled bowler's — league rule)
            </span>
          )}
          {side.status === "absent" && (
            <span className="normal-case tracking-normal text-[10px] text-muted-foreground">
              Absent hcp <b className="text-foreground">{scheduledHandicap}</b>
              {" "}(scheduled bowler's)
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
          <div className="mb-3 grid gap-2 sm:grid-cols-[2fr_140px]">
            <div>
              <Label className="text-[10px]">Pick from pool</Label>
              <Select
                value={side.subId || undefined}
                onValueChange={(v) => {
                  const found = subs.find((s) => s.id === v);
                  onChange({
                    subId: v,
                    subName: found?.name ?? "",
                    // Prefill the sub's stored starting average — admin
                    // can still override for this specific match.
                    subStartAvg: found?.starting_average != null
                      ? String(found.starting_average)
                      : side.subStartAvg,
                  });
                }}
              >
                <SelectTrigger data-testid={`${testId}-sub-select`}>
                  <SelectValue placeholder="Choose sub…" />
                </SelectTrigger>
                <SelectContent>
                  {subs.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.bowler_number ? ` (ID ${s.bowler_number})` : ""}
                      {s.starting_average != null ? ` · avg ${s.starting_average}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Substitutes must be added first via Manage Bowlers (ID Number required). Walk-on names are not allowed.
                Match handicap always uses the SCHEDULED bowler's handicap — the sub's own is informational only.
              </p>
            </div>
            <div>
              <Label className="text-[10px]">Starting Average (informational)</Label>
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

        {side.status === "absent" ? (
          <div className="rounded-md border border-dashed border-gold/50 bg-gold/5 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              Absent scratch scores — three numeric game scores. Feed handicap totals for match/standings pinfall using the scheduled bowler's handicap. Do NOT count toward any personal statistic.
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <Label className="text-[10px]">Game {i + 1}</Label>
                  <Input
                    data-testid={`${testId}-absent-g${i + 1}`}
                    type="number"
                    inputMode="numeric"
                    min={0} max={300} step={1}
                    value={side.absentScores[i]}
                    onChange={(e) => {
                      const next: [string, string, string] = [
                        side.absentScores[0], side.absentScores[1], side.absentScores[2],
                      ];
                      next[i] = e.target.value.replace(/[^0-9]/g, "");
                      onChange({ absentScores: next });
                    }}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Match handicap per game = <b className="text-foreground">{handicap}</b>. Handicap set = scratch set + {handicap} × 3.
            </p>
          </div>
        ) : (
          <SideLinescoreEditor
            label="Linescore"
            handicap={handicap}
            disabled={false}
            state={side.linescore}
            onChange={(next) => onChange({ linescore: next })}
            testPrefix={testId}
          />
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
