-- ============================================================
-- Multi-season history + permanent-people phase (ADDITIVE)
--
-- ⚠️ PENDING — NOT YET APPLIED.
-- Stored outside supabase/migrations/ so the migration tool does not pick
-- it up. Review, then apply via the migration tool in the next phase.
--
-- Non-destructive. Safe to leave unapplied while the app is running:
-- application code queries these tables/columns behind feature-detects and
-- degrades to "not available yet" when the schema is not present.
--
-- Every existing 2026-season row remains untouched. `is_current` continues
-- to work; the new `status`/`public_visible` columns are backfilled to
-- match, and a partial-unique-index still enforces at most one current
-- season.
-- ============================================================

begin;

-- ---------- Idempotent updated_at trigger helper --------------------------
-- Defined locally so this migration never depends on a global helper being
-- present. `create or replace` is safe against re-application.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- people (permanent identity across seasons) ---------------------
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (btrim(display_name) <> ''),
  normalized_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists people_normalized_name_idx
  on public.people (normalized_name);

-- Deterministic uniqueness of NON-NULL normalized names prevents the
-- backfill (below) from linking one seasonal row to multiple people. A
-- partial unique index allows nulls freely.
create unique index if not exists people_normalized_name_unique
  on public.people (normalized_name)
  where normalized_name is not null;

grant select on public.people to anon, authenticated;
grant all on public.people to service_role;

alter table public.people enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='people' and policyname='Anyone reads people') then
    create policy "Anyone reads people" on public.people for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='people' and policyname='Admins manage people') then
    create policy "Admins manage people" on public.people for all to authenticated
      using (public.has_role(auth.uid(),'admin'))
      with check (public.has_role(auth.uid(),'admin'));
  end if;
end $$;

drop trigger if exists people_updated_at on public.people;
create trigger people_updated_at before update on public.people
  for each row execute function public.tg_set_updated_at();

-- ---------- person_aliases -------------------------------------------------
create table if not exists public.person_aliases (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  alias text not null check (btrim(alias) <> ''),
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  unique (normalized_alias)
);
create index if not exists person_aliases_person_idx on public.person_aliases (person_id);

grant select on public.person_aliases to anon, authenticated;
grant all on public.person_aliases to service_role;

alter table public.person_aliases enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='person_aliases' and policyname='Anyone reads person_aliases') then
    create policy "Anyone reads person_aliases" on public.person_aliases for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='person_aliases' and policyname='Admins manage person_aliases') then
    create policy "Admins manage person_aliases" on public.person_aliases for all to authenticated
      using (public.has_role(auth.uid(),'admin'))
      with check (public.has_role(auth.uid(),'admin'));
  end if;
end $$;

-- ---------- seasons: additive fields with constraints ---------------------
alter table public.seasons add column if not exists status text
  not null default 'draft'
  check (status in ('draft','current','archived'));
alter table public.seasons add column if not exists public_visible boolean not null default false;
alter table public.seasons add column if not exists start_date date;
alter table public.seasons add column if not exists end_date date;
alter table public.seasons add column if not exists total_weeks integer;
alter table public.seasons add column if not exists point_system integer
  check (point_system in (4,7));
alter table public.seasons add column if not exists handicap_percent numeric;
alter table public.seasons add column if not exists handicap_base integer;
alter table public.seasons add column if not exists champion_person_id uuid references public.people(id);
alter table public.seasons add column if not exists description text;

