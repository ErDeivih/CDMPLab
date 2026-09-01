-- =============================================================
-- EntrenoLab — Esquema PostgreSQL / Supabase (v2, nuevo planteamiento)
-- Proyecto: vgwfjkhvzprsoixpzruq  · PostgreSQL 17
--
-- IMPORTANTE (estado de verificación)
--   Este archivo es una MIGRACIÓN DISEÑADA, NO validada ni aplicada. No se ha
--   ejecutado contra ninguna base (no hay catálogo remoto accesible desde esta
--   sesión, el CLI no está autenticado y no se usa Docker). Antes de aplicarla
--   hay que: (1) revisar el SQL, (2) validar sintaxis, (3) verificar el catálogo
--   real del proyecto vgwfjkhvzprsoixpzruq, y (4) ejecutarla con el flujo oficial
--   (supabase migration new + migrate) o MCP apply_migration.
--   NO confiar en ella tal cual sin esa verificación.
--
-- Decisiones clave
--   · Autenticación SOLO correo/contraseña (sin Google).
--   · Aprobación manual separada de la confirmación del correo.
--   · un usuario = como máximo UN equipo propio (teams.owner_user_id UNIQUE).
--   · Hasta 4 colaboradores/invitaciones pendientes (el propietario NO cuenta).
--   · Helpers privilegiados en esquema private (no expuesto), SECURITY DEFINER
--     solo donde es imprescindible, siempre con set search_path = ''.
--   · RLS activada en todas las tablas expuestas; políticas con autorización REAL
--     (auth.uid()), nunca user_metadata.
--   · Vistas/helpers no expuestos como security-definer en public.
-- =============================================================

-- ---------- Esquemas ----------
create schema if not exists private;

-- ---------- Extensión ----------
create extension if not exists "pgcrypto";

-- =============================================================
-- TABLAS
-- =============================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email_normalized text not null unique,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','suspended')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- platform_admins (esquema PRIVADO; no expuesto a clientes) ----------
create table if not exists private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- teams ----------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null,
  accent_color text not null default '#3056d3',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_owner_unique unique (owner_user_id)
);

-- ---------- team_members ----------
create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null default 'editor' check (role in ('owner','editor')),
  status text not null default 'pending_approval'
    check (status in ('pending_approval','active','revoked')),
  invited_by uuid references public.profiles(user_id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- ---------- team_invitations ----------
create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email_normalized text not null,
  invited_user_id uuid references public.profiles(user_id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid references public.profiles(user_id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

-- Índice único parcial: una única invitación PENDIENTE por correo+equipo.
create unique index if not exists team_invitations_pending_unique
  on public.team_invitations (team_id, lower(email_normalized))
  where status = 'pending';

-- ---------- players ----------
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  number smallint,
  position text not null default '',
  color text not null default '#1a73e8',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists players_team_idx on public.players (team_id);
create index if not exists players_team_active_idx on public.players (team_id, active);

-- ---------- exercise_folders ----------
create table if not exists public.exercise_folders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  parent_id uuid,
  name text not null,
  created_at timestamptz not null default now(),
  constraint exercise_folders_team_id_id_unique unique (team_id, id),
  constraint exercise_folders_parent_same_team_fk
    foreign key (team_id, parent_id)
    references public.exercise_folders(team_id, id)
    on delete set null (parent_id)
);
create index if not exists exercise_folders_team_idx on public.exercise_folders (team_id);
create index if not exists exercise_folders_parent_idx on public.exercise_folders (parent_id);

-- ---------- exercises ----------
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  folder_id uuid,
  title text not null,
  description text not null default '',
  explanation text not null default '',
  category text not null default 'Técnica',
  objectives text[] not null default '{}',
  materials text[] not null default '{}',
  duration_minutes smallint,
  min_players smallint,
  max_players smallint,
  load_mode text not null default 'fixed' check (load_mode in ('fixed','interval')),
  series_count smallint,
  repetitions_count smallint,
  work_seconds smallint,
  rest_seconds smallint,
  is_template boolean not null default false,
  canvas_data jsonb,
  thumbnail text,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exercises_duration check (duration_minutes is null or duration_minutes between 1 and 240),
  constraint exercises_team_id_id_unique unique (team_id, id),
  constraint exercises_folder_same_team_fk
    foreign key (team_id, folder_id)
    references public.exercise_folders(team_id, id)
    on delete set null (folder_id)
);
create index if not exists exercises_team_idx on public.exercises (team_id);
create index if not exists exercises_team_folder_idx on public.exercises (team_id, folder_id);
create index if not exists exercises_updated_idx on public.exercises (team_id, updated_at desc);

-- ---------- sessions ----------
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null,
  date date,
  duration_minutes smallint,
  notes text not null default '',
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sessions_team_id_id_unique unique (team_id, id)
);
create index if not exists sessions_team_idx on public.sessions (team_id);

