-- =============================================================
-- ORDEN DE MIGRACIONES: reafirmar que borrar una cuenta cancela sus invitaciones pendientes
--
-- POR QUÉ EXISTE ESTE FICHERO (encontrado el 23/09/2026 al auditar el estado publicado):
--
-- El arreglo ya está escrito en `20260923154020_admin_delete_revokes_invitations.sql` y **está
-- aplicado en el proyecto remoto**. Pero ese fichero se renombró para que su versión coincidiera con
-- la que Supabase registró… y al hacerlo quedó ordenado ANTES de
-- `20260924000000_account_and_membership_management.sql`, que es la migración que CREA
-- `public.admin_delete_account`. Como el CLI aplica por orden de nombre y `create or replace` deja
-- ganar al ÚLTIMO, en un despliegue LIMPIO (proyecto nuevo, `db push` desde cero) la definición
-- final sería la vieja: **el arreglo desaparecería en silencio**. Y en silencio de verdad: el
-- cuerpo de una función `plpgsql` no resuelve tablas al crearse, así que la migración temprana no
-- falla aunque `public.account_deletions` (que usa esa función) todavía no exista.
--
-- De las 13 funciones que este repositorio define en más de una migración, 12 siguen el patrón
-- normal (definición base + arreglo posterior, y gana el posterior). `public.admin_delete_account`
-- era la única invertida.
--
-- LO QUE HACE: vuelve a definir la función con el arreglo, con una versión que ordena DESPUÉS de
-- todas las demás (`20260930…` > `20260928…` y > `20260924000000`), de modo que sea la que gane
-- tanto en el proyecto remoto como en un despliegue limpio. El cuerpo es idéntico al de
-- `20260923154020`, que se conserva porque el remoto ya lo tiene registrado (borrarlo dejaría un
-- registro huérfano y perdería la traza de lo aplicado).
--
-- El validador (`npm run validate:migration`) vigila esta clase de error: comprueba que el fichero
-- cuyas propiedades inspecciona es el ÚLTIMO que define esa función.
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
  v_invitaciones integer;
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

  -- Invitaciones PENDIENTES del usuario: se revocan (no se borran, igual que el resto del
  -- histórico). Se hace ANTES del borrado, mientras `invited_user_id` todavía lo identifica.
  update public.team_invitations
     set status = 'revoked'
   where invited_user_id = p_user_id
     and status = 'pending';
  get diagnostics v_invitaciones = row_count;

  -- Borrado REAL de la cuenta. `profiles.user_id` referencia `auth.users` con ON DELETE CASCADE,
  -- así que desaparecen perfil y membresías. Las invitaciones NO se borran por cascada
  -- (`invited_user_id` es ON DELETE SET NULL); las de este usuario ya quedaron revocadas arriba y
  -- las columnas que lo referencian (invited_by, decided_by, approved_by) quedan a NULL.
  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'account_not_found';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'user_id', p_user_id,
    'email_normalized', v_email,
    'revoked_invitations', v_invitaciones
  );
end;
$$;

revoke all on function public.admin_delete_account(uuid, text) from public, anon;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;

-- =============================================================
-- COMPROBACIÓN PREVIA AL DESPLIEGUE (obligatoria antes de aplicarla; el repositorio NO la ejecuta)
--
--   -- 1) ¿La definición ACTUAL en el remoto ya revoca las invitaciones? Si la consulta devuelve
--   --    `true`, esta migración no cambia el comportamiento (es idempotente) y solo fija el orden.
--   select strpos(pg_get_functiondef(p.oid), 'set status = ''revoked''') > 0 as ya_revoca
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'admin_delete_account';
--
--   -- 2) Firma y permisos (esperado: anon = false, authenticated = true; `service_role` también
--   --    puede ejecutarla, igual que el propietario de la función: es la credencial del servidor).
--   select r.rolname,
--          has_function_privilege(r.rolname, 'public.admin_delete_account(uuid, text)', 'execute')
--     from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
--
--   -- 3) ¿Hay invitaciones pendientes HUÉRFANAS de borrados anteriores a este arreglo? (siguen
--   --    vivas: ocupan plaza y bloquean reinvitar; conviene cancelarlas a mano).
--   select i.id, i.team_id, i.email_normalized, i.expires_at
--     from public.team_invitations i
--    where i.status = 'pending' and i.invited_user_id is null
--    order by i.created_at desc;
-- =============================================================
