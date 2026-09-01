-- =============================================================
-- EntrenoLab — Migración 00005: RPC mínimas y seguras
--
-- Proyecto: vgwfjkhvzprsoixpzruq (PostgreSQL 17).
-- Añade SOLO lo estrictamente necesario que la app necesita y que aún no existía:
--   · is_platform_admin()                 (pública, comprobable desde el cliente)
--   · revoke_team_member()                (solo propietario)
--   · cancel_team_invitation()            (solo propietario)
--   · list_team_members()                 (solo propietario; incluye correo/datos de perfil)
--   · my_team_invitations()               (las propias invitaciones pendientes del usuario)
--   · admin_list_profiles()               (solo platform admin; listado + búsqueda)
--
-- ⚠️ NO modifica las migraciones aplicadas (00000..00004). Sigue el patrón del
--    esquema: helpers privilegiados SECURITY DEFINER en esquema `private` (con
--    set search_path='' y EXECUTE a authenticated), y una capa pública SECURITY
--    INVOKER que valida auth.uid() en cada helper antes de mutar/leer.
--
-- NOTA DE VERIFICACIÓN CONTRA LA BASE: estas funciones NO se han comprobado
-- contra el catálogo remoto en esta sesión (no hay CLIENTES/CLI autenticados).
-- Se construyen observando el esquema documentado (docs/06). Antes de aplicar,
-- verificar pg_proc por si alguna ya existiera y ajustar.
-- =============================================================

-- ---------- HELPERS PRIVADOS (SECURITY DEFINER, search_path='') ----------

