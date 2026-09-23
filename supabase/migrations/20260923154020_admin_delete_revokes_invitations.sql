-- =============================================================
-- CONSISTENCIA: borrar una cuenta CANCELA sus invitaciones pendientes
--
-- EL PROBLEMA (auditoría de flujos, 23/09/2026): la vista previa del borrado promete al
-- administrador que «se cancelarán N invitación(es) pendiente(s) suya(s)», pero la función NO las
-- tocaba. La clave foránea es `team_invitations.invited_user_id → profiles(user_id) ON DELETE SET
-- NULL`, así que al borrar el usuario las invitaciones NO desaparecen: se quedan **pendientes** con
-- `invited_user_id = NULL`. Y una invitación pendiente huérfana:
--   · OCUPA PLAZA mientras no haya caducado (`enforce_collaborator_limit` cuenta `status='pending'`
--     con `expires_at > now()`), sin que nadie pueda ya aceptarla;
--   · BLOQUEA para siempre volver a invitar a ese correo, porque el índice parcial único
--     `team_invitations_pending_unique` cubre `status='pending'` sin mirar la caducidad;
--   · sería aceptable por quien registrara ese correo más adelante: una cuenta borrada por el
--     administrador dejaba una invitación VIVA a su nombre.
--
-- LO QUE HACE AHORA: revoca las invitaciones pendientes del usuario dentro de la MISMA transacción,
-- antes de borrar la identidad. La auditoría sigue escribiéndose primero y el comportamiento
-- coincide con lo que la interfaz cuenta. `leave_team` y `revoke_team_member` ya hacían lo mismo.
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
  -- así que desaparecen perfil y membresías. OJO: las invitaciones NO se borran por cascada
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
    -- Cuántas invitaciones pendientes se han cancelado. Se añade al objeto de siempre para que el
    -- administrador pueda comprobarlo sin consultar la tabla (el cliente ignora el resto).
    'revoked_invitations', v_invitaciones
  );
end;
$$;

revoke all on function public.admin_delete_account(uuid, text) from public, anon;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;

-- =============================================================
-- COMPROBACIÓN PREVIA AL DESPLIEGUE (ejecutada antes de aplicarla remotamente el 23/09/2026)
--
--   -- 1) La firma es la MISMA que la ya aplicada (si cambiara, habría dos funciones conviviendo).
--   select p.oid::regprocedure, p.prosecdef, p.proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'admin_delete_account';
--
--   -- 2) Permisos actuales (esperado: anon=false, authenticated=true; `service_role` puede ser
--   --    true por los privilegios por defecto del proyecto para funciones en public).
--   select r.rolname, has_function_privilege(r.rolname, 'public.admin_delete_account(uuid, text)', 'execute')
--     from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
--
--   -- 3) ¿Hay invitaciones pendientes huérfanas de borrados anteriores? (las de antes de esta
--   --    migración siguen vivas y bloquean reinvitar: conviene cancelarlas a mano).
--   select i.id, i.team_id, i.email_normalized, i.status, i.expires_at
--     from public.team_invitations i
--    where i.status = 'pending'
--      and i.invited_user_id is null
--    order by i.created_at desc;
-- =============================================================
