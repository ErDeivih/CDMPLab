-- =============================================================
-- EntrenoLab / CDMPLab — Migración de ENDURECIMIENTO de permisos (grants).
--
-- Proyecto: PostgreSQL 17 · Supabase · ref vgwfjkhvzprsoixpzruq.
--
-- MOTIVO (auditoría remota del arquitecto): aunque RLS está activada en todas las
-- tablas públicas y no hay políticas para anon, `role_table_grants` mostraba
-- privilegios generales excesivos para `anon` y `authenticated` sobre las tablas
-- de la aplicación. Se endurece aquí, con concesiones MÍNIMAS y explícitas.
--
-- PRINCIPIOS:
--   · Mínimo privilegio: anon NO tiene acceso a tablas de aplicación.
--   · authenticated: SELECT donde el cliente consulta; INSERT/UPDATE/DELETE solo
--     donde la aplicación escribe DIRECTAMENTE.
--   · Sin TRUNCATE, TRIGGER ni REFERENCES a anon/authenticated.
--   · Sin acceso de tabla a private.platform_admins.
--   · EXECUTE solo de las RPC que la aplicación necesita; revocado a PUBLIC/anon en
--     las funciones sensibles. No se rompen los SECURITY DEFINER/INVOKER.
--
-- IDEMPOTENTE: ejecutable varias veces con el mismo resultado final.
--
-- CATÁLOGO REMOTO VERIFICADO (2026-09-02): el esquema `public` pertenece a
-- `pg_database_owner`; las migraciones de usuario se ejecutan como `postgres`.
-- `pg_default_acl` contiene concesiones amplias creadas por `postgres` y por el
-- rol interno `supabase_admin`. La sesión `postgres` NO es miembro de
-- `supabase_admin`, por lo que Supabase rechaza cambiar los defaults de ese rol.
-- Se endurecen aquí los defaults de `postgres`, que gobiernan los objetos creados
-- por nuestras migraciones. Los defaults internos de plataforma quedan fuera del
-- alcance permitido de una migración de usuario alojada.
-- =============================================================

-- ---------- 1) ANON: sin acceso a ninguna tabla pública de la aplicación ----------
revoke all on table public.profiles, public.teams, public.team_members,
  public.team_invitations, public.players, public.exercise_folders,
  public.exercises, public.sessions, public.session_exercises
  from anon;

-- ---------- 2) PUBLIC (rol implícito) y también anon: cero de una vez ----------
revoke all on table public.profiles, public.teams, public.team_members,
  public.team_invitations, public.players, public.exercise_folders,
  public.exercises, public.sessions, public.session_exercises
  from public;

-- ---------- 3) AUTHENTICATED: revocar privilegios excesivos primero ----------
-- Revocar TODO y después conceder SOLO lo mínimo. Garantiza que no quede
-- TRUNCATE/TRIGGER/REFERENCES heredado.
revoke all on table public.profiles, public.teams, public.team_members,
  public.team_invitations, public.players, public.exercise_folders,
  public.exercises, public.sessions, public.session_exercises
  from authenticated;

-- ---------- 4) AUTHENTICATED: concesiones MÍNIMAS (cada una documentada) ----------
-- SELECT (lectura) para los datos que el cliente consulta vía supabase-js.
-- RLS es la barrera real por fila; aquí solo habilitamos la lectura REST.
grant select on table public.profiles, public.teams, public.team_members,
  public.team_invitations, public.players, public.exercise_folders,
  public.exercises, public.sessions, public.session_exercises
  to authenticated;

-- Jugadores: la app escribe directamente con RLS (addPlayer/updatePlayer/removePlayer).
grant insert, update, delete on table public.players to authenticated;

-- Carpetas: la app crea/renombra/duplica/borra carpetas con RLS (create/rename/delete/duplicate).
grant insert, update, delete on table public.exercise_folders to authenticated;

-- Ejercicios: la app guarda/borra/duplica con RLS (saveExercise/deleteExercise/duplicate).
grant insert, update, delete on table public.exercises to authenticated;

-- Sesiones: la app guarda/borra sesiones. El guardado transaccional va por la RPC
-- `public.save_session_with_tasks` (SECURITY INVOKER) pero el borrado directo
-- `deleteSession` usa DELETE REST sobre `public.sessions`; se concede DELETE.
grant insert, update, delete on table public.sessions to authenticated;

-- Sesion_exercises: la RPC `save_session_with_tasks` (INVOKER) escribe las tareas;
-- al ser INVOKER exige DML REST sobre la tabla para el rol authenticated.
grant insert, update, delete on table public.session_exercises to authenticated;

-- Equipos: la app CREA equipos únicamente mediante `public.create_my_team`
-- (SECURITY INVOKER), que hace `insert into public.teams`. Por tanto se concede
-- INSERT. NO existe ninguna operación real del producto que borre un equipo:
-- la app NUNCA hace `.from('teams').delete()`, así que NO se concede DELETE.
grant insert on table public.teams to authenticated;
grant update (name, accent_color) on table public.teams to authenticated;

-- Perfiles: solo se actualiza `display_name` (datos propios, RLS own).
grant update (display_name) on table public.profiles to authenticated;

-- NUNCA se conceden TRUNCATE/TRIGGER/REFERENCES a authenticated (no se usan).

