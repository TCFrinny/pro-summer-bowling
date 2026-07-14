
# Pro Summer Singles — Supabase Migration Plan

This is a large, cross-cutting change (7,100+ LOC touched or reshaped). Approve before I execute — implementation will take multiple passes.

## Goals

Move league persistence from `pss.leagueStore.v5` (localStorage) to Supabase as the production source of truth, with Supabase Auth admin login, RLS, a single cached public snapshot, and a one-time authenticated import tool. Keep every rule, display, and stat unchanged.

## Database schema (single migration)

Relational tables for identity + queryable fields; JSONB only for the two blobs that are already opaque today (frame linescores, precomputed snapshot).

```text
public.seasons          (id, label, current bool, created_at)
public.app_role         enum ('admin')
public.user_roles       (user_id fk auth.users, role app_role, unique)
public.profiles         (user_id pk fk auth.users, display_name, created_at)
public.rostered_bowlers (id, season_id, name, bowler_number, entry_average,
                         handicap, archived, created_at, updated_at,
                         unique(season_id, bowler_number) where not archived)
public.substitutes      (id, season_id, name, bowler_number, starting_average,
                         handicap, archived, ...)
public.weeks            (id, season_id, week_number, date, published bool,
                         unique(season_id, week_number))
public.schedule_slots   (id, week_id, lane_pair, slot,
                         bowler_a_id, bowler_b_id,
                         bowler_number_a, bowler_number_b,   -- frozen at save
                         name_a, name_b,                     -- frozen at save
                         published bool,
                         unique(week_id, lane_pair, slot))
public.match_results    (id, schedule_slot_id unique, week_id, season_id,
                         side_a jsonb, side_b jsonb,        -- participation, sub id, frozen name/avg/hcp
                         linescore_a jsonb, linescore_b jsonb,  -- three GameLinescore objects
                         derived jsonb,                     -- computed W-L, marks, opens, segments
                         override jsonb,                    -- {pointsA, pointsB, reason} | null
                         entered_by uuid, created_at, updated_at)
public.public_snapshots (season_id pk, snapshot jsonb, updated_at)
```

All tables enable RLS. Every `CREATE TABLE` includes explicit `GRANT`s per the platform rule.

## RLS policies

- `rostered_bowlers`, `substitutes`, `schedule_slots`, `match_results`, `weeks`:
  - `SELECT TO anon, authenticated USING (published = true)` (for `weeks`/`schedule_slots`; slots inherit via week join through a security-definer helper), plus `SELECT USING (has_role(auth.uid(),'admin'))` for full read.
  - Roster/subs/results: anon SELECT allowed (they only surface via snapshot anyway, but Standings/Bowlers list needs names) — scoped to `season.current = true` and rows whose owning week is published; drafts stay hidden.
  - INSERT/UPDATE/DELETE: `has_role(auth.uid(),'admin')` only.
- `public_snapshots`: anon SELECT; admin write.
- `user_roles`, `profiles`: authenticated read own; admin manages.
- `has_role(uuid, app_role)` is a SECURITY DEFINER function on `public.user_roles` (per user-roles rule).

## Auth

- Replace `/admin-login` with real Supabase email/password form using `@/integrations/supabase/client`.
- Add `_authenticated/route.tsx` (integration-managed layout) if not present; move `/admin/*` routes under it.
- Add `beforeLoad` role check helper that calls a `getIsAdmin` server function (uses `requireSupabaseAuth` + `has_role`); non-admins redirect to `/`.
- Sign-out hygiene per rules.

## Data layer

Replace `src/lib/league-store.ts` with:

- `src/lib/league-repo.ts` — thin async repo backed by Supabase, same shape functions used today (`selectActiveRoster`, `applyResult`, `saveScheduleDraft`, `publishWeek`, `addRosteredBowler`, etc.) but returning promises and running against Supabase.
- `src/lib/snapshot.functions.ts` — `createServerFn` `.middleware([requireSupabaseAuth])` that rebuilds the aggregate snapshot (reusing pure logic from current `mock-data.ts`) and writes to `public_snapshots`. Called after every admin mutation server fn.
- `src/lib/snapshot-read.functions.ts` — public GET server fn reads `public_snapshots` via server publishable client (or direct browser client, since anon SELECT is allowed).
- Pure scoring/aggregation logic (currently inside `mock-data.ts` `buildSnapshot`) extracted to `src/lib/aggregation.ts` — stays pure, testable, framework-free. Server fn imports it.

