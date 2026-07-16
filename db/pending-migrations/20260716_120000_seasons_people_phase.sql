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

-- ---------- people (permanent identity across seasons) ---------------------
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists people_normalized_name_idx
  on public.people (normalized_name);

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
  alias text not null,
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

-- ---------- seasons: additive fields ---------------------------------------
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

update public.seasons
  set status = 'current', public_visible = true
  where is_current = true and (status <> 'current' or public_visible is distinct from true);

create unique index if not exists seasons_one_current_status
  on public.seasons ((status = 'current')) where status = 'current';

-- ---------- season_lane_pairs ---------------------------------------------
create table if not exists public.season_lane_pairs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  label text not null,
  display_order integer not null default 0,
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

-- ---------- deterministic backfill for the current season ------------------
-- One person per distinct normalized name found in the current-season
-- roster+substitute pool. Exact normalized matches share one person.
-- No fuzzy merging.
with current_season as (
  select id from public.seasons where is_current = true limit 1
),
raw_names as (
  select lower(trim(regexp_replace(rb.name, '\s+', ' ', 'g'))) as norm, rb.name as display
  from public.rostered_bowlers rb, current_season cs
  where rb.season_id = cs.id and rb.person_id is null
  union
  select lower(trim(regexp_replace(s.name, '\s+', ' ', 'g'))) as norm, s.name as display
  from public.substitutes s, current_season cs
  where s.season_id = cs.id and s.person_id is null
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
   and p.normalized_name = lower(trim(regexp_replace(rb.name, '\s+', ' ', 'g')));

update public.substitutes s
   set person_id = p.id
  from public.people p, public.seasons cs
 where cs.is_current = true
   and s.season_id = cs.id
   and s.person_id is null
   and p.normalized_name = lower(trim(regexp_replace(s.name, '\s+', ' ', 'g')));

commit;
