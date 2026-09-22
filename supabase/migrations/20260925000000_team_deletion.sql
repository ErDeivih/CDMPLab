-- =============================================================
-- EntrenoLab / CDMPLab — ELIMINAR un EQUIPO (con auditoría y confirmación escrita).
--
-- Proyecto: PostgreSQL 17 · Supabase.
--
-- MOTIVO (encargo del dueño, 22/09/2026). Faltaba la última operación de la lista: borrar un
-- equipo. Además resolvía una limitación declarada de la migración anterior: el propietario
-- ÚNICO de un equipo no podía borrar su cuenta porque su equipo se lo impedía
-- (`target_owns_team`) y no había forma de borrar el equipo. Ahora puede: primero elimina el
-- equipo y después el administrador puede dar de baja su cuenta.
--
-- QUIÉN PUEDE Y CÓMO (todo en el SERVIDOR):
--   · el PROPIETARIO del equipo, o un ADMINISTRADOR de plataforma (soporte);
--   · exige escribir el NOMBRE EXACTO del equipo en la propia llamada
--     (`p_confirm_name`): la confirmación reforzada NO depende de la interfaz;
--   · `for update` sobre el equipo: dos borrados simultáneos se serializan y el segundo
--     encuentra el equipo ya borrado;
--   · deja registro en `public.team_deletions` ANTES de borrar (sin clave foránea: la fila
--     sobrevive) con el nombre, el propietario, el motivo y un resumen de lo que había;
--   · el borrado arrastra por cascada jugadores, carpetas, ejercicios, sesiones, membresías e
--     invitaciones del equipo (las solicitudes que apuntaran a él quedan con `created_team_id`
--     a NULL, porque su FK es `on delete set null`).
--
-- CATÁLOGO REMOTO VERIFICADO ANTES DE APLICAR (22/09/2026): `public.team_deletions` y las dos
--   funciones no existían. Las FKs de players, exercise_folders, exercises, sessions,
--   session_exercises, team_members y team_invitations hacia teams usan ON DELETE CASCADE; la
--   de team_requests.created_team_id usa ON DELETE SET NULL. La migración posterior
--   20260926000000 permite conservar una solicitud aprobada cuando esa referencia queda a NULL.
--
-- IDEMPOTENTE: ejecutable varias veces con el mismo resultado final.
-- =============================================================

-- =============================================================
-- 1) REGISTRO DE EQUIPOS ELIMINADOS (auditoría que sobrevive al borrado)
-- =============================================================
create table if not exists public.team_deletions (
  id uuid primary key default gen_random_uuid(),
  -- SIN clave foránea a propósito: la fila debe seguir existiendo cuando el equipo ya no está.
  deleted_team_id uuid not null,
  team_name text not null,
  owner_user_id uuid,
  owner_email text,
  data_summary jsonb not null default '{}'::jsonb,
  reason text,
  deleted_by uuid references public.profiles(user_id) on delete set null,
  deleted_at timestamptz not null default now()
);
create index if not exists team_deletions_deleted_at_idx on public.team_deletions (deleted_at desc);
create index if not exists team_deletions_deleted_by_idx
  on public.team_deletions (deleted_by) where deleted_by is not null;

-- RLS: solo el administrador LEE. Nadie escribe desde el cliente (la fila la crea la RPC).
alter table public.team_deletions enable row level security;

drop policy if exists team_deletions_select_admin on public.team_deletions;
create policy team_deletions_select_admin on public.team_deletions
  for select to authenticated
  using (private.is_platform_admin());

