-- EntrenoLab: correcciones detectadas al ejecutar la matriz RLS contra el remoto.
-- Esta migración es deliberadamente incremental: 20260827000000 ya está aplicada.

-- La unicidad de owner_user_id ya garantiza un solo equipo por propietario. El
-- NOT EXISTS de la policy veía la propia fila durante WITH CHECK y rechazaba
-- todas las altas legítimas.
drop policy if exists teams_insert_owner on public.teams;
create policy teams_insert_owner on public.teams for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and private.is_approved()
  );

-- Evita reevaluar auth.uid() una vez por fila en las políticas que lo usan de
-- forma directa.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists teams_update_owner on public.teams;
create policy teams_update_owner on public.teams for update to authenticated
  using (private.is_team_owner(id))
  with check (private.is_team_owner(id) and owner_user_id = (select auth.uid()));

drop policy if exists team_invitations_select_owner on public.team_invitations;
create policy team_invitations_select_owner on public.team_invitations for select to authenticated
  using (
    private.is_team_owner(team_id)
    or (
      invited_user_id = (select auth.uid())
      and private.is_approved()
    )
  );

-- Los RPC públicos son la única superficie de mutación de membresías y
-- aprobaciones. Ejecutan con el propietario de la función, pero conservan y
-- validan auth.uid() dentro de los helpers privados.
create or replace function public.create_my_team(
  p_name text,
  p_accent_color text default '#3056d3'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  team_id uuid;
begin
  if auth.uid() is null or not private.is_approved() then
    raise exception 'profile_not_approved' using errcode = '42501';
  end if;
  if trim(p_name) = '' then
    raise exception 'team_name_required';
  end if;
  if p_accent_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid_accent_color';
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
security definer
set search_path = ''
as $$ select private.create_invitation(p_team_id, p_email) $$;

create or replace function public.accept_team_invitation(p_invitation_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$ select private.accept_invitation(p_invitation_id) $$;

create or replace function public.admin_set_profile_status(p_user_id uuid, p_status text)
returns void
language sql
security definer
set search_path = ''
as $$ select private.set_profile_status(p_user_id, p_status) $$;

revoke execute on function private.enforce_collaborator_limit(uuid) from authenticated;
revoke execute on function private.add_collaborator(uuid, uuid, text) from authenticated;
revoke execute on function private.create_invitation(uuid, text) from authenticated;
revoke execute on function private.accept_invitation(uuid) from authenticated;
revoke execute on function private.set_profile_status(uuid, text) from authenticated;

-- Índices que cubren las claves foráneas compuestas y simples señaladas por el
-- asesor de rendimiento. No se eliminan índices sin uso en una base recién
-- creada: aún no existe tráfico representativo.
create index if not exists profiles_approved_by_idx
  on public.profiles (approved_by) where approved_by is not null;
create index if not exists exercise_folders_team_parent_idx
  on public.exercise_folders (team_id, parent_id);
create index if not exists session_exercises_team_session_idx
  on public.session_exercises (team_id, session_id);
create index if not exists session_exercises_team_exercise_idx
  on public.session_exercises (team_id, exercise_id) where exercise_id is not null;
create index if not exists team_invitations_invited_by_idx
  on public.team_invitations (invited_by);
create index if not exists team_invitations_invited_user_idx
  on public.team_invitations (invited_user_id) where invited_user_id is not null;
create index if not exists team_members_invited_by_idx
  on public.team_members (invited_by) where invited_by is not null;
create index if not exists team_members_user_idx
  on public.team_members (user_id);
