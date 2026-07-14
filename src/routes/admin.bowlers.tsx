import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Archive, Plus, RotateCcw } from "lucide-react";
import {
  addRosteredBowler,
  addSubstitute,
  archiveRosteredBowler,
  archiveSubstitute,
  isDuplicateActiveRosterName,
  isDuplicateActiveSubName,
  resetToDemoData,
  updateRosteredBowler,
  updateSubstitute,
  useLeagueState,
} from "@/lib/league-store";
import { computeHandicap } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/bowlers")({
  head: () => ({
    meta: [
      { title: "Admin — Bowlers & Substitutes" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminBowlersPage,
});

function AdminBowlersPage() {
  const state = useLeagueState();
  const [tab, setTab] = useState<"rostered" | "subs">("rostered");
  const [newRosterName, setNewRosterName] = useState("");
  const [newRosterAvg, setNewRosterAvg] = useState("140");
  const [newSubName, setNewSubName] = useState("");

  const activeRosterCount = state.rostered.filter((b) => b.active && !b.archived).length;
  const activeSubCount = state.subs.filter((s) => s.active && !s.archived).length;

  return (
    <AppShell>
      <PageHeader
        title="Admin · Bowlers & Substitutes"
        subtitle="Mock-only Phase 1. Archived people remain visible in historical results but are hidden from future scheduling and sub pickers."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border bg-background/40 p-1 text-xs">
          {(["rostered", "subs"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded px-3 py-1.5 capitalize",
                tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent/40",
              )}
            >
              {t === "rostered" ? `Rostered (${activeRosterCount}/36)` : `Substitute Pool (${activeSubCount})`}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            if (window.confirm("Reset all Phase 1 mock roster/sub data back to the seeded demo?")) {
              resetToDemoData();
            }
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-accent/40 px-3 py-2 text-xs hover:bg-accent"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
        </button>
      </div>

      {tab === "rostered" && activeRosterCount !== 36 && (
        <Card className="mb-3 border-gold/40 bg-gold/5">
          <CardContent className="p-3 text-xs">
            <AlertTriangle className="mr-1 inline h-4 w-4 text-gold" />
            Active roster is <strong>{activeRosterCount}</strong>. The league expects 36 active
            rostered bowlers to fill 18 weekly matches.
          </CardContent>
        </Card>
      )}

      {tab === "rostered" ? (
        <>
          <Card className="mb-3 bg-card">
            <CardContent className="p-3">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                Add rostered bowler
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_140px_120px_auto]">
                <div>
                  <Label className="text-[10px]">Name</Label>
                  <Input
                    value={newRosterName}
                    onChange={(e) => setNewRosterName(e.target.value)}
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Entry avg</Label>
                  <Input
                    inputMode="numeric"
                    value={newRosterAvg}
                    onChange={(e) => setNewRosterAvg(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Handicap</Label>
                  <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm font-mono">
                    {computeHandicap(Number(newRosterAvg || 0))}
                  </div>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => {
                      const name = newRosterName.trim();
                      const avg = Number(newRosterAvg);
                      if (!name || !Number.isFinite(avg)) return;
                      if (isDuplicateActiveRosterName(name)) {
                        if (!window.confirm(`"${name}" already exists in the active roster. Add anyway?`)) return;
                      }
                      addRosteredBowler(name, avg);
                      setNewRosterName("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4" /> Add
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-2">
            {state.rostered.map((b) => (
              <RosterRow key={b.id} record={b} />
            ))}
          </div>
        </>
      ) : (
        <>
          <Card className="mb-3 bg-card">
            <CardContent className="p-3">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                Add substitute
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  placeholder="Substitute display name"
                />
                <button
                  onClick={() => {
                    const name = newSubName.trim();
                    if (!name) return;
                    if (isDuplicateActiveSubName(name)) {
                      if (!window.confirm(`Substitute "${name}" already active. Add anyway?`)) return;
                    }
                    addSubstitute(name);
                    setNewSubName("");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-2">
            {state.subs.map((s) => (
              <SubRow key={s.id} record={s} />
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}

function RosterRow({ record }: { record: ReturnType<typeof useLeagueState>["rostered"][number] }) {
  const [name, setName] = useState(record.name);
  const [avg, setAvg] = useState(String(record.entryAverage));
  const dirty = name !== record.name || Number(avg) !== record.entryAverage;
  return (
    <Card className={cn("bg-card", record.archived && "opacity-60")}>
      <CardContent className="grid grid-cols-[1fr_120px_100px_auto_auto] items-center gap-2 p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
        <Input
          value={avg}
          inputMode="numeric"
          onChange={(e) => setAvg(e.target.value.replace(/[^0-9]/g, ""))}
          className="h-8 font-mono"
        />
        <div className="text-xs text-muted-foreground">
          hcp <span className="font-mono text-foreground">{computeHandicap(Number(avg || 0))}</span>
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={record.active}
            onChange={(e) => updateRosteredBowler(record.id, { active: e.target.checked })}
          />
          Active
        </label>
        <div className="flex items-center gap-1">
          <button
            disabled={!dirty}
            onClick={() => updateRosteredBowler(record.id, { name, entryAverage: Number(avg) })}
            className={cn(
              "rounded-md px-2 py-1 text-xs",
              dirty ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground",
            )}
          >
            Save
          </button>
          <button
            title="Archive (preserves history)"
            onClick={() => {
              if (window.confirm(`Archive ${record.name}? History is preserved; future selectors will hide them.`))
                archiveRosteredBowler(record.id);
            }}
            className="rounded-md border border-border p-1 hover:bg-accent/40"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function SubRow({ record }: { record: ReturnType<typeof useLeagueState>["subs"][number] }) {
  const [name, setName] = useState(record.name);
  const dirty = name !== record.name;
  return (
    <Card className={cn("bg-card", record.archived && "opacity-60")}>
      <CardContent className="grid grid-cols-[1fr_auto_auto] items-center gap-2 p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={record.active}
            onChange={(e) => updateSubstitute(record.id, { active: e.target.checked })}
          />
          Active
        </label>
        <div className="flex items-center gap-1">
          <button
            disabled={!dirty}
            onClick={() => updateSubstitute(record.id, { name })}
            className={cn(
              "rounded-md px-2 py-1 text-xs",
              dirty ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground",
            )}
          >
            Save
          </button>
          <button
            title="Archive"
            onClick={() => {
              if (window.confirm(`Archive substitute "${record.name}"?`))
                archiveSubstitute(record.id);
            }}
            className="rounded-md border border-border p-1 hover:bg-accent/40"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