-- ---------- session_exercises ----------
create table if not exists public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  session_id uuid not null,
  exercise_id uuid,
  title text not null,
  duration_minutes smallint,
  material text not null default '',
  sort_order smallint not null default 0,
  constraint session_exercises_session_same_team_fk
    foreign key (team_id, session_id)
    references public.sessions(team_id, id)
    on delete cascade,
  constraint session_exercises_exercise_same_team_fk
    foreign key (team_id, exercise_id)
    references public.exercises(team_id, id)
    on delete set null (exercise_id)
);
create index if not exists session_exercises_session_idx on public.session_exercises (session_id, sort_order);
create index if not exists session_exercises_team_idx on public.session_exercises (team_id);
create index if not exists session_exercises_exercise_idx on public.session_exercises (exercise_id);

-- =============================================================
-- HELPERS PRIVILEGIADOS (esquema private, no expuesto)
-- =============================================================

-- ¿Es el usuario un administrador de plataforma?
create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.platform_admins pa
    where pa.user_id = auth.uid()
  );
$$;

-- ¿Está el usuario aprobado?
create or replace function private.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select status = 'approved' from public.profiles p where p.user_id = auth.uid()
  ), false);
$$;

-- Rol del usuario en un equipo ('owner' | 'editor' | 'none').
create or replace function private.team_role(t uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.is_approved() then 'none'
    when exists (select 1 from public.teams x where x.id = t and x.owner_user_id = auth.uid()) then 'owner'
    else coalesce((
      select role from public.team_members tm
      where tm.team_id = t and tm.user_id = auth.uid() and tm.status = 'active'
      limit 1
    ), 'none')
  end;
$$;

-- ¿Es propietario del equipo?
create or replace function private.is_team_owner(t uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_approved()
    and coalesce((select owner_user_id = auth.uid() from public.teams where id = t), false);
$$;

-- ¿Es miembro activo (owner/editor) del equipo?
create or replace function private.is_team_member(t uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.team_role(t) in ('owner','editor');
$$;

-- El id del equipo propio (el que posee el usuario), o null.
create or replace function private.owned_team_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (select id from public.teams where owner_user_id = auth.uid() limit 1);
$$;

-- =============================================================
-- FUNCIÓN TRANSACCIONAL: límite de colaboradores (máx. 4; el propietario NO cuenta)
-- =============================================================
-- Cuenta: colaboradores activos + invitaciones pendientes no caducadas.
-- Bloquea la fila del equipo (SELECT ... FOR UPDATE) para evitar carreras.
create or replace function private.enforce_collaborator_limit(t uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  -- Solo el propietario del equipo puede invocar.
  if not private.is_team_owner(t) then
    raise exception 'forbidden: not team owner';
  end if;
  -- Bloquea la fila del equipo hasta el final de la transacción.
  perform 1 from public.teams where id = t for update;
  if not found then
    raise exception 'team_not_found';
  end if;
  select
    (
      (select count(*) from public.team_members
         where team_id = t and status = 'active' and role <> 'owner')
      +
      (select count(*) from public.team_invitations
         where team_id = t and status = 'pending' and expires_at > now())
    )
    into used;
  if used >= 4 then
    raise exception 'collaborator_limit_exceeded';
  end if;
end;
$$;

-- Añadir un colaborador de forma transaccional (valida pertenencia y límite).
create or replace function private.add_collaborator(
  p_team_id uuid,
  p_user_id uuid,
  p_role text default 'editor'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_role <> 'editor' then
    raise exception 'invalid_collaborator_role';
  end if;
  if exists (
    select 1 from public.teams
    where id = p_team_id and owner_user_id = p_user_id
  ) then
    raise exception 'owner_cannot_be_collaborator';
  end if;
  if not exists (
    select 1 from public.profiles
    where user_id = p_user_id and status = 'approved'
  ) then
    raise exception 'collaborator_not_approved';
  end if;
  if exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = p_user_id and status = 'active'
  ) then
    return;
  end if;
  perform private.enforce_collaborator_limit(p_team_id);
  insert into public.team_members (team_id, user_id, role, status, invited_by)
  values (p_team_id, p_user_id, p_role, 'active', auth.uid())
  on conflict (team_id, user_id)
    do update set role = excluded.role, status = 'active';
end;
$$;

-- Crear una invitación de forma transaccional (valida pertenencia y límite).
create or replace function private.create_invitation(
  p_team_id uuid,
  p_email_normalized text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv_id uuid;
  normalized text := lower(trim(p_email_normalized));
  target_user uuid;
begin
  if normalized = '' or normalized !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_invitation_email';
  end if;
  perform private.enforce_collaborator_limit(p_team_id);
  select user_id into target_user
  from public.profiles
  where email_normalized = normalized;
  insert into public.team_invitations (team_id, email_normalized, invited_by)
  values (p_team_id, normalized, auth.uid())
  returning id into inv_id;
  if target_user is not null then
    update public.team_invitations
    set invited_user_id = target_user
    where id = inv_id;
  end if;
  return inv_id;
end;
$$;

-- Aceptar una invitación: exige correo confirmado, perfil aprobado y coincidencia
-- exacta entre el correo autenticado y el correo invitado.
create or replace function private.accept_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.team_invitations%rowtype;
  caller_email text;
begin
  select lower(email)
    into caller_email
  from auth.users
  where id = auth.uid() and email_confirmed_at is not null;
  if caller_email is null then
    raise exception 'email_not_confirmed';
  end if;
  if not private.is_approved() then
    raise exception 'profile_not_approved';
  end if;
  select * into inv
  from public.team_invitations
  where id = p_invitation_id
  for update;
  if not found or inv.status <> 'pending' or inv.expires_at <= now() then
    raise exception 'invitation_not_available';
  end if;
  if inv.email_normalized <> caller_email then
    raise exception 'invitation_email_mismatch';
  end if;
  update public.team_invitations
  set status = 'accepted', invited_user_id = auth.uid()
  where id = inv.id;
  perform private.add_collaborator(inv.team_id, auth.uid(), 'editor');
  return inv.team_id;
end;
$$;

create or replace function private.set_profile_status(p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden: platform admin required';
  end if;
  if p_status not in ('pending','approved','rejected','suspended') then
    raise exception 'invalid_profile_status';
  end if;
  update public.profiles
  set status = p_status,
      approved_at = case when p_status = 'approved' then now() else null end,
      approved_by = case when p_status = 'approved' then auth.uid() else null end
  where user_id = p_user_id;
  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

-- Perfil automático al registrarse con correo. También enlaza invitaciones que
-- fueron creadas antes de que existiera la cuenta.
create or replace function private.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(new.email));
begin
  if new.email is null or normalized = '' then
    return new;
  end if;
  insert into public.profiles (user_id, display_name, email_normalized)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    normalized
  )
  on conflict (user_id) do update
    set email_normalized = excluded.email_normalized;
  update public.team_invitations
  set invited_user_id = new.id
  where email_normalized = normalized and status = 'pending';
  return new;
end;
$$;

drop trigger if exists entrenolab_auth_user on auth.users;
create trigger entrenolab_auth_user
after insert or update of email on auth.users
for each row execute function private.handle_auth_user();

-- El propietario se registra como miembro activo para que el listado de miembros
-- tenga una fuente coherente; los helpers también reconocen owner_user_id.
create or replace function private.add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.team_members (team_id, user_id, role, status, accepted_at)
  values (new.id, new.owner_user_id, 'owner', 'active', now())
  on conflict (team_id, user_id) do update
    set role = 'owner', status = 'active', accepted_at = coalesce(public.team_members.accepted_at, now());
  return new;
end;
$$;

drop trigger if exists teams_add_owner_membership on public.teams;
create trigger teams_add_owner_membership
after insert on public.teams
for each row execute function private.add_owner_membership();

-- Evita referencias circulares en la jerarquía de carpetas.
create or replace function private.guard_folder_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cursor_id uuid := new.parent_id;
begin
  if cursor_id is null then
    return new;
  end if;
  if cursor_id = new.id then
    raise exception 'folder_cycle';
  end if;
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'folder_cycle';
    end if;
    select parent_id into cursor_id
    from public.exercise_folders
    where team_id = new.team_id and id = cursor_id;
    if not found then
      exit;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists exercise_folders_guard_hierarchy on public.exercise_folders;
create trigger exercise_folders_guard_hierarchy
before insert or update of parent_id, team_id on public.exercise_folders
for each row execute function private.guard_folder_hierarchy();

-- RPC públicas deliberadamente pequeñas. Son SECURITY INVOKER y delegan en los
-- helpers privados, que vuelven a comprobar identidad, aprobación y pertenencia.
create or replace function public.create_my_team(p_name text, p_accent_color text default '#3056d3')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  team_id uuid;
begin
  if trim(p_name) = '' then
    raise exception 'team_name_required';
  end if;
  insert into public.teams (owner_user_id, name, accent_color)
  values (auth.uid(), trim(p_name), p_accent_color)
  returning id into team_id;
  return team_id;
end;
$$;

create or replace function public.invite_team_member(p_team_id uuid, p_email text)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.create_invitation(p_team_id, p_email) $$;

create or replace function public.accept_team_invitation(p_invitation_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.accept_invitation(p_invitation_id) $$;

create or replace function public.admin_set_profile_status(p_user_id uuid, p_status text)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.set_profile_status(p_user_id, p_status) $$;

-- =============================================================
-- RLS
-- =============================================================

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invitations enable row level security;
alter table public.players enable row level security;
alter table public.exercise_folders enable row level security;
alter table public.exercises enable row level security;
alter table public.sessions enable row level security;
alter table public.session_exercises enable row level security;

-- ---------- profiles ----------
-- Un usuario ve SU propio perfil y los datos mínimos de miembros de sus equipos.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using (user_id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles for select to authenticated
  using (private.is_platform_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- El administrador cambia estados exclusivamente mediante admin_set_profile_status;
-- ningún cliente recibe permiso directo para modificar status/approved_* o email.

-- ---------- teams ----------
drop policy if exists teams_select_owner on public.teams;
create policy teams_select_owner on public.teams for select to authenticated
  using (private.is_team_owner(id) or private.is_team_member(id));

drop policy if exists teams_insert_owner on public.teams;
create policy teams_insert_owner on public.teams for insert to authenticated
  with check (
    owner_user_id = auth.uid()
    and private.is_approved()
    and not exists (select 1 from public.teams where owner_user_id = auth.uid())
  );

-- El propietario y los editores activos pueden modificar los datos del equipo; solo
-- el propietario gestiona quién es miembro/invitado.
drop policy if exists teams_update_owner on public.teams;
create policy teams_update_owner on public.teams for update to authenticated
  using (private.is_team_owner(id))
  with check (private.is_team_owner(id) and owner_user_id = auth.uid());

drop policy if exists teams_delete_owner on public.teams;
create policy teams_delete_owner on public.teams for delete to authenticated
  using (private.is_team_owner(id));

-- ---------- team_members ----------
drop policy if exists team_members_select_member on public.team_members;
create policy team_members_select_member on public.team_members for select to authenticated
  using (private.is_team_member(team_id));

drop policy if exists team_members_select_admin on public.team_members;
create policy team_members_select_admin on public.team_members for select to authenticated
  using (private.is_platform_admin());

-- No hay políticas de escritura directa: las altas/cambios pasan por RPC para que
-- el límite de cuatro no pueda saltarse desde el cliente.

-- ---------- team_invitations ----------
drop policy if exists team_invitations_select_owner on public.team_invitations;
create policy team_invitations_select_owner on public.team_invitations for select to authenticated
  using (private.is_team_owner(team_id) or (private.is_approved() and invited_user_id = auth.uid()));

drop policy if exists team_invitations_select_admin on public.team_invitations;
create policy team_invitations_select_admin on public.team_invitations for select to authenticated
  using (private.is_platform_admin());

-- Tampoco hay escritura directa de invitaciones: crear/aceptar usa RPC.

-- ---------- players ----------
drop policy if exists players_select_member on public.players;
create policy players_select_member on public.players for select to authenticated
  using (private.is_team_member(team_id));

drop policy if exists players_insert_owner on public.players;
create policy players_insert_owner on public.players for insert to authenticated
  with check (private.is_team_member(team_id));

drop policy if exists players_update_owner on public.players;
create policy players_update_owner on public.players for update to authenticated
  using (private.is_team_member(team_id))
  with check (private.is_team_member(team_id));

drop policy if exists players_delete_owner on public.players;
create policy players_delete_owner on public.players for delete to authenticated
  using (private.is_team_member(team_id));

-- ---------- exercise_folders ----------
drop policy if exists exercise_folders_select_member on public.exercise_folders;
create policy exercise_folders_select_member on public.exercise_folders for select to authenticated
  using (private.is_team_member(team_id));

drop policy if exists exercise_folders_insert_member on public.exercise_folders;
create policy exercise_folders_insert_member on public.exercise_folders for insert to authenticated
  with check (private.is_team_member(team_id));

drop policy if exists exercise_folders_update_member on public.exercise_folders;
create policy exercise_folders_update_member on public.exercise_folders for update to authenticated
  using (private.is_team_member(team_id))
  with check (private.is_team_member(team_id));

drop policy if exists exercise_folders_delete_member on public.exercise_folders;
create policy exercise_folders_delete_member on public.exercise_folders for delete to authenticated
  using (private.is_team_member(team_id));

-- ---------- exercises ----------
drop policy if exists exercises_select_member on public.exercises;
create policy exercises_select_member on public.exercises for select to authenticated
  using (private.is_team_member(team_id));

drop policy if exists exercises_insert_member on public.exercises;
create policy exercises_insert_member on public.exercises for insert to authenticated
  with check (private.is_team_member(team_id));

drop policy if exists exercises_update_member on public.exercises;
create policy exercises_update_member on public.exercises for update to authenticated
  using (private.is_team_member(team_id))
  with check (private.is_team_member(team_id));

drop policy if exists exercises_delete_member on public.exercises;
create policy exercises_delete_member on public.exercises for delete to authenticated
  using (private.is_team_member(team_id));

-- ---------- sessions ----------
drop policy if exists sessions_select_member on public.sessions;
create policy sessions_select_member on public.sessions for select to authenticated
  using (private.is_team_member(team_id));

drop policy if exists sessions_insert_member on public.sessions;
create policy sessions_insert_member on public.sessions for insert to authenticated
  with check (private.is_team_member(team_id));

drop policy if exists sessions_update_member on public.sessions;
create policy sessions_update_member on public.sessions for update to authenticated
  using (private.is_team_member(team_id))
  with check (private.is_team_member(team_id));

drop policy if exists sessions_delete_member on public.sessions;
create policy sessions_delete_member on public.sessions for delete to authenticated
  using (private.is_team_member(team_id));

-- ---------- session_exercises ----------
drop policy if exists session_exercises_select_member on public.session_exercises;
create policy session_exercises_select_member on public.session_exercises for select to authenticated
  using (private.is_team_member(team_id));

drop policy if exists session_exercises_insert_member on public.session_exercises;
create policy session_exercises_insert_member on public.session_exercises for insert to authenticated
  with check (private.is_team_member(team_id));

drop policy if exists session_exercises_update_member on public.session_exercises;
create policy session_exercises_update_member on public.session_exercises for update to authenticated
  using (private.is_team_member(team_id))
  with check (private.is_team_member(team_id));

drop policy if exists session_exercises_delete_member on public.session_exercises;
create policy session_exercises_delete_member on public.session_exercises for delete to authenticated
  using (private.is_team_member(team_id));

-- =============================================================
-- Funciones/tigger updated_at
-- =============================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Impide alterar la identidad (user_id / PK) de un perfil: solo un admin puede
-- editar status/approved_at/approved_by, pero nunca reasignar la identidad.
create or replace function public.guard_profile_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'profile user_id is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_identity();
drop trigger if exists teams_touch on public.teams;
create trigger teams_touch before update on public.teams
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

-- Incrementar `revision` en cada UPDATE de exercises/sessions (concurrencia optimista).
create or replace function public.bump_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision = old.revision + 1;
  return new;
end;
$$;

drop trigger if exists exercises_bump on public.exercises;
create trigger exercises_bump before update on public.exercises
  for each row execute function public.bump_revision();
drop trigger if exists sessions_bump on public.sessions;
create trigger sessions_bump before update on public.sessions
  for each row execute function public.bump_revision();

-- =============================================================
-- SEGURIDAD: revocar EXECUTE, conceder lo mínimo, grants Data API
-- =============================================================

-- Las funciones de esquema public solo deben ser invocables cuando corresponda.
-- touch_updated_at/bump_revision son triggers (no se llaman por el cliente).
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.bump_revision() from public, anon, authenticated;
revoke execute on function public.guard_profile_identity() from public, anon, authenticated;

-- Helpers privados: no ejecutables por el cliente.
revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.is_approved() to authenticated;
grant execute on function private.team_role(uuid) to authenticated;
grant execute on function private.is_team_owner(uuid) to authenticated;
grant execute on function private.is_team_member(uuid) to authenticated;
grant execute on function private.owned_team_id() to authenticated;
grant execute on function private.enforce_collaborator_limit(uuid) to authenticated;
grant execute on function private.add_collaborator(uuid, uuid, text) to authenticated;
grant execute on function private.create_invitation(uuid, text) to authenticated;
grant execute on function private.accept_invitation(uuid) to authenticated;
grant execute on function private.set_profile_status(uuid, text) to authenticated;

-- Las RPC públicas son la única superficie de mutación para equipos/invitaciones
-- y administración. Evitamos el EXECUTE implícito que PostgreSQL da a PUBLIC.
revoke execute on function public.create_my_team(text, text) from public, anon;
revoke execute on function public.invite_team_member(uuid, text) from public, anon;
revoke execute on function public.accept_team_invitation(uuid) from public, anon;
revoke execute on function public.admin_set_profile_status(uuid, text) from public, anon;
grant execute on function public.create_my_team(text, text) to authenticated;
grant execute on function public.invite_team_member(uuid, text) to authenticated;
grant execute on function public.accept_team_invitation(uuid) to authenticated;
grant execute on function public.admin_set_profile_status(uuid, text) to authenticated;

-- Las tablas nuevas pueden no exponerse automáticamente a la Data API.
-- Se concede a anon/authenticated para poder consultar mediante REST/Supabase client.
grant select on public.profiles to authenticated;
grant select on public.teams to authenticated;
grant select on public.team_members to authenticated;
grant select on public.team_invitations to authenticated;
grant select on public.players to authenticated;
grant select on public.exercise_folders to authenticated;
grant select on public.exercises to authenticated;
grant select on public.sessions to authenticated;
grant select on public.session_exercises to authenticated;

-- Las operaciones de escritura viajan a través de funciones SECURITY DEFINER en
-- private (add_collaborator / create_invitation) o de las RLS de la tabla; no se
-- conceden INSERT/UPDATE/DELETE indiscriminadamente a anon. Se conceden a
-- authenticated solo donde la política RLS es la barrera y no hay función dedicada.
grant insert, delete on public.teams to authenticated;
grant update (name, accent_color) on public.teams to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert, update, delete on public.players to authenticated;
grant insert, update, delete on public.exercise_folders to authenticated;
grant insert, update, delete on public.exercises to authenticated;
grant insert, update, delete on public.sessions to authenticated;
grant insert, update, delete on public.session_exercises to authenticated;

-- =============================================================
-- NOTA APLICACIÓN POST-MIGRACIÓN (no forma parte del esquema)
-- =============================================================
-- Designar al primer administrador (después de que David se registre):
--   insert into private.platform_admins (user_id)
--   values ('<UUID de David tras registrarse>');
-- Nunca hardcodear el correo de David en el frontend. El UUID se obtiene del
-- auth.users de David una vez registrado.
