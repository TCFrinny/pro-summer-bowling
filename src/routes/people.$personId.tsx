import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader, EmptyState } from "@/components/layout/AppShell";
import { Loader2 } from "lucide-react";
import { aggregateCareerTotals, type CareerSeasonRow } from "@/lib/season-history";

export const Route = createFileRoute("/people/$personId")({
  head: () => ({
    meta: [
      { title: "Career — Pro Summer Singles" },
      { name: "description", content: "Permanent career profile across every season." },
    ],
  }),
  component: PersonPage,
});

/** Career profile fetch is deliberately best-effort. Until historical
 *  seasons are entered we just show the current linked seasonal rows.
 *  This route degrades cleanly when the `people` table is missing. */
async function fetchCareer(personId: string) {
  // Dynamic import so the browser bundle does not eagerly pull the
  // generated Supabase types module unless this route is visited.
  const { supabase } = await import("@/integrations/supabase/client");
  // Try the joined query; when the `people`/`person_id` column is absent
  // we return an "unavailable" marker rather than throwing.
  try {
    const rb = await (supabase.from as unknown as (t: string) => any)("rostered_bowlers") // eslint-disable-line @typescript-eslint/no-explicit-any
      .select("id,name,bowler_number,entry_average,handicap,season_id")
      .eq("person_id", personId);
    const sub = await (supabase.from as unknown as (t: string) => any)("substitutes") // eslint-disable-line @typescript-eslint/no-explicit-any
      .select("id,name,bowler_number,starting_average,handicap,season_id")
      .eq("person_id", personId);
    const person = await (supabase.from as unknown as (t: string) => any)("people") // eslint-disable-line @typescript-eslint/no-explicit-any
      .select("id,display_name,notes")
      .eq("id", personId)
      .maybeSingle();

    if (rb.error && (rb.error.code === "42P01" || rb.error.code === "42703")) {
      return { available: false as const };
    }
    const seasons = await supabase.from("seasons").select("id,label");
    const seasonLabelById = new Map<string, string>();
    for (const s of seasons.data ?? []) seasonLabelById.set(s.id, s.label);

    const rows: CareerSeasonRow[] = [];
    for (const r of (rb.data ?? []) as Array<Record<string, unknown>>) {
      rows.push({
        seasonId: String(r.season_id),
        seasonLabel: seasonLabelById.get(String(r.season_id)) ?? "—",
        role: "rostered",
        seasonalName: String(r.name ?? ""),
        bowlerNumber: (r.bowler_number as string | null) ?? null,
        startingAverage: r.entry_average != null ? Number(r.entry_average) : null,
        handicap: r.handicap != null ? Number(r.handicap) : null,
        hasGameData: false, // populated when historical snapshots land
      });
    }
    for (const r of (sub.data ?? []) as Array<Record<string, unknown>>) {
      rows.push({
        seasonId: String(r.season_id),
        seasonLabel: seasonLabelById.get(String(r.season_id)) ?? "—",
        role: "substitute",
        seasonalName: String(r.name ?? ""),
        bowlerNumber: (r.bowler_number as string | null) ?? null,
        startingAverage: r.starting_average != null ? Number(r.starting_average) : null,
        handicap: r.handicap != null ? Number(r.handicap) : null,
        hasGameData: false,
      });
    }
    return {
      available: true as const,
      person: person.data
        ? { id: String(person.data.id), displayName: String(person.data.display_name), notes: person.data.notes as string | null }
        : null,
      rows,
    };
  } catch (err) {
    console.warn("fetchCareer failed", err);
    return { available: false as const };
  }
}

function PersonPage() {
  const { personId } = Route.useParams();
  const q = useQuery({ queryKey: ["people", personId], queryFn: () => fetchCareer(personId) });
  return (
    <AppShell>
      {q.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}
      {q.data && !q.data.available && (
        <>
          <PageHeader title="Career profile" />
          <EmptyState
            title="Career profiles not available yet"
            description="Apply the pending multi-season history migration to enable permanent people and cross-season profiles."
          />
        </>
      )}
      {q.data && q.data.available && (
        <>
          <PageHeader
            title={q.data.person?.displayName ?? "Career profile"}
            subtitle="All seasons this person has been linked to across the league."
          >
            <Link to="/bowlers" className="text-sm underline">Roster</Link>
          </PageHeader>
          <CareerBody rows={q.data.rows} />
          {q.data.person?.notes && (
            <p className="mt-4 text-sm text-muted-foreground">{q.data.person.notes}</p>
          )}
        </>
      )}
    </AppShell>
  );
}

function CareerBody({ rows }: { rows: CareerSeasonRow[] }) {
  const totals = aggregateCareerTotals(rows);
  if (rows.length === 0) {
    return <EmptyState title="No linked seasons yet" description="This person is not linked to any seasonal roster or substitute record." />;
  }
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Seasons" value={totals.seasonsCount} />
        <Stat label="Championships" value={totals.championships} />
        <Stat label="Games (avail.)" value={totals.totalGames || "—"} />
        <Stat label="Avg (avail.)" value={totals.average != null ? totals.average.toFixed(1) : "—"} />
        <Stat label="Seasons w/ game data" value={totals.seasonsWithGameData} />
      </section>
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-3 text-sm font-semibold">Season history</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-accent/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Season</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Name / #</th>
                <th className="px-3 py-2 text-right">Start Avg</th>
                <th className="px-3 py-2 text-right">HDCP</th>
                <th className="px-3 py-2 text-right">Games</th>
                <th className="px-3 py-2 text-right">Avg</th>
                <th className="px-3 py-2 text-right">Finish</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={`${r.seasonId}-${r.role}-${i}`}>
                  <td className="px-3 py-2">
                    <Link to="/seasons/$seasonId" params={{ seasonId: r.seasonId }} className="underline">
                      {r.seasonLabel}
                    </Link>
                    {r.isChampion && <span className="ml-1 text-gold" aria-label="Champion">★</span>}
                  </td>
                  <td className="px-3 py-2 capitalize">{r.role}</td>
                  <td className="px-3 py-2">
                    {r.seasonalName}
                    {r.bowlerNumber && <span className="ml-1 text-xs text-muted-foreground">#{r.bowlerNumber}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{r.startingAverage ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.handicap ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.games ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.average != null ? r.average.toFixed(1) : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.finalFinish ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border p-3 text-xs text-muted-foreground">
          Season-level games/averages are shown from seasons with available game data. Missing values are left as em dashes, never zero.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{value}</div>
    </div>
  );
}
