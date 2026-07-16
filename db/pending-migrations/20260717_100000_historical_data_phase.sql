-- ============================================================
-- Historical data phase (Phase D) — ADDITIVE.
--
-- ⚠️ PENDING — NOT YET APPLIED.
-- Stored outside supabase/migrations/ so the migration tool does not pick
-- it up. Apply manually after review; the app degrades gracefully to
-- "historical data not available yet" until then.
--
-- All new tables are strictly scoped by season_id. Nothing here touches
-- the 2026 tables (weeks, schedule_slots, match_results,
-- live_match_results, public_snapshots). Existing RLS on those tables is
-- unchanged. Also NOT touched: seasons/rostered_bowlers/substitutes
-- schema or existing policies — only lookups.
--
-- Server-side write guards additionally enforce `season.is_current=false`
-- so historical writes can NEVER reach the current season. Trigger-level
-- consistency (season_id ↔ week_id ↔ slot_id) is enforced below as a
-- second belt-and-braces guard against tampered API calls.
-- ============================================================

begin;

-- Local updated_at helper (idempotent).
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

-- Predicate used by every public SELECT policy below. `stable` +
-- `security definer` so it can read `seasons` even for anon callers who
-- have no direct SELECT grant on that table. search_path is pinned to
-- prevent role-based schema hijacking.
create or replace function public.season_is_public_archive(_season_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.seasons s
    where s.id = _season_id
      and s.status = 'archived'
      and s.public_visible = true
  );
$$;
revoke all on function public.season_is_public_archive(uuid) from public;
grant execute on function public.season_is_public_archive(uuid) to anon, authenticated;

-- Predicate used by every write policy: admin AND non-current season.
create or replace function public.season_is_historical_writable(_season_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin')
    and exists (
      select 1 from public.seasons s
      where s.id = _season_id
        and coalesce(s.is_current, false) = false
    );
$$;
revoke all on function public.season_is_historical_writable(uuid) from public;
grant execute on function public.season_is_historical_writable(uuid) to authenticated;

-- Trigger helper: assert that the row's week_id belongs to the same
-- season_id, and (for match_results) that slot_id belongs to the same
-- week_id AND season_id. Rejects tampered payloads even if RLS somehow
-- lets the row through.
create or replace function public.trg_assert_historical_scope()
returns trigger language plpgsql set search_path = public as $$
declare
  ok boolean;
begin
  if TG_TABLE_NAME = 'historical_schedule_slots' then
    select true into ok
      from public.historical_weeks w
      where w.id = NEW.week_id and w.season_id = NEW.season_id;
    if not found then
      raise exception 'week % does not belong to season %', NEW.week_id, NEW.season_id
        using errcode = '23514';
    end if;
  elsif TG_TABLE_NAME = 'historical_match_results' then
    select true into ok
      from public.historical_schedule_slots s
      where s.id = NEW.slot_id
        and s.week_id = NEW.week_id
        and s.season_id = NEW.season_id;
    if not found then
      raise exception 'slot % does not belong to week % / season %',
        NEW.slot_id, NEW.week_id, NEW.season_id using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_assert_historical_scope() from public;

-- ----------------------------------------------------------------
-- historical_weeks
-- ----------------------------------------------------------------
create table if not exists public.historical_weeks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  week_number int not null check (week_number between 1 and 60),
  date date,
  published boolean not null default false,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, week_number)
);
create index if not exists historical_weeks_season_idx
  on public.historical_weeks(season_id);

-- Grants: authenticated must be able to write for the admin RLS policy to
-- take effect. Anon+authenticated may SELECT; RLS narrows anon to public
-- archived seasons.
grant select                             on public.historical_weeks to anon;
grant select, insert, update, delete     on public.historical_weeks to authenticated;
grant all                                on public.historical_weeks to service_role;
alter table public.historical_weeks enable row level security;
-- Public/admin SELECT policies. Recreated idempotently because earlier
-- drafts used `if not exists`, which never corrects an already-created
-- policy with a weaker predicate. Public callers must ONLY see PUBLISHED
-- weeks of a public archived season.
drop policy if exists "public reads historical weeks" on public.historical_weeks;
create policy "public reads historical weeks" on public.historical_weeks
  for select to anon, authenticated
  using (public.season_is_public_archive(season_id) and published = true);