-- Revocar el acceso de un editor a un equipo. Solo el propietario puede
-- revocar; nunca se revoca al propietario; se marcan como 'revoked' la
-- membresía activa y las invitaciones pendientes de ese usuario.
create or replace function private.revoke_team_member(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_team_owner(p_team_id) then
    raise exception 'forbidden: not team owner';
  end if;
  if exists (select 1 from public.teams where id = p_team_id and owner_user_id = p_user_id) then
    raise exception 'cannot_revoke_owner';
  end if;
  update public.team_members
     set status = 'revoked', accepted_at = null
   where team_id = p_team_id and user_id = p_user_id and status = 'active';
  update public.team_invitations
     set status = 'revoked'
   where team_id = p_team_id and invited_user_id = p_user_id and status = 'pending';
end;
$$;

-- Cancelar una invitación PENDIENTE. Solo el propietario del equipo destino.
create or replace function private.cancel_team_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.team_invitations%rowtype;
begin
  select * into inv from public.team_invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'invitation_not_found';
  end if;
  if not private.is_team_owner(inv.team_id) then
    raise exception 'forbidden: not team owner';
  end if;
  if inv.status <> 'pending' then
    raise exception 'invitation_not_available';
  end if;
  update public.team_invitations set status = 'revoked' where id = inv.id;
end;
$$;

-- Listar miembros (owner + editores) con correo/nombre. Solo el propietario.
-- SECURITY DEFINER porque las políticas RLS de profiles impedirían leer el
-- correo de otros miembros desde el cliente; esta función valida el rol.
create or replace function private.list_team_members(p_team_id uuid)
returns table(
  user_id uuid,
  display_name text,
  email_normalized text,
  role text,
  status text,
  accepted_at timestamptz,
  invited_by uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_team_owner(p_team_id) then
    raise exception 'forbidden: not team owner';
  end if;
  return query
    select tm.user_id,
           p.display_name,
           p.email_normalized,
           tm.role::text,
           tm.status::text,
           tm.accepted_at,
           tm.invited_by
    from public.team_members tm
    join public.profiles p on p.user_id = tm.user_id
    where tm.team_id = p_team_id
    order by (tm.role = 'owner') desc, tm.created_at asc;
end;
$$;

-- Invitaciones PENDIENTES del usuario autenticado (para que pueda aceptarlas).
-- SECURITY DEFINER por el mismo motivo de RLS (necesita el join con teams).
create or replace function private.my_team_invitations()
returns table(
  id uuid,
  team_id uuid,
  team_name text,
  email_normalized text,
  status text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select i.id,
           i.team_id,
           t.name,
           i.email_normalized,
           i.status,
           i.expires_at,
           i.created_at
    from public.team_invitations i
    join public.teams t on t.id = i.team_id
    where i.invited_user_id = auth.uid()
      and i.status = 'pending'
      and i.expires_at > now()
    order by i.created_at desc;
end;
$$;

-- Listar perfiles (solo platform admin) con búsqueda por correo/nombre.
create or replace function private.list_admin_profiles(p_search text)
returns table(
  user_id uuid,
  display_name text,
  email_normalized text,
  status text,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden: platform admin required';
  end if;
  return query
    select p.user_id,
           p.display_name,
           p.email_normalized,
           p.status,
           p.approved_at
    from public.profiles p
    where (p_search is null or p_search = ''
           or p.email_normalized ilike '%' || lower(p_search) || '%'
           or p.display_name ilike '%' || p_search || '%')
    order by p.created_at desc;
end;
$$;

-- ---------- RPC PÚBLICAS (SECURITY INVOKER; validan auth.uid() vía helpers) ----------

create or replace function public.is_platform_admin()
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.is_platform_admin(); $$;

create or replace function public.revoke_team_member(p_team_id uuid, p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.revoke_team_member(p_team_id, p_user_id); $$;

create or replace function public.cancel_team_invitation(p_invitation_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.cancel_team_invitation(p_invitation_id); $$;

create or replace function public.list_team_members(p_team_id uuid)
returns table(
  user_id uuid,
  display_name text,
  email_normalized text,
  role text,
  status text,
  accepted_at timestamptz,
  invited_by uuid
)
language sql
security invoker
set search_path = ''
as $$ select * from private.list_team_members(p_team_id); $$;

create or replace function public.my_team_invitations()
returns table(
  id uuid,
  team_id uuid,
  team_name text,
  email_normalized text,
  status text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$ select * from private.my_team_invitations(); $$;

create or replace function public.admin_list_profiles(p_search text default null)
returns table(
  user_id uuid,
  display_name text,
  email_normalized text,
  status text,
  approved_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$ select * from private.list_admin_profiles(p_search); $$;

-- ---------- GRANTS: mínimo privilegio, sin acceso a PUBLIC/anon ----------

-- Helpers privados (los invocan las RPC invoker; los llama el rol authenticated).
grant execute on function private.revoke_team_member(uuid, uuid) to authenticated;
grant execute on function private.cancel_team_invitation(uuid) to authenticated;
grant execute on function private.list_team_members(uuid) to authenticated;
grant execute on function private.my_team_invitations() to authenticated;
grant execute on function private.list_admin_profiles(text) to authenticated;

-- RPC públicas: EXECUTE solo a authenticated (revocado a public/anon).
revoke execute on function public.is_platform_admin() from public, anon;
revoke execute on function public.revoke_team_member(uuid, uuid) from public, anon;
revoke execute on function public.cancel_team_invitation(uuid) from public, anon;
revoke execute on function public.list_team_members(uuid) from public, anon;
revoke execute on function public.my_team_invitations() from public, anon;
revoke execute on function public.admin_list_profiles(text) from public, anon;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.revoke_team_member(uuid, uuid) to authenticated;
grant execute on function public.cancel_team_invitation(uuid) to authenticated;
grant execute on function public.list_team_members(uuid) to authenticated;
grant execute on function public.my_team_invitations() to authenticated;
grant execute on function public.admin_list_profiles(text) to authenticated;

-- =============================================================
-- PRUEBAS DE ABUSO (manuales, tras aplicar y con usuarios de prueba).
-- Deben correr como un autenticado y verificar el error/corte esperado:
--
-- 1) is_platform_admin() devuelve FALSE para un usuario normal y TRUE para un admin.
-- 2) Un editor NO puede listar miembros: private.list_team_members lanza 'forbidden'.
-- 3) Un editor NO puede revocar a otro editor (revoke_team_member) → 'forbidden'.
-- 4) El propietario NO puede revocarse a sí mismo → 'cannot_revoke_owner'.
-- 5) Un propietario no puede cancelar una invitación ajena (de otro equipo) → 'forbidden'.
-- 6) my_team_invitations() solo devuelve invitaciones PENDIENTES del propio usuario.
-- 7) Un usuario con perfil pending/suspended NO puede listar perfiles → 'forbidden'.
-- 8) Un admin puede suspender/rechazar/reactivar (admin_list_profiles + admin_set_profile_status).
-- 9) Un editor NO puede añadir más de 4 colaboradores (enforce_collaborator_limit).
-- 10) auth.uid() invalidado (JWT sin usuario) no puede invocar RPC privadas → error/denegado.
-- =============================================================
