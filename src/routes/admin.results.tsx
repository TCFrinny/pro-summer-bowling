import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  WEEKS,
  formatPoints,
  getBowler,
  getMatchesForWeek,
  validatePointsOverride,
  type BowlerId,
  type Match,
  type ParticipationStatus,
} from "@/lib/mock-data";
import {
  recordSavedResult,
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
import { AlertTriangle, CheckCircle2, Save } from "lucide-react";
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

const EMPTY_SIDE: SideDraft = {
  status: "rostered",
  subId: "",
  subName: "",
  linescore: emptySideEditorState(),
};

function AdminResultsPage() {
  const league = useLeagueState();
  const activeSubs = selectActiveSubs(league);
  // Roster available for reference (e.g. showing archived flags on
  // scheduled bowlers). We don't currently swap scheduled bowlers here.
  void selectActiveRoster(league);

  const [week, setWeek] = useState(1);
  const matches = useMemo(() => getMatchesForWeek(week), [week]);
  const [matchId, setMatchId] = useState(matches[0]?.id ?? "");
  const currentMatch = matches.find((m) => m.id === matchId) ?? matches[0];

  const [draft, setDraft] = useState<Draft>({
    sideA: { ...EMPTY_SIDE, linescore: emptySideEditorState() },
    sideB: { ...EMPTY_SIDE, linescore: emptySideEditorState() },
    overrideEnabled: false,
    overrideA: "0",
    overrideB: "0",
    overrideReason: "",
  });
  const [flash, setFlash] = useState<string | null>(null);

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

  // Frame-derived W-L preview when both sides bowled.
  const previewNormal = useMemo(() => {
    if (
      draft.sideA.status === "absent" ||
      draft.sideB.status === "absent" ||
      !derivedA.valid || !derivedB.valid ||
      !derivedA.games.every(Boolean) || !derivedB.games.every(Boolean)
    ) return null;
    let ptsA = 0, ptsB = 0;
    for (let i = 0; i < 3; i++) {
      const ga = derivedA.games[i]!.scratchTotal;
      const gb = derivedB.games[i]!.scratchTotal;
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
  }, [draft.sideA.status, draft.sideB.status, derivedA, derivedB]);

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
        subtitle="Enter frame-by-frame linescores. W-L points derive from the totals unless a manual override is applied."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[160px_1fr]">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Week</div>
          <Select value={String(week)} onValueChange={(v) => changeWeek(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
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
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {matches.map((m) => {
                const ba = getBowler(m.bowlerA)?.name ?? m.bowlerA;
                const bb = getBowler(m.bowlerB)?.name ?? m.bowlerB;
                return (
                  <SelectItem key={m.id} value={m.id}>
                    Lanes {m.lanePair} · Slot {m.slot} — {ba} vs {bb}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SidePanel
          label={`Side A — ${a?.name ?? currentMatch.bowlerA}`}
          handicap={a?.handicap ?? 0}
          side={draft.sideA}
          subs={activeSubs}
          onChange={(patch) => setSide("A", patch)}
        />
        <SidePanel
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
            <div className="mt-1 font-display text-lg text-gold">
              {formatPoints(previewNormal.ptsA)} – {formatPoints(previewNormal.ptsB)}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className={cn("mt-4", eitherAbsent && "border-gold/60 bg-gold/5")}>
        <CardContent className="p-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={draft.overrideEnabled}
              onChange={(e) => setDraft((d) => ({ ...d, overrideEnabled: e.target.checked }))}
            />
            Manual Points Override
          </label>
          {eitherAbsent && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gold">
              <AlertTriangle className="h-3.5 w-3.5" />
              One side is absent — confirm or set a manual override before saving.
            </div>
          )}
          {draft.overrideEnabled && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <NumberInput
                label="Side A awarded (0–7, step 0.5)"
                value={draft.overrideA}
                onChange={(v) => setDraft((d) => ({ ...d, overrideA: v }))}
              />
              <NumberInput
                label="Side B awarded (0–7, step 0.5)"
                value={draft.overrideB}
                onChange={(v) => setDraft((d) => ({ ...d, overrideB: v }))}
              />
              <div>
                <Label>Reason (required)</Label>
                <Input
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
          <CardContent className="p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-destructive">
              <AlertTriangle className="h-4 w-4" /> Validation ({validation.length})
            </div>
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {validation.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          disabled={validation.length > 0}
          onClick={() => {
            recordSavedResult(currentMatch.id, `Saved by admin at ${new Date().toISOString()}`);
            setFlash("Result draft saved to local mock store. Public snapshot regeneration is a Phase 2 task.");
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold",
            validation.length > 0
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          <Save className="h-4 w-4" /> Save result (mock)
        </button>
        {flash && (
          <span className="inline-flex items-center gap-1.5 text-xs text-primary">
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
}: {
  label: string;
  handicap: number;
  side: SideDraft;
  subs: { id: string; name: string }[];
  onChange: (patch: Partial<SideDraft>) => void;
}) {
  const disabled = side.status === "absent";
  return (
    <Card className="bg-card">
      <CardContent className="p-4">
        <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        <div className="mb-3 grid grid-cols-3 gap-1 text-xs">
          {(["rostered", "substitute", "absent"] as const).map((s) => (
            <button
              key={s}
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
                <SelectTrigger><SelectValue placeholder="Choose sub…" /></SelectTrigger>
                <SelectContent>
                  {subs.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Or type a name</Label>
              <Input
                value={side.subName}
                onChange={(e) => onChange({ subId: "", subName: e.target.value })}
                placeholder="Walk-on substitute"
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
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
