import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/layout/AppShell";
import {
  createPerson,
  executePersonMerge,
  linkParticipantToPerson,
  listPeople,
  listUnlinkedParticipants,
  previewPersonMerge,
} from "@/lib/history-repo.functions";
import { Loader2, UserPlus } from "lucide-react";

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

  const filtered = (people.data?.people ?? []).filter((p) =>
    !search ? true : p.displayName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Permanent identities across all seasons. Link seasonal roster/substitute rows to a person, and merge accidental duplicates."
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
          <div className="mb-4 flex flex-wrap gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
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
                  await people.refetch();
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
            <div className="lg:col-span-2 overflow-x-auto rounded-lg border border-border bg-card">
              <table className="min-w-full text-sm">
                <thead className="bg-accent/40 text-xs uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-right">Rostered</th>
                    <th className="px-3 py-2 text-right">Substitute</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.displayName}</div>
                        {p.rosterCount + p.substituteCount === 0 && (
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">Unlinked</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{p.rosterCount}</td>
                      <td className="px-3 py-2 text-right">{p.substituteCount}</td>
                      <td className="px-3 py-2 text-right">
                        <Link to="/people/$personId" params={{ personId: p.id }} className="text-xs underline">Career</Link>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">No people found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <MergePanel people={filtered} onDone={async () => { await people.refetch(); await unlinked.refetch(); }} />
          </div>

          <UnlinkedBlock
            unlinked={unlinked.data}
            people={people.data.people}
            onDone={async () => { await people.refetch(); await unlinked.refetch(); }}
          />
        </>
      )}
    </>
  );
}

function Loading() {
  return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
}

// ------- Merge ------------------------------------------------------------

function MergePanel({
  people,
  onDone,
}: {
  people: Array<{ id: string; displayName: string; rosterCount: number; substituteCount: number }>;
  onDone: () => Promise<void>;
}) {
  const [keep, setKeep] = useState("");
  const [remove, setRemove] = useState("");
  const [preview, setPreview] = useState<{ repoints: Array<{ table: string; id: string }>; summary: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const options = useMemo(() => [...people].sort((a, b) => a.displayName.localeCompare(b.displayName)), [people]);

  async function runPreview() {
    setMsg(null); setPreview(null);
    if (!keep || !remove) { setMsg("Choose both people."); return; }
    if (keep === remove) { setMsg("Cannot merge a person into themselves."); return; }
    setBusy(true);
    try {
      const p = await previewPersonMerge({ data: { keepPersonId: keep, removePersonId: remove } });
      setPreview({ repoints: p.repoints, summary: p.summary });
    } catch (err) { setMsg(err instanceof Error ? err.message : "Preview failed"); }
    finally { setBusy(false); }
  }

  async function runMerge() {
    if (!preview) return;
    if (!window.confirm(`Merge these two people? ${preview.repoints.length} record(s) will be repointed. The duplicate person identity will be deleted; seasonal rows are preserved.`)) return;
    setBusy(true);
    try {
      await executePersonMerge({ data: { keepPersonId: keep, removePersonId: remove, confirmMerge: true } });
      setMsg("Merge completed."); setPreview(null); setKeep(""); setRemove("");
      await onDone();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Merge failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h2 className="mb-2 text-sm font-semibold">Merge duplicates</h2>
      <div className="space-y-2">
        <label className="block text-xs">
          <span className="text-muted-foreground">Keep</span>
          <select value={keep} onChange={(e) => { setKeep(e.target.value); setPreview(null); }} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm">
            <option value="">— pick person to KEEP —</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">Delete (merge into Keep)</span>
          <select value={remove} onChange={(e) => { setRemove(e.target.value); setPreview(null); }} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm">
            <option value="">— pick duplicate to REMOVE —</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button disabled={busy} onClick={runPreview} className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-60">
            Preview
          </button>
          {preview && (
            <button disabled={busy} onClick={runMerge} className="rounded-md bg-destructive px-2 py-1 text-xs text-destructive-foreground disabled:opacity-60">
              Confirm merge
            </button>
          )}
        </div>
        {preview && (
          <div className="rounded-md border border-dashed border-border bg-accent/20 p-2 text-xs">
            <div className="mb-1 font-semibold">{preview.repoints.length} record(s) will move to the kept person.</div>
            <ul className="list-disc pl-4">{preview.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}
        {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
      </div>
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
  people: Array<{ id: string; displayName: string }>;
  onDone: () => Promise<void>;
}) {
  if (!unlinked || !unlinked.available) return null;
  const rows = unlinked.rows;
  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-3">
      <h2 className="mb-2 text-sm font-semibold">Unlinked seasonal rows ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Every seasonal roster/substitute row is linked to a person.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr><th className="text-left">Season</th><th className="text-left">Role</th><th className="text-left">Name</th><th className="text-left">Link to person</th></tr>
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
  people: Array<{ id: string; displayName: string }>;
  onDone: () => Promise<void>;
}) {
  const [pid, setPid] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <tr>
      <td className="py-1 text-xs">{row.seasonLabel}</td>
      <td className="py-1 text-xs capitalize">{row.role}</td>
      <td className="py-1">{row.name}{row.bowlerNumber && <span className="ml-1 text-xs text-muted-foreground">#{row.bowlerNumber}</span>}</td>
      <td className="py-1">
        <div className="flex items-center gap-2">
          <select value={pid} onChange={(e) => setPid(e.target.value)} className="rounded border border-border bg-background px-1 text-xs">
            <option value="">— person —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
          <button
            disabled={busy || !pid}
            onClick={async () => {
              setBusy(true); setMsg(null);
              try {
                await linkParticipantToPerson({ data: { role: row.role, id: row.id, personId: pid } });
                await onDone();
              } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); }
              finally { setBusy(false); }
            }}
            className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground disabled:opacity-60"
          >Link</button>
          {msg && <span className="text-xs text-destructive">{msg}</span>}
        </div>
      </td>
    </tr>
  );
}
