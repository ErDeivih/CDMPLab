-- =============================================================
-- EntrenoLab / CDMPLab — GESTIÓN de CUENTAS y de PERTENENCIA a un equipo.
--
-- Proyecto: PostgreSQL 17 · Supabase.
--
-- MOTIVO (encargo del dueño, 22/09/2026). Faltaban las tres operaciones que el dueño
-- preguntó explícitamente y que NO existían:
--   1. ELIMINAR una cuenta (solo había cambio de estado: rechazar/suspender);
--   2. SALIR de un equipo por voluntad propia (un editor activo no tenía forma de irse:
--      `revoke_team_member` es del propietario y `decline_team_invitation` solo sirve
--      con la invitación todavía pendiente);
--   3. TRASPASAR la propiedad del equipo a otro miembro (no existía ninguna función y
--      `teams_update_owner` obliga a que el propietario siga siendo auth.uid()).
--
-- DECISIONES DE SEGURIDAD (todas en el SERVIDOR, ninguna en la interfaz):
--   · Borrar una cuenta es cosa de un **administrador de plataforma** y, además, con
--     guardas: no puede borrarse a sí mismo, no puede borrar a otro administrador y no
--     puede borrar a quien POSEE un equipo (primero hay que traspasarlo: si no, la
--     cascada se llevaría el equipo y todos sus datos sin decirlo).
--   · Salir de un equipo lo decide el PROPIO miembro activo; el propietario no puede
--     «salir» (dejaría el equipo sin dueño): tiene que traspasarlo.
--   · Traspasar la propiedad solo lo puede hacer el propietario actual, y solo a un
--     miembro ACTIVO, aprobado y que no posea ya otro equipo (owner_user_id es único).
--     El cambio de roles de las DOS partes ocurre en la misma transacción.
--   · Toda baja de cuenta deja un registro en `public.account_deletions` que SOBREVIVE
--     al borrado (sin clave foránea a `profiles`).
--
-- CATÁLOGO REMOTO VERIFICADO (22/09/2026, antes de aplicar):
--   `account_deletions` y las cuatro RPC no existían; el rol `postgres` tiene DELETE
--   sobre `auth.users`; `profiles.user_id` referencia `auth.users` con ON DELETE CASCADE.
--   Aplicada en remoto como `20260922101345_account_and_membership_management`.
--   La matriz `supabase/tests/entrenolab_rls.sql` pasó con ROLLBACK y sin dejar
--   usuarios ni filas de auditoría de prueba. El borrado va en UNA transacción:
--   si falla, tampoco queda el registro de auditoría.
--
-- IDEMPOTENTE: ejecutable varias veces con el mismo resultado final.
-- =============================================================

-- =============================================================
-- 1) REGISTRO DE BAJAS DE CUENTA (auditoría que sobrevive al borrado)
-- =============================================================
create table if not exists public.account_deletions (
  id uuid primary key default gen_random_uuid(),
  -- SIN clave foránea a propósito: la fila debe seguir existiendo cuando el perfil ya no está.
  deleted_user_id uuid not null,
  email_normalized text not null,
  display_name text not null default '',
  status_before text,
  reason text,
  deleted_by uuid references public.profiles(user_id) on delete set null,
  deleted_at timestamptz not null default now()
);
create index if not exists account_deletions_deleted_at_idx
  on public.account_deletions (deleted_at desc);
create index if not exists account_deletions_deleted_by_idx
  on public.account_deletions (deleted_by) where deleted_by is not null;

-- RLS: solo el administrador LEE. Nadie escribe desde el cliente: la fila la crea la RPC.
alter table public.account_deletions enable row level security;

drop policy if exists account_deletions_select_admin on public.account_deletions;
create policy account_deletions_select_admin on public.account_deletions
  for select to authenticated
  using (private.is_platform_admin());

