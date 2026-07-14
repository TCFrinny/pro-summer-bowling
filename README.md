# Pro Summer Singles

Public site for the **Pro Summer Singles** duckpin bowling league at
**Mt. Airy Lanes** (2026 Summer season). This repo is the replacement for
the previous Flask/Python site.

## Phase 1 goals

Phase 1 ships a polished, fully navigable public interface backed by a
single mock data layer. The backend (Lovable Cloud / Supabase) and admin
authoring flows arrive in Phase 2.

## Scoring rules (7-point duckpin singles)

Every matchup distributes **exactly 7 points**:

- 3 games per match.
- Each **game** is worth **2 points** — win = 2, tie = 1 each, loss = 0
  (based on handicap game score).
- The 3-game **set** is worth **1 point** based on **total handicap
  pinfall** — win = 1, tie = 0.5 each, loss = 0.
- A bowler's match total can be `0, 0.5, 1, 1.5, … 7`. Example scores:
  `5–2`, `4.5–2.5`, `3.5–3.5`.
- **Handicap** = `floor(0.80 × (160 − entryAverage))`, minimum 0.
- **Season length**: 11 weeks.
- **Season averages** are **scratch only**, displayed to **3 decimals**.
- **Official standings tiebreaker**: total points **DESC**, then total
  handicap pinfall **DESC**.
- **Record (W - L)**: standings show each bowler's league points **won**
  and **lost** across completed matches. Because every match distributes
  exactly 7 points, `L = 7 − W` per match, so half-points and ties are
  handled naturally (e.g. `31 - 18`, `24.5 - 24.5`).
- **Points Behind (PB)**: informational only — never replaces the
  official tiebreaker. Standard games-behind formula on points won/lost:
  `PB = ((leaderW − W) + (L − leaderL)) / 2`. The leader displays `—`.
  Works correctly when bowlers have completed different numbers of
  matches. Set Points are still awarded as part of the 7-point match
  total but are **not** shown as a separate standings column.




### The performance rule (do not violate)

> **Public page navigation must never trigger expensive season-wide
> recalculations.** Public pages read already-saved records or cached
> summaries only. Calculations run only when an administrator saves or
> publishes results, and they write their outputs back to storage.

Concretely, in Phase 1:

- No page component contains solver logic, tournament simulation, or
  elimination proofs.
- The Elimination page renders a *saved* snapshot with a
  `lastCalculatedAt` timestamp — it does not run a solver on load.
- Standings, statistics, and lane data are read from
  pre-computed helpers in `src/lib/mock-data.ts` that mimic the shape of
  the future database reads.

When the database is enabled in Phase 2, the swap is one file: replace the
helpers in `src/lib/mock-data.ts` with reads against database tables /
materialized views. Route and component code should not need to change.

## Stack

- React 19 + TypeScript
- TanStack Router (file-based) + TanStack Start
- TanStack Query (already wired in `src/router.tsx`)
- Tailwind CSS v4 (tokens in `src/styles.css`)
- shadcn/ui components

> Note: the user brief mentioned React Router; this template ships with
> TanStack Router, so file-based routes under `src/routes/` are used.

## Route structure

All routes live in `src/routes/`.

| File | URL | Purpose |
| ---- | --- | ------- |
| `__root.tsx` | — | Head/meta, providers, error + 404 boundaries |
| `index.tsx` | `/` | Home / league landing |
| `standings.tsx` | `/standings` | Rank, points, pinfall, avg (3 decimals), movement |
| `schedule.tsx` | `/schedule` | 18 matches across lane pairs 1–2 … 11–12 |
| `weekly-results.tsx` | `/weekly-results` | Match cards: scratch games, hdcp, per-game points, set point, match total |
| `bowlers.tsx` | `/bowlers` | Roster + search |
| `bowlers.$bowlerId.tsx` | `/bowlers/:id` | Bowler profile + weekly history |
| `statistics.tsx` | `/statistics` | Leaders + sortable tables |
| `lane-data.tsx` | `/lane-data` | Season + weekly lane-pair summaries (POA) |
| `elimination.tsx` | `/elimination` | Saved elimination proofs + timestamp |
| `admin-login.tsx` | `/admin-login` | Login shell (disabled until Phase 2) |

Navigation lives in `src/components/layout/AppShell.tsx` and uses
`<Link>` — no full-page reloads.

## Mock data layer

`src/lib/mock-data.ts` is the single source of truth for Phase 1. It
exports:

- `BOWLERS` — 36 typed bowlers, deterministic (seeded RNG).
- `WEEKS` — 11 weeks, 7 completed.
- `getMatchesForWeek(week)` — 18 matches, 3 per lane pair.
- `getStandingsSnapshot()` — sorted by points desc, then handicap pinfall desc.
- `getSeasonLaneSummaries()`, `getWeekLaneSummaries(week)` — POA summaries.
- `getEliminationSnapshot()` — saved proof set + `lastCalculatedAt`.
- `getBowlerHistory(id)` — per-bowler weekly rows.

Every helper returns *already-computed* values. If Phase 2 needs new
derived data, compute it in an admin job and store the result — do not
compute it in a page component.

## Brand

- Dark navy / charcoal base, warm red primary, warm gold accent.
- Duckpin balls in graphics have **no finger holes** (duckpin balls are
  small and hole-less).
- Display font: Barlow Condensed (loaded via `<link>` in `__root.tsx`).

## Scripts

```bash
bun dev      # dev server
bun run build
```