-- Extra sanity constraints (add-if-not-exists via DO blocks).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seasons_total_weeks_positive') then
    alter table public.seasons add constraint seasons_total_weeks_positive
      check (total_weeks is null or total_weeks > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seasons_handicap_percent_bounded') then
    alter table public.seasons add constraint seasons_handicap_percent_bounded
      check (handicap_percent is null or (handicap_percent >= 0 and handicap_percent <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seasons_handicap_base_bounded') then
    alter table public.seasons add constraint seasons_handicap_base_bounded
      check (handicap_base is null or (handicap_base >= 0 and handicap_base <= 300));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seasons_date_order') then
    alter table public.seasons add constraint seasons_date_order
      check (start_date is null or end_date is null or end_date >= start_date);
  end if;
end $$;

-- Preserve current 2026 flag: touch ONLY the metadata columns needed to
-- keep is_current == 'current'. Every roster, week, schedule, result,
-- snapshot, average, and handicap row is left alone.
update public.seasons
  set status = 'current', public_visible = true
  where is_current = true and (status <> 'current' or public_visible is distinct from true);

create unique index if not exists seasons_one_current_status
  on public.seasons ((status = 'current')) where status = 'current';

-- ---------- season_lane_pairs ---------------------------------------------
create table if not exists public.season_lane_pairs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  display_order integer not null default 0 check (display_order >= 0),
  matchup_capacity integer not null check (matchup_capacity >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, label)
);
create index if not exists season_lane_pairs_season_idx on public.season_lane_pairs (season_id);

grant select on public.season_lane_pairs to anon, authenticated;
grant all on public.season_lane_pairs to service_role;

alter table public.season_lane_pairs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='season_lane_pairs' and policyname='Anyone reads season_lane_pairs') then
    create policy "Anyone reads season_lane_pairs" on public.season_lane_pairs for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='season_lane_pairs' and policyname='Admins manage season_lane_pairs') then
    create policy "Admins manage season_lane_pairs" on public.season_lane_pairs for all to authenticated
      using (public.has_role(auth.uid(),'admin'))
      with check (public.has_role(auth.uid(),'admin'));
  end if;
end $$;

drop trigger if exists season_lane_pairs_updated_at on public.season_lane_pairs;
create trigger season_lane_pairs_updated_at before update on public.season_lane_pairs
  for each row execute function public.tg_set_updated_at();

-- ---------- link seasonal records to people (nullable) ---------------------
alter table public.rostered_bowlers add column if not exists person_id uuid references public.people(id);
alter table public.substitutes      add column if not exists person_id uuid references public.people(id);
create index if not exists rostered_bowlers_person_idx on public.rostered_bowlers (person_id);
create index if not exists substitutes_person_idx      on public.substitutes (person_id);

-- Prevent the SAME person being added twice as the same role in one season.
-- Partial index scopes uniqueness to non-null person_id so unlinked rows
-- coexist freely.
create unique index if not exists rostered_bowlers_season_person_unique
  on public.rostered_bowlers (season_id, person_id) where person_id is not null;
create unique index if not exists substitutes_season_person_unique
  on public.substitutes (season_id, person_id) where person_id is not null;

-- ---------- deterministic backfill for the current season ------------------
-- One person per DISTINCT normalized name across current-season roster +
-- substitutes. The partial-unique index above prevents any duplicate rows
-- from being inserted here, so ambiguous matches are impossible.
with current_season as (
  select id from public.seasons where is_current = true limit 1
),
raw_names as (
  select lower(btrim(regexp_replace(rb.name, '\s+', ' ', 'g'))) as norm,
         min(rb.name) as display
  from public.rostered_bowlers rb, current_season cs
  where rb.season_id = cs.id and rb.person_id is null
  group by 1
  union
  select lower(btrim(regexp_replace(s.name, '\s+', ' ', 'g'))) as norm,
         min(s.name) as display
  from public.substitutes s, current_season cs
  where s.season_id = cs.id and s.person_id is null
  group by 1
),
distinct_names as (
  select norm, min(display) as display
  from raw_names
  where norm is not null and norm <> ''
  group by norm
)
insert into public.people (display_name, normalized_name)
select dn.display, dn.norm
from distinct_names dn
where not exists (select 1 from public.people p where p.normalized_name = dn.norm);

update public.rostered_bowlers rb
   set person_id = p.id
  from public.people p, public.seasons cs
 where cs.is_current = true
   and rb.season_id = cs.id
   and rb.person_id is null
   and p.normalized_name = lower(btrim(regexp_replace(rb.name, '\s+', ' ', 'g')));

