import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  BOWLERS,
  LANE_PAIRS,
  WEEKS,
  getMatchesForWeek,
  type BowlerId,
  type LanePair,
  type Match,
} from "@/lib/mock-data";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Save, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

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
  bowlerA: BowlerId | "";
  bowlerB: BowlerId | "";
}

function loadDraftForWeek(week: number): DraftSlot[] {
  const existing = getMatchesForWeek(week);
  const rows: DraftSlot[] = [];
  for (const lp of LANE_PAIRS) {
    for (let slot = 1; slot <= 3; slot++) {
      const m = existing.find((x) => x.lanePair === lp && x.slot === slot);
      rows.push({
        lanePair: lp,
        slot,
        bowlerA: m?.bowlerA ?? "",
        bowlerB: m?.bowlerB ?? "",
      });
    }
  }
  return rows;
}

function AdminSchedulePage() {
  const [week, setWeek] = useState<number>(1);
  const [draft, setDraft] = useState<DraftSlot[]>(() => loadDraftForWeek(1));
  const [flash, setFlash] = useState<string | null>(null);

  const priorPairKeys = useMemo(() => {
    const set = new Set<string>();
    for (const w of WEEKS) {
      if (w.week >= week) continue;
      for (const m of getMatchesForWeek(w.week)) {
        set.add(pairKey(m.bowlerA, m.bowlerB));
      }
    }
    return set;
  }, [week]);

  const usedBowlers = useMemo(() => {
    const counts = new Map<BowlerId, number>();
    for (const r of draft) {
      if (r.bowlerA) counts.set(r.bowlerA, (counts.get(r.bowlerA) ?? 0) + 1);
      if (r.bowlerB) counts.set(r.bowlerB, (counts.get(r.bowlerB) ?? 0) + 1);
    }
    return counts;
  }, [draft]);

  const warnings = useMemo(() => {
    const w: string[] = [];
    let incomplete = 0;
    for (const r of draft) {
      if (!r.bowlerA || !r.bowlerB) incomplete++;
      if (r.bowlerA && r.bowlerA === r.bowlerB)
        w.push(`Lanes ${r.lanePair} slot ${r.slot}: bowler cannot face themself`);
    }
    if (incomplete > 0) w.push(`${incomplete} matchup(s) incomplete`);
    const dupes: string[] = [];
    for (const [id, c] of usedBowlers) {
      if (c > 1) dupes.push(`${id}×${c}`);
    }
    if (dupes.length) w.push(`Duplicate bowlers in week: ${dupes.join(", ")}`);
    for (const r of draft) {
      if (!r.bowlerA || !r.bowlerB) continue;
      if (priorPairKeys.has(pairKey(r.bowlerA, r.bowlerB))) {
        w.push(`Lanes ${r.lanePair} slot ${r.slot}: repeat matchup from an earlier week`);
      }
    }
    return w;
  }, [draft, usedBowlers, priorPairKeys]);

  const setSlot = (idx: number, patch: Partial<DraftSlot>) => {
    setDraft((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const changeWeek = (w: number) => {
    setWeek(w);
    setDraft(loadDraftForWeek(w));
    setFlash(null);
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin · Phase 1 (mock)"
        title="Manual Schedule Editor"
        description="Administrators set every week's schedule by hand. Warnings surface duplicates and repeat pairings but never rewrite your choices."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
            Week
          </div>
          <Select value={String(week)} onValueChange={(v) => changeWeek(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WEEKS.map((w) => (
                <SelectItem key={w.week} value={String(w.week)}>
                  Week {w.week}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setFlash("Draft saved to local mock state.")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-accent/40 px-3 py-2 text-sm hover:bg-accent"
          >
            <Save className="h-4 w-4" /> Save draft schedule
          </button>
          <button
            onClick={() => setFlash("Week published (mock). Nothing persisted.")}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <UploadCloud className="h-4 w-4" /> Publish week
          </button>
        </div>
      </div>

      {flash && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-accent/40 px-3 py-2 text-xs">
          <CheckCircle2 className="h-4 w-4 text-primary" /> {flash}
        </div>
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
                      />
                      <span className="text-xs text-muted-foreground">vs</span>
                      <BowlerSelect
                        value={r.bowlerB}
                        onChange={(v) => setSlot(idx, { bowlerB: v })}
                        invalid={Boolean(dupSelf || dupB)}
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

function BowlerSelect({
  value,
  onChange,
  invalid,
}: {
  value: BowlerId | "";
  onChange: (v: BowlerId | "") => void;
  invalid?: boolean;
}) {
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v as BowlerId)}>
      <SelectTrigger className={cn(invalid && "border-destructive")}>
        <SelectValue placeholder="Select bowler…" />
      </SelectTrigger>
      <SelectContent>
        {BOWLERS.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function pairKey(a: BowlerId, b: BowlerId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Silence unused-type warnings if any.
export type _AdminScheduleMatchRef = Match;
