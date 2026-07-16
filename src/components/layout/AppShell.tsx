import { Link, useRouterState } from "@tanstack/react-router";
import { LEAGUE_NAME, SEASON_LABEL, VENUE_NAME } from "@/lib/mock-data";
import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/use-session";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/standings", label: "Standings" },
  { to: "/schedule", label: "Schedule" },
  { to: "/weekly-results", label: "Weekly Results" },
  { to: "/leaderboards", label: "Leaderboards" },
  { to: "/bowlers", label: "Bowlers" },
  { to: "/statistics", label: "Statistics" },
  { to: "/lane-data", label: "Lane Data" },
  { to: "/elimination", label: "Elimination" },
  { to: "/seasons", label: "Seasons" },
] as const;


function DuckpinBallMark({ className }: { className?: string }) {
  // Duckpin balls have NO finger holes — render as a plain sphere with a
  // subtle highlight only.
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="dpb" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="oklch(0.55 0.20 27)" />
          <stop offset="60%" stopColor="oklch(0.42 0.18 27)" />
          <stop offset="100%" stopColor="oklch(0.25 0.10 27)" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="17" fill="url(#dpb)" />
      <circle cx="14" cy="14" r="3" fill="oklch(0.95 0.05 90 / 0.5)" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { session } = useSession();
  const adminLink = session
    ? { to: "/admin/bowlers" as const, label: "Admin" }
    : { to: "/admin-login" as const, label: "Admin Login" };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <DuckpinBallMark className="h-8 w-8" />
            <div className="leading-tight">
              <div className="font-display text-lg font-bold tracking-wide">
                {LEAGUE_NAME}
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {VENUE_NAME} · {SEASON_LABEL}
              </div>
            </div>
          </Link>
          <nav className="ml-auto hidden lg:flex items-center gap-1">
            {NAV.map((n) => {
              const active =
                n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "px-3 py-2 text-sm rounded-md transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
            <Link
              to={adminLink.to}
              className={cn(
                "px-3 py-2 text-sm rounded-md transition-colors",
                pathname.startsWith("/admin")
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              {adminLink.label}
            </Link>
          </nav>
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto lg:hidden rounded-md p-2 hover:bg-accent"
            aria-label="Toggle menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <nav className="lg:hidden border-t border-border/60 bg-background">
            <div className="mx-auto max-w-7xl px-2 py-2 grid grid-cols-2 gap-1">
              {NAV.map((n) => {
                const active =
                  n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "px-3 py-2 text-sm rounded-md",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent",
                    )}
                  >
                    {n.label}
                  </Link>
                );
              })}
              <Link
                to={adminLink.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "px-3 py-2 text-sm rounded-md col-span-2",
                  pathname.startsWith("/admin")
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                {adminLink.label}
              </Link>
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>

      <footer className="border-t border-border/60 mt-12">
        <div className="mx-auto max-w-7xl px-4 py-6 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <div>
            © {new Date().getFullYear()} {LEAGUE_NAME} · {VENUE_NAME}
          </div>
          <div className="opacity-70">
            Phase 1 · public pages read pre-saved data only
          </div>
        </div>
      </footer>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-card/40 p-10 text-center">
      <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-accent" />
      <div className="font-semibold">{title}</div>
      {description && (
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      )}
    </div>
  );
}