update public.substitutes s
   set person_id = p.id
  from public.people p, public.seasons cs
 where cs.is_current = true
   and s.season_id = cs.id
   and s.person_id is null
   and p.normalized_name = lower(btrim(regexp_replace(s.name, '\s+', ' ', 'g')));

-- ===========================================================================
-- ATOMIC ADMIN RPCs (invoked from history-repo.functions.ts)
-- ===========================================================================

-- switch_current_season: atomically promote one season to `current` and
-- retire every other current season. Admin-guarded inside the function
-- body so a rogue authenticated user cannot call it directly.
create or replace function public.switch_current_season(_season_id uuid, _confirm boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _confirm is distinct from true then
    raise exception 'switch_current_season requires explicit confirmation (_confirm=true)';
  end if;
  if not exists (select 1 from public.seasons where id = _season_id) then
    raise exception 'season % does not exist', _season_id;
  end if;
  -- Retire any previously-current seasons. Only touches status/is_current;
  -- no scoring rows are modified. status and is_current are kept in sync.
  update public.seasons
     set is_current = false,
         status = case when status = 'current' then 'archived' else status end
   where id <> _season_id and (is_current = true or status = 'current');
  update public.seasons
     set is_current = true, status = 'current', public_visible = true
   where id = _season_id;
end;
$$;

revoke all on function public.switch_current_season(uuid, boolean) from public;
grant execute on function public.switch_current_season(uuid, boolean) to authenticated;

-- merge_people: repoint every reference from _remove to _keep, then delete
-- ONLY the duplicate person identity + its aliases. Seasonal roster,
-- substitute, and season champion rows themselves are preserved.
create or replace function public.merge_people(_keep uuid, _remove uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  moved_roster integer := 0;
  moved_subs   integer := 0;
  moved_champ  integer := 0;
  moved_alias  integer := 0;
begin
  if not public.current_user_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _keep is null or _remove is null or _keep = _remove then
    raise exception 'invalid merge arguments';
  end if;
  if not exists (select 1 from public.people where id = _keep)
  or not exists (select 1 from public.people where id = _remove) then
    raise exception 'both persons must exist';
  end if;

  -- Rostered rows: skip any that would clash with the kept person's
  -- existing row for the same season (partial unique index enforces that).
  update public.rostered_bowlers rb
     set person_id = _keep
   where rb.person_id = _remove
     and not exists (
       select 1 from public.rostered_bowlers x
       where x.season_id = rb.season_id and x.person_id = _keep
     );
  get diagnostics moved_roster = row_count;

  update public.substitutes s
     set person_id = _keep
   where s.person_id = _remove
     and not exists (
       select 1 from public.substitutes x
       where x.season_id = s.season_id and x.person_id = _keep
     );
  get diagnostics moved_subs = row_count;

  update public.seasons
     set champion_person_id = _keep
   where champion_person_id = _remove;
  get diagnostics moved_champ = row_count;

  -- Move aliases where the normalized alias would not clash. Drop the rest
  -- with the cascade below.
  update public.person_aliases pa
     set person_id = _keep
   where pa.person_id = _remove
     and not exists (
       select 1 from public.person_aliases y
       where y.normalized_alias = pa.normalized_alias and y.person_id = _keep
     );
  get diagnostics moved_alias = row_count;

  -- Any remaining rows tied to _remove (aliases that clashed, roster/sub
  -- rows that clashed) stay put; we cascade-delete aliases and refuse to
  -- delete the person if seasonal rows still reference it.
  delete from public.person_aliases where person_id = _remove;

  if exists (select 1 from public.rostered_bowlers where person_id = _remove)
  or exists (select 1 from public.substitutes where person_id = _remove) then
    raise exception 'cannot merge: some seasonal rows would collide with the kept person';
  end if;

  delete from public.people where id = _remove;

  return jsonb_build_object(
    'moved_roster', moved_roster,
    'moved_subs', moved_subs,
    'moved_champion', moved_champ,
    'moved_aliases', moved_alias
  );
end;
$$;

revoke all on function public.merge_people(uuid, uuid) from public;
grant execute on function public.merge_people(uuid, uuid) to authenticated;

commit;
