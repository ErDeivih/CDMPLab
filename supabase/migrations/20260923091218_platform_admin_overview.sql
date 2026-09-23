-- =============================================================
-- PANEL DE ADMINISTRACIÓN — resumen de TODOS los equipos, calculado en el SERVIDOR
--
-- POR QUÉ EXISTE: el resumen del panel se estaba calculando en el navegador descargando el
-- dataset COMPLETO de cada equipo (jugadores, carpetas, ejercicios y sesiones de todos) solo para
-- contar filas: con N equipos eso es N × todo el contenido, en cada visita al panel. Aquí se
-- resuelve en UNA consulta agregada y se devuelve solo lo que se muestra.
--
-- QUIÉN PUEDE: solo un administrador de plataforma (`private.is_platform_admin()`, tabla privada,
-- nunca por correo ni por metadatos del token). El `EXECUTE` va solo a `authenticated` porque cada
-- llamada se autoriza DENTRO; sin la comprobación, la función no devuelve nada.
--
-- QUÉ NO DEVUELVE: ni un solo dato de contenido (ningún ejercicio, jugador, sesión ni pizarra).
-- Solo recuentos, el nombre del equipo, su color, su propietario y las fechas.
-- =============================================================

create or replace function public.admin_team_overview()
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
  sessions integer
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
           -- Invitaciones PENDIENTES (las que ocupan plaza y aún no se han aceptado).
           (select count(*) from public.team_invitations i
             where i.team_id = t.id and i.status = 'pending')::integer,
           -- Jugadores activos e inactivos por separado: nunca se borra un jugador con histórico.
           (select count(*) from public.players pl
             where pl.team_id = t.id and pl.active)::integer,
           (select count(*) from public.players pl
             where pl.team_id = t.id and not pl.active)::integer,
           (select count(*) from public.exercise_folders f where f.team_id = t.id)::integer,
           (select count(*) from public.exercises e where e.team_id = t.id)::integer,
           (select count(*) from public.sessions s where s.team_id = t.id)::integer
      from public.teams t
      left join public.profiles p on p.user_id = t.owner_user_id
     order by t.created_at asc, t.name asc;
end;
$$;

revoke all on function public.admin_team_overview() from public, anon;
grant execute on function public.admin_team_overview() to authenticated;

-- =============================================================
-- COMPROBACIÓN PREVIA AL DESPLIEGUE (obligatoria antes de aplicarla; el repositorio NO la ejecuta)
--
--   -- 1) ¿Existe ya la función con OTRA firma o ya está aplicada?
--   select p.oid::regprocedure, p.prosecdef, p.provolatile, p.proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'admin_team_overview';
--
--   -- 2) Permisos de ejecución actuales (esperado tras aplicar: solo authenticated).
--   select r.rolname, has_function_privilege(r.rolname, 'public.admin_team_overview()', 'execute')
--     from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
--
--   -- 3) Las columnas y estados que cuenta esta función siguen existiendo.
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public'
--      and (table_name, column_name) in (
--        ('teams','owner_user_id'), ('teams','updated_at'), ('team_members','status'),
--        ('team_invitations','status'), ('players','active'));
--
--   -- 4) Índices que sostienen los recuentos (por equipo).
--   select indexname from pg_indexes
--    where schemaname = 'public' and tablename in
--      ('players','exercise_folders','exercises','sessions','team_members','team_invitations');
-- =============================================================
