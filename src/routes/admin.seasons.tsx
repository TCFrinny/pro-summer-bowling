import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader, EmptyState } from "@/components/layout/AppShell";
import { adminListSeasons, adminUpsertSeason } from "@/lib/history-repo.functions";
import { Loader2, Plus } from "lucide-react";

export const Route = createFileRoute("/admin/seasons")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: AdminSeasonsPage,
});

function AdminSeasonsPage() {
  const q = useQuery({ queryKey: ["admin", "seasons"], queryFn: () => adminListSeasons() });
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Seasons"
        subtitle="Create, configure, and archive seasons. New seasons are created as Draft — an explicit action makes one current."
      />
      {q.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}
      {q.data && !q.data.available && (
        <EmptyState
          title="Historical season setup is not available yet"
          description="Apply the pending migration `db/pending-migrations/20260716_120000_seasons_people_phase.sql` to enable season history management."
        />
      )}
      {q.data && q.data.available && (
        <>
          <form
            className="mb-4 flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const label = newLabel.trim();
              if (!label || creating) return;
              setCreating(true);
              setMsg(null);
              try {
                await adminUpsertSeason({ data: { label } });
                setNewLabel("");
                setMsg("Draft season created.");
                await q.refetch();
              } catch (err) {
                setMsg(err instanceof Error ? err.message : "Create failed");
              } finally {
                setCreating(false);
              }
            }}
          >
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="New season label (e.g. 2027 Winter)"
              className="w-72 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={creating || !newLabel.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> {creating ? "Creating…" : "New draft season"}
            </button>
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </form>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="min-w-full text-sm">
              <thead className="bg-accent/40 text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Label</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Visibility</th>
                  <th className="px-3 py-2 text-right">Points</th>
                  <th className="px-3 py-2 text-right">Weeks</th>
                  <th className="px-3 py-2 text-left">Dates</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {q.data.seasons.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 font-medium">{s.label}</td>
                    <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                    <td className="px-3 py-2 text-xs">{s.publicVisible ? "Public" : "Private"}</td>
                    <td className="px-3 py-2 text-right">{s.pointSystem ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{s.totalWeeks ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {s.startDate ? new Date(s.startDate).toLocaleDateString() : "—"}
                      {" – "}
                      {s.endDate ? new Date(s.endDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link to="/admin/seasons/$seasonId" params={{ seasonId: s.id }} className="text-xs underline">Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: "current" | "draft" | "archived" }) {
  const cls =
    status === "current"
      ? "bg-primary text-primary-foreground"
      : status === "archived"
        ? "bg-accent text-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${cls}`}>
      {status}
    </span>
  );
}