All mutating server fns live in `src/lib/*.functions.ts`, admin-gated (`requireSupabaseAuth` + `has_role` check inside handler), and finish by calling snapshot rebuild + insert.

## Public routes

Convert from synchronous `getSnapshot()` reads to `useSuspenseQuery(snapshotQueryOptions)` with a root loader `ensureQueryData`. Realtime: root subscribes to `public_snapshots` changes and calls `queryClient.invalidateQueries(['snapshot'])`. Empty-DB state renders a friendly "Season data is being prepared" component in each route rather than crashing.

Bowler profile page: derives from snapshot (already does).

## Admin routes

- `/admin/bowlers`, `/admin/schedule`, `/admin/results`: same UI, swap store calls for async repo calls; wrap in `useMutation` with optimistic invalidation.
- `/admin/settings` (new):
  - Import from browser v5: reads `pss.leagueStore.v5`, shows preview counts (bowlers, subs, weeks, matches, results), refuses if any Supabase league table has rows unless admin picks "Destructive reset & import". Idempotent by natural key where possible.
  - Import runs through a `createServerFn` that accepts the parsed v5 JSON payload; server validates with Zod, does all writes as service role or as admin user, then rebuilds snapshot.
  - Reset: nukes all league tables inside a transaction, requires typing `RESET`.

## Frozen values

- Schedule save/publish freezes `name`, `bowler_number` into `schedule_slots` (both A & B). Later roster edits do not touch these columns — enforced by only writing them in `saveScheduleDraft`/`publishWeek`.
- `match_results.side_a/b` snapshot `entry_average`, `handicap`, `name` at result-save time. Immutable on subsequent roster edits.

## Removing localStorage

Delete `league-store.ts` writes/reads. Keep `localStorage` only for: last-selected week in admin UIs, in-progress result-entry form draft (per slot key, cleared on save).

## Tests

- `tests/deterministic.ts`: keep — repoint at pure `aggregation.ts` with in-memory fixtures. No Supabase.
- New `tests/rls.ts` (bun script): with anon key, assert SELECT on published data works and INSERT is rejected on every table; with a seeded admin JWT (via service-role admin-create + password login), assert admin CRUD works.
- New `tests/import-v5.ts`: feed the sample v5 JSON through the import server fn contract (pure validator + writer against a scratch schema? or skip if only feasible against a real DB — will use RLS test harness).
- `tests/admin-result-flow.py` (Playwright): update to log in with a test admin, exercise result entry, verify snapshot refresh on the public standings page.
- Add: replacement-edit test (edit same result twice, verify no double counting); partial-week snapshot test.

## Verification

```text
bunx tsgo --noEmit
bun run test:deterministic
bun run test:rls           # new
python3 tests/admin-result-flow.py
bun run build
```

## Manual owner steps (reported at the end)

1. In Supabase Auth → Users, create the first admin user with email/password.
2. In SQL editor, run:
   ```sql
   insert into public.user_roles (user_id, role)
   values ('<uuid>', 'admin');
   ```
3. Sign in at `/admin-login`, open `/admin/settings`, click "Import from browser v5" (if migrating existing local data) OR begin entering rosters directly.

## Explicitly out of scope

- Publishing / deploy / domain.
- Multi-season UI beyond the single `current = true` season.
- A `substitutes` public profile page.
- Enabling Lovable Cloud (user said connected Supabase project directly).

## Execution order (single pass)

1. `supabase--migration` with the full schema + RLS + grants + `has_role`.
2. Extract `aggregation.ts` from `mock-data.ts`.
3. Write `league-repo.ts` + server fns.
4. Rewrite public routes to use snapshot query.
5. Rewrite admin routes to async repo + auth gate.
6. Build `/admin/settings` import tool.
7. Update auth-attacher wiring in `src/start.ts`.
8. Rewrite/extend tests, run all four verification commands, report outputs.

Approve to proceed, or tell me which pieces to trim/reshape.