-- =============================================================
-- 2) QUÉ PASARÍA SI SE BORRARA ESTA CUENTA (antes de decidir)
-- =============================================================
-- Devuelve el resumen y los BLOQUEOS para que la interfaz pueda explicarlo y para que el
-- administrador no borre «a ciegas». Solo un administrador de plataforma puede mirarlo.
create or replace function public.admin_deletion_preview(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_prof public.profiles%rowtype;
  v_team public.teams%rowtype;
  v_blockers text[] := '{}';
  v_players integer := 0;
  v_folders integer := 0;
  v_exercises integer := 0;
  v_sessions integer := 0;
  v_memberships integer := 0;
  v_invitations integer := 0;
begin
  if v_admin is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select * into v_prof from public.profiles where user_id = p_user_id;
  if not found then
    return jsonb_build_object('found', false, 'user_id', p_user_id);
  end if;

  select * into v_team from public.teams where owner_user_id = p_user_id;
  if found then
    -- Si posee un equipo, la cascada se lo llevaría entero: hay que decirlo con números.
    select count(*) into v_players from public.players where team_id = v_team.id;
    select count(*) into v_folders from public.exercise_folders where team_id = v_team.id;
    select count(*) into v_exercises from public.exercises where team_id = v_team.id;
    select count(*) into v_sessions from public.sessions where team_id = v_team.id;
    v_blockers := array_append(v_blockers, 'owns_team');
  end if;
  if p_user_id = v_admin then
    v_blockers := array_append(v_blockers, 'self');
  end if;
  if exists (select 1 from private.platform_admins pa where pa.user_id = p_user_id) then
    v_blockers := array_append(v_blockers, 'platform_admin');
  end if;

  select count(*) into v_memberships
  from public.team_members m
  where m.user_id = p_user_id and m.status = 'active';
  select count(*) into v_invitations
  from public.team_invitations i
  where i.invited_user_id = p_user_id and i.status = 'pending';

  return jsonb_build_object(
    'found', true,
    'user_id', v_prof.user_id,
    'display_name', v_prof.display_name,
    'email_normalized', v_prof.email_normalized,
    'status', v_prof.status,
    'is_platform_admin', ('platform_admin' = any (v_blockers)),
    'is_self', ('self' = any (v_blockers)),
    'owns_team', ('owns_team' = any (v_blockers)),
    'owned_team_name', case when v_team.id is null then null else v_team.name end,
    'owned_team_data', jsonb_build_object(
      'players', v_players,
      'folders', v_folders,
      'exercises', v_exercises,
      'sessions', v_sessions
    ),
    'active_memberships', v_memberships,
    'pending_invitations', v_invitations,
    'blockers', to_jsonb(v_blockers),
    'deletable', cardinality(v_blockers) = 0
  );
end;
$$;

-- =============================================================
-- 3) BORRAR UNA CUENTA (administrador de plataforma, con guardas)
-- =============================================================
create or replace function public.admin_delete_account(
  p_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_prof public.profiles%rowtype;
  v_email text;
begin
  if v_admin is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  -- Bloqueo del perfil: dos borrados simultáneos de la misma cuenta se serializan.
  select * into v_prof from public.profiles where user_id = p_user_id for update;
  if not found then
    raise exception 'account_not_found';
  end if;
  if p_user_id = v_admin then
    raise exception 'cannot_delete_self';
  end if;
  if exists (select 1 from private.platform_admins pa where pa.user_id = p_user_id) then
    raise exception 'cannot_delete_platform_admin';
  end if;
  -- Quien POSEE un equipo no se borra: la cascada se llevaría el equipo y sus datos.
  -- Primero se traspasa la propiedad (`transfer_team_ownership`) y después se borra.
  if exists (select 1 from public.teams t where t.owner_user_id = p_user_id) then
    raise exception 'target_owns_team';
  end if;

  v_email := v_prof.email_normalized;

  -- Auditoría ANTES del borrado: la fila no tiene FK a `profiles`, así que sobrevive a la
  -- cascada. Si algo falla después, la transacción entera se deshace (incluido esto).
  insert into public.account_deletions
    (deleted_user_id, email_normalized, display_name, status_before, reason, deleted_by)
  values (
    v_prof.user_id,
    v_prof.email_normalized,
    v_prof.display_name,
    v_prof.status,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_admin
  );

  -- Borrado REAL de la cuenta. `profiles.user_id` referencia `auth.users` con ON DELETE
  -- CASCADE, así que desaparecen perfil, membresías e invitaciones del usuario. Las
  -- columnas que lo referencian (invited_by, decided_by, approved_by) quedan a NULL.
  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'account_not_found';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'user_id', p_user_id,
    'email_normalized', v_email
  );
end;
$$;

-- =============================================================
-- 4) SALIR DE UN EQUIPO (lo decide el propio miembro activo)
-- =============================================================
-- Mismas consecuencias que una revocación: la membresía queda `revoked` (no se borra: el
-- histórico de quién estuvo en el equipo se conserva) y sus invitaciones pendientes de ese
-- equipo se revocan. El PROPIETARIO no puede salir: dejaría el equipo sin dueño y sin nadie
-- que pueda gestionarlo; para eso está el traspaso.
create or replace function public.leave_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_approved() then
    raise exception 'profile_not_approved';
  end if;
  -- El traspaso bloquea esta misma fila. Comprobar el propietario DESPUÉS del lock
  -- evita que una salida concurrente revoque al nuevo dueño.
  perform 1 from public.teams where id = p_team_id for update;
  if exists (select 1 from public.teams t where t.id = p_team_id and t.owner_user_id = v_uid) then
    raise exception 'owner_cannot_leave';
  end if;
  if not exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = v_uid and m.status = 'active'
  ) then
    raise exception 'not_a_member';
  end if;
  -- La aceptación de una invitación bloquea primero la invitación y después la
  -- membresía. Conservar ese orden evita un interbloqueo con una aceptación simultánea.
  update public.team_invitations
     set status = 'revoked'
   where team_id = p_team_id and invited_user_id = v_uid and status = 'pending';
  update public.team_members
     set status = 'revoked', accepted_at = null
   where team_id = p_team_id and user_id = v_uid and status = 'active';
