## Goal

Extend Phase 1 admin workflow with (A) editable bowler + substitute rosters, (B) true frame-by-frame linescore entry, and (C) a shared persisted mock store so admin saves propagate to every public page without re-running season-wide generation.

## Assumptions

- Still mock-only; no Supabase enablement, no auth, no publish.
- Existing seeded mock data becomes the default snapshot loaded into the store on first visit (or after "Reset demo data").
- Frame-10 admin input allows richer notation (`XX7`, `X9/`, `9/-`, etc.) for accurate entry, but the SAVED tenth-frame mark is normalized to one of the seven allowed display strings (`XXX`, `XX`, `X/`, `/X`, `X`, `/`, `-`) — the per-frame cumulative total captures the exact scoring; display components keep the current format.
- "Frames Rolled" and advanced roster-only aggregates continue to exclude substitute games.
- Historical handicap on completed matches is frozen at entry time; entry-average edits only affect future matches.
- Aggregate snapshot is JSON in localStorage keyed by season; a small `version` field lets us reset if the shape changes.

## Architecture

### Shared league store (`src/lib/league-store.ts`)

Single source of truth for all mutable state:

```text
LeagueState
  version: number
  rosteredBowlers: Bowler[]          // includes `active`, `archived`
  substitutes: Substitute[]          // {id, name, active}
  weeks: WeekSchedule[]              // matches per week
  results: Record<matchId, MatchResult>
  snapshot: PublicSnapshot           // precomputed aggregates
```

- `loadState()` — reads localStorage; if empty/invalid version, seeds from `mock-data.ts` demo generator.
- `saveState(next)` — persists + bumps a subscription counter.
- `useLeagueState()` — React hook using `useSyncExternalStore` so every route re-renders when the store changes.
- `applyResult(matchId, draft)` — validates, writes result, recomputes only the affected match + rebuilds the snapshot (still O(matches), but only on admin action — never on public render).
- `resetToDemo()` — clears + reseeds with confirmation.

Public routes replace their direct `mock-data` reads with `useLeagueState().snapshot.*`. The seed generator moves behind the store; `mock-data.ts` exports the seed builder and type/helpers only.

### PublicSnapshot shape

Precomputed once per admin save:
- `standings: StandingsRow[]`
- `weeklyResults: Record<week, WeeklyResultCard[]>`
- `bowlerProfiles: Record<bowlerId, BowlerProfile>`
- `leaderboards: { standard, advanced }`
- `laneData: LanePairSummary[]`
- `stats: StatsSummary`
- `lastComputedAt: number`

Public routes render straight from this — no season loops in components.

### Frame-by-frame editor (`src/components/linescore/GameEditor.tsx`)

- 10 frame cells per game, each with `mark` input + `running total` input.
- Frames 1–9 accept `X`, `/`, `-`, or `0`–`9` digits (open pinfall).
- Frame 10 accepts richer notation (`XXX`, `XX7`, `X9/`, `9/X`, `9/-`, `X`, `/`, `-`, etc.); on save, we compute the frame-10 pin contribution from running total and normalize the stored mark to the allowed 7-string set via `normalizeTenthMark(input, contribution)`.
- Normalizer: uppercase, trim, reject impossible combos (`/` in ball-1, digits > 9, etc.).
- Running-total validator: monotonic, non-negative, per-frame delta within class range (open 0–9, spare 10–20, strike 10–30, frame-10 strike/spare 10–30).
- Live per-game validity indicator; three-game set total shown live.
- Keyboard: `Tab` moves mark→total→next-frame-mark; `Enter` jumps to next game.
- Mobile: stack games vertically with sticky frame headers.

### Admin bowlers page (`src/routes/admin.bowlers.tsx`)

Two tabbed lists (Rostered / Substitutes). Add / edit inline / archive (soft-delete) / mark active-inactive. Handicap auto-computed & shown read-only. Active-count badge warns when rostered active ≠ 36. Duplicate-name check (case+trim) warns without blocking. Archived people remain in the store so historical match records keep displaying their name.

### Result-entry rewrite (`src/routes/admin.results.tsx`)

- Replaces three scratch inputs with two `<GameEditor>` blocks (one per side, three games each).
- Substitute status: `<Select>` sourced from active subs + inline "Add substitute" that writes to the store.
- Absent side hides the editor and strongly prompts override.
- Live preview of derived scratch totals, handicap totals, game awards, set award, awarded points — all from the frame data.
- Save button calls `applyResult()` which validates, freezes the current handicap onto the result record, and updates the snapshot.

## Files to add / edit

Add:
- `src/lib/league-store.ts` — store, subscriptions, seed loader, snapshot builder.
- `src/lib/snapshot.ts` — pure functions to build `PublicSnapshot` from raw records.
- `src/lib/frame-input.ts` — mark parser, tenth-frame normalizer, validators.
- `src/components/linescore/GameEditor.tsx` — frame + running-total grid.
- `src/components/linescore/MatchLinescoreEditor.tsx` — two-side wrapper with live summary.
- `src/routes/admin.bowlers.tsx` — roster/sub management UI.
- Deterministic validator module (runs at module load, same pattern as existing) covering the 10 test cases.

Edit:
- `src/lib/mock-data.ts` — export seed builder; keep types/helpers; remove IIFE aggregates (moved to snapshot).
- `src/routes/admin-login.tsx` — add link to `/admin/bowlers` and "Reset demo data" button.
- `src/routes/admin.schedule.tsx` — read active rostered bowlers from store; write draft/published schedule to store.
- `src/routes/admin.results.tsx` — use `MatchLinescoreEditor`; write via `applyResult()`.
- All public routes (`standings`, `weekly-results`, `bowlers`, `bowlers.$bowlerId`, `statistics`, `leaderboards`, `leaderboards.advanced`, `lane-data`, `elimination`, `index`) — swap direct mock-data imports for `useLeagueState().snapshot`.
- `AppShell` — nav unchanged; admin sub-nav gains a "Bowlers" link when inside `/admin/*`.

## Validation

Deterministic asserts at module load (same style as current `assertMatchResult`):

1. Archive-preserves-history: edit bowler → inactive; completed match still renders original name.
2. Sub add → appears in picker; sub archive → hidden from picker but historical label intact.
3. Frame-10 fixtures: strike-strike-strike, strike-strike-pins, strike-spare, spare-strike, spare-pins, open — each round-trips through `normalizeTenthMark` and `validateGame`.
4. Running total of frame 10 == recorded game scratch.
5. Three games → set totals → handicap totals → 2/1/0 awards → 7-point sum.
6. Sub linescore visible on weekly-results but roster-only leaderboard sums exclude it.
7. Absent side: no linescore, no stat rows generated.
8. Override: awarded points change; frame-derived stats unchanged.
9. `applyResult` bumps store version → snapshot values used by public routes reflect new totals.
10. Public route render path is a straight read: assertion counts snapshot accesses vs. season recomputations (recomputations == 0).

## Verification

- `tsgo --noEmit` clean.
- Full production build.
- Curl smoke: `/admin/bowlers`, `/admin/schedule`, `/admin/results`, `/standings`, `/weekly-results`, `/bowlers`, `/bowlers/b01`, `/statistics`, `/leaderboards`, `/leaderboards/advanced`, `/lane-data`, `/elimination` → 200.
- Manual click-through via Playwright: add a sub, enter a linescore, verify standings row updates without refresh.

## Out of scope

- Real auth, real database, publish, deploy.
- Multi-season history.
- Undo/redo beyond "Reset demo data".
