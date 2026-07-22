/**
 * Admin: Historical Data section for the season editor.
 *
 * Renders only when the season is NOT the current season. Owns:
 *  - Progress summary (weeks / schedules / results / summaries)
 *  - Weeks list + bulk generator (edit date / published / completed)
 *  - Per-week schedule editor (add + edit + delete; rostered A/B only)
 *  - Per-slot result entry
 *      • FULL_LINESCORE — three-game frame editor (reuses SideLinescoreEditor)
 *      • GAME_SCORES     — three scratch scores per side
 *      Both modes support substitutes as ACTUAL participants (not scheduled),
 *      absent-with-three-scores contributes to standings only, absent-
 *      without-scores requires an explicit points override, and existing
 *      saved results pre-populate the form.
 *  - Per-participant summary-only record form
 *
 * Any modification to a PUBLISHED week is gated behind a confirm-and-
 * `allowPublished` flow. Server-side guards ensure every write is scoped
 * by seasonId and rejected against the current season.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  adminDeleteHistoricalMatchResult,
  adminDeleteHistoricalScheduleSlot,
  adminDeleteHistoricalSummary,
  adminDeleteHistoricalWeek,
  adminGenerateHistoricalWeeks,
  adminGetHistoricalMatchResult,
  adminHistoricalProgress,
  adminListHistoricalSchedule,
  adminListHistoricalSummary,
  adminListHistoricalWeeks,
  adminRebuildHistoricalSnapshot,
  adminSaveHistoricalMatchResult,
  adminUpdateHistoricalWeek,
  adminUpsertHistoricalScheduleSlot,
  adminUpsertHistoricalSummary,
  type HistoricalSlotRow,
  type HistoricalWeekRow,
} from "@/lib/historical-repo.functions";
import { adminListParticipants, type ParticipantRow } from "@/lib/history-repo.functions";
import { compareLanePairLabel } from "@/lib/lane-pair-order";
import { sortPersonOptions } from "@/lib/person-sort";
import {
  computeSideDerived,
  emptySideEditorState,
  SideLinescoreEditor,
  type SideEditorState,
} from "@/components/linescore/MatchLinescoreEditor";
import type { GameLinescore } from "@/lib/duckpin";

interface Props {
  seasonId: string;
  seasonLabel: string;
  isCurrent: boolean;
  totalWeeksHint: number | null;
  lanePairLabels: string[];
  pointSystem: 4 | 7;
}

export function HistoricalDataSection({ seasonId, seasonLabel, isCurrent, totalWeeksHint, lanePairLabels, pointSystem }: Props) {
  if (isCurrent) {
    return (
      <section className="mt-6 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Historical Data entry is only available for archived / draft seasons. This season is currently active.
      </section>
    );
  }
  return (
    <section className="mt-8 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Historical Data — {seasonLabel}</h2>
        <RebuildSnapshotButton seasonId={seasonId} />
      </header>
      <ProgressCard seasonId={seasonId} />
      <WeeksBlock seasonId={seasonId} totalWeeksHint={totalWeeksHint} lanePairLabels={lanePairLabels} pointSystem={pointSystem} />
      <SummaryRecordsBlock seasonId={seasonId} />
    </section>
  );
}

function RebuildSnapshotButton({ seasonId }: { seasonId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <button
      onClick={async () => {
        setBusy(true); setMsg(null);
        try {
          await adminRebuildHistoricalSnapshot({ data: { seasonId } });
          await qc.invalidateQueries({ queryKey: ["admin", "historical"] });
          setMsg("Rebuilt.");
        } catch (e) {
          setMsg(e instanceof Error ? e.message : "Failed");
        } finally { setBusy(false); }
      }}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-60"
    >
      <RefreshCw className={"h-3 w-3 " + (busy ? "animate-spin" : "")} />
      Rebuild snapshot {msg && <span className="ml-1 text-muted-foreground">· {msg}</span>}
    </button>
  );
}

function ProgressCard({ seasonId }: { seasonId: string }) {
  const q = useQuery({
    queryKey: ["admin", "historical", "progress", seasonId],
    queryFn: () => adminHistoricalProgress({ data: { seasonId } }),
  });
  if (q.isLoading || !q.data) return null;
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-6 text-xs">
      <Stat label="Rostered" value={q.data.rostered} />
      <Stat label="Subs" value={q.data.substitutes} />
      <Stat label="Weeks" value={q.data.weeks} />
      <Stat label="Schedules" value={q.data.schedules} />
      <Stat label="Results" value={q.data.results} />
      <Stat label="Summaries" value={q.data.summaries} />
      {q.data.snapshotBuiltAt && (
        <div className="col-span-full text-[10px] text-muted-foreground">
          Snapshot built {new Date(q.data.snapshotBuiltAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-base font-semibold">{value}</div>
    </div>
  );
}

// ---------- Weeks + per-week schedule + per-slot result ----------

function WeeksBlock({ seasonId, totalWeeksHint, lanePairLabels, pointSystem }: { seasonId: string; totalWeeksHint: number | null; lanePairLabels: string[]; pointSystem: 4 | 7 }) {
  const qc = useQueryClient();
  const weeks = useQuery({
    queryKey: ["admin", "historical", "weeks", seasonId],
    queryFn: () => adminListHistoricalWeeks({ data: { seasonId } }),
  });
  const [genCount, setGenCount] = useState(String(totalWeeksHint ?? 27));
  const [busy, setBusy] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    try {
      await adminGenerateHistoricalWeeks({ data: { seasonId, totalWeeks: Number(genCount) || 1 } });
      await qc.invalidateQueries({ queryKey: ["admin", "historical"] });
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-4 rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Weeks</h3>
        <input type="number" min={1} max={60} value={genCount} onChange={(e) => setGenCount(e.target.value)}
          className="ml-auto w-16 rounded border border-border bg-background px-1 text-sm text-right" />
        <button onClick={generate} disabled={busy}
          className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-60">
          <Plus className="mr-1 inline h-3 w-3" /> Generate 1..N
        </button>
      </div>
      {weeks.data?.available === false && (
        <div className="rounded border border-dashed border-border p-2 text-xs text-muted-foreground">
          Historical schema not applied yet. Apply the pending migration to enable weekly entry.
        </div>
      )}
      {weeks.data?.weeks?.length === 0 && weeks.data.available && (
        <div className="text-xs text-muted-foreground">No weeks yet. Use the generator above.</div>
      )}
      {(weeks.data?.weeks ?? []).length > 0 && (
        <div className="space-y-1">
          {(weeks.data?.weeks ?? []).map((w: HistoricalWeekRow) => (
            <WeekRow key={w.id} week={w} seasonId={seasonId}
              expanded={selectedWeek === w.id}
              onToggle={() => setSelectedWeek(selectedWeek === w.id ? null : w.id)}
              lanePairLabels={lanePairLabels}
              onChanged={() => qc.invalidateQueries({ queryKey: ["admin", "historical"] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WeekRow({
  week, seasonId, expanded, onToggle, lanePairLabels, onChanged,
}: {
  week: HistoricalWeekRow; seasonId: string; expanded: boolean; onToggle: () => void;
  lanePairLabels: string[]; onChanged: () => void;
}) {
  const [date, setDate] = useState(week.date ?? "");
  const [pub, setPub] = useState(week.published);
  const [done, setDone] = useState(week.completed);
  const [saving, setSaving] = useState(false);
  const dirty = (week.date ?? "") !== date || pub !== week.published || done !== week.completed;

  async function save() {
    setSaving(true);
    try {
      const wasPub = week.published;
      const nowPub = pub;
      const pubChanged = wasPub !== nowPub;
      const dateChanged = (week.date ?? "") !== date;
      const completedChanged = week.completed !== done;
      if (pubChanged) {
        const msg = nowPub
          ? `Publish Week ${week.weekNumber}? Public archived pages will show this week.`
          : `UNPUBLISH Week ${week.weekNumber}? This hides it from public archived pages.`;
        if (!window.confirm(msg)) { setSaving(false); return; }
      } else if (wasPub && (dateChanged || completedChanged)) {
        if (!window.confirm(`Week ${week.weekNumber} is PUBLISHED. Change date/completed anyway?`)) {
          setSaving(false); return;
        }
      }
      await adminUpdateHistoricalWeek({ data: {
        id: week.id, seasonId,
        date: dateChanged ? (date || null) : undefined,
        published: pubChanged ? pub : undefined,
        completed: completedChanged ? done : undefined,
        // Server requires these acknowledgements — pass them explicitly.
        allowPublished: wasPub && (dateChanged || completedChanged) ? true : undefined,
        confirmPublicationChange: pubChanged ? true : undefined,
      } });
      onChanged();
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded border border-border">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-sm">
        <button onClick={onToggle} className="font-mono text-xs underline">
          Wk {week.weekNumber}{week.published ? " · pub" : ""}
        </button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded border border-border bg-background px-1 text-xs" />
        <label className="text-xs"><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} /> Published</label>
        <label className="text-xs"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Completed</label>
        {dirty && (
          <button onClick={save} disabled={saving} className="rounded border border-border px-2 py-0.5 text-xs">
            <Save className="mr-1 inline h-3 w-3" /> Save
          </button>
        )}
        <button
          onClick={async () => {
            const highRisk = week.published;
            const prompt = highRisk
              ? `Week ${week.weekNumber} is PUBLISHED. Type DELETE to remove it (cascades all schedules and results):`
              : `Delete Week ${week.weekNumber}? All schedule and result rows in it will cascade.`;
            if (highRisk) {
              const t = window.prompt(prompt);
              if (t !== "DELETE") return;
            } else if (!window.confirm(prompt)) { return; }
            await adminDeleteHistoricalWeek({ data: {
              id: week.id, seasonId, confirm: true, allowPublished: highRisk,
            } });
            onChanged();
          }}
          className="ml-auto inline-flex items-center gap-1 rounded border border-destructive/40 px-1.5 text-xs text-destructive"
        ><Trash2 className="h-3 w-3" /></button>
      </div>
      {expanded && <WeekScheduleEditor week={week} seasonId={seasonId} lanePairLabels={lanePairLabels} onChanged={onChanged} />}
    </div>
  );
}

function WeekScheduleEditor({
  week, seasonId, lanePairLabels, onChanged,
}: { week: HistoricalWeekRow; seasonId: string; lanePairLabels: string[]; onChanged: () => void }) {
  const qc = useQueryClient();
  const parts = useQuery({
    queryKey: ["admin", "seasons", "participants", seasonId],
    queryFn: () => adminListParticipants({ data: { seasonId } }),
  });
  const sched = useQuery({
    queryKey: ["admin", "historical", "schedule", week.id],
    queryFn: () => adminListHistoricalSchedule({ data: { weekId: week.id } }),
  });
  // Rostered ONLY for scheduled A/B. Substitutes are actual-participant-only.
  const rosterOptions = useMemo(
    () => sortPersonOptions(parts.data?.roster ?? []),
    [parts.data],
  );
  const allOptions = useMemo(
    () => sortPersonOptions([
      ...(parts.data?.roster ?? []),
      ...(parts.data?.substitutes ?? []),
    ]),
    [parts.data],
  );
  const sortedLanes = useMemo(() => [...lanePairLabels].sort(compareLanePairLabel), [lanePairLabels]);

  const [lane, setLane] = useState(sortedLanes[0] ?? "");
  const [slot, setSlot] = useState("1");
  const [aRef, setA] = useState("");
  const [bRef, setB] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (!lane && sortedLanes[0]) setLane(sortedLanes[0]); }, [lane, sortedLanes]);

  async function addSlot() {
    setMsg(null);
    const A = rosterOptions.find((p) => p.id === aRef);
    const B = rosterOptions.find((p) => p.id === bRef);
    if (!A || !B) { setMsg("Pick both bowlers (rostered only)."); return; }
    if (week.published && !window.confirm(`Week ${week.weekNumber} is PUBLISHED. Add slot anyway?`)) return;
    try {
      await adminUpsertHistoricalScheduleSlot({ data: {
        seasonId, weekId: week.id,
        lanePair: lane, slot: Number(slot) || 1,
        bowlerARef: A.id, bowlerBRef: B.id,
        nameA: A.name, nameB: B.name,
        bowlerNumberA: A.bowlerNumber, bowlerNumberB: B.bowlerNumber,
        allowPublished: week.published,
      } });
      setA(""); setB("");
      qc.invalidateQueries({ queryKey: ["admin", "historical", "schedule", week.id] });
      onChanged();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="border-t border-border bg-background/50 p-2">
      {parts.isLoading || sched.isLoading ? (
        <div className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
      ) : (
        <>
          {sched.data?.slots?.length === 0 && (
            <p className="mb-2 text-xs text-muted-foreground">No slots yet.</p>
          )}
          <table className="mb-2 w-full text-xs">
            <tbody>
              {(sched.data?.slots ?? []).map((s: HistoricalSlotRow) => (
                <SlotRow key={s.id} slot={s} seasonId={seasonId}
                  weekId={week.id}
                  weekPublished={week.published}
                  rosterOptions={rosterOptions}
                  allOptions={allOptions}
                  sortedLanes={sortedLanes}
                  onChanged={() => {
                    qc.invalidateQueries({ queryKey: ["admin", "historical", "schedule", week.id] });
                    onChanged();
                  }} />
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-1">
            <select value={lane} onChange={(e) => setLane(e.target.value)} className="rounded border border-border bg-background px-1 text-xs">
              {sortedLanes.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <input type="number" min={1} max={64} value={slot} onChange={(e) => setSlot(e.target.value)}
              className="w-12 rounded border border-border bg-background px-1 text-xs text-right" />
            <BowlerSelect value={aRef} onChange={setA} options={rosterOptions} placeholder="Bowler A (rostered)" />
            <span className="text-xs">vs</span>
            <BowlerSelect value={bRef} onChange={setB} options={rosterOptions} placeholder="Bowler B (rostered)" />
            <button onClick={addSlot} className="ml-auto rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              <Plus className="mr-0.5 inline h-3 w-3" /> Add slot
            </button>
            {msg && <span className="text-xs text-destructive">{msg}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function BowlerSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: ParticipantRow[]; placeholder: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="max-w-40 rounded border border-border bg-background px-1 text-xs">
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}{o.bowlerNumber ? ` (#${o.bowlerNumber})` : ""} {o.role === "substitute" ? "· sub" : ""}
        </option>
      ))}
    </select>
  );
}

function SlotRow({
  slot, seasonId, weekId, weekPublished, rosterOptions, allOptions, sortedLanes, onChanged,
}: {
  slot: HistoricalSlotRow; seasonId: string; weekId: string; weekPublished: boolean;
  rosterOptions: ParticipantRow[]; allOptions: ParticipantRow[]; sortedLanes: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<null | "result" | "slot">(null);
  return (
    <>
      <tr className="border-t border-border">
        <td className="py-0.5 font-mono">{slot.lanePair}·{slot.slot}</td>
        <td className="py-0.5">{slot.nameA ?? slot.bowlerARef}</td>
        <td className="py-0.5 text-center text-muted-foreground">vs</td>
        <td className="py-0.5">{slot.nameB ?? slot.bowlerBRef}</td>
        <td className="py-0.5 text-right">
          <button onClick={() => setEditing(editing === "slot" ? null : "slot")}
            className="rounded border border-border px-1 text-xs">Edit</button>
          <button onClick={() => setEditing(editing === "result" ? null : "result")}
            className="ml-1 rounded border border-border px-1 text-xs">Result</button>
          <button
            onClick={async () => {
              if (weekPublished && !window.confirm("Week is PUBLISHED. Delete this slot anyway?")) return;
              if (!weekPublished && !window.confirm("Remove this slot? Any saved result cascades.")) return;
              await adminDeleteHistoricalScheduleSlot({ data: {
                id: slot.id, seasonId, confirm: true, allowPublished: weekPublished,
              } });
              onChanged();
            }}
            className="ml-1 inline-flex items-center rounded border border-destructive/40 px-1 text-xs text-destructive">
            <Trash2 className="h-3 w-3" />
          </button>
        </td>
      </tr>
      {editing === "slot" && (
        <tr>
          <td colSpan={5} className="border-t border-dashed border-border bg-accent/20 p-2">
            <SlotEditForm slot={slot} seasonId={seasonId} weekId={weekId}
              weekPublished={weekPublished}
              rosterOptions={rosterOptions} sortedLanes={sortedLanes}
              onSaved={() => { setEditing(null); onChanged(); }} />
          </td>
        </tr>
      )}
      {editing === "result" && (
        <tr>
          <td colSpan={5} className="border-t border-dashed border-border bg-accent/20 p-2">
            <ResultEntryForm
              seasonId={seasonId} weekId={weekId} slot={slot}
              weekPublished={weekPublished}
              rosterOptions={rosterOptions} allOptions={allOptions}
              onSaved={() => { setEditing(null); onChanged(); }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function SlotEditForm({
  slot, seasonId, weekId, weekPublished, rosterOptions, sortedLanes, onSaved,
}: {
  slot: HistoricalSlotRow; seasonId: string; weekId: string; weekPublished: boolean;
  rosterOptions: ParticipantRow[]; sortedLanes: string[]; onSaved: () => void;
}) {
  const [lane, setLane] = useState(slot.lanePair);
  const [slotN, setSlotN] = useState(String(slot.slot));
  const [aRef, setA] = useState(slot.bowlerARef);
  const [bRef, setB] = useState(slot.bowlerBRef);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const A = rosterOptions.find((p) => p.id === aRef);
      const B = rosterOptions.find((p) => p.id === bRef);
      if (!A || !B) throw new Error("Pick two rostered bowlers.");
      if (weekPublished && !window.confirm("Week is PUBLISHED. Save changes anyway?")) { setBusy(false); return; }
      await adminUpsertHistoricalScheduleSlot({ data: {
        id: slot.id, seasonId, weekId,
        lanePair: lane, slot: Number(slotN) || 1,
        bowlerARef: A.id, bowlerBRef: B.id,
        nameA: A.name, nameB: B.name,
        bowlerNumberA: A.bowlerNumber, bowlerNumberB: B.bowlerNumber,
        allowPublished: weekPublished,
      } });
      onSaved();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <select value={lane} onChange={(e) => setLane(e.target.value)} className="rounded border border-border bg-background px-1">
        {sortedLanes.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <input type="number" min={1} max={64} value={slotN} onChange={(e) => setSlotN(e.target.value)}
        className="w-12 rounded border border-border bg-background px-1 text-right" />
      <BowlerSelect value={aRef} onChange={setA} options={rosterOptions} placeholder="Bowler A" />
      <span>vs</span>
      <BowlerSelect value={bRef} onChange={setB} options={rosterOptions} placeholder="Bowler B" />
      <button onClick={save} disabled={busy} className="ml-auto rounded bg-primary px-2 py-0.5 text-primary-foreground">
        {busy ? "…" : "Save slot"}
      </button>
      {msg && <span className="text-destructive">{msg}</span>}
    </div>
  );
}

// ---------- Result entry (mode selector: game_scores | full_linescore) ---

type Status = "rostered" | "substitute" | "absent";
type DetailMode = "game_scores" | "full_linescore";

function ResultEntryForm({
  seasonId, weekId, slot, weekPublished, rosterOptions, allOptions, onSaved,
}: {
  seasonId: string; weekId: string; slot: HistoricalSlotRow; weekPublished: boolean;
  rosterOptions: ParticipantRow[]; allOptions: ParticipantRow[]; onSaved: () => void;
}) {
  const existing = useQuery({
    queryKey: ["admin", "historical", "result", slot.id],
    queryFn: () => adminGetHistoricalMatchResult({ data: { slotId: slot.id, seasonId } }),
  });

  const A0 = allOptions.find((p) => p.id === slot.bowlerARef);
  const B0 = allOptions.find((p) => p.id === slot.bowlerBRef);
  const substitutes = sortPersonOptions(allOptions.filter((p) => p.role === "substitute"));

  const [mode, setMode] = useState<DetailMode>("game_scores");
  const [statusA, setStatusA] = useState<Status>("rostered");
  const [statusB, setStatusB] = useState<Status>("rostered");
  const [subA, setSubA] = useState("");
  const [subB, setSubB] = useState("");
  const [gA, setGA] = useState<[string, string, string]>(["", "", ""]);
  const [gB, setGB] = useState<[string, string, string]>(["", "", ""]);
  const [absA, setAbsA] = useState<[string, string, string]>(["", "", ""]);
  const [absB, setAbsB] = useState<[string, string, string]>(["", "", ""]);
  const [lineA, setLineA] = useState<SideEditorState>(emptySideEditorState());
  const [lineB, setLineB] = useState<SideEditorState>(emptySideEditorState());
  const [ovr, setOvr] = useState(false);
  const [ovrA, setOvrA] = useState("");
  const [ovrB, setOvrB] = useState("");
  const [ovrReason, setOvrReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Hydrate from existing saved result.
  useEffect(() => {
    const r = existing.data?.result;
    if (!r) return;
    setMode(r.detailMode);
    const A = r.sideA as { status: Status; actualRef: string; absentScores?: [number, number, number] | null };
    const B = r.sideB as { status: Status; actualRef: string; absentScores?: [number, number, number] | null };
    setStatusA(A.status); setStatusB(B.status);
    if (A.status === "substitute") setSubA(A.actualRef);
    if (B.status === "substitute") setSubB(B.actualRef);
    if (A.status === "absent" && A.absentScores) setAbsA(A.absentScores.map(String) as [string, string, string]);
    if (B.status === "absent" && B.absentScores) setAbsB(B.absentScores.map(String) as [string, string, string]);
    if (r.gameScoresA && A.status !== "absent") setGA(r.gameScoresA.map(String) as [string, string, string]);
    if (r.gameScoresB && B.status !== "absent") setGB(r.gameScoresB.map(String) as [string, string, string]);
    if (r.pointOverride) {
      setOvr(true);
      setOvrA(String(r.pointOverride.pointsA));
      setOvrB(String(r.pointOverride.pointsB));
      setOvrReason(r.pointOverride.reason ?? "");
    }
    // Rehydrate FULL_LINESCORE frame editor by reading the saved
    // GameLinescore array back into per-frame mark/cumulative strings.
    if (r.detailMode === "full_linescore") {
      const rehydrate = (raw: unknown): SideEditorState => {
        const empty = emptySideEditorState();
        if (!Array.isArray(raw) || raw.length !== 3) return empty;
        for (let gi = 0; gi < 3; gi++) {
          const g = raw[gi] as { frames?: Array<{ mark?: string; cumulativeScore?: number }> } | null;
          if (!g || !Array.isArray(g.frames) || g.frames.length !== 10) continue;
          const marks: string[] = [];
          const cums: string[] = [];
          for (const f of g.frames) {
            marks.push(String(f.mark ?? ""));
            cums.push(f.cumulativeScore != null ? String(f.cumulativeScore) : "");
          }
          empty.games[gi] = { marks, cumulatives: cums };
        }
        return empty;
      };
      if (A.status !== "absent") setLineA(rehydrate(r.linescoreA));
      if (B.status !== "absent") setLineB(rehydrate(r.linescoreB));
    }
  }, [existing.data]);

  function actualFor(status: Status, scheduled: ParticipantRow | undefined, subId: string) {
    if (status === "substitute") {
      const s = substitutes.find((x) => x.id === subId);
      return { ref: s?.id ?? "", name: s?.name ?? "", average: s?.average ?? 0, handicap: s?.handicap ?? 0 };
    }
    // Absent falls through to scheduled bowler's identity + handicap.
    return {
      ref: scheduled?.id ?? "unknown",
      name: scheduled?.name ?? "unknown",
      average: scheduled?.average ?? 0,
      handicap: scheduled?.handicap ?? 0,
    };
  }

  function parseScores(arr: [string, string, string]): [number, number, number] | null {
    const nums = arr.map((v) => (v === "" ? null : Number(v)));
    if (nums.some((n) => n === null || Number.isNaN(n))) return null;
    return nums as [number, number, number];
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const aA = actualFor(statusA, A0, subA);
      const aB = actualFor(statusB, B0, subB);

      let gameScoresA: [number, number, number] | null = null;
      let gameScoresB: [number, number, number] | null = null;
      let linescoreA: unknown = null;
      let linescoreB: unknown = null;

      if (mode === "full_linescore") {
        if (statusA !== "absent") {
          const d = computeSideDerived(lineA, aA.handicap);
          if (!d.valid) throw new Error(`${aA.name || "Side A"}: complete all three games' marks and running totals.`);
          gameScoresA = d.games.map((g) => (g as GameLinescore).scratchTotal) as [number, number, number];
          linescoreA = d.games;
        }
        if (statusB !== "absent") {
          const d = computeSideDerived(lineB, aB.handicap);
          if (!d.valid) throw new Error(`${aB.name || "Side B"}: complete all three games' marks and running totals.`);
          gameScoresB = d.games.map((g) => (g as GameLinescore).scratchTotal) as [number, number, number];
          linescoreB = d.games;
        }
      } else {
        if (statusA !== "absent") {
          const p = parseScores(gA);
          if (!p) throw new Error(`${aA.name || "Side A"}: three scratch scores required.`);
          gameScoresA = p;
        }
        if (statusB !== "absent") {
          const p = parseScores(gB);
          if (!p) throw new Error(`${aB.name || "Side B"}: three scratch scores required.`);
          gameScoresB = p;
        }
      }

      const absentScoresA = statusA === "absent" ? parseScores(absA) : null;
      const absentScoresB = statusB === "absent" ? parseScores(absB) : null;
      const missingAbsA = statusA === "absent" && absentScoresA === null;
      const missingAbsB = statusB === "absent" && absentScoresB === null;
      if ((missingAbsA || missingAbsB) && !ovr) {
        throw new Error("Absent side without three absent scores requires an explicit points override (check Override and enter both sides' points).");
      }
      if (statusA === "absent") gameScoresA = absentScoresA;
      if (statusB === "absent") gameScoresB = absentScoresB;

      if (weekPublished && !window.confirm("Week is PUBLISHED. Save result anyway?")) { setBusy(false); return; }

      await adminSaveHistoricalMatchResult({ data: {
        seasonId, weekId, slotId: slot.id, detailMode: mode,
        sideA: {
          status: statusA, actualRef: aA.ref || slot.bowlerARef, actualName: aA.name || (slot.nameA ?? ""),
          entryAverage: aA.average, handicap: aA.handicap, absentScores: absentScoresA,
        },
        sideB: {
          status: statusB, actualRef: aB.ref || slot.bowlerBRef, actualName: aB.name || (slot.nameB ?? ""),
          entryAverage: aB.average, handicap: aB.handicap, absentScores: absentScoresB,
        },
        gameScoresA, gameScoresB,
        linescoreA, linescoreB,
        pointOverride: ovr && ovrA !== "" && ovrB !== ""
          ? { pointsA: Number(ovrA), pointsB: Number(ovrB), reason: ovrReason || undefined }
          : null,
        allowPublished: weekPublished,
      } });
      setMsg("Saved.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  const handicapA = actualFor(statusA, A0, subA).handicap;
  const handicapB = actualFor(statusB, B0, subB).handicap;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as DetailMode)}
          className="rounded border border-border bg-background px-1 text-xs">
          <option value="game_scores">Game scores (3 per side)</option>
          <option value="full_linescore">Full linescore (frame editor)</option>
        </select>
        {existing.data?.result && <span className="text-[10px] text-muted-foreground">· editing saved result</span>}
      </div>

      <ParticipantRow
        label={slot.nameA ?? slot.bowlerARef}
        status={statusA} setStatus={setStatusA}
        subId={subA} setSubId={setSubA} substitutes={substitutes}
        absentScores={absA} setAbsentScores={setAbsA}
      />
      <ParticipantRow
        label={slot.nameB ?? slot.bowlerBRef}
        status={statusB} setStatus={setStatusB}
        subId={subB} setSubId={setSubB} substitutes={substitutes}
        absentScores={absB} setAbsentScores={setAbsB}
      />

      {mode === "game_scores" ? (
        <div className="space-y-1">
          {statusA !== "absent" && <GameScoreRow label={slot.nameA ?? "A"} scores={gA} setScores={setGA} />}
          {statusB !== "absent" && <GameScoreRow label={slot.nameB ?? "B"} scores={gB} setScores={setGB} />}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <SideLinescoreEditor label={slot.nameA ?? "A"} handicap={handicapA}
            disabled={statusA === "absent"} state={lineA} onChange={setLineA} testPrefix="hist-side-A" />
          <SideLinescoreEditor label={slot.nameB ?? "B"} handicap={handicapB}
            disabled={statusB === "absent"} state={lineB} onChange={setLineB} testPrefix="hist-side-B" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-2">
        <label><input type="checkbox" checked={ovr} onChange={(e) => setOvr(e.target.checked)} /> Override</label>
        {ovr && <>
          <input type="number" step={0.5} placeholder="pts A" value={ovrA} onChange={(e) => setOvrA(e.target.value)} className="w-16 rounded border border-border bg-background px-1" />
          <input type="number" step={0.5} placeholder="pts B" value={ovrB} onChange={(e) => setOvrB(e.target.value)} className="w-16 rounded border border-border bg-background px-1" />
          <input type="text" placeholder="reason" value={ovrReason} onChange={(e) => setOvrReason(e.target.value)} className="flex-1 rounded border border-border bg-background px-1" />
        </>}
        <button onClick={save} disabled={busy} className="ml-auto rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-60">
          {busy ? "Saving…" : "Save result"}
        </button>
        <button
          onClick={async () => {
            if (!window.confirm("Clear this saved result?")) return;
            await adminDeleteHistoricalMatchResult({ data: {
              slotId: slot.id, seasonId, confirm: true, allowPublished: weekPublished,
            } });
            onSaved();
          }}
          className="rounded border border-destructive/40 px-2 py-0.5 text-destructive">Clear</button>
        {msg && <span className="text-[10px] text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}

function ParticipantRow({
  label, status, setStatus, subId, setSubId, substitutes, absentScores, setAbsentScores,
}: {
  label: string;
  status: Status; setStatus: (v: Status) => void;
  subId: string; setSubId: (v: string) => void;
  substitutes: ParticipantRow[];
  absentScores: [string, string, string]; setAbsentScores: (v: [string, string, string]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-28 truncate font-medium">{label}</span>
      <select value={status} onChange={(e) => setStatus(e.target.value as Status)}
        className="rounded border border-border bg-background px-1">
        <option value="rostered">Rostered</option>
        <option value="substitute">Substitute</option>
        <option value="absent">Absent</option>
      </select>
      {status === "substitute" && (
        <select value={subId} onChange={(e) => setSubId(e.target.value)} className="rounded border border-border bg-background px-1">
          <option value="">— pick sub —</option>
          {substitutes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {status === "absent" && (
        <>
          <span className="text-[10px] text-muted-foreground">Absent-with-scores (optional):</span>
          {[0, 1, 2].map((i) => (
            <input key={i} type="number" min={0} max={300} placeholder={`A${i + 1}`}
              value={absentScores[i]}
              onChange={(e) => {
                const next = [...absentScores] as [string, string, string];
                next[i] = e.target.value;
                setAbsentScores(next);
              }}
              className="w-14 rounded border border-border bg-background px-1 text-right" />
          ))}
        </>
      )}
    </div>
  );
}

function GameScoreRow({
  label, scores, setScores,
}: {
  label: string; scores: [string, string, string]; setScores: (v: [string, string, string]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-28 truncate font-medium">{label}</span>
      {[0, 1, 2].map((i) => (
        <input key={i} type="number" min={0} max={300} placeholder={`G${i + 1}`}
          value={scores[i]}
          onChange={(e) => {
            const next: [string, string, string] = [...scores] as [string, string, string];
            next[i] = e.target.value;
            setScores(next);
          }}
          className="w-14 rounded border border-border bg-background px-1 text-right" />
      ))}
    </div>
  );
}

// ---------- Summary-only records ----------------------------------------

function SummaryRecordsBlock({ seasonId }: { seasonId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "historical", "summary", seasonId],
    queryFn: () => adminListHistoricalSummary({ data: { seasonId } }),
  });
  const parts = useQuery({
    queryKey: ["admin", "seasons", "participants", seasonId],
    queryFn: () => adminListParticipants({ data: { seasonId } }),
  });
  const rosterOptions = useMemo(() =>
    sortPersonOptions([...(parts.data?.roster ?? []), ...(parts.data?.substitutes ?? [])]),
  [parts.data]);

  const [participantRef, setParticipantRef] = useState("");
  const [role, setRole] = useState<"rostered" | "substitute">("rostered");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState({
    games: "", scratchPinfall: "", average: "", highGame: "", highSet: "",
    points: "", pointsLost: "", finalFinish: "", isChampion: false,
  });

  const chosen = rosterOptions.find((r) => r.id === participantRef) ?? null;

  async function save() {
    if (!chosen) { setMsg("Pick a participant."); return; }
    setBusy(true); setMsg(null);
    try {
      await adminUpsertHistoricalSummary({ data: {
        seasonId,
        participantRef: chosen.id,
        personId: chosen.personId ?? undefined,
        role,
        displayName: chosen.name,
        bowlerNumber: chosen.bowlerNumber,
        games: fields.games === "" ? null : Number(fields.games),
        scratchPinfall: fields.scratchPinfall === "" ? null : Number(fields.scratchPinfall),
        average: fields.average === "" ? null : Number(fields.average),
        highGame: fields.highGame === "" ? null : Number(fields.highGame),
        highSet: fields.highSet === "" ? null : Number(fields.highSet),
        points: fields.points === "" ? null : Number(fields.points),
        pointsLost: fields.pointsLost === "" ? null : Number(fields.pointsLost),
        finalFinish: fields.finalFinish === "" ? null : Number(fields.finalFinish),
        isChampion: fields.isChampion,
      } });
      qc.invalidateQueries({ queryKey: ["admin", "historical", "summary", seasonId] });
      setMsg("Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  type SummaryRec = { id: string; displayName: string; role: string; games: number | null; scratchPinfall: number | null; average: number | null; highGame: number | null; highSet: number | null; points: number | null; finalFinish: number | null; isChampion: boolean };
  const records = (q.data?.records ?? []) as SummaryRec[];

  return (
    <div className="mt-4 rounded-md border border-border bg-card p-3">
      <h3 className="mb-2 text-sm font-semibold">Season summary records</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Enter aggregate season totals for bowlers when weekly linescores / game scores are unavailable.
        Any blank field stays blank and displays as "—" on the public site — never zero.
      </p>
      {q.data?.available === false && (
        <div className="mb-2 rounded border border-dashed border-border p-2 text-xs text-muted-foreground">
          Historical schema not applied yet.
        </div>
      )}
      {records.length > 0 && (
        <table className="mb-3 w-full text-xs">
          <thead className="text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="text-left">Name</th><th>Role</th><th>Games</th><th>Pinfall</th><th>Avg</th>
              <th>HG</th><th>HS</th><th>Pts</th><th>Finish</th><th>★</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {records.map((r) => (
              <tr key={r.id}>
                <td>{r.displayName}</td>
                <td>{r.role}</td>
                <td className="text-right">{r.games ?? "—"}</td>
                <td className="text-right">{r.scratchPinfall ?? "—"}</td>
                <td className="text-right">{r.average != null ? r.average.toFixed(1) : "—"}</td>
                <td className="text-right">{r.highGame ?? "—"}</td>
                <td className="text-right">{r.highSet ?? "—"}</td>
                <td className="text-right">{r.points ?? "—"}</td>
                <td className="text-right">{r.finalFinish ?? "—"}</td>
                <td className="text-center">{r.isChampion ? "★" : ""}</td>
                <td className="text-right">
                  <button onClick={async () => {
                    if (!window.confirm("Remove this summary record?")) return;
                    await adminDeleteHistoricalSummary({ data: { id: r.id, seasonId, confirm: true } });
                    qc.invalidateQueries({ queryKey: ["admin", "historical", "summary", seasonId] });
                  }} className="text-destructive"><Trash2 className="h-3 w-3" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="grid grid-cols-2 gap-1 md:grid-cols-6 text-xs">
        <select value={participantRef} onChange={(e) => setParticipantRef(e.target.value)}
          className="col-span-2 rounded border border-border bg-background px-1">
          <option value="">— pick participant —</option>
          {rosterOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.role}</option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value as "rostered" | "substitute")}
          className="rounded border border-border bg-background px-1">
          <option value="rostered">Rostered</option>
          <option value="substitute">Substitute</option>
        </select>
        {(["games", "scratchPinfall", "average", "highGame", "highSet", "points", "pointsLost", "finalFinish"] as const).map((k) => (
          <input key={k} type="number" placeholder={k} value={fields[k] as string}
            onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
            className="rounded border border-border bg-background px-1" />
        ))}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={fields.isChampion} onChange={(e) => setFields({ ...fields, isChampion: e.target.checked })} />
          Champion
        </label>
        <button onClick={save} disabled={busy || !participantRef}
          className="rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-60">
          {busy ? "…" : "Save"}
        </button>
        {msg && <span className="col-span-full text-[10px] text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}
