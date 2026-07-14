import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import {
  formatPoints,
  getEliminationSnapshot,
  type EliminationStatus,
} from "@/lib/mock-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Circle, HelpCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/elimination")({
  head: () => ({
    meta: [
      { title: "Elimination — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Saved elimination proofs: clinched, alive, eliminated, and not proven within limit.",
      },
    ],
  }),
  component: EliminationPage,
});

const STATUS: Record<
  EliminationStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  calculating: {
    label: "Calculating",
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    className: "bg-accent text-muted-foreground",
  },
  clinched: {
    label: "Proven Clinched",
    icon: <CheckCircle2 className="h-4 w-4" />,
    className: "bg-gold text-gold-foreground",
  },
  eliminated: {
    label: "Proven Eliminated",
    icon: <XCircle className="h-4 w-4" />,
    className: "bg-primary/25 text-primary",
  },
  alive: {
    label: "Alive",
    icon: <Circle className="h-4 w-4" />,
    className: "bg-emerald-500/20 text-emerald-300",
  },
  not_proven: {
    label: "Not Proven Within Limit",
    icon: <HelpCircle className="h-4 w-4" />,
    className: "bg-secondary text-secondary-foreground",
  },
};

function EliminationPage() {
  // Read the last-published snapshot. NEVER run a solver here.
  const snap = getEliminationSnapshot();

  const counts = snap.rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<EliminationStatus, number>,
  );

  return (
    <AppShell>
      <PageHeader
        title="Elimination"
        subtitle="Displays the last saved elimination proof set. Recalculation only runs when the admin publishes new results."
      />

      <Card className="mb-6 bg-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 font-display text-xl">
            <span>Snapshot</span>
            <span className="text-xs font-normal text-muted-foreground">
              Last calculated{" "}
              {new Date(snap.lastCalculatedAt).toLocaleString()} ·{" "}
              {snap.weeksRemaining} weeks remaining
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          {(Object.keys(STATUS) as EliminationStatus[]).map((s) => (
            <div
              key={s}
              className={`rounded-md p-3 text-sm ${STATUS[s].className}`}
            >
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest opacity-90">
                {STATUS[s].icon} {STATUS[s].label}
              </div>
              <div className="font-display text-2xl">{counts[s] ?? 0}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-accent/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3 text-left">Bowler</th>
              <th className="px-3 py-3 text-right">Points</th>
              <th className="px-3 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {snap.rows.map((r) => (
              <tr key={r.bowler.id} className="hover:bg-accent/30">
                <td className="px-3 py-2 font-medium">{r.bowler.name}</td>
                <td className="px-3 py-2 text-right font-display text-base text-gold">
                  {formatPoints(r.bowler.points)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${STATUS[r.status].className}`}
                  >
                    {STATUS[r.status].icon} {STATUS[r.status].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
