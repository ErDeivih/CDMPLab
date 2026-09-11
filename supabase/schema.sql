-- =============================================================
-- EntrenoLab — Esquema PostgreSQL / Supabase
--
-- ⚠️  DEPRECADO — NO ES LA FUENTE DE VERDAD.
-- Este fichero es un esquema INICIAL histórico, anterior al versionado. La fuente única
-- del esquema es `supabase/migrations/` (aplicada en orden por nombre de fichero), que
-- incluye el endurecimiento de permisos y las RPC posteriores. Usar este fichero para
-- levantar una base nueva produce un esquema INCOMPLETO (sin las migraciones 00001..).
-- Se conserva solo como referencia de lectura.
--
-- Enfoque (histórico): cada usuario pertenece a UN equipo (profiles.team_id).
-- =============================================================

-- ---------- Equipos ----------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  accent_color text not null default '#3056d3',
  created_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Perfiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  team_id uuid references public.teams(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------- Jugadores (plantilla por equipo) ----------
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  number smallint,
  position text,
  color text not null default '#1a73e8',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists players_team_active_idx on public.players (team_id, active);
create index if not exists players_team_name_idx on public.players (team_id, name);

-- ---------- Carpetas de ejercicios ----------
create table if not exists public.exercise_folders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  parent_id uuid references public.exercise_folders(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists exercise_folders_team_idx on public.exercise_folders (team_id, parent_id);

-- ---------- Ejercicios ----------
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  folder_id uuid references public.exercise_folders(id) on delete set null,
  title text not null,
  description text default '',
  explanation text default '',
  category text not null default 'Técnica',
  objectives text[] not null default '{}',
  materials text[] not null default '{}',
  duration_minutes smallint,
  min_players smallint,
  max_players smallint,
  load_mode text not null default 'fixed',
  series_count smallint,
  repetitions_count smallint,
  work_seconds smallint,
  rest_seconds smallint,
  is_template boolean not null default false,
  canvas_data jsonb,
  thumbnail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exercises_duration check (duration_minutes is null or duration_minutes between 1 and 240)
);
create index if not exists exercises_team_idx on public.exercises (team_id, folder_id);
create index if not exists exercises_updated_idx on public.exercises (team_id, updated_at desc);
create index if not exists exercises_search_idx on public.exercises
  using gin (to_tsvector('spanish', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(explanation,'')));

-- ---------- Sesiones ----------
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null,
  date date,
  duration_minutes smallint,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  title text not null,
  duration_minutes smallint,
  material text default '',
  sort_order smallint not null default 0
);
create index if not exists session_exercises_session_idx on public.session_exercises (session_id, sort_order);

-- ---------- Helpers ----------
create or replace function public.current_team_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select team_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_team_staff(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.team_id = t
  )
$$;

-- ---------- RLS ----------
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.exercise_folders enable row level security;
alter table public.exercises enable row level security;
alter table public.sessions enable row level security;
alter table public.session_exercises enable row level security;

-- Equipos: leer el propio, escribir si eres creador.
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (id = public.current_team_id() or created_by = auth.uid());

-- Perfiles: cada uno el suyo.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Resto: leer/escribir solo el equipo del usuario.
drop policy if exists players_all on public.players;
create policy players_all on public.players for all to authenticated
  using (team_id = public.current_team_id())
  with check (team_id = public.current_team_id());

drop policy if exists exercise_folders_all on public.exercise_folders;
create policy exercise_folders_all on public.exercise_folders for all to authenticated
  using (team_id = public.current_team_id())
  with check (team_id = public.current_team_id());

drop policy if exists exercises_all on public.exercises;
create policy exercises_all on public.exercises for all to authenticated
  using (team_id = public.current_team_id())
  with check (team_id = public.current_team_id());

drop policy if exists sessions_all on public.sessions;
create policy sessions_all on public.sessions for all to authenticated
  using (team_id = public.current_team_id())
  with check (team_id = public.current_team_id());

drop policy if exists session_exercises_all on public.session_exercises;
create policy session_exercises_all on public.session_exercises for all to authenticated
  using (session_id in (select id from public.sessions where team_id = public.current_team_id()))
  with check (session_id in (select id from public.sessions where team_id = public.current_team_id()));

-- ---------- updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists teams_touch on public.teams;
create trigger teams_touch before update on public.teams
  for each row execute function public.touch_updated_at();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists players_touch on public.players;
create trigger players_touch before update on public.players
  for each row execute function public.touch_updated_at();
drop trigger if exists exercises_touch on public.exercises;
create trigger exercises_touch before update on public.exercises
  for each row execute function public.touch_updated_at();
drop trigger if exists sessions_touch on public.sessions;
create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();
