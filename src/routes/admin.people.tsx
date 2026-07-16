import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/layout/AppShell";
import {
  addPersonAlias,
  createAndLinkParticipant,
  createPerson,
  executePersonMerge,
  linkParticipantToPerson,
  listPeople,
  listUnlinkedParticipants,
  previewPersonMerge,
  removePersonAlias,
  type PersonMergePreview,
  type PersonRow,
  type PersonSeasonalRecord,
} from "@/lib/history-repo.functions";
import { ChevronDown, ChevronRight, Loader2, UserPlus, X } from "lucide-react";

export const Route = createFileRoute("/admin/people")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: AdminPeoplePage,
});

function AdminPeoplePage() {
  const people = useQuery({ queryKey: ["admin", "people"], queryFn: () => listPeople() });
  const unlinked = useQuery({ queryKey: ["admin", "people", "unlinked"], queryFn: () => listUnlinkedParticipants() });
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([people.refetch(), unlinked.refetch()]);
  };

  // Server-side haystack covers permanent name + aliases + seasonal names +
  // bowler numbers. Client filter is a single case-insensitive includes().
  const filtered = useMemo(() => {
    const rows = people.data?.people ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => p.searchHaystack.includes(q));
  }, [people.data, search]);

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Permanent identities across all seasons. Search covers names, aliases, seasonal names, and bowler numbers."
      />
      {people.isLoading && <Loading />}
      {people.data && !people.data.available && (
        <EmptyState
          title="People table not available yet"
          description="Apply the pending multi-season history migration to enable this page."
        />
      )}
      {people.data && people.data.available && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, alias, seasonal name, or bowler #…"
              className="w-96 max-w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
            <form
              className="ml-auto flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim() || creating) return;
                setCreating(true); setMsg(null);
                try {
                  await createPerson({ data: { displayName: name.trim() } });
                  setName("");
                  setMsg("Person created.");
                  await refresh();
                } catch (err) { setMsg(err instanceof Error ? err.message : "Create failed"); }
                finally { setCreating(false); }
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New person's display name"
                className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={creating || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
              >
                <UserPlus className="h-4 w-4" /> {creating ? "Adding…" : "Add"}
              </button>
            </form>
          </div>
          {msg && <div className="mb-3 text-xs text-muted-foreground">{msg}</div>}

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-2">
              {filtered.map((p) => (
                <PersonCard key={p.id} person={p} onDone={refresh} />
              ))}
              {filtered.length === 0 && (
                <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
                  No people match that search.
                </div>
              )}
            </div>

            <MergePanel people={people.data.people} onDone={refresh} />
          </div>

          <UnlinkedBlock
            unlinked={unlinked.data}
            people={people.data.people}
            onDone={refresh}
          />
        </>
      )}
    </>
  );
}

function Loading() {
  return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
}

// ------- Person card ------------------------------------------------------

