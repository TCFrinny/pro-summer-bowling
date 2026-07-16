import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/layout/AppShell";
import {
  adminAddParticipant,
  adminDeleteLanePair,
  adminGetSeasonDetail,
  adminListParticipants,
  adminMakeSeasonCurrent,
  adminUpsertLanePair,
  adminUpsertSeason,
  createPerson,
  listPeople,
} from "@/lib/history-repo.functions";
import { summarizeLanePairs } from "@/lib/season-history";
import { Loader2, Save, Star, Trash2 } from "lucide-react";

export const Route = createFileRoute("/admin/seasons/$seasonId")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: SeasonEditor,
});

function SeasonEditor() {
  const { seasonId } = Route.useParams();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["admin", "seasons", "detail", seasonId],
    queryFn: () => adminGetSeasonDetail({ data: { seasonId } }),
  });
  const participants = useQuery({
    queryKey: ["admin", "seasons", "participants", seasonId],
    queryFn: () => adminListParticipants({ data: { seasonId } }),
  });
  const people = useQuery({ queryKey: ["admin", "people"], queryFn: () => listPeople() });

  if (detail.isLoading) return <Loader />;
  if (!detail.data) return <EmptyState title="Season not found" />;
  if (!detail.data.available || !detail.data.season) {
    return (
      <EmptyState
        title="Season not available"
        description="Apply the pending multi-season migration or check that this season exists."
      />
    );
  }
  const season = detail.data.season;

  async function invalidate() {
    await qc.invalidateQueries({ queryKey: ["admin", "seasons"] });
    await detail.refetch();
    await participants.refetch();
  }

  return (
    <>
      <PageHeader
        title={season.label}
        subtitle={`Status: ${season.status} · Visibility: ${season.publicVisible ? "public" : "private"}`}
      >
        <Link to="/admin/seasons" className="text-sm underline">All seasons</Link>
      </PageHeader>

      <MetadataForm season={season} onSaved={invalidate} />

      <MakeCurrentBlock seasonId={seasonId} isCurrent={season.status === "current"} onDone={invalidate} />

      <LanePairsBlock
        seasonId={seasonId}
        pairs={detail.data.lanePairs}
        onChanged={invalidate}
      />

      <ParticipantsBlock
        seasonId={seasonId}
        participants={participants.data}
        peopleAvailable={people.data?.available ?? false}
        people={people.data?.people ?? []}
        onChanged={async () => {
          await participants.refetch();
        }}
        onPeopleChanged={async () => {
          await people.refetch();
        }}
      />

      <HistoricalDataSection
        seasonId={seasonId}
        seasonLabel={season.label}
        isCurrent={season.status === "current"}
        totalWeeksHint={season.totalWeeks ?? null}
        lanePairLabels={detail.data.lanePairs.map((p) => p.label)}
      />
    </>
  );
}

function Loader() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
  );
}

// ---------- Metadata --------------------------------------------------------

