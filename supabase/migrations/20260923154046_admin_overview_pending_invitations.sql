-- =============================================================
-- CONSISTENCIA: el resumen del panel separa invitaciones PENDIENTES de las CADUCADAS
--
-- EL PROBLEMA (auditoría de flujos, 23/09/2026): `admin_team_overview()` contaba como
-- «invitations_pending» TODAS las invitaciones con `status='pending'`, incluidas las CADUCADAS.
-- Pero el servidor, para el límite de plazas (`private.enforce_collaborator_limit`), cuenta solo
-- `status='pending' AND expires_at > now()`, y la pantalla de Miembros también las excluye. Así que
-- el panel decía «3 invitaciones pendientes» donde el equipo tenía 1 esperando respuesta y 2
-- caducadas que no ocupaban plaza: una cifra que no servía ni para saber si quedan plazas.
--
-- QUÉ CAMBIA:
--   · `invitations_pending` = pendientes y NO caducadas: las que esperan respuesta y sí ocupan
--     plaza (mismo criterio que el límite del servidor y que Miembros);
--   · `invitations_expired_pending` (NUEVA columna) = pendientes pero CADUCADAS: no ocupan plaza,
--     pero BLOQUEAN volver a invitar a ese correo por el índice único parcial, así que el
--     administrador debe poder verlas.
--
-- COMPATIBILIDAD: la columna nueva se AÑADE al final del `returns table`; el cliente la lee como
-- opcional (`?? 0`), así que la aplicación sigue funcionando aunque esta migración aún no se haya
-- aplicado (simplemente no muestra el aviso de caducadas).
--
-- OJO CON EL `drop`: AÑADIR UNA COLUMNA AL RETORNO ES CAMBIAR EL TIPO DE RETORNO, y PostgreSQL lo
-- rechaza con `create or replace` («cannot change return type of existing function»). Hay que
-- borrarla y volver a crearla. Es la misma trampa que el validador vigila en
-- `private.list_team_members`. Se hace dentro de la misma transacción (sin ventana sin función) y
-- los permisos se vuelven a conceder justo después.
-- =============================================================

drop function if exists public.admin_team_overview();

create function public.admin_team_overview()
returns table(
  team_id uuid,
  name text,
  accent_color text,
  owner_user_id uuid,
  owner_email text,
  created_at timestamptz,
  updated_at timestamptz,
  members_active integer,
  members_revoked integer,
  members_pending integer,
  invitations_pending integer,
  players_active integer,
  players_inactive integer,
  folders integer,
  exercises integer,
  sessions integer,
  invitations_expired_pending integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  return query
    select t.id,
           t.name,
           t.accent_color,
           t.owner_user_id,
           coalesce(p.email_normalized, ''),
           t.created_at,
           t.updated_at,
           -- Miembros: activos (los que cuentan para el límite de plazas), revocados (histórico que
           -- NO se borra) y pendientes de aprobación (invitación aceptada antes de estar aprobado).
           (select count(*) from public.team_members m
             where m.team_id = t.id and m.status = 'active')::integer,
           (select count(*) from public.team_members m
             where m.team_id = t.id and m.status = 'revoked')::integer,
           (select count(*) from public.team_members m
             where m.team_id = t.id and m.status = 'pending_approval')::integer,
           -- Invitaciones PENDIENTES Y NO CADUCADAS: las que esperan respuesta y ocupan plaza.
           (select count(*) from public.team_invitations i
             where i.team_id = t.id and i.status = 'pending' and i.expires_at > now())::integer,
           -- Jugadores activos e inactivos por separado: nunca se borra un jugador con histórico.
           (select count(*) from public.players pl
             where pl.team_id = t.id and pl.active)::integer,
           (select count(*) from public.players pl
             where pl.team_id = t.id and not pl.active)::integer,
           (select count(*) from public.exercise_folders f where f.team_id = t.id)::integer,
           (select count(*) from public.exercises e where e.team_id = t.id)::integer,
           (select count(*) from public.sessions s where s.team_id = t.id)::integer,
           -- Pendientes CADUCADAS: no ocupan plaza, pero bloquean reinvitar a ese correo hasta que
           -- alguien las cancele. El panel las muestra aparte para que no parezcan «esperando».
           (select count(*) from public.team_invitations i
             where i.team_id = t.id and i.status = 'pending' and i.expires_at <= now())::integer
      from public.teams t
      left join public.profiles p on p.user_id = t.owner_user_id
     order by t.created_at asc, t.name asc;
end;
$$;

revoke all on function public.admin_team_overview() from public, anon;
grant execute on function public.admin_team_overview() to authenticated;

-- =============================================================
-- COMPROBACIÓN PREVIA AL DESPLIEGUE (ejecutada antes de aplicarla remotamente el 23/09/2026)
--
--   -- 1) Que la función y su `returns table` sean los que espera esta migración. Añadir una
--   --    columna al final es compatible; CUALQUIER otra diferencia en el retorno hace que
--   --    PostgreSQL rechace el `create` (por eso va un `drop` antes).
--   select p.oid::regprocedure, pg_get_function_result(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'admin_team_overview';
--
--   -- 2) Nada puede DEPENDER de la función (si algo la usara en una vista o un default, el `drop`
--   --    fallaría; se espera cero filas).
--   select d.classid::regclass, d.objid, d.objsubid, d.deptype
--     from pg_depend d
--    where d.refclassid = 'pg_proc'::regclass
--      and d.refobjid = 'public.admin_team_overview()'::regprocedure
--      and d.deptype = 'n';
--
--   -- 3) Invitaciones caducadas que hoy se cuentan como pendientes (lo que se está corrigiendo).
--   select count(*) filter (where i.status = 'pending' and i.expires_at <= now()) as caducadas,
--          count(*) filter (where i.status = 'pending' and i.expires_at > now())  as vigentes
--     from public.team_invitations i;
-- =============================================================