function PersonCard({ person, onDone }: { person: PersonRow; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleAddAlias(e: React.FormEvent) {
    e.preventDefault();
    if (!alias.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      await addPersonAlias({ data: { personId: person.id, alias: alias.trim() } });
      setAlias("");
      await onDone();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function handleRemoveAlias(aliasId: string, aliasText: string) {
    if (!window.confirm(`Remove alias "${aliasText}"? This does not touch any seasonal record.`)) return;
    setBusy(true); setMsg(null);
    try {
      await removePersonAlias({ data: { aliasId } });
      await onDone();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  }

  const unlinkedBadge = person.rosterCount + person.substituteCount === 0;
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-medium">{person.displayName}</span>
        {unlinkedBadge && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">Unlinked</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {person.rosterCount} rostered · {person.substituteCount} sub · {person.aliases.length} alias{person.aliases.length === 1 ? "" : "es"}
        </span>
        <Link
          to="/people/$personId"
          params={{ personId: person.id }}
          onClick={(e) => e.stopPropagation()}
          className="text-xs underline"
        >
          Career
        </Link>
      </button>
      {open && (
        <div className="border-t border-border p-3 space-y-3 text-sm">
          {/* Aliases */}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Aliases</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {person.aliases.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 rounded bg-accent/40 px-2 py-0.5 text-xs">
                  {a.alias}
                  <button
                    onClick={() => handleRemoveAlias(a.id, a.alias)}
                    disabled={busy}
                    className="rounded p-0.5 hover:bg-destructive/20"
                    aria-label={`Remove alias ${a.alias}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {person.aliases.length === 0 && <span className="text-xs text-muted-foreground">None.</span>}
            </div>
            <form onSubmit={handleAddAlias} className="mt-1 flex items-center gap-1.5">
              <input
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="Add alias (nickname, prior last name…)"
                className="w-64 max-w-full rounded border border-border bg-background px-2 py-1 text-xs"
              />
              <button
                type="submit"
                disabled={busy || !alias.trim()}
                className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-60"
              >Add alias</button>
              {msg && <span className="text-xs text-destructive">{msg}</span>}
            </form>
          </div>

          {/* Seasonal records */}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Seasonal records</div>
            {person.seasonalRecords.length === 0 ? (
              <p className="text-xs text-muted-foreground">No linked seasonal roster or substitute rows yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left">Season</th>
                    <th className="text-left">Role</th>
                    <th className="text-left">Name</th>
                    <th className="text-left">#</th>
                    <th className="text-right">Avg</th>
                    <th className="text-right">HDCP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {person.seasonalRecords.map((r) => <SeasonalRow key={`${r.role}:${r.id}`} row={r} />)}
                </tbody>
              </table>
            )}
          </div>
          {person.notes && <p className="text-xs text-muted-foreground">{person.notes}</p>}
        </div>
      )}
    </div>
  );
}

function SeasonalRow({ row }: { row: PersonSeasonalRecord }) {
  return (
    <tr>
      <td className="py-1">
        {row.seasonLabel}
        <span className="ml-1 text-[10px] uppercase text-muted-foreground">{row.seasonStatus}</span>
      </td>
      <td className="py-1 capitalize">{row.role}</td>
      <td className="py-1">{row.name}</td>
      <td className="py-1">{row.bowlerNumber ?? "—"}</td>
      <td className="py-1 text-right">{row.average ?? "—"}</td>
      <td className="py-1 text-right">{row.handicap ?? "—"}</td>
    </tr>
  );
}

// ------- Merge ------------------------------------------------------------

function MergePanel({
  people,
  onDone,
}: {
  people: PersonRow[];
  onDone: () => Promise<void>;
}) {
  const [keep, setKeep] = useState("");
  const [remove, setRemove] = useState("");
  const [preview, setPreview] = useState<PersonMergePreview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const options = useMemo(() => [...people].sort((a, b) => a.displayName.localeCompare(b.displayName)), [people]);

  async function runPreview() {
    setMsg(null); setPreview(null); setTyped("");
    if (!keep || !remove) { setMsg("Choose both people."); return; }
    if (keep === remove) { setMsg("Cannot merge a person into themselves."); return; }
    setBusy(true);
    try {
      const p = await previewPersonMerge({ data: { keepPersonId: keep, removePersonId: remove } });
      setPreview(p);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Preview failed"); }
    finally { setBusy(false); }
  }

  async function runMerge() {
    if (!preview) return;
    if (typed !== "MERGE") { setMsg("Type MERGE (all caps) to confirm."); return; }
    const totalMove = preview.rostered.length + preview.substitutes.length + preview.championSeasons.length + preview.aliases.length;
    // Second gate: browser confirm. Belt-and-braces per the plan.
    if (!window.confirm(
      `MERGE\n\nKeep: ${preview.keepDisplayName}\nDelete: ${preview.removeDisplayName}\n\n${totalMove} reference(s) will be repointed. The duplicate person identity is deleted. Seasonal roster, substitute, result, and season rows are preserved.\n\nProceed?`,
    )) return;
    setBusy(true); setMsg(null);
    try {
      await executePersonMerge({ data: { keepPersonId: keep, removePersonId: remove, confirmMerge: true } });
      setMsg("Merge completed."); setPreview(null); setKeep(""); setRemove(""); setTyped("");
      await onDone();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Merge failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h2 className="mb-2 text-sm font-semibold">Merge duplicates</h2>
      <div className="space-y-2">
        <label className="block text-xs">
          <span className="text-muted-foreground">Keep person</span>
          <select
            value={keep}
            onChange={(e) => { setKeep(e.target.value); setPreview(null); setTyped(""); }}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">— pick person to KEEP —</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">Duplicate person (merge into Keep)</span>
          <select
            value={remove}
            onChange={(e) => { setRemove(e.target.value); setPreview(null); setTyped(""); }}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">— pick duplicate to REMOVE —</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button disabled={busy} onClick={runPreview} className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-60">
            Preview
          </button>
        </div>
        {preview && (
          <div className="space-y-2 rounded-md border border-dashed border-border bg-accent/20 p-2 text-xs">
            <div className="font-semibold">
              Keep <span className="underline">{preview.keepDisplayName}</span> · Delete <span className="underline">{preview.removeDisplayName}</span>
            </div>
            <ul className="list-disc pl-4">
              {preview.summary.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
            <MergeSection title="Rostered rows" items={preview.rostered.map((r) => ({ id: r.id, label: `${r.seasonLabel} — ${r.name}`, conflict: r.conflict }))} />
            <MergeSection title="Substitute rows" items={preview.substitutes.map((r) => ({ id: r.id, label: `${r.seasonLabel} — ${r.name}`, conflict: r.conflict }))} />
            <MergeSection title="Season champion references" items={preview.championSeasons.map((r) => ({ id: r.id, label: r.seasonLabel }))} />
            <MergeSection title="Aliases" items={preview.aliases.map((a) => ({ id: a.id, label: a.alias, conflict: a.conflict }))} />

            <label className="block">
              <span className="text-muted-foreground">Type <span className="font-mono font-semibold">MERGE</span> to unlock:</span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="MERGE"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
              />
            </label>
            <button
              disabled={busy || typed !== "MERGE"}
              onClick={runMerge}
              className="rounded-md bg-destructive px-2 py-1 text-xs text-destructive-foreground disabled:opacity-60"
            >
              Confirm merge
            </button>
          </div>
        )}
        {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
      </div>
    </div>
  );
}

function MergeSection({ title, items }: { title: string; items: Array<{ id: string; label: string; conflict?: boolean }> }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{title} ({items.length})</div>
      <ul className="ml-3 list-disc">
        {items.map((it) => (
          <li key={it.id}>
            {it.label}
            {it.conflict && <span className="ml-1 rounded bg-destructive/20 px-1 text-[10px] text-destructive">conflict — dropped</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------- Unlinked participants --------------------------------------------

function UnlinkedBlock({
  unlinked,
  people,
  onDone,
}: {
  unlinked: { available: boolean; rows: Array<{ id: string; role: "rostered" | "substitute"; seasonId: string; seasonLabel: string; name: string; bowlerNumber: string | null }> } | undefined;
  people: PersonRow[];
  onDone: () => Promise<void>;
}) {
  if (!unlinked || !unlinked.available) return null;
  const rows = unlinked.rows;
  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-3">
      <h2 className="mb-2 text-sm font-semibold">
        Unlinked seasonal rows
        <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
          Unlinked · {rows.length}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Every seasonal roster/substitute row is linked to a person.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr><th className="text-left">Season</th><th className="text-left">Role</th><th className="text-left">Name / #</th><th className="text-left">Link</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => <UnlinkedRow key={`${r.role}:${r.id}`} row={r} people={people} onDone={onDone} />)}
          </tbody>
        </table>
      )}
    </section>
  );
}

function UnlinkedRow({
  row,
  people,
  onDone,
}: {
  row: { id: string; role: "rostered" | "substitute"; seasonLabel: string; name: string; bowlerNumber: string | null };
  people: PersonRow[];
  onDone: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [pid, setPid] = useState("");
  const [newName, setNewName] = useState(row.name);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleLink() {
    setBusy(true); setMsg(null);
    try {
      if (mode === "existing") {
        if (!pid) { setMsg("Pick a person."); return; }
        await linkParticipantToPerson({ data: { role: row.role, id: row.id, personId: pid } });
      } else {
        if (!newName.trim()) { setMsg("Name required."); return; }
        await createAndLinkParticipant({ data: { role: row.role, id: row.id, displayName: newName.trim() } });
      }
      await onDone();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <tr>
      <td className="py-1 text-xs">{row.seasonLabel}</td>
      <td className="py-1 text-xs capitalize">
        {row.role}
        <span className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] uppercase text-amber-700 dark:text-amber-400">Unlinked</span>
      </td>
      <td className="py-1">{row.name}{row.bowlerNumber && <span className="ml-1 text-xs text-muted-foreground">#{row.bowlerNumber}</span>}</td>
      <td className="py-1">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "existing" | "new")}
            className="rounded border border-border bg-background px-1 text-xs"
          >
            <option value="existing">Existing…</option>
            <option value="new">Create new…</option>
          </select>
          {mode === "existing" ? (
            <select value={pid} onChange={(e) => setPid(e.target.value)} className="rounded border border-border bg-background px-1 text-xs">
              <option value="">— person —</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          ) : (
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Permanent display name"
              className="w-48 rounded border border-border bg-background px-1 text-xs"
            />
          )}
          <button
            disabled={busy || (mode === "existing" ? !pid : !newName.trim())}
            onClick={handleLink}
            className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground disabled:opacity-60"
          >{mode === "existing" ? "Link" : "Create & link"}</button>
          {msg && <span className="text-xs text-destructive">{msg}</span>}
        </div>
      </td>
    </tr>
  );
}