end;
$$;

-- =============================================================
-- 5) TRASPASAR LA PROPIEDAD DEL EQUIPO
-- =============================================================
-- Solo el propietario actual. El destinatario debe ser un EDITOR ACTIVO del equipo, con el
-- perfil aprobado y sin equipo propio (owner_user_id es único: un usuario no puede poseer
-- dos equipos). Intercambio de roles en la misma transacción: al terminar hay exactamente
-- el mismo número de cuentas en el equipo (el antiguo propietario ocupa la plaza de editor
-- que deja libre el nuevo).
create or replace function public.transfer_team_ownership(
  p_team_id uuid,
  p_new_owner_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- Serializa dos traspasos simultáneos del mismo equipo.
  perform 1 from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'team_not_found';
  end if;
  -- La autorización se evalúa DESPUÉS de esperar el lock: de otro modo, el
  -- antiguo propietario podría aprobar un segundo traspaso con permiso obsoleto.
  if not private.is_team_owner(p_team_id) then
    raise exception 'forbidden: not team owner';
  end if;
  if p_new_owner_user_id = v_uid then
    raise exception 'already_owner';
  end if;
  if not exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id
      and m.user_id = p_new_owner_user_id
      and m.status = 'active'
      and m.role = 'editor'
  ) then
    raise exception 'new_owner_must_be_active_member';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.user_id = p_new_owner_user_id and p.status = 'approved'
  ) then
    raise exception 'new_owner_not_approved';
  end if;
  if exists (select 1 from public.teams t where t.owner_user_id = p_new_owner_user_id) then
    raise exception 'new_owner_already_has_team';
  end if;

  update public.teams set owner_user_id = p_new_owner_user_id where id = p_team_id;
  -- Ambas filas de membresía YA existen (el editor fue invitado y aceptó); se intercambian
  -- los roles, no se crean plazas nuevas.
  update public.team_members
     set role = 'owner', status = 'active', accepted_at = coalesce(accepted_at, now())
   where team_id = p_team_id and user_id = p_new_owner_user_id;
  update public.team_members
     set role = 'editor', status = 'active', accepted_at = coalesce(accepted_at, now())
   where team_id = p_team_id and user_id = v_uid;
end;
$$;

-- =============================================================
-- 6) PERMISOS MÍNIMOS
-- =============================================================
revoke all on table public.account_deletions from public, anon, authenticated;
grant select on table public.account_deletions to authenticated;

revoke execute on function public.admin_deletion_preview(uuid) from public, anon;
grant execute on function public.admin_deletion_preview(uuid) to authenticated;
revoke execute on function public.admin_delete_account(uuid, text) from public, anon;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;
revoke execute on function public.leave_team(uuid) from public, anon;
grant execute on function public.leave_team(uuid) to authenticated;
revoke execute on function public.transfer_team_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_team_ownership(uuid, uuid) to authenticated;

-- =============================================================
-- 7) COMPROBACIÓN POSTERIOR (a ejecutar a mano tras aplicar en remoto)
-- =============================================================
--   -- a) privacidad de la auditoría: solo el administrador lee, nadie escribe desde el cliente
--   select policyname, cmd from pg_policies where tablename = 'account_deletions';
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name='account_deletions';
--   -- b) EXECUTE de las tres RPC: solo a authenticated
--   select p.proname, r.grantee, r.privilege_type
--     from pg_proc p join information_schema.routine_privileges r
--       on r.routine_name = p.proname
--    where p.proname in ('admin_deletion_preview','admin_delete_account','leave_team','transfer_team_ownership');
--   -- c) PRIVILEGIO DE BORRADO sobre auth.users (si falla, la bajada de cuenta NO funcionará):
--   select has_table_privilege(current_user, 'auth.users', 'DELETE') as puede_borrar_usuarios;
--   -- d) guardas, ejecutadas como administrador (deben responder error):
--   --    select public.admin_delete_account('<mi propio uuid>');          → cannot_delete_self
--   --    select public.admin_delete_account('<uuid con equipo>');         → target_owns_team
--   --    select public.transfer_team_ownership('<equipo>', '<uuid ajeno>'); → new_owner_must_be_active_member
--   -- e) traspaso real: los roles cambian, el equipo sigue teniendo el mismo número de cuentas.
