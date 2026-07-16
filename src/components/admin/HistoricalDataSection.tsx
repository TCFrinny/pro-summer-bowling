/**
 * Admin: Historical Data section for the season editor.
 *
 * Renders only when the season is NOT the current season. Owns:
 *  - Progress summary (weeks / schedules / results / summaries)
 *  - Weeks list + bulk generator
 *  - Per-week schedule editor
 *  - Per-slot result entry (full-linescore reuses the existing frame editor,
 *    game-scores is a simple 3-score form)
 *  - Per-participant summary-only record form
 *
 * Server-side guards ensure every write is scoped by seasonId AND rejected
 * against the current season.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Trash2, Save } from "lucide-react";
import {
  adminDeleteHistoricalMatchResult,
  adminDeleteHistoricalScheduleSlot,
  adminDeleteHistoricalSummary,
  adminDeleteHistoricalWeek,
  adminGenerateHistoricalWeeks,
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

interface Props {
  seasonId: string;
  seasonLabel: string;
  isCurrent: boolean;
  totalWeeksHint: number | null;
  lanePairLabels: string[];
}

export function HistoricalDataSection({ seasonId, seasonLabel, isCurrent, totalWeeksHint, lanePairLabels }: Props) {
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
      <WeeksBlock seasonId={seasonId} totalWeeksHint={totalWeeksHint} lanePairLabels={lanePairLabels} />
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

function WeeksBlock({ seasonId, totalWeeksHint, lanePairLabels }: { seasonId: string; totalWeeksHint: number | null; lanePairLabels: string[] }) {
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
          {(weeks.data?.weeks ?? []).map((w) => (
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
      await adminUpdateHistoricalWeek({ data: {
        id: week.id, seasonId, date: date || null, published: pub, completed: done,
      } });
      onChanged();
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded border border-border">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-sm">
        <button onClick={onToggle} className="font-mono text-xs underline">Wk {week.weekNumber}</button>
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
            if (!window.confirm(`Delete Week ${week.weekNumber}? All schedule and result rows in it will cascade.`)) return;
            await adminDeleteHistoricalWeek({ data: { id: week.id, seasonId, confirm: true } });
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
  const rosterOptions = useMemo(() => {
    const roster = parts.data?.roster ?? [];
    const subs = parts.data?.substitutes ?? [];
    return [...roster, ...subs];
  }, [parts.data]);
  const sortedLanes = useMemo(() => [...lanePairLabels].sort(compareLanePairLabel), [lanePairLabels]);

  const [lane, setLane] = useState(sortedLanes[0] ?? "");
  const [slot, setSlot] = useState("1");
  const [aRef, setA] = useState("");
  const [bRef, setB] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function addSlot() {
    setMsg(null);
    const A = rosterOptions.find((p) => p.id === aRef);
    const B = rosterOptions.find((p) => p.id === bRef);
    if (!A || !B) { setMsg("Pick both bowlers."); return; }
    try {
      await adminUpsertHistoricalScheduleSlot({ data: {
        seasonId, weekId: week.id,
        lanePair: lane, slot: Number(slot) || 1,
        bowlerARef: A.id, bowlerBRef: B.id,
        nameA: A.name, nameB: B.name,
        bowlerNumberA: A.bowlerNumber, bowlerNumberB: B.bowlerNumber,
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
              {(sched.data?.slots ?? []).map((s) => (
                <SlotRow key={s.id} slot={s} seasonId={seasonId}
                  weekId={week.id} rosterOptions={rosterOptions}
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
            <input type="number" min={1} max={32} value={slot} onChange={(e) => setSlot(e.target.value)}
              className="w-12 rounded border border-border bg-background px-1 text-xs text-right" />
            <BowlerSelect value={aRef} onChange={setA} options={rosterOptions} placeholder="Bowler A" />
            <span className="text-xs">vs</span>
            <BowlerSelect value={bRef} onChange={setB} options={rosterOptions} placeholder="Bowler B" />
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
  slot, seasonId, weekId, rosterOptions, onChanged,
}: {
  slot: HistoricalSlotRow; seasonId: string; weekId: string;
  rosterOptions: ParticipantRow[]; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<null | "result">(null);
  return (
    <>
      <tr className="border-t border-border">
        <td className="py-0.5 font-mono">{slot.lanePair}·{slot.slot}</td>
        <td className="py-0.5">{slot.nameA ?? slot.bowlerARef}</td>
        <td className="py-0.5 text-center text-muted-foreground">vs</td>
        <td className="py-0.5">{slot.nameB ?? slot.bowlerBRef}</td>
        <td className="py-0.5 text-right">
          <button onClick={() => setEditing(editing === "result" ? null : "result")}
            className="rounded border border-border px-1 text-xs">Result</button>
          <button
            onClick={async () => {
              if (!window.confirm("Remove this slot? Any saved result cascades.")) return;
              await adminDeleteHistoricalScheduleSlot({ data: { id: slot.id, seasonId, confirm: true } });
              onChanged();
            }}
            className="ml-1 inline-flex items-center rounded border border-destructive/40 px-1 text-xs text-destructive">
            <Trash2 className="h-3 w-3" />
          </button>
        </td>
      </tr>
      {editing === "result" && (
        <tr>
          <td colSpan={5} className="border-t border-dashed border-border bg-accent/20 p-2">
            <GameScoresForm
              seasonId={seasonId} weekId={weekId} slot={slot} rosterOptions={rosterOptions}
              onSaved={() => { setEditing(null); onChanged(); }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------- Game-scores entry form (simple 3 scratch scores per side) ----

function GameScoresForm({
  seasonId, weekId, slot, rosterOptions, onSaved,
}: {
  seasonId: string; weekId: string; slot: HistoricalSlotRow; rosterOptions: ParticipantRow[]; onSaved: () => void;
}) {
  const A0 = rosterOptions.find((p) => p.id === slot.bowlerARef);
  const B0 = rosterOptions.find((p) => p.id === slot.bowlerBRef);
  const [statusA, setStatusA] = useState<"rostered" | "substitute" | "absent">("rostered");
  const [statusB, setStatusB] = useState<"rostered" | "substitute" | "absent">("rostered");
  const [subA, setSubA] = useState("");
  const [subB, setSubB] = useState("");
  const [gA, setGA] = useState<[string, string, string]>(["", "", ""]);
  const [gB, setGB] = useState<[string, string, string]>(["", "", ""]);
  const [ovr, setOvr] = useState(false);
  const [ovrA, setOvrA] = useState("");
  const [ovrB, setOvrB] = useState("");
  const [ovrReason, setOvrReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const substitutes = rosterOptions.filter((p) => p.role === "substitute");

  function actual(status: "rostered" | "substitute" | "absent",
                  scheduled: ParticipantRow | undefined, subId: string) {
    if (status === "substitute") {
      const s = substitutes.find((x) => x.id === subId);
      return { ref: s?.id ?? "", name: s?.name ?? "", average: s?.average ?? 0, handicap: s?.handicap ?? 0 };
    }
    return {
      ref: scheduled?.id ?? "unknown",
      name: scheduled?.name ?? "unknown",
      average: scheduled?.average ?? 0,
      handicap: scheduled?.handicap ?? 0,
    };
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const parseScores = (arr: [string, string, string]): [number, number, number] | null => {
        const nums = arr.map((v) => (v === "" ? null : Number(v)));
        if (nums.some((n) => n === null || Number.isNaN(n))) return null;
        return nums as [number, number, number];
      };
      const scoresA = statusA === "absent" ? null : parseScores(gA);
      const scoresB = statusB === "absent" ? null : parseScores(gB);
      const absentScoresA = statusA === "absent" ? parseScores(gA) ?? undefined : undefined;
      const absentScoresB = statusB === "absent" ? parseScores(gB) ?? undefined : undefined;
      const aA = actual(statusA, A0, subA);
      const aB = actual(statusB, B0, subB);
      await adminSaveHistoricalMatchResult({ data: {
        seasonId, weekId, slotId: slot.id, detailMode: "game_scores",
        sideA: { status: statusA, actualRef: aA.ref || slot.bowlerARef, actualName: aA.name || (slot.nameA ?? ""),
                 entryAverage: aA.average, handicap: aA.handicap, absentScores: absentScoresA ?? null },
        sideB: { status: statusB, actualRef: aB.ref || slot.bowlerBRef, actualName: aB.name || (slot.nameB ?? ""),
                 entryAverage: aB.average, handicap: aB.handicap, absentScores: absentScoresB ?? null },
        gameScoresA: scoresA, gameScoresB: scoresB,
        linescoreA: null, linescoreB: null,
        pointOverride: ovr && ovrA !== "" && ovrB !== ""
          ? { pointsA: Number(ovrA), pointsB: Number(ovrB), reason: ovrReason || undefined }
          : null,
      } });
      setMsg("Saved.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Game-score entry (per side: 3 scratch scores). Full linescore mode uses the existing frame editor for the current season only; historical rows use score-only entry unless implemented.
      </div>
      <SideRow label={slot.nameA ?? slot.bowlerARef} status={statusA} setStatus={setStatusA} subId={subA} setSubId={setSubA}
        substitutes={substitutes} scores={gA} setScores={setGA} />
      <SideRow label={slot.nameB ?? slot.bowlerBRef} status={statusB} setStatus={setStatusB} subId={subB} setSubId={setSubB}
        substitutes={substitutes} scores={gB} setScores={setGB} />
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
            await adminDeleteHistoricalMatchResult({ data: { slotId: slot.id, seasonId, confirm: true } });
            onSaved();
          }}
          className="rounded border border-destructive/40 px-2 py-0.5 text-destructive">Clear</button>
        {msg && <span className="text-[10px] text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}

function SideRow({
  label, status, setStatus, subId, setSubId, substitutes, scores, setScores,
}: {
  label: string;
  status: "rostered" | "substitute" | "absent";
  setStatus: (v: "rostered" | "substitute" | "absent") => void;
  subId: string; setSubId: (v: string) => void;
  substitutes: ParticipantRow[];
  scores: [string, string, string]; setScores: (v: [string, string, string]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-28 truncate font-medium">{label}</span>
      <select value={status} onChange={(e) => setStatus(e.target.value as "rostered" | "substitute" | "absent")}
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
    [...(parts.data?.roster ?? []), ...(parts.data?.substitutes ?? [])],
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
      {(q.data?.records ?? []).length > 0 && (
        <table className="mb-3 w-full text-xs">
          <thead className="text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="text-left">Name</th><th>Role</th><th>Games</th><th>Pinfall</th><th>Avg</th>
              <th>HG</th><th>HS</th><th>Pts</th><th>Finish</th><th>★</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(q.data?.records ?? []).map((r) => (
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
