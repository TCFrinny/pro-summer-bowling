# Phase D — Reusable Historical Season Data System

This plan covers a single reusable system for every non-current season (2025, 2024, future archives). Nothing here touches 2026 code paths.

## Scope check

This is a large body of work — new schema, ~10 admin surfaces, 6 public routes, career aggregation, and tests. I'll do it in one commit but in clearly separated internal phases so it stays reviewable. If any phase turns out larger than expected I'll flag it rather than silently shrinking scope.

## Safety invariants (enforced in every phase)

- All new code paths guard `season.is_current = false` server-side. Attempting a historical write against the current season → 403.
- 2026 uses existing tables (`weeks`, `match_results`, `live_match_results`, `public_snapshots`) untouched.
- Historical writes go to NEW season-scoped tables (see schema). No historical row ever lands in the current-season tables.
- Additive migration only. No column drops, no data rewrites, no changes to existing RLS on 2026 tables.
- Existing snapshot builder unchanged. New `historical_season_snapshots` is a separate cache.

## Phase D.1 — Schema (single additive migration)

```text
historical_weeks(id, season_id, week_number, date, published, completed, ...)
  UNIQUE (season_id, week_number)

historical_schedule_slots(id, season_id, week_id, lane_pair, slot,
  bowler_a_participant_id, bowler_b_participant_id, ...)
  UNIQUE (season_id, week_id, lane_pair, slot)
  CHECK bowler_a != bowler_b

historical_match_results(id, season_id, week_id, slot_id,
  detail_mode: 'full_linescore' | 'game_scores' | 'summary_only',
  side_a JSONB, side_b JSONB,          -- frozen participation, names, avgs, hdcps
  linescore_a JSONB, linescore_b JSONB, -- null unless full_linescore
  game_scores_a INT[3], game_scores_b INT[3], -- null unless game_scores/full
  points_a NUMERIC, points_b NUMERIC,
  point_override JSONB,                -- {points_a, points_b, reason}
  ...)

historical_season_summary_records(id, season_id, participant_ref,
  role: 'rostered'|'substitute',
  games, scratch_pinfall, average, high_game, high_set,
  points, points_lost, final_finish, is_champion, ...)
  -- every stat column NULLABLE; NULL = unavailable (never 0)

historical_season_snapshots(season_id PK, snapshot JSONB, built_at)
```

- `seasons.point_system` already exists; reuse it (4 or 7).
- Full RLS: public SELECT only when `season.public_visible AND status='archived'`; writes gated by `has_role(auth.uid(),'admin')` AND `season.is_current = false`.
- GRANTs for anon (SELECT) + authenticated + service_role per project rules.

## Phase D.2 — Server functions (`src/lib/historical-*.functions.ts`)

- `listHistoricalWeeks`, `generateHistoricalWeeks(seasonId, totalWeeks)`, `updateHistoricalWeek`.
- `listHistoricalSchedule(weekId)`, `upsertHistoricalScheduleSlot`, `deleteHistoricalScheduleSlot` — validates capacity, lane order, no duplicate bowler in a week.
- `saveHistoricalMatchResult` — routes by `detail_mode`; reuses existing 7-point / adds 4-point calculator; freezes identity; honors override.
- `upsertHistoricalSummaryRecord`, `listHistoricalSummaryRecords`.
- `rebuildHistoricalSeasonSnapshot(seasonId)` — season-scoped snapshot builder producing standings, weekly results, stats/leaderboards. Skips frame-derived stats for game-score/summary-only rows; marks unavailable fields as `null`.
- `getPublicHistoricalSeason(seasonId)` — enforces `archived + public_visible`; 404-shaped response otherwise.

## Phase D.3 — Points calculators

- `src/lib/points-7.ts` (extract from current logic, unchanged behavior).
- `src/lib/points-4.ts` — 1/game, 1 set, ties 0.5-0.5.
- Shared substitute/absent semantics identical to 2026.

## Phase D.4 — Admin UI

Extend `src/routes/admin.seasons.$seasonId.tsx` with a "Historical Data" section (only rendered when `!season.is_current`):

- Progress card: roster / weeks / schedules / results / summary counts.
- Sub-panels (tabs or collapsibles):
  1. Weeks (bulk generate + list editor)
  2. Weekly Schedule (week selector → lane-pair grid, uses `compareLanePairSlotSnake`)
  3. Match Results (per slot → modal picking mode: full linescore reuses `MatchLinescoreEditor`; game-scores = simple 3-score form; summary-only disabled at match level)
  4. Season Summary Records (per participant form, all fields optional)
- Delete + bulk actions gated behind confirm dialogs.

## Phase D.5 — Public archived routes

New routes reading `historical_season_snapshots` and related tables:

- `/seasons/$seasonId` — already exists; extend Overview when historical data present.
- `/seasons/$seasonId/standings`
- `/seasons/$seasonId/schedule`
- `/seasons/$seasonId/weekly-results`
- `/seasons/$seasonId/statistics`
- `/seasons/$seasonId/bowlers/$participantId`

All server-side hide draft/private (already covered by `getPublicSeasonDetail` pattern). Unavailable fields render as "—", never 0. Game-score rows show a "full linescore unavailable" note; summary-only seasons hide weekly UI entirely.

## Phase D.6 — Career profile

Update `/people/$personId` to merge historical seasons:
- Prefer computed values (full/game-score) from `historical_season_snapshots`.
- Fall back to `historical_season_summary_records`.
- Deduplicate by `(person_id, season_id, role)`.
- Show role per season; unavailable → dashes.
- Do not include draft/private seasons.

## Phase D.7 — Deterministic tests (`tests/historical-*.ts`)

1. `historical-isolation.ts` — creating/editing historical data for two archived seasons never touches 2026 `weeks`/`match_results`/snapshot.
2. `historical-lane-order.ts` — schedules + weekly results order 11-12 after 9-10 (reuses shared comparator).
3. `historical-privacy.ts` — draft or private seasons return `forbidden` server-side even with correct UUID.
4. `points-7-and-4.ts` — cover 2/1 game wins, ties, set-tie halves, override.
5. `historical-detail-modes.ts` — full vs game-score vs summary-only: unavailable fields stay `null`, aggregates never treat null as 0.
6. `career-aggregation.ts` — two archived + one current season → no duplicates, correct role labels, dashes for unavailable.
7. `historical-substitute-absent.ts` — points credit scheduled bowler; sub personal stats separate; absent excluded from personal scratch stats.

## Verification

Typecheck, `bun run test:deterministic`, production build (`bun run build`). Reported at end.

## Explicit non-goals / limitations

- Migration will be recorded in `supabase/migrations/` but I will NOT run it (per project rule for pending migrations you've reviewed). You approve/run it separately; UI degrades gracefully until then.
- Historical live-scoring (final-week live entry for archived seasons) is out of scope — archived seasons only get static entry modes.
- No deployment through Lovable; you push `main` to trigger Cloudflare.

## Assumption to confirm or correct

I'm assuming you want the migration authored via the `supabase--migration` tool (which stages it for your approval), NOT executed by me. If you'd instead like the SQL written directly under `db/pending-migrations/` like `20260716_120000_seasons_people_phase.sql`, say so and I'll switch.