function MetadataForm({
  season,
  onSaved,
}: {
  season: {
    id: string; label: string;
    startDate?: string | null; endDate?: string | null;
    totalWeeks?: number | null; pointSystem?: 4 | 7 | null;
    handicapPercent?: number | null; handicapBase?: number | null;
    status: "draft" | "current" | "archived"; publicVisible: boolean;
    description?: string | null;
  };
  onSaved: () => Promise<void>;
}) {
  const [label, setLabel] = useState(season.label);
  const [startDate, setStartDate] = useState(season.startDate ?? "");
  const [endDate, setEndDate] = useState(season.endDate ?? "");
  const [totalWeeks, setTotalWeeks] = useState(season.totalWeeks?.toString() ?? "");
  const [pointSystem, setPointSystem] = useState<string>(season.pointSystem?.toString() ?? "7");
  const [handicapPercent, setHandicapPercent] = useState(season.handicapPercent?.toString() ?? "80");
  const [handicapBase, setHandicapBase] = useState(season.handicapBase?.toString() ?? "160");
  const [status, setStatus] = useState<"draft" | "archived">(
    season.status === "current" ? "archived" : season.status,
  );
  const [publicVisible, setPublicVisible] = useState(season.publicVisible);
  const [description, setDescription] = useState(season.description ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Metadata</h2>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setMsg(null);
          try {
            await adminUpsertSeason({
              data: {
                id: season.id,
                label: label.trim(),
                startDate: startDate || null,
                endDate: endDate || null,
                totalWeeks: totalWeeks ? Number(totalWeeks) : null,
                pointSystem: pointSystem === "4" ? 4 : 7,
                handicapPercent: handicapPercent ? Number(handicapPercent) : null,
                handicapBase: handicapBase ? Number(handicapBase) : null,
                // Never sets status='current' via this path. Use the Make Current block.
                status: season.status === "current" ? undefined : status,
                publicVisible: season.status === "current" ? undefined : publicVisible,
                description: description || null,
              },
            });
            setMsg("Saved.");
            await onSaved();
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "Save failed");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} /></Field>
        <Field label="Point system">
          <select value={pointSystem} onChange={(e) => setPointSystem(e.target.value)} className={inputCls}>
            <option value="7">7-point</option>
            <option value="4">4-point</option>
          </select>
        </Field>
        <Field label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></Field>
        <Field label="End date"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Total weeks"><input type="number" min={1} max={60} value={totalWeeks} onChange={(e) => setTotalWeeks(e.target.value)} className={inputCls} /></Field>
        <Field label="Handicap %"><input type="number" min={0} max={100} value={handicapPercent} onChange={(e) => setHandicapPercent(e.target.value)} className={inputCls} /></Field>
        <Field label="Handicap base"><input type="number" min={0} max={300} value={handicapBase} onChange={(e) => setHandicapBase(e.target.value)} className={inputCls} /></Field>
        {season.status !== "current" && (
          <>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as "draft" | "archived")} className={inputCls}>
                <option value="draft">Draft (hidden from public)</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="Public visibility">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={publicVisible} onChange={(e) => setPublicVisible(e.target.checked)} />
                Public
              </label>
            </Field>
          </>
        )}
        {season.status === "current" && (
          <div className="md:col-span-2 rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
            This season is currently the active league season. Its status and visibility are managed by the Make Current control below.
          </div>
        )}
        <Field label="Description" span={2}>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} min-h-16`} />
        </Field>
        <div className="md:col-span-2 flex items-center gap-3">
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save metadata"}
          </button>
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        </div>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">
        Editing metadata never touches roster, weeks, schedules, results, snapshots, averages, or scoring records.
      </p>
    </section>
  );
}

function MakeCurrentBlock({ seasonId, isCurrent, onDone }: { seasonId: string; isCurrent: boolean; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (isCurrent) {
    return (
      <section className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
        <Star className="mr-1 inline h-4 w-4 text-primary" /> This season is currently marked as <strong>current</strong>.
      </section>
    );
  }
  return (
    <section className="mt-4 rounded-lg border border-border bg-card p-3">
      <h2 className="mb-2 text-sm font-semibold">Make current</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        Atomically archives whichever season is currently active, then promotes this season. Requires explicit confirmation.
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          if (!window.confirm("Make this season CURRENT and archive the previously-current season? This affects all public pages.")) return;
          setBusy(true);
          setMsg(null);
          try {
            await adminMakeSeasonCurrent({ data: { seasonId, confirmMakeCurrent: true } });
            setMsg("Season is now current.");
            await onDone();
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "Failed");
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
      >
        <Star className="h-4 w-4" /> {busy ? "Working…" : "Make current"}
      </button>
      {msg && <span className="ml-3 text-xs text-muted-foreground">{msg}</span>}
    </section>
  );
}

// ---------- Lane pairs ------------------------------------------------------

function LanePairsBlock({
  seasonId,
  pairs,
  onChanged,
}: {
  seasonId: string;
  pairs: { id: string; label: string; displayOrder: number; matchupCapacity: number; active: boolean }[];
  onChanged: () => Promise<void>;
}) {
  const totals = summarizeLanePairs(pairs);
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [displayOrder, setDisplayOrder] = useState((pairs.length + 1).toString());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setDisplayOrder((pairs.length + 1).toString());
  }, [pairs.length]);

  async function addPair(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await adminUpsertLanePair({
        data: {
          seasonId,
          label: label.trim(),
          displayOrder: Number(displayOrder) || 0,
          matchupCapacity: Number(capacity) || 0,
        },
      });
      setLabel("");
      setCapacity("4");
      await onChanged();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Lane pairs</h2>
        <span className="text-xs text-muted-foreground">
          {totals.totalMatchups} matchups · {totals.bowlerCapacity} bowlers
        </span>
      </div>
      {pairs.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">No lane pairs configured yet.</p>
      ) : (
        <table className="mb-3 w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr><th className="text-left">Label</th><th className="text-right">Order</th><th className="text-right">Cap</th><th className="text-left">Active</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pairs.map((p) => <LanePairRow key={p.id} seasonId={seasonId} pair={p} onChanged={onChanged} />)}
          </tbody>
        </table>
      )}
      <form onSubmit={addPair} className="flex flex-wrap items-end gap-2">
        <Field label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="1-2" className={inputCls} /></Field>
        <Field label="Display order"><input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} className={inputCls} /></Field>
        <Field label="Matchup capacity"><input type="number" min={0} max={64} value={capacity} onChange={(e) => setCapacity(e.target.value)} className={inputCls} /></Field>
        <button type="submit" disabled={busy || !label.trim()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">Add lane pair</button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </form>
    </section>
  );
}

function LanePairRow({
  seasonId,
  pair,
  onChanged,
}: {
  seasonId: string;
  pair: { id: string; label: string; displayOrder: number; matchupCapacity: number; active: boolean };
  onChanged: () => Promise<void>;
}) {
  const [capacity, setCapacity] = useState(pair.matchupCapacity.toString());
  const [order, setOrder] = useState(pair.displayOrder.toString());
  const [active, setActive] = useState(pair.active);
  const [busy, setBusy] = useState(false);

  const dirty = String(pair.matchupCapacity) !== capacity || String(pair.displayOrder) !== order || pair.active !== active;

  return (
    <tr>
      <td className="py-1 font-mono text-sm">{pair.label}</td>
      <td className="py-1 text-right"><input type="number" value={order} onChange={(e) => setOrder(e.target.value)} className="w-16 rounded border border-border bg-background px-1 text-right text-sm" /></td>
      <td className="py-1 text-right"><input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="w-16 rounded border border-border bg-background px-1 text-right text-sm" /></td>
      <td className="py-1"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /></td>
      <td className="py-1 text-right">
        {dirty && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await adminUpsertLanePair({
                  data: {
                    id: pair.id,
                    seasonId,
                    label: pair.label,
                    displayOrder: Number(order),
                    matchupCapacity: Number(capacity),
                    active,
                  },
                });
                await onChanged();
              } finally { setBusy(false); }
            }}
            className="mr-2 rounded border border-border px-2 text-xs hover:bg-accent"
          >Save</button>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            if (!window.confirm(`Remove lane pair ${pair.label}?`)) return;
            setBusy(true);
            try {
              await adminDeleteLanePair({ data: { id: pair.id, seasonId } });
              await onChanged();
            } finally { setBusy(false); }
          }}
          className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10"
        ><Trash2 className="h-3 w-3" /> Remove</button>
      </td>
    </tr>
  );
}

// ---------- Participants ---------------------------------------------------

function ParticipantsBlock({
  seasonId,
  participants,
  peopleAvailable,
  people,
  onChanged,
  onPeopleChanged,
}: {
  seasonId: string;
  participants: { roster: Array<{ id: string; name: string; bowlerNumber: string | null; average: number | null; handicap: number | null; personId: string | null; personDisplayName?: string | null }>; substitutes: Array<{ id: string; name: string; bowlerNumber: string | null; average: number | null; handicap: number | null; personId: string | null; personDisplayName?: string | null }> } | undefined;
  peopleAvailable: boolean;
  people: Array<{ id: string; displayName: string }>;
  onChanged: () => Promise<void>;
  onPeopleChanged: () => Promise<void>;
}) {
  const [role, setRole] = useState<"rostered" | "substitute">("rostered");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [avg, setAvg] = useState("");
  const [personId, setPersonId] = useState<string>("");
  const [newPersonName, setNewPersonName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [people],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      let pid = personId;
      if (!pid && newPersonName.trim()) {
        const created = await createPerson({ data: { displayName: newPersonName.trim() } });
        pid = created.id;
        await onPeopleChanged();
      }
      if (!pid) throw new Error("Choose an existing person or type a new person's name.");
      await adminAddParticipant({
        data: {
          seasonId,
          role,
          personId: pid,
          name: name.trim() || newPersonName.trim(),
          bowlerNumber: number.trim(),
          average: avg ? Number(avg) : null,
        },
      });
      setName(""); setNumber(""); setAvg(""); setPersonId(""); setNewPersonName("");
      setMsg("Participant added.");
      await onChanged();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">Participants</h2>
      {!peopleAvailable ? (
        <p className="text-sm text-muted-foreground">Historical people table not available yet — apply the pending migration first.</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <ParticipantList title="Rostered" rows={participants?.roster ?? []} />
            <ParticipantList title="Substitutes" rows={participants?.substitutes ?? []} />
          </div>
          <form onSubmit={submit} className="mt-4 grid gap-2 md:grid-cols-6">
            <Field label="Role">
              <select value={role} onChange={(e) => setRole(e.target.value as "rostered" | "substitute")} className={inputCls}>
                <option value="rostered">Rostered</option>
                <option value="substitute">Substitute</option>
              </select>
            </Field>
            <Field label="Existing person">
              <select value={personId} onChange={(e) => { setPersonId(e.target.value); if (e.target.value) setNewPersonName(""); }} className={inputCls}>
                <option value="">— none —</option>
                {sortedPeople.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
              </select>
            </Field>
            <Field label="…or new person">
              <input value={newPersonName} onChange={(e) => { setNewPersonName(e.target.value); if (e.target.value) setPersonId(""); }} className={inputCls} placeholder="Full name" />
            </Field>
            <Field label="Seasonal display name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Bob Smith" />
            </Field>
            <Field label="Bowler #">
              <input value={number} onChange={(e) => setNumber(e.target.value)} className={inputCls} placeholder="01001" />
            </Field>
            <Field label="Starting avg">
              <input value={avg} onChange={(e) => setAvg(e.target.value)} className={inputCls} placeholder="140" />
            </Field>
            <div className="md:col-span-6 flex items-center gap-3">
              <button type="submit" disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
                {busy ? "Adding…" : "Add participant"}
              </button>
              {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
            </div>
          </form>
        </>
      )}
    </section>
  );
}

function ParticipantList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; name: string; bowlerNumber: string | null; average: number | null; handicap: number | null; personId: string | null; personDisplayName?: string | null }>;
}) {
  return (
    <div className="rounded border border-border">
      <div className="border-b border-border bg-accent/40 px-2 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title} ({rows.length})
      </div>
      {rows.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">None yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-2 py-1">
              <div>
                <div className="font-medium">{r.name}{r.bowlerNumber && <span className="ml-1 text-xs text-muted-foreground">#{r.bowlerNumber}</span>}</div>
                <div className="text-[10px] text-muted-foreground">
                  Avg {r.average ?? "—"} · HDCP {r.handicap ?? "—"}
                  {r.personId ? (
                    <> · <Link to="/people/$personId" params={{ personId: r.personId }} className="underline">{r.personDisplayName ?? "person"}</Link></>
                  ) : (
                    <span className="ml-1 text-amber-600"> · unlinked</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- shared ---------------------------------------------------------

const inputCls = "w-full rounded-md border border-border bg-background px-2 py-1 text-sm";

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <label className={`flex flex-col gap-1 ${span === 2 ? "md:col-span-2" : ""}`}>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
