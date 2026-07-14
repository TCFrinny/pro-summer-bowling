import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  WEEKS,
  formatPoints,
  getBowler,
  getMatchesForWeek,
  validatePointsOverride,
  type BowlerId,
  type Match,
  type MatchResult,
  type ParticipationStatus,
} from "@/lib/mock-data";
import {
  addSubstitute,
  applyResult,
  getSavedResult,
  selectActiveRoster,
  selectActiveSubs,
  useLeagueState,
} from "@/lib/league-store";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  /** Sub id when status="substitute" and picked from pool. Empty string
   *  means the admin is typing a free-form name in `subName`. */
  subId: string;
  subName: string;
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
    subId: "",
    subName: "",
    linescore: emptySideEditorState(),
  };
}
function emptyDraft(): Draft {
  return {
    sideA: emptySide(),
    sideB: emptySide(),
    overrideEnabled: false,
    overrideA: "0",
    overrideB: "0",
    overrideReason: "",
  };
}

/** Hydrate the admin editor draft from a saved MatchResult. Round-trips
 *  saved frame marks and cumulative totals back into the editor grid so
 *  the admin sees exactly what was previously saved. */
function draftFromResult(r: MatchResult): Draft {
  const sideFromResult = (
    isA: boolean,
  ): SideDraft => {
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
    return {
      status: p.status,
      subId: isSub && p.actualId ? p.actualId : "",
      subName: isSub && !p.actualId ? p.actualName : "",
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

function AdminResultsPage() {
  const league = useLeagueState();
  const activeSubs = selectActiveSubs(league);
  void selectActiveRoster(league);

  const [week, setWeek] = useState(1);
  const matches = useMemo(() => getMatchesForWeek(week), [week, league.version]);
  const [matchId, setMatchId] = useState(matches[0]?.id ?? "");
  const currentMatch = matches.find((m) => m.id === matchId) ?? matches[0];

  const savedResult = currentMatch?.result;
  const isEditingSaved = !!savedResult;

  const [draft, setDraft] = useState<Draft>(() =>
    savedResult ? draftFromResult(savedResult) : emptyDraft(),
  );
  const [flash, setFlash] = useState<string | null>(null);

  // Re-hydrate the draft ONLY when the selected match id changes. Do not
  // depend on `savedResult` — that reference can churn on any store tick
  // and would clobber in-progress edits (e.g. toggling the override).
  useEffect(() => {
    const m = getMatchesForWeek(week).find((mm) => mm.id === matchId);
    setDraft(m?.result ? draftFromResult(m.result) : emptyDraft());
    setFlash(null);
     
  }, [matchId, week]);

  const changeWeek = (w: number) => {
    setWeek(w);
    const next = getMatchesForWeek(w);
    setMatchId(next[0]?.id ?? "");
  };

  const setSide = (side: "A" | "B", patch: Partial<SideDraft>) => {
    setDraft((d) => ({
      ...d,
      [side === "A" ? "sideA" : "sideB"]: { ...d[side === "A" ? "sideA" : "sideB"], ...patch },
    }));
  };

  const eitherAbsent =
    draft.sideA.status === "absent" || draft.sideB.status === "absent";

  const a = currentMatch ? getBowler(currentMatch.bowlerA) : undefined;
  const b = currentMatch ? getBowler(currentMatch.bowlerB) : undefined;

  const derivedA = useMemo(
    () => computeSideDerived(draft.sideA.linescore, a?.handicap ?? 0),
    [draft.sideA.linescore, a?.handicap],
  );
  const derivedB = useMemo(
    () => computeSideDerived(draft.sideB.linescore, b?.handicap ?? 0),
    [draft.sideB.linescore, b?.handicap],
  );

  const validation = useMemo(() => {
    const errors: string[] = [];
    for (const [label, s, d] of [
      ["A", draft.sideA, derivedA],
      ["B", draft.sideB, derivedB],
    ] as const) {
      if (s.status === "substitute" && !s.subId && !s.subName.trim()) {
        errors.push(`Side ${label}: pick a substitute or type a name`);
      }
      if (s.status !== "absent" && !d.valid) {
        errors.push(`Side ${label}: linescore incomplete or invalid`);
      }
    }
    const anyAbsent = draft.sideA.status === "absent" || draft.sideB.status === "absent";
    if (anyAbsent && !draft.overrideEnabled) {
      errors.push("An absent side requires a manual points override with a reason.");
    }
    if (draft.overrideEnabled) {
      const oa = Number(draft.overrideA);
      const ob = Number(draft.overrideB);
      const check = validatePointsOverride({
        enabled: true, pointsA: oa, pointsB: ob, reason: draft.overrideReason,
      });
      if (!check.ok) errors.push(`Override: ${check.error}`);
    }
    return errors;
  }, [draft, derivedA, derivedB]);

  const previewNormal = useMemo(() => {
    if (
      draft.sideA.status === "absent" ||
      draft.sideB.status === "absent" ||
      !derivedA.valid || !derivedB.valid ||
      !derivedA.games.every(Boolean) || !derivedB.games.every(Boolean)
    ) return null;
    let ptsA = 0, ptsB = 0;
    for (let i = 0; i < 3; i++) {
      const ga = (derivedA.games[i]!.scratchTotal) + (a?.handicap ?? 0);
      const gb = (derivedB.games[i]!.scratchTotal) + (b?.handicap ?? 0);
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
  }, [draft.sideA.status, draft.sideB.status, derivedA, derivedB, a?.handicap, b?.handicap]);

  const handleReset = () => {
    setDraft(savedResult ? draftFromResult(savedResult) : emptyDraft());
    setFlash(null);
  };

  const handleSave = () => {
    const buildSideGames = (s: SideDraft, d: typeof derivedA) => {
      if (s.status === "absent") return undefined;
      const g = d.games;
      if (!g[0] || !g[1] || !g[2]) return undefined;
      return [g[0], g[1], g[2]] as [
        NonNullable<(typeof g)[number]>, NonNullable<(typeof g)[number]>, NonNullable<(typeof g)[number]>,
      ];
    };
    if (!currentMatch) return;
    const outcome = applyResult({
      matchId: currentMatch.id,
      sideA: {
        status: draft.sideA.status,
        substituteId: draft.sideA.subId || undefined,
        substituteName: draft.sideA.subName.trim() || undefined,
        games: buildSideGames(draft.sideA, derivedA),
      },
      sideB: {
        status: draft.sideB.status,
        substituteId: draft.sideB.subId || undefined,
        substituteName: draft.sideB.subName.trim() || undefined,
        games: buildSideGames(draft.sideB, derivedB),
      },
      override: draft.overrideEnabled ? {
        enabled: true,
        pointsA: Number(draft.overrideA),
        pointsB: Number(draft.overrideB),
        reason: draft.overrideReason,
      } : null,
    });
    if (outcome.ok) {
      // Re-hydrate directly from the freshly saved result so the editor
      // still shows the saved values (never a blank form after Save).
      const saved = getSavedResult(outcome.matchId);
      if (saved) setDraft(draftFromResult(saved));
      setFlash("Result saved. Standings, weekly results, profiles, and boards now reflect this match.");
    } else {
      setFlash("Save failed: " + outcome.errors.join("; "));
    }
  };

  if (!currentMatch) {
    return (
      <AppShell>
        <PageHeader title="Weekly Result Entry" subtitle="Admin · Phase 1 (mock)" />
        <p className="text-sm text-muted-foreground">No matches scheduled for this week.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Admin · Weekly Result Entry"
        subtitle="Enter frame-by-frame linescores. W-L points derive from handicap totals unless a manual override is applied."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[160px_1fr]" data-testid="admin-results-toolbar">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Week</div>
          <Select value={String(week)} onValueChange={(v) => changeWeek(Number(v))}>
            <SelectTrigger data-testid="week-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WEEKS.map((w) => (
                <SelectItem key={w.week} value={String(w.week)}>Week {w.week}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Matchup</div>
          <Select value={matchId} onValueChange={setMatchId}>
            <SelectTrigger data-testid="match-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {matches.map((m) => {
                const ba = getBowler(m.bowlerA)?.name ?? m.bowlerA;
                const bb = getBowler(m.bowlerB)?.name ?? m.bowlerB;
                const done = m.result ? " ✓" : "";
                return (
                  <SelectItem key={m.id} value={m.id}>
                    Lanes {m.lanePair} · Slot {m.slot} — {ba} vs {bb}{done}
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
          <span className="font-semibold uppercase tracking-widest">
            Editing saved result
          </span>
          <span className="text-muted-foreground">
            — re-saving replaces the existing match record (no double-count).
          </span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2" data-testid="admin-results-sides">
        <SidePanel
          testId="side-A"
          label={`Side A — ${a?.name ?? currentMatch.bowlerA}`}
          handicap={a?.handicap ?? 0}
          side={draft.sideA}
          subs={activeSubs}
          onChange={(patch) => setSide("A", patch)}
        />
        <SidePanel
          testId="side-B"
          label={`Side B — ${b?.name ?? currentMatch.bowlerB}`}
          handicap={b?.handicap ?? 0}
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
            Combined awarded points must be ≤ 7 in 0.5-point increments. Any
            unawarded remainder is NOT auto-distributed.
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
          disabled={validation.length > 0}
          onClick={handleSave}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold",
            validation.length > 0
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          <Save className="h-4 w-4" /> Save result
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
    </AppShell>
  );
}

function SidePanel({
  label,
  handicap,
  side,
  subs,
  onChange,
  testId,
}: {
  label: string;
  handicap: number;
  side: SideDraft;
  subs: { id: string; name: string }[];
  onChange: (patch: Partial<SideDraft>) => void;
  testId?: string;
}) {
  const disabled = side.status === "absent";
  return (
    <Card className="bg-card" data-testid={testId}>
      <CardContent className="p-4">
        <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          {label}
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
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-[10px]">Pick from pool</Label>
              <Select
                value={side.subId || undefined}
                onValueChange={(v) => {
                  const found = subs.find((s) => s.id === v);
                  onChange({ subId: v, subName: found?.name ?? side.subName });
                }}
              >
                <SelectTrigger data-testid={`${testId}-sub-select`}>
                  <SelectValue placeholder="Choose sub…" />
                </SelectTrigger>
                <SelectContent>
                  {subs.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Or type a name</Label>
              <div className="flex gap-1">
                <Input
                  data-testid={`${testId}-sub-name`}
                  value={side.subName}
                  onChange={(e) => onChange({ subId: "", subName: e.target.value })}
                  placeholder="Walk-on substitute"
                />
                <button
                  type="button"
                  disabled={!side.subName.trim()}
                  onClick={() => {
                    const nm = side.subName.trim();
                    if (!nm) return;
                    try {
                      const rec = addSubstitute(nm);
                      onChange({ subId: rec.id, subName: rec.name });
                    } catch (e) { window.alert((e as Error).message); }
                  }}
                  className={cn(
                    "shrink-0 rounded-md px-2 text-xs font-semibold",
                    side.subName.trim()
                      ? "bg-gold text-gold-foreground hover:bg-gold/90"
                      : "bg-muted text-muted-foreground",
                  )}
                  title="Add this person to the substitute pool"
                >
                  + Pool
                </button>
              </div>
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
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        data-testid={testId}
        type="number"
        min={0}
        max={7}
        step={0.5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// Ensure symbol imports referenced.
export type _AdminResultsMatchRef = Match | BowlerId;
