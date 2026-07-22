import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader, EmptyState } from "@/components/layout/AppShell";
import { adminListSeasons, adminUpsertSeason } from "@/lib/history-repo.functions";
import { sortSeasonsChronological } from "@/lib/season-history";
import { Loader2, Plus } from "lucide-react";

export const Route = createFileRoute("/admin/seasons/")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: AdminSeasonsPage,
});

function AdminSeasonsPage() {
  // ADMIN-ONLY listing. The public seasons endpoint is intentionally NOT
  // used here — admins must see draft/private seasons too.
  const q = useQuery({ queryKey: ["admin", "seasons"], queryFn: () => adminListSeasons() });
  const navigate = useNavigate();

  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [totalWeeks, setTotalWeeks] = useState("11");
  const [pointSystem, setPointSystem] = useState("7");
  const [handicapPercent, setHandicapPercent] = useState("80");
  const [handicapBase, setHandicapBase] = useState("160");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function createSeason(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || creating) return;
    setCreating(true);
    setMsg(null);
    try {
      // New seasons ALWAYS begin as draft + private. We deliberately do NOT
      // pass `status` or `publicVisible` here so the server default wins.
      const res = await adminUpsertSeason({
        data: {
          label: label.trim(),
          startDate: startDate || null,
          endDate: endDate || null,
          totalWeeks: totalWeeks ? Number(totalWeeks) : null,
          pointSystem: pointSystem === "4" ? 4 : 7,
          handicapPercent: handicapPercent ? Number(handicapPercent) : null,
          handicapBase: handicapBase ? Number(handicapBase) : null,
          description: description.trim() || null,
        },
      });
      // Reset + navigate to the season editor as required.
      setLabel(""); setStartDate(""); setEndDate(""); setDescription("");
      await q.refetch();
      navigate({ to: "/admin/seasons/$seasonId", params: { seasonId: res.id } });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

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
          <section className="mb-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Create a new season</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              New seasons are created as <strong>Draft</strong> and <strong>Private</strong> by default. Use the editor to configure lane pairs and participants, and the Make Current control to promote.
            </p>
            <form onSubmit={createSeason} className="grid gap-3 md:grid-cols-3">
              <Field label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2027 Summer" className={inputCls} required /></Field>
              <Field label="Point system">
                <select value={pointSystem} onChange={(e) => setPointSystem(e.target.value)} className={inputCls}>
                  <option value="7">7-point</option>
                  <option value="4">4-point</option>
                </select>
              </Field>
              <Field label="Total weeks"><input type="number" min={1} max={60} value={totalWeeks} onChange={(e) => setTotalWeeks(e.target.value)} className={inputCls} /></Field>
              <Field label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></Field>
              <Field label="End date"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} /></Field>
              <Field label="Handicap %"><input type="number" min={0} max={100} value={handicapPercent} onChange={(e) => setHandicapPercent(e.target.value)} className={inputCls} /></Field>
              <Field label="Handicap base"><input type="number" min={0} max={300} value={handicapBase} onChange={(e) => setHandicapBase(e.target.value)} className={inputCls} /></Field>
              <Field label="Description / notes" span={3}>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional notes about this season." className={`${inputCls} min-h-16`} />
              </Field>
              <div className="md:col-span-3 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={creating || !label.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" /> {creating ? "Creating…" : "Create draft season"}
                </button>
                {msg && <span className="text-xs text-destructive">{msg}</span>}
              </div>
            </form>
          </section>

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
                    <td className="px-3 py-2 text-xs">
                      <VisibilityBadge publicVisible={s.publicVisible} />
                    </td>
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

function VisibilityBadge({ publicVisible }: { publicVisible: boolean }) {
  const cls = publicVisible
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${cls}`}>
      {publicVisible ? "Public" : "Private"}
    </span>
  );
}

const inputCls = "w-full rounded-md border border-border bg-background px-2 py-1 text-sm";

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <label className={`flex flex-col gap-1 ${span === 3 ? "md:col-span-3" : span === 2 ? "md:col-span-2" : ""}`}>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
