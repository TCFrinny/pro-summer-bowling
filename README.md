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

## Source of truth: frame result + running cumulative

Every completed match stores a **result + cumulative-only** linescore in
`src/lib/duckpin.ts` + `src/lib/mock-data.ts`. Each side is a
`BowlerMatchLinescore` with three `GameLinescore`s of 10 `FrameLinescore`
rows. A `FrameLinescore` carries ONLY:

- `frameNumber` (1–10)
- `mark` — the score-sheet notation
  (frames 1–9: `X` / `/` / `-`; frame 10: one of the seven allowed saved
  combos — `XXX`, `XX`, `X/`, `/X`, `X`, `/`, `-`)
- `cumulativeScore` — the running scratch total through that frame

**No individual ball information is stored, displayed, required, or
validated anywhere in the public model.** This mirrors the admin input
model: 10 marks + 10 cumulative totals per game.

Classification (used for strikes/spares/opens counts and derived %):
frames 1–9 by the mark itself; frame 10 by the **initial** mark character
only. Tenth-frame bonus marks are display notation and never inflate frame,
strike, spare, or denominator counts.

Development-time validators enforce: exactly 10 frames per game, legal mark
notation, non-negative and non-decreasing cumulative totals, open-frame
contribution in 0–9, spare-frame contribution in 10–20, strike-frame
contribution in 10–30, `First5 + Last5 = final`, `BigOpening = cumulative
after frame 3`, `BigFinish = final − cumulative after frame 7`, matching
scratch/handicap totals, and exactly-7-point match distribution.

## Substitutes: roster-only vs credited

- **Scratch** performance, averages, strikes/spares/opens, marks, segments,
  and all advanced percentages belong to the **actual** bowler who rolled
  and are **roster-only** — off-roster substitutes are excluded.
- **League points** and **handicap pinfall** are **credited** to the
  **scheduled** (rostered) bowler regardless of who rolled.
- Boards label this distinction ("Scratch roster-only · Points/HCP credited").

## Leaderboards (`/leaderboards`, `/leaderboards/advanced`)

Standard boards (Season or any completed week):

- **Scratch (roster-only)**: High Game top 5, High Series top 5, Top Scratch
  Averages.
- **Points / HCP (credited)**: High Game HCP, High Series HCP, Top Total
  Points.
- **Volume (roster-only)**: Most Strikes, Most Spares, Fewest Opens (min 3 g).

Advanced boards (roster-only, subs excluded):

- **Mark %** = `(Strikes + Spares) / Frames`
- **Strike %** = `Strikes / Frames`
- **Spare Conversion %** = `Spares / (Spares + Opens)`
- **Open %** = `Opens / Frames` (lower is better)
- **Pins Lost** = `Σ(10 − openPinfall) / #openFrames`, where openPinfall is
  derived from the cumulative-score diff for that open frame (lower is
  better)
- **Consistency** = population std. dev. of scratch game scores (lower is
  better; Season view only, minimum 6 games)
- **First 5**, **Last 5**, **Big Opening** (frames 1–3), **Big Finish**
  (frames 8–10) — Season ranks by average PINS PER 3-GAME MATCH personally
  rolled; single-week ranks by that week's match total.
- **Clutch %** — marks in frames 9–10 across the scope (aggregate mark
  percentage).
- **Total Marks**, plus raw strike / spare counts.

Eligibility: percentage boards require ≥ 3 games in the selected scope;
consistency requires ≥ 6 games and is hidden for single-week views. Frame
denominators use **regulation frames only** — tenth-frame bonus marks do
not inflate the count.






### Linescores are the source of truth

Every completed match stores a full two-bowler **linescore**:
scheduled + actual bowler per side, sub flag, entry average, handicap,
three scratch games, three handicap games, scratch and handicap 3-game
totals, per-game point awards, set point, and final match points. A
runtime validator (`assertMatchResult`) enforces that:

- each game's awarded points sum to exactly 2 (2+0 or 1+1),
- handicap games equal `scratch + weekly handicap`,
- scratch and handicap totals match their game sums,
- set-point awards sum to exactly 1,
- and both sides always total exactly 7 match points.

All season aggregates on every page — standings, W-L, PB, statistics,
leaderboards, POA, bowler profiles — are derived **once at module load**
from those linescores. Bowlers carry no hand-entered aggregates that
could drift from the underlying games. Additional invariants:

- `W + L == 7 × matchesPlayed` per bowler (asserted at aggregation time),
- `scratchAverage == scratchPinfall / gamesPlayed`, displayed to 3 decimals,
- `highSet` = highest scratch 3-game total across all rows.

**POA baseline (Phase 1)**: pins-over-average uses each bowler's
**entry average** as the baseline. `poaSet = scratchTotal − 3 × entry`,
`poaBestGame = max(game − entry)`. When the database lands this becomes
a rolling scratch average per bowler.

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
- Standings, statistics, lane data, and bowler profiles read
  pre-computed helpers in `src/lib/mock-data.ts`. Aggregation runs
  once at module load, not per navigation.

When the database is enabled in Phase 2, admin result entry writes
linescores; public pages continue to read stored summaries derived
from them.

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
| `standings.tsx` | `/standings` | Rank, Record (W - L), PB, pinfall, avg, high game/set, movement |
| `schedule.tsx` | `/schedule` | 18 matches across lane pairs 1–2 … 11–12, with linked finals for completed weeks |
| `weekly-results.tsx` | `/weekly-results` | Full linescore per match: G1/G2/G3 with awarded points, hdcp totals, match points |
| `bowlers.tsx` | `/bowlers` | Roster + search |
| `bowlers.$bowlerId.tsx` | `/bowlers/:id` | Bowler profile + full game log + lane-pair usage + POA |
| `statistics.tsx` | `/statistics` | Leaders + sortable POA/points/pinfall tables |
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
- `getMatchesForWeek(week)` — 18 matches, 3 per lane pair, with full linescores for completed weeks.
- `assertMatchResult(match, result)` — runtime invariant checker for every completed linescore.
- `getStandingsSnapshot()` — sorted by points DESC, then handicap pinfall DESC.
- `computePointsBehind(leader, bowler)` — games-behind formula on W/L.
- `getSeasonLaneSummaries()`, `getWeekLaneSummaries(week)` — POA summaries.
- `getEliminationSnapshot()` — saved proof set + `lastCalculatedAt`.
- `getBowlerHistory(id)` — per-bowler weekly rows (full linescore + POA per week).
- `getBowlerSeasonExtras(id)` — POA and lane-pair usage from linescores.

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
