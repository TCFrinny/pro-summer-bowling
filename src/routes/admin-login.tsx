import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Info, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/admin-login")({
  head: () => ({
    meta: [
      { title: "Admin Login — Pro Summer Singles" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLogin,
});

function AdminLogin() {
  return (
    <AppShell>
      <div className="mx-auto max-w-md">
        <Card className="bg-card">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/20">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-center font-display text-2xl">
              Admin Login
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => e.preventDefault()}
              aria-disabled
            >
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@mtairylanes.com"
                  autoComplete="username"
                  disabled
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  disabled
                />
              </div>
              <button
                type="submit"
                disabled
                className="w-full cursor-not-allowed rounded-md bg-primary/40 px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Sign in
              </button>
              <div className="flex items-start gap-2 rounded-md border border-border bg-accent/40 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                <span>
                  Authentication will be connected after the Lovable Cloud
                  backend is enabled in Phase 2. Admin editing controls are not
                  exposed publicly in Phase 1.
                </span>
              </div>
            </form>

            <div className="mt-6 border-t border-border pt-4">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                Phase 1 Admin Preview (no auth)
              </div>
              <div className="grid gap-2">
                <Link
                  to="/admin/bowlers"
                  className="flex items-center justify-between rounded-md border border-border bg-accent/40 px-3 py-2 text-sm hover:bg-accent"
                >
                  <span>Bowlers & Substitutes</span>
                  <ArrowRight className="h-4 w-4 text-gold" />
                </Link>
                <Link
                  to="/admin/schedule"
                  className="flex items-center justify-between rounded-md border border-border bg-accent/40 px-3 py-2 text-sm hover:bg-accent"
                >
                  <span>Manual Schedule Editor</span>
                  <ArrowRight className="h-4 w-4 text-gold" />
                </Link>
                <Link
                  to="/admin/results"
                  className="flex items-center justify-between rounded-md border border-border bg-accent/40 px-3 py-2 text-sm hover:bg-accent"
                >
                  <span>Weekly Result Entry (frame-by-frame)</span>
                  <ArrowRight className="h-4 w-4 text-gold" />
                </Link>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Local-only mock state. Changes are not persisted and no admin
                data is visible on public routes.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