-- =============================================================
-- 2) QUÉ SE VA A BORRAR (antes de decidir)
-- =============================================================
-- Lo puede mirar el propietario del equipo (es su equipo) y un administrador de plataforma.
-- Devuelve además `confirm_name_required`: el nombre EXACTO que hay que escribir para borrarlo.
create or replace function public.team_deletion_preview(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_team public.teams%rowtype;
  v_owner public.profiles%rowtype;
  v_es_propietario boolean;
  v_es_admin boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_team from public.teams where id = p_team_id;
  if not found then
    return jsonb_build_object('found', false, 'team_id', p_team_id);
  end if;
  v_es_propietario := v_team.owner_user_id = v_uid;
  v_es_admin := private.is_platform_admin();
  -- La función es SECURITY DEFINER: no basta con devolver can_delete=false, porque
  -- el resto de la respuesta contiene el correo del propietario y los recuentos del equipo.
  if not v_es_propietario and not v_es_admin then
    raise exception 'not_authorized_for_team_deletion' using errcode = '42501';
  end if;
  select * into v_owner from public.profiles where user_id = v_team.owner_user_id;

  return jsonb_build_object(
    'found', true,
    'team_id', v_team.id,
    'name', v_team.name,
    'accent_color', v_team.accent_color,
    'owner_user_id', v_team.owner_user_id,
    'owner_email', coalesce(v_owner.email_normalized, ''),
    'is_owner', v_es_propietario,
    'is_platform_admin', v_es_admin,
    'can_delete', v_es_propietario or v_es_admin,
    'confirm_name_required', v_team.name,
    'data', jsonb_build_object(
      'players', (select count(*) from public.players p where p.team_id = v_team.id),
      'folders', (select count(*) from public.exercise_folders f where f.team_id = v_team.id),
      'exercises', (select count(*) from public.exercises e where e.team_id = v_team.id),
      'sessions', (select count(*) from public.sessions s where s.team_id = v_team.id),
      'members', (select count(*) from public.team_members m where m.team_id = v_team.id),
      'pending_invitations',
        (select count(*) from public.team_invitations i
          where i.team_id = v_team.id and i.status = 'pending')
    )
  );
end;
$$;

-- =============================================================
-- 3) BORRAR EL EQUIPO (propietario o administrador, con el nombre escrito)
-- =============================================================
create or replace function public.delete_team(
  p_team_id uuid,
  p_confirm_name text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_team public.teams%rowtype;
  v_owner public.profiles%rowtype;
  v_nombre text;
  v_resumen jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- Serializa dos borrados simultáneos del mismo equipo.
  select * into v_team from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'team_not_found';
  end if;
  -- Autorización: el propietario del equipo o un administrador de plataforma.
  if v_team.owner_user_id <> v_uid and not private.is_platform_admin() then
    raise exception 'not_authorized_for_team_deletion' using errcode = '42501';
  end if;
  -- CONFIRMACIÓN REFORZADA EN EL SERVIDOR: el nombre exacto del equipo, escrito por quien borra.
  v_nombre := btrim(coalesce(p_confirm_name, ''));
  if v_nombre = '' or v_nombre <> v_team.name then
    raise exception 'team_name_confirmation_mismatch';
  end if;

  select * into v_owner from public.profiles where user_id = v_team.owner_user_id;
  v_resumen := jsonb_build_object(
    'players', (select count(*) from public.players p where p.team_id = v_team.id),
    'folders', (select count(*) from public.exercise_folders f where f.team_id = v_team.id),
    'exercises', (select count(*) from public.exercises e where e.team_id = v_team.id),
    'sessions', (select count(*) from public.sessions s where s.team_id = v_team.id),
    'members', (select count(*) from public.team_members m where m.team_id = v_team.id),
    'pending_invitations',
      (select count(*) from public.team_invitations i
        where i.team_id = v_team.id and i.status = 'pending')
  );

  -- Auditoría ANTES del borrado (sin FK al equipo: sobrevive a la cascada). Si algo falla
  -- después, la transacción entera se deshace, incluido este registro.
  insert into public.team_deletions
    (deleted_team_id, team_name, owner_user_id, owner_email, data_summary, reason, deleted_by)
  values (
    v_team.id,
    v_team.name,
    v_team.owner_user_id,
    coalesce(v_owner.email_normalized, ''),
    v_resumen,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_uid
  );

  -- Borrado real: las tablas del equipo tienen `on delete cascade` sobre `teams.id`.
  delete from public.teams where id = v_team.id;
  if not found then
    raise exception 'team_not_found';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'team_id', v_team.id,
    'name', v_team.name,
    'data', v_resumen
  );
end;
$$;

-- =============================================================
-- 4) PERMISOS MÍNIMOS
-- =============================================================
revoke all on table public.team_deletions from public, anon, authenticated;
grant select on table public.team_deletions to authenticated;

revoke execute on function public.team_deletion_preview(uuid) from public, anon;
grant execute on function public.team_deletion_preview(uuid) to authenticated;
revoke execute on function public.delete_team(uuid, text, text) from public, anon;
grant execute on function public.delete_team(uuid, text, text) to authenticated;

-- =============================================================
-- 5) COMPROBACIÓN POSTERIOR (a ejecutar a mano tras aplicar en remoto)
-- =============================================================
--   -- a) la cascada que se asume (todas deben ser ON DELETE CASCADE sobre teams.id):
--   select conrelid::regclass as tabla, confdeltype
--     from pg_constraint
--    where confrelid = 'public.teams'::regclass and contype = 'f';
--     (confdeltype: 'c' = cascade, 'n' = set null; team_requests es intencionadamente 'n')
--   -- b) privacidad de la auditoría y permisos de las RPC:
--   select policyname, cmd from pg_policies where tablename = 'team_deletions';
--   select grantee, privilege_type from information_schema.routine_privileges
--    where routine_name in ('team_deletion_preview','delete_team');
--   -- c) guardas (como el propietario de otro equipo o con el nombre mal escrito):
--   --    select public.delete_team('<equipo>', 'otro nombre');   → team_name_confirmation_mismatch
--   --    select public.delete_team('<equipo ajeno>', '<nombre>'); → not_authorized_for_team_deletion
--   -- d) borrado real de un equipo de prueba: comprobar que quedan 0 filas en players,
--   --    exercise_folders, exercises, sessions, team_members y team_invitations de ese equipo,
--   --    y que en `team_deletions` hay exactamente una fila con su resumen.
