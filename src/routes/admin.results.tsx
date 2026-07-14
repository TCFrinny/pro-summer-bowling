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
  subName: string;
  games: [string, string, string]; // scratch totals as strings
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
  subName: "",
  games: ["", "", ""],
};

function AdminResultsPage() {
  const [week, setWeek] = useState(1);
  const matches = useMemo(() => getMatchesForWeek(week), [week]);
  const [matchId, setMatchId] = useState(matches[0]?.id ?? "");
  const currentMatch = matches.find((m) => m.id === matchId) ?? matches[0];

  const [draft, setDraft] = useState<Draft>({
    sideA: { ...EMPTY_SIDE },
    sideB: { ...EMPTY_SIDE },
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

  const validation = useMemo(() => {
    const errors: string[] = [];
    for (const [label, s] of [["A", draft.sideA], ["B", draft.sideB]] as const) {
      if (s.status === "substitute" && !s.subName.trim())
        errors.push(`Side ${label}: substitute name required`);
      if (s.status !== "absent") {
        for (let i = 0; i < 3; i++) {
          const n = Number(s.games[i]);
          if (!Number.isInteger(n) || n < 0 || n > 300)
            errors.push(`Side ${label} game ${i + 1}: invalid scratch total`);
        }
      }
    }
    if (draft.overrideEnabled) {
      const a = Number(draft.overrideA);
      const b = Number(draft.overrideB);
      const check = validatePointsOverride({
        enabled: true, pointsA: a, pointsB: b, reason: draft.overrideReason,
      });
      if (!check.ok) errors.push(`Override: ${check.error}`);
    }
    return errors;
  }, [draft]);

  const previewNormal = useMemo(() => {
    if (draft.sideA.status === "absent" || draft.sideB.status === "absent") return null;
    const ga = draft.sideA.games.map(Number);
    const gb = draft.sideB.games.map(Number);
    if (ga.some((n) => !Number.isFinite(n)) || gb.some((n) => !Number.isFinite(n))) return null;
    let ptsA = 0, ptsB = 0;
    for (let i = 0; i < 3; i++) {
      if (ga[i] > gb[i]) ptsA += 2;
      else if (gb[i] > ga[i]) ptsB += 2;
      else { ptsA += 1; ptsB += 1; }
    }
    const setA = ga.reduce((s, x) => s + x, 0);
    const setB = gb.reduce((s, x) => s + x, 0);
    if (setA > setB) ptsA += 1;
    else if (setB > setA) ptsB += 1;
    else { ptsA += 0.5; ptsB += 0.5; }
    return { ptsA, ptsB };
  }, [draft]);

  if (!currentMatch) {
    return (
      <AppShell>
        <PageHeader title="Weekly Result Entry" subtitle="Admin · Phase 1 (mock)" />
        <p className="text-sm text-muted-foreground">No matches scheduled for this week.</p>
      </AppShell>
    );
  }

  const a = getBowler(currentMatch.bowlerA);
  const b = getBowler(currentMatch.bowlerB);

  return (
    <AppShell>
      <PageHeader
        subtitle="Admin · Phase 1 (mock)"
        title="Weekly Result Entry"
        subtitle="Enter participation, scratch totals, and any manual W-L override for each scheduled matchup."
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
          side={draft.sideA}
          onChange={(patch) => setSide("A", patch)}
        />
        <SidePanel
          label={`Side B — ${b?.name ?? currentMatch.bowlerB}`}
          side={draft.sideB}
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
          onClick={() => setFlash("Result saved to local mock state.")}
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
  side,
  onChange,
}: {
  label: string;
  side: SideDraft;
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
          <div className="mb-3">
            <Label>Substitute name</Label>
            <Input
              value={side.subName}
              onChange={(e) => onChange({ subName: e.target.value })}
              placeholder="Required"
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Game {i + 1} scratch
              </Label>
              <Input
                disabled={disabled}
                inputMode="numeric"
                value={side.games[i]}
                onChange={(e) => {
                  const games = [...side.games] as [string, string, string];
                  games[i] = e.target.value;
                  onChange({ games });
                }}
              />
            </div>
          ))}
        </div>

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
