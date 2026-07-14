
-- ============================================================
-- Pro Summer Singles — Supabase schema (v1)
-- ============================================================

-- Roles enum + user_roles table (per platform rules; never store roles on profiles)
create type public.app_role as enum ('admin');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

-- Security-definer role check (used by every policy that needs admin gating)
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- user_roles policies (only admins manage roles; users can read their own)
create policy "Users read own roles"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid());
create policy "Admins manage roles"
  on public.user_roles for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Admin profiles (display name, tied to auth.users)
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "Users read own profile"
  on public.profiles for select
  to authenticated
  using (user_id = auth.uid());
create policy "Users update own profile"
  on public.profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "Admins read all profiles"
  on public.profiles for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Timestamp updater used by several tables
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- League tables
-- ============================================================

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.seasons to anon, authenticated;
grant all on public.seasons to service_role;
alter table public.seasons enable row level security;
create policy "Anyone reads seasons" on public.seasons for select to anon, authenticated using (true);
create policy "Admins manage seasons" on public.seasons for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger seasons_updated_at before update on public.seasons
  for each row execute function public.tg_set_updated_at();
-- Only one current season at a time
create unique index seasons_one_current on public.seasons (is_current) where is_current;

create table public.rostered_bowlers (
  id text primary key,                          -- keep string ids ("b00".."b35") for import compatibility
  season_id uuid not null references public.seasons(id) on delete cascade,
  name text not null,
  bowler_number text,
  entry_average numeric not null,
  handicap integer not null,
  active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.rostered_bowlers to anon, authenticated;
grant all on public.rostered_bowlers to service_role;
alter table public.rostered_bowlers enable row level security;
create policy "Anyone reads rostered bowlers" on public.rostered_bowlers for select to anon, authenticated using (true);
create policy "Admins manage rostered bowlers" on public.rostered_bowlers for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger rostered_bowlers_updated_at before update on public.rostered_bowlers
  for each row execute function public.tg_set_updated_at();

create table public.substitutes (
  id text primary key,
  season_id uuid not null references public.seasons(id) on delete cascade,
  name text not null,
  bowler_number text,
  starting_average numeric,
  handicap integer,
  active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.substitutes to anon, authenticated;
grant all on public.substitutes to service_role;
alter table public.substitutes enable row level security;
create policy "Anyone reads substitutes" on public.substitutes for select to anon, authenticated using (true);
create policy "Admins manage substitutes" on public.substitutes for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger substitutes_updated_at before update on public.substitutes
  for each row execute function public.tg_set_updated_at();

create table public.weeks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  week_number integer not null,
  date date,
  published boolean not null default false,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, week_number)
);
grant select on public.weeks to anon, authenticated;
grant all on public.weeks to service_role;
alter table public.weeks enable row level security;
-- Public only sees published weeks; admins see everything
create policy "Public reads published weeks" on public.weeks for select to anon
  using (published = true);
create policy "Authed reads weeks" on public.weeks for select to authenticated
  using (published = true or public.has_role(auth.uid(),'admin'));
create policy "Admins manage weeks" on public.weeks for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger weeks_updated_at before update on public.weeks
  for each row execute function public.tg_set_updated_at();

-- Helper: is a given week published?
create or replace function public.week_published(_week_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select published from public.weeks where id = _week_id), false)
$$;

create table public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.weeks(id) on delete cascade,
  lane_pair text not null,
  slot integer not null,
  bowler_a_id text references public.rostered_bowlers(id),
  bowler_b_id text references public.rostered_bowlers(id),
  -- Frozen at save/publish time — never touched by later roster edits
  name_a text,
  name_b text,
  bowler_number_a text,
  bowler_number_b text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_id, lane_pair, slot)
);
grant select on public.schedule_slots to anon, authenticated;
grant all on public.schedule_slots to service_role;
alter table public.schedule_slots enable row level security;
create policy "Public reads slots of published weeks" on public.schedule_slots for select to anon
  using (public.week_published(week_id));
create policy "Authed reads slots" on public.schedule_slots for select to authenticated
  using (public.week_published(week_id) or public.has_role(auth.uid(),'admin'));
create policy "Admins manage slots" on public.schedule_slots for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger schedule_slots_updated_at before update on public.schedule_slots
  for each row execute function public.tg_set_updated_at();

create table public.match_results (
  id uuid primary key default gen_random_uuid(),
  schedule_slot_id uuid not null unique references public.schedule_slots(id) on delete cascade,
  week_id uuid not null references public.weeks(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  -- Both sides' participation, frozen name/avg/handicap, and (optional) substitute id
  side_a jsonb not null,
  side_b jsonb not null,
  -- Three-game linescores per side (frame marks + cumulative totals)
  linescore_a jsonb not null,
  linescore_b jsonb not null,
  -- Precomputed W-L, marks, opens, segments (derived from linescores)
  derived jsonb not null,
  -- {pointsA, pointsB, reason} | null
  override jsonb,
  entered_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.match_results to anon, authenticated;
grant all on public.match_results to service_role;
alter table public.match_results enable row level security;
create policy "Public reads results of published weeks" on public.match_results for select to anon
  using (public.week_published(week_id));
create policy "Authed reads results" on public.match_results for select to authenticated
  using (public.week_published(week_id) or public.has_role(auth.uid(),'admin'));
create policy "Admins manage results" on public.match_results for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger match_results_updated_at before update on public.match_results
  for each row execute function public.tg_set_updated_at();

-- One cached public snapshot per season. Rebuilt on every admin mutation.
create table public.public_snapshots (
  season_id uuid primary key references public.seasons(id) on delete cascade,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);
grant select on public.public_snapshots to anon, authenticated;
grant all on public.public_snapshots to service_role;
alter table public.public_snapshots enable row level security;
create policy "Anyone reads snapshot" on public.public_snapshots for select to anon, authenticated using (true);
create policy "Admins manage snapshot" on public.public_snapshots for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger public_snapshots_updated_at before update on public.public_snapshots
  for each row execute function public.tg_set_updated_at();

-- ============================================================
-- Enable Realtime so public snapshot changes push to browsers
-- ============================================================
alter publication supabase_realtime add table public.public_snapshots;
