import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Archive, Plus, Power, PowerOff, RefreshCw, Trash2, Undo2 } from "lucide-react";
import {
  addRosterBowler,
  addSubstitute,
  deleteRosterBowler,
  deleteSubstitute,
  listRosterAndSubs,
  setRosterActive,
  setRosterArchived,
  setSubstituteActive,
  setSubstituteArchived,
  updateRosterBowler,
  updateSubstitute,
} from "@/lib/league-repo.functions";
import {
  BOWLER_NUMBER_MAX_LEN,
  isDuplicateActive,
  ROSTER_MAX_ACTIVE,
  validateAverage,
  validateBowlerNumber,
  type RosteredRow,
  type SubRow,
} from "@/lib/roster-adapter";
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

const ROSTER_QUERY_KEY = ["admin", "roster-and-subs"] as const;

// Allow only digits and a single decimal point in average inputs. Preserves
// user-entered decimals (e.g. "145.75") without any silent Math.round().
function sanitizeAverageInput(raw: string): string {
  // Strip any character that is not a digit or dot, then keep only the first dot.
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}
function parseAverage(raw: string): number {
  return Number(raw);
}

function useRosterQuery() {
  const fetchRoster = useServerFn(listRosterAndSubs);
  return useQuery({
    queryKey: ROSTER_QUERY_KEY,
    queryFn: () => fetchRoster(),
    staleTime: 15_000,
  });
}

function useAfterMutation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
    qc.invalidateQueries({ queryKey: ["public-snapshot"] });
  };
}

function AdminBowlersPage() {
  const q = useRosterQuery();
  const [tab, setTab] = useState<"rostered" | "subs">("rostered");

  if (q.isPending) {
    return (
      <>
        <PageHeader title="Admin · Bowlers & Substitutes" subtitle="Loading roster…" />
        <Card className="bg-card"><CardContent className="p-4 text-sm text-muted-foreground">Loading…</CardContent></Card>
      </>
    );
  }
  if (q.isError) {
    return (
      <>
        <PageHeader title="Admin · Bowlers & Substitutes" subtitle="Failed to load roster." />
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            <AlertTriangle className="mr-1 inline h-4 w-4 text-destructive" />
            {(q.error as Error).message}
          </CardContent>
        </Card>
      </>
    );
  }

  const rostered = q.data.rostered;
  const subs = q.data.subs;
  const activeRosterCount = rostered.filter((r) => r.active && !r.archived).length;
  const activeSubCount = subs.filter((s) => s.active && !s.archived).length;

  return (
    <>
      <PageHeader
        title="Admin · Bowlers & Substitutes"
        subtitle="Live Supabase data. ID Number is required for every person and appears on schedules as `Name (ID …)`. Active = eligible for scheduling; Archived = preserved for history and hidden from future selection."
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
              {t === "rostered"
                ? `Rostered (${activeRosterCount}/${ROSTER_MAX_ACTIVE})`
                : `Substitute Pool (${activeSubCount} active)`}
            </button>
          ))}
        </div>
        {q.isFetching && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" /> syncing…
          </span>
        )}
      </div>

      {tab === "rostered" && activeRosterCount !== ROSTER_MAX_ACTIVE && (
        <Card className="mb-3 border-gold/40 bg-gold/5">
          <CardContent className="p-3 text-xs">
            <AlertTriangle className="mr-1 inline h-4 w-4 text-gold" />
            Active roster is <strong>{activeRosterCount}</strong>. The league expects{" "}
            {ROSTER_MAX_ACTIVE} active rostered bowlers to fill 18 weekly matches.
          </CardContent>
        </Card>
      )}

      {tab === "rostered" ? <RosterTab rostered={rostered} /> : <SubsTab subs={subs} />}
    </>
  );
}

// ------------------------- Rostered tab -------------------------