do $$ begin
  if not exists (select 1 from pg_policies where tablename='historical_weeks'
                  and policyname='admin reads all historical weeks') then
    create policy "admin reads all historical weeks" on public.historical_weeks
      for select to authenticated
      using (public.has_role(auth.uid(), 'admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename='historical_weeks'
                  and policyname='admin writes historical weeks') then
    create policy "admin writes historical weeks" on public.historical_weeks
      for all to authenticated
      using      (public.season_is_historical_writable(season_id))
      with check (public.season_is_historical_writable(season_id));
  end if;
end $$;
drop trigger if exists historical_weeks_updated_at on public.historical_weeks;
create trigger historical_weeks_updated_at
  before update on public.historical_weeks
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------
-- historical_schedule_slots
-- ----------------------------------------------------------------
create table if not exists public.historical_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  week_id uuid not null references public.historical_weeks(id) on delete cascade,
  lane_pair text not null,
  slot int not null check (slot between 1 and 32),
  -- Participant refs point at rostered_bowlers.id / substitutes.id / a
  -- manual identifier. Names/numbers frozen at save time so archived
  -- data survives roster edits.
  bowler_a_ref text not null,
  bowler_b_ref text not null,
  name_a text,
  name_b text,
  bowler_number_a text,
  bowler_number_b text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, week_id, lane_pair, slot),
  check (bowler_a_ref <> bowler_b_ref)
);
create index if not exists historical_slots_week_idx
  on public.historical_schedule_slots(week_id);
create index if not exists historical_slots_season_idx
  on public.historical_schedule_slots(season_id);