-- ---------- 5) private.platform_admins: NO se concede acceso de tabla ----------
-- (ningún grant a anon/authenticated sobre private.platform_admins).

-- ---------- 6) EXECUTE de RPC públicas: solo necesarias; revocado a PUBLIC/anon ----------
-- Funciones públicas (SECURITY INVOKER) que la aplicación invoca desde el cliente.
revoke execute on function public.create_my_team(text, text) from public, anon;
revoke execute on function public.invite_team_member(uuid, text) from public, anon;
revoke execute on function public.accept_team_invitation(uuid) from public, anon;
revoke execute on function public.admin_set_profile_status(uuid, text) from public, anon;
revoke execute on function public.is_platform_admin() from public, anon;
revoke execute on function public.revoke_team_member(uuid, uuid) from public, anon;
revoke execute on function public.cancel_team_invitation(uuid) from public, anon;
revoke execute on function public.list_team_members(uuid) from public, anon;
revoke execute on function public.my_team_invitations() from public, anon;
revoke execute on function public.admin_list_profiles(text) from public, anon;
revoke execute on function public.save_session_with_tasks(jsonb, integer, jsonb) from public, anon;
revoke execute on function public.import_team_dataset(uuid, jsonb) from public, anon;
-- Funciones de trigger NO deben ser llamables por el cliente.
revoke execute on function public.touch_updated_at() from public, anon;
revoke execute on function public.guard_profile_identity() from public, anon;
revoke execute on function public.bump_revision() from public, anon;

grant execute on function public.create_my_team(text, text) to authenticated;
grant execute on function public.invite_team_member(uuid, text) to authenticated;
grant execute on function public.accept_team_invitation(uuid) to authenticated;
grant execute on function public.admin_set_profile_status(uuid, text) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.revoke_team_member(uuid, uuid) to authenticated;
grant execute on function public.cancel_team_invitation(uuid) to authenticated;
grant execute on function public.list_team_members(uuid) to authenticated;
grant execute on function public.my_team_invitations() to authenticated;
grant execute on function public.admin_list_profiles(text) to authenticated;
grant execute on function public.save_session_with_tasks(jsonb, integer, jsonb) to authenticated;
grant execute on function public.import_team_dataset(uuid, jsonb) to authenticated;

-- ---------- 7) Helpers PRIVADOS SECURITY DEFINER: solo los necesarios ----------
-- Un helper privado necesita EXECUTE a `authenticated` SOLO si un wrapper público
-- SECURITY INVOKER o una política RLS lo invoca DIRECTAMENTE (el cuerpo corre como
-- authenticated y debe poder ejecutarlo). Si solo se llama desde OTRO helper SECURITY
-- DEFINER, el cuerpo corre como el propietario y NO necesita EXECUTE del cliente.
--
-- INVOCADOS DIRECTAMENTE desde RPC públicas SECURITY INVOKER → SÍ necesitan EXECUTE:
grant execute on function private.is_approved() to authenticated;
grant execute on function private.team_role(uuid) to authenticated;
grant execute on function private.is_team_owner(uuid) to authenticated;
grant execute on function private.is_team_member(uuid) to authenticated;
grant execute on function private.owned_team_id() to authenticated;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.create_invitation(uuid, text) to authenticated;          -- público.invite_team_member
grant execute on function private.accept_invitation(uuid) to authenticated;                -- público.accept_team_invitation
grant execute on function private.set_profile_status(uuid, text) to authenticated;         -- público.admin_set_profile_status
grant execute on function private.revoke_team_member(uuid, uuid) to authenticated;         -- público.revoke_team_member
grant execute on function private.cancel_team_invitation(uuid) to authenticated;           -- público.cancel_team_invitation
grant execute on function private.list_team_members(uuid) to authenticated;                -- público.list_team_members
grant execute on function private.my_team_invitations() to authenticated;                  -- público.my_team_invitations
grant execute on function private.list_admin_profiles(text) to authenticated;              -- público.admin_list_profiles

-- SOLO se llaman desde otros helpers SECURITY DEFINER (NO desde un wrapper INVOKER ni
-- una política con EXECUTE del cliente) → NO necesitan EXECUTE a authenticated. Se
-- revocan para que el cliente no los invoque directamente (mínimo privilegio).
revoke execute on function private.enforce_collaborator_limit(uuid) from authenticated;    -- llamada por add_collaborator/create_invitation (DEFINER)
revoke execute on function private.add_collaborator(uuid, uuid, text) from authenticated;  -- llamada por accept_invitation (DEFINER)

-- ---------- 8) ENDURECIMIENTO POR DEFECTO para FUTUROS objetos ----------
-- Supabase tenía ACL por defecto amplias para objetos creados por `postgres`. Se
-- revocan para tablas, secuencias y funciones en `public`.
-- Una migración que añada una tabla/RPC nueva deberá habilitarla explícitamente.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

-- =============================================================
-- NOTA FINAL: esta migración es idempotente y fue preparada contra el catálogo
-- remoto real. Su estado aplicado se comprueba en la tabla de migraciones y en los
-- catálogos de privilegios después de ejecutarla. Los defaults pertenecientes a
-- `supabase_admin` no son modificables por `postgres` en Supabase alojado; esto no
-- impide cerrar los objetos actuales ni los futuros creados por nuestras migraciones.
-- =============================================================