function RosterTab({ rostered }: { rostered: RosteredRow[] }) {
  const [name, setName] = useState("");
  const [avg, setAvg] = useState("140");
  const [idNum, setIdNum] = useState("");
  const invalidate = useAfterMutation();
  const addFn = useServerFn(addRosterBowler);
  const activeCount = rostered.filter((r) => r.active && !r.archived).length;
  const atCap = activeCount >= ROSTER_MAX_ACTIVE;
  const add = useMutation({
    mutationFn: (input: { name: string; entryAverage: number; bowlerNumber: string }) =>
      addFn({ data: input }),
    onSuccess: () => { invalidate(); setName(""); setIdNum(""); },
    onError: (e) => window.alert((e as Error).message),
  });

  const parsedAvg = parseAverage(avg);
  const hcpPreview = Number.isFinite(parsedAvg) ? computeHandicap(parsedAvg) : 0;

  return (
    <>
      <Card className="mb-3 bg-card">
        <CardContent className="p-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            Add rostered bowler
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_140px_140px_120px_auto]">
            <div>
              <Label className="text-[10px]">Name <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <Label className="text-[10px]">ID Number <span className="text-destructive">*</span></Label>
              <Input
                value={idNum}
                maxLength={BOWLER_NUMBER_MAX_LEN}
                onChange={(e) => setIdNum(e.target.value)}
                placeholder="required, 1–10"
              />
            </div>
            <div>
              <Label className="text-[10px]">Entry avg (0–300)</Label>
              <Input
                inputMode="decimal"
                value={avg}
                onChange={(e) => setAvg(sanitizeAverageInput(e.target.value))}
                placeholder="e.g. 145.75"
              />
            </div>
            <div>
              <Label className="text-[10px]">Handicap</Label>
              <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm font-mono">
                {hcpPreview}
              </div>
            </div>
            <div className="flex items-end">
              <button
                disabled={add.isPending || atCap}
                title={atCap ? `Active roster is full (${ROSTER_MAX_ACTIVE})` : undefined}
                onClick={() => {
                  const trimmed = name.trim();
                  const bn = idNum.trim();
                  if (!trimmed) return window.alert("Name is required.");
                  const eNum = validateBowlerNumber(bn);
                  if (eNum) return window.alert(eNum);
                  const n = parseAverage(avg);
                  const eAvg = validateAverage(n);
                  if (eAvg) return window.alert(eAvg);
                  if (isDuplicateActive(trimmed, rostered)) {
                    return window.alert(`"${trimmed}" is already on the active roster.`);
                  }
                  add.mutate({ name: trimmed, entryAverage: n, bowlerNumber: bn });
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" /> {add.isPending ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            ID Number is required — decimal averages are preserved (handicap ={" "}
            <span className="font-mono">max(0, floor(0.8 × (160 − avg)))</span>).
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-2">
        {rostered.map((r) => (
          <RosterRow key={r.id} record={r} rows={rostered} atActiveCap={atCap} />
        ))}
      </div>
    </>
  );
}

