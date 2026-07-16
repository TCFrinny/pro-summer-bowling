import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader, EmptyState } from "@/components/layout/AppShell";
import { listPeople, createPerson } from "@/lib/history-repo.functions";
import { Loader2, UserPlus } from "lucide-react";

export const Route = createFileRoute("/admin/people")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: AdminPeoplePage,
});

function AdminPeoplePage() {
  const q = useQuery({ queryKey: ["admin", "people"], queryFn: () => listPeople() });
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const filtered = (q.data?.people ?? []).filter((p) =>
    !search ? true : p.displayName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Permanent identities across all seasons. Names may be duplicated across seasons — use these records to link them."
      />
      {q.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}
      {q.data && !q.data.available && (
        <EmptyState
          title="People table not available yet"
          description="Apply the pending multi-season history migration to enable this page."
        />
      )}
      {q.data && q.data.available && (
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
                setCreating(true);
                setMsg(null);
                try {
                  await createPerson({ data: { displayName: name.trim() } });
                  setName("");
                  setMsg("Person created.");
                  await q.refetch();
                } catch (err) {
                  setMsg(err instanceof Error ? err.message : "Create failed");
                } finally {
                  setCreating(false);
                }
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
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="min-w-full text-sm">
              <thead className="bg-accent/40 text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-right">Rostered seasons</th>
                  <th className="px-3 py-2 text-right">Substitute seasons</th>
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
                      <Link to="/people/$personId" params={{ personId: p.id }} className="text-xs underline">
                        Career
                      </Link>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No people found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Guarded merge and roster-link workflows land in the next phase — the safe repointing helper is already covered by deterministic tests.
          </p>
        </>
      )}
    </>
  );
}