grant select                             on public.historical_schedule_slots to anon;
grant select, insert, update, delete     on public.historical_schedule_slots to authenticated;
grant all                                on public.historical_schedule_slots to service_role;
alter table public.historical_schedule_slots enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='historical_schedule_slots'
                  and policyname='public reads historical slots') then
    create policy "public reads historical slots" on public.historical_schedule_slots
      for select to anon, authenticated
      using (public.season_is_public_archive(season_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='historical_schedule_slots'
                  and policyname='admin reads all historical slots') then
    create policy "admin reads all historical slots" on public.historical_schedule_slots
      for select to authenticated
      using (public.has_role(auth.uid(), 'admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename='historical_schedule_slots'
                  and policyname='admin writes historical slots') then
    create policy "admin writes historical slots" on public.historical_schedule_slots
      for all to authenticated
      using      (public.season_is_historical_writable(season_id))
      with check (public.season_is_historical_writable(season_id));
  end if;
end $$;
drop trigger if exists historical_slots_updated_at on public.historical_schedule_slots;
create trigger historical_slots_updated_at
  before update on public.historical_schedule_slots
  for each row execute function public.tg_set_updated_at();
drop trigger if exists historical_slots_scope_check on public.historical_schedule_slots;
create trigger historical_slots_scope_check
  before insert or update on public.historical_schedule_slots
  for each row execute function public.trg_assert_historical_scope();

-- ----------------------------------------------------------------
-- historical_match_results
-- ----------------------------------------------------------------
create table if not exists public.historical_match_results (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  week_id uuid not null references public.historical_weeks(id) on delete cascade,
  slot_id uuid not null references public.historical_schedule_slots(id) on delete cascade,
  detail_mode text not null check (detail_mode in ('full_linescore','game_scores')),
  side_a jsonb not null,     -- frozen participation shape
  side_b jsonb not null,
  linescore_a jsonb,          -- null unless detail_mode='full_linescore'
  linescore_b jsonb,
  game_scores_a int[],        -- present for both modes; entered scratch scores
  game_scores_b int[],
  points_a numeric(4,1) not null default 0,
  points_b numeric(4,1) not null default 0,
  point_override jsonb,       -- {pointsA, pointsB, reason} or null
  derived jsonb,              -- full computed outcome shape for snapshot builder
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id)
);
create index if not exists historical_results_season_idx
  on public.historical_match_results(season_id);
create index if not exists historical_results_week_idx
  on public.historical_match_results(week_id);
grant select                             on public.historical_match_results to anon;
grant select, insert, update, delete     on public.historical_match_results to authenticated;
grant all                                on public.historical_match_results to service_role;
alter table public.historical_match_results enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='historical_match_results'
                  and policyname='public reads historical results') then
    create policy "public reads historical results" on public.historical_match_results
      for select to anon, authenticated
      using (public.season_is_public_archive(season_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='historical_match_results'
                  and policyname='admin reads all historical results') then
    create policy "admin reads all historical results" on public.historical_match_results
      for select to authenticated
      using (public.has_role(auth.uid(), 'admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename='historical_match_results'
                  and policyname='admin writes historical results') then
    create policy "admin writes historical results" on public.historical_match_results
      for all to authenticated
      using      (public.season_is_historical_writable(season_id))
      with check (public.season_is_historical_writable(season_id));
  end if;
end $$;
drop trigger if exists historical_results_updated_at on public.historical_match_results;
create trigger historical_results_updated_at
  before update on public.historical_match_results
  for each row execute function public.tg_set_updated_at();
drop trigger if exists historical_results_scope_check on public.historical_match_results;
create trigger historical_results_scope_check
  before insert or update on public.historical_match_results
  for each row execute function public.trg_assert_historical_scope();

-- ----------------------------------------------------------------
-- historical_season_summary_records
-- Every stat column is nullable; NULL means "unavailable", NEVER zero.
-- ----------------------------------------------------------------
create table if not exists public.historical_season_summary_records (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  participant_ref text not null,      -- rostered_bowlers.id / substitutes.id / manual
  person_id uuid references public.people(id) on delete set null,
  role text not null check (role in ('rostered','substitute')),
  display_name text not null,
  bowler_number text,
  games int,
  scratch_pinfall int,
  average numeric(6,2),
  high_game int,
  high_set int,
  points numeric(6,1),
  points_lost numeric(6,1),
  final_finish int,
  is_champion boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, participant_ref, role)
);
create index if not exists historical_summary_season_idx
  on public.historical_season_summary_records(season_id);
create index if not exists historical_summary_person_idx
  on public.historical_season_summary_records(person_id);
grant select                             on public.historical_season_summary_records to anon;
grant select, insert, update, delete     on public.historical_season_summary_records to authenticated;
grant all                                on public.historical_season_summary_records to service_role;
alter table public.historical_season_summary_records enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='historical_season_summary_records'
                  and policyname='public reads historical summary') then
    create policy "public reads historical summary" on public.historical_season_summary_records
      for select to anon, authenticated
      using (public.season_is_public_archive(season_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='historical_season_summary_records'
                  and policyname='admin reads all historical summary') then
    create policy "admin reads all historical summary" on public.historical_season_summary_records
      for select to authenticated
      using (public.has_role(auth.uid(), 'admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename='historical_season_summary_records'
                  and policyname='admin writes historical summary') then
    create policy "admin writes historical summary" on public.historical_season_summary_records
      for all to authenticated
      using      (public.season_is_historical_writable(season_id))
      with check (public.season_is_historical_writable(season_id));
  end if;
end $$;
drop trigger if exists historical_summary_updated_at
  on public.historical_season_summary_records;
create trigger historical_summary_updated_at
  before update on public.historical_season_summary_records
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------
-- historical_season_snapshots — cached read model for archived pages
-- ----------------------------------------------------------------
create table if not exists public.historical_season_snapshots (
  season_id uuid primary key references public.seasons(id) on delete cascade,
  snapshot jsonb not null,
  built_at timestamptz not null default now()
);
grant select                             on public.historical_season_snapshots to anon;
grant select, insert, update, delete     on public.historical_season_snapshots to authenticated;
grant all                                on public.historical_season_snapshots to service_role;
alter table public.historical_season_snapshots enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='historical_season_snapshots'
                  and policyname='public reads historical snapshot') then
    create policy "public reads historical snapshot" on public.historical_season_snapshots
      for select to anon, authenticated
      using (public.season_is_public_archive(season_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='historical_season_snapshots'
                  and policyname='admin reads all historical snapshot') then
    create policy "admin reads all historical snapshot" on public.historical_season_snapshots
      for select to authenticated
      using (public.has_role(auth.uid(), 'admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename='historical_season_snapshots'
                  and policyname='admin writes historical snapshot') then
    create policy "admin writes historical snapshot" on public.historical_season_snapshots
      for all to authenticated
      using      (public.season_is_historical_writable(season_id))
      with check (public.season_is_historical_writable(season_id));
  end if;
end $$;

commit;