function RosterRow({
  record, rows, atActiveCap,
}: { record: RosteredRow; rows: RosteredRow[]; atActiveCap: boolean }) {
  const [name, setName] = useState(record.name);
  const [avg, setAvg] = useState(String(record.entry_average));
  const [idNum, setIdNum] = useState(record.bowler_number ?? "");
  const invalidate = useAfterMutation();
  const updateFn = useServerFn(updateRosterBowler);
  const activeFn = useServerFn(setRosterActive);
  const archiveFn = useServerFn(setRosterArchived);
  const deleteFn = useServerFn(deleteRosterBowler);

  const upd = useMutation({
    mutationFn: (input: { id: string; name: string; entryAverage: number; bowlerNumber: string }) =>
      updateFn({ data: input }),
    onSuccess: invalidate, onError: (e) => window.alert((e as Error).message),
  });
  const act = useMutation({
    mutationFn: (input: { id: string; active: boolean }) => activeFn({ data: input }),
    onSuccess: invalidate, onError: (e) => window.alert((e as Error).message),
  });
  const arch = useMutation({
    mutationFn: (input: { id: string; archived: boolean }) => archiveFn({ data: input }),
    onSuccess: () => { invalidate();
      // The server returns the row as INACTIVE after a restore — surface that.
    },
    onError: (e) => window.alert((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (input: { id: string }) => deleteFn({ data: input }),
    onSuccess: invalidate, onError: (e) => window.alert((e as Error).message),
  });

  const parsedAvg = parseAverage(avg);
  const dirty =
    name !== record.name ||
    !Number.isNaN(parsedAvg) && parsedAvg !== record.entry_average ||
    (idNum || "") !== (record.bowler_number ?? "");
  const legacyMissingId = !(record.bowler_number ?? "").trim();

  return (
    <Card className={cn("bg-card", record.archived && "opacity-60")}>
      <CardContent className="grid grid-cols-[80px_1fr_120px_110px_110px_auto_auto] items-center gap-2 p-3">
        <div className="font-mono text-xs text-muted-foreground">{record.id}</div>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
        <Input
          value={idNum}
          maxLength={BOWLER_NUMBER_MAX_LEN}
          onChange={(e) => setIdNum(e.target.value)}
          className={cn("h-8 font-mono", legacyMissingId && "border-destructive/60")}
          placeholder="required"
        />
        <Input
          value={avg}
          inputMode="decimal"
          onChange={(e) => setAvg(sanitizeAverageInput(e.target.value))}
          className="h-8 font-mono"
        />
        <div className="text-xs text-muted-foreground">
          hcp{" "}
          <span className="font-mono text-foreground">
            {Number.isFinite(parsedAvg) ? computeHandicap(parsedAvg) : "–"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <StatusBadge active={record.active} archived={record.archived} />
        </div>
        <div className="flex items-center gap-1">
          <button
            disabled={!dirty || upd.isPending}
            onClick={() => {
              const trimmed = name.trim();
              const bn = idNum.trim();
              if (!trimmed) return window.alert("Name is required.");
              const eNum = validateBowlerNumber(bn);
              if (eNum) return window.alert(eNum);
              const eAvg = validateAverage(parsedAvg);
              if (eAvg) return window.alert(eAvg);
              if (isDuplicateActive(trimmed, rows, record.id)) {
                return window.alert(`"${trimmed}" is already on the active roster.`);
              }
              upd.mutate({
                id: record.id, name: trimmed,
                entryAverage: parsedAvg, bowlerNumber: bn,
              });
            }}
            className={cn(
              "rounded-md px-2 py-1 text-xs",
              dirty && !upd.isPending
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground",
            )}
          >
            {upd.isPending ? "Saving…" : "Save"}
          </button>

          {!record.archived && (
            <button
              title={record.active ? "Deactivate (hide from scheduling)" : "Activate"}
              disabled={act.isPending || (!record.active && atActiveCap)}
              onClick={() => act.mutate({ id: record.id, active: !record.active })}
              className="rounded-md border border-border p-1 hover:bg-accent/40 disabled:opacity-50"
            >
              {record.active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
            </button>
          )}

          {record.archived ? (
            <button
              title="Restore (stays inactive until you re-activate)"
              disabled={arch.isPending}
              onClick={() => arch.mutate({ id: record.id, archived: false })}
              className="rounded-md border border-border p-1 hover:bg-accent/40"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              title="Archive (preserves history)"
              disabled={arch.isPending}
              onClick={() => {
                if (window.confirm(`Archive ${record.name}? Preserves history; hidden from future scheduling.`))
                  arch.mutate({ id: record.id, archived: true });
              }}
              className="rounded-md border border-border p-1 hover:bg-accent/40"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            title="Delete permanently (only if never scheduled)"
            disabled={del.isPending}
            onClick={() => {
              if (window.confirm(`Permanently delete ${record.name}? Only possible if never scheduled.`))
                del.mutate({ id: record.id });
            }}
            className="rounded-md border border-destructive/40 p-1 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {legacyMissingId && (
          <div className="col-span-full text-[10px] text-destructive">
            Legacy row missing ID Number — add one before saving.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------- Substitutes tab -------------------------

function SubsTab({ subs }: { subs: SubRow[] }) {
  const [name, setName] = useState("");
  const [avg, setAvg] = useState("");
  const [idNum, setIdNum] = useState("");
  const invalidate = useAfterMutation();
  const addFn = useServerFn(addSubstitute);
  const add = useMutation({
    mutationFn: (input: { name: string; startingAverage: number; bowlerNumber: string }) =>
      addFn({ data: input }),
    onSuccess: () => { invalidate(); setName(""); setIdNum(""); setAvg(""); },
    onError: (e) => window.alert((e as Error).message),
  });

  return (
    <>
      <Card className="mb-3 bg-card">
        <CardContent className="p-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Add substitute</div>
          <div className="grid gap-2 sm:grid-cols-[1fr_140px_160px_auto]">
            <div>
              <Label className="text-[10px]">Name <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
            </div>
            <div>
              <Label className="text-[10px]">ID Number <span className="text-destructive">*</span></Label>
              <Input
                value={idNum}
                maxLength={BOWLER_NUMBER_MAX_LEN}
                onChange={(e) => setIdNum(e.target.value)}
                placeholder="required, 1–10"
              />
            </div>
            <div>
              <Label className="text-[10px]">Starting Avg (0–300)</Label>
              <Input
                inputMode="decimal"
                value={avg}
                onChange={(e) => setAvg(sanitizeAverageInput(e.target.value))}
                placeholder="required, e.g. 132.5"
              />
            </div>
            <div className="flex items-end">
              <button
                disabled={add.isPending}
                onClick={() => {
                  const trimmed = name.trim();
                  const bn = idNum.trim();
                  if (!trimmed) return window.alert("Name is required.");
                  const eNum = validateBowlerNumber(bn);
                  if (eNum) return window.alert(eNum);
                  if (avg.trim() === "") return window.alert("Starting Average is required.");
                  const n = parseAverage(avg);
                  const eAvg = validateAverage(n);
                  if (eAvg) return window.alert(eAvg);
                  if (isDuplicateActive(trimmed, subs)) {
                    return window.alert(`Substitute "${trimmed}" is already active.`);
                  }
                  add.mutate({ name: trimmed, startingAverage: n, bowlerNumber: bn });
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" /> {add.isPending ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            ID Number and Starting Average are required — the sub's handicap is{" "}
            <span className="font-mono">max(0, floor(0.8 × (160 − avg)))</span>. Points and handicap
            pinfall are still credited to the scheduled bowler.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-2">
        {subs.map((s) => (
          <SubRowRow key={s.id} record={s} rows={subs} />
        ))}
      </div>
    </>
  );
}

function SubRowRow({ record, rows }: { record: SubRow; rows: SubRow[] }) {
  const [name, setName] = useState(record.name);
  const [idNum, setIdNum] = useState(record.bowler_number ?? "");
  const [avg, setAvg] = useState(record.starting_average != null ? String(record.starting_average) : "");
  const invalidate = useAfterMutation();
  const updateFn = useServerFn(updateSubstitute);
  const activeFn = useServerFn(setSubstituteActive);
  const archiveFn = useServerFn(setSubstituteArchived);
  const deleteFn = useServerFn(deleteSubstitute);

  const upd = useMutation({
    mutationFn: (input: { id: string; name: string; startingAverage: number; bowlerNumber: string }) =>
      updateFn({ data: input }),
    onSuccess: invalidate, onError: (e) => window.alert((e as Error).message),
  });
  const act = useMutation({
    mutationFn: (input: { id: string; active: boolean }) => activeFn({ data: input }),
    onSuccess: invalidate, onError: (e) => window.alert((e as Error).message),
  });
  const arch = useMutation({
    mutationFn: (input: { id: string; archived: boolean }) => archiveFn({ data: input }),
    onSuccess: invalidate, onError: (e) => window.alert((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (input: { id: string }) => deleteFn({ data: input }),
    onSuccess: invalidate, onError: (e) => window.alert((e as Error).message),
  });

  const savedAvg = record.starting_average != null ? String(record.starting_average) : "";
  const parsedAvg = parseAverage(avg);
  const dirty =
    name !== record.name ||
    (idNum || "") !== (record.bowler_number ?? "") ||
    avg !== savedAvg;
  const legacyMissingId = !(record.bowler_number ?? "").trim();

  return (
    <Card className={cn("bg-card", record.archived && "opacity-60")}>
      <CardContent className="grid grid-cols-[80px_1fr_120px_120px_auto_auto] items-center gap-2 p-3">
        <div className="font-mono text-xs text-muted-foreground">{record.id}</div>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
        <Input
          value={idNum}
          maxLength={BOWLER_NUMBER_MAX_LEN}
          onChange={(e) => setIdNum(e.target.value)}
          className={cn("h-8 font-mono", legacyMissingId && "border-destructive/60")}
          placeholder="required"
        />
        <Input
          value={avg}
          inputMode="decimal"
          onChange={(e) => setAvg(sanitizeAverageInput(e.target.value))}
          className="h-8 font-mono"
          placeholder="Start avg"
        />
        <div className="flex items-center gap-1">
          <StatusBadge active={record.active} archived={record.archived} />
        </div>
        <div className="flex items-center gap-1">
          <button
            disabled={!dirty || upd.isPending}
            onClick={() => {
              const trimmed = name.trim();
              const bn = idNum.trim();
              if (!trimmed) return window.alert("Name is required.");
              const eNum = validateBowlerNumber(bn);
              if (eNum) return window.alert(eNum);
              if (avg.trim() === "") return window.alert("Starting Average is required.");
              const eAvg = validateAverage(parsedAvg);
              if (eAvg) return window.alert(eAvg);
              if (isDuplicateActive(trimmed, rows, record.id)) {
                return window.alert(`Substitute "${trimmed}" is already active.`);
              }
              upd.mutate({
                id: record.id, name: trimmed,
                startingAverage: parsedAvg, bowlerNumber: bn,
              });
            }}
            className={cn(
              "rounded-md px-2 py-1 text-xs",
              dirty && !upd.isPending
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground",
            )}
          >
            {upd.isPending ? "Saving…" : "Save"}
          </button>
          {!record.archived && (
            <button
              title={record.active ? "Deactivate" : "Activate"}
              disabled={act.isPending}
              onClick={() => act.mutate({ id: record.id, active: !record.active })}
              className="rounded-md border border-border p-1 hover:bg-accent/40"
            >
              {record.active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
            </button>
          )}
          {record.archived ? (
            <button
              title="Restore (stays inactive until you re-activate)"
              disabled={arch.isPending}
              onClick={() => arch.mutate({ id: record.id, archived: false })}
              className="rounded-md border border-border p-1 hover:bg-accent/40"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              title="Archive"
              disabled={arch.isPending}
              onClick={() => {
                if (window.confirm(`Archive substitute "${record.name}"?`))
                  arch.mutate({ id: record.id, archived: true });
              }}
              className="rounded-md border border-border p-1 hover:bg-accent/40"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            title="Delete permanently (only if never used in a match)"
            disabled={del.isPending}
            onClick={() => {
              if (window.confirm(`Permanently delete substitute "${record.name}"?`))
                del.mutate({ id: record.id });
            }}
            className="rounded-md border border-destructive/40 p-1 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {legacyMissingId && (
          <div className="col-span-full text-[10px] text-destructive">
            Legacy row missing ID Number — add one before saving.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ active, archived }: { active: boolean; archived: boolean }) {
  if (archived) {
    return (
      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        Archived
      </span>
    );
  }
  if (active) {
    return (
      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-400">
        Active
      </span>
    );
  }
  return (
    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-400">
      Inactive
    </span>
  );
}
