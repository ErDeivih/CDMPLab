-- =============================================================
-- EntrenoLab — Rechazar una invitación (lo hace el INVITADO, no el propietario).
--
-- DEFECTO QUE CORRIGE: la pantalla de invitaciones del invitado llamaba a
-- `cancel_team_invitation`, que exige ser PROPIETARIO del equipo
-- (private.cancel_team_invitation → 'forbidden: not team owner'). El invitado
-- recibía SIEMPRE un error al pulsar "Rechazar", y la invitación seguía pendiente.
--
-- MOLDE: `private.accept_invitation` (20260827000002_fix_invitation_acceptance.sql),
-- que es la otra RPC que usa un invitado. Mismo patrón: SECURITY DEFINER +
-- search_path='' + bloqueo de fila con `for update` + comprobaciones de identidad,
-- wrapper público SECURITY INVOKER que delega, y grants mínimos.
--
-- CLAVE DE IDENTIDAD: el correo de la cuenta (`auth.users.email`, ya confirmado),
-- la MISMA que usa accept_invitation. `invited_user_id` puede seguir siendo NULL
-- (solo se rellena al crear la invitación si el perfil ya existe, o al registrarse),
-- así que no se usa como criterio único.
--
-- CATÁLOGO REMOTO COMPROBADO (no por este script): la función
-- `decline_team_invitation` NO existe todavía en el proyecto; las funciones de
-- aceptación usadas como molde SÍ existen; el estado `revoked` está admitido por el
-- CHECK de `team_invitations`; y el patrón privada-DEFINER + wrapper público-INVOKER es
-- coherente con el resto. MIGRACIÓN AÚN NO APLICADA: la aplica el dueño/Codex.
--
-- SEGURIDAD / LÍMITE CONOCIDO: además, esta migración se ha validado con análisis
-- ESTÁTICO. `npm run validate:migration` parsea la sintaxis (libpg-query) y audita las
-- propiedades de seguridad de este fichero, pero NO comprueba que RLS esté activa ni que
-- los GRANT se apliquen sin error. Después de aplicarla hay que ejecutar las pruebas de
-- abuso de abajo con dos usuarios reales antes de darla por buena.
-- =============================================================

create or replace function private.decline_team_invitation(p_invitation_id uuid)
returns void
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
  -- Solo el invitado de ESA invitación puede rechazarla.
  if inv.email_normalized <> caller_email then
    raise exception 'invitation_email_mismatch';
  end if;
  -- El propietario del equipo no tiene una invitación propia que rechazar.
  if exists (
    select 1 from public.teams
    where id = inv.team_id and owner_user_id = auth.uid()
  ) then
    raise exception 'owner_cannot_be_collaborator';
  end if;

  -- 'revoked' ya existe en el CHECK de la tabla y el índice único parcial solo
  -- cubre `status = 'pending'`: al revocar, el correo queda libre para otra
  -- invitación del mismo equipo.
  update public.team_invitations
  set status = 'revoked'
  where id = inv.id;
end;
$$;

-- Wrapper público: SECURITY INVOKER (delega en la DEFINER), como el resto de RPC
-- públicas del proyecto (ver 20260827000003_rpc_security_invoker.sql).
create or replace function public.decline_team_invitation(p_invitation_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.decline_team_invitation(p_invitation_id); $$;

-- ---------- GRANTS: mínimo privilegio ----------
-- El invitado es `authenticated`. Nada para public ni anon.
revoke execute on function public.decline_team_invitation(uuid) from public, anon;
revoke execute on function private.decline_team_invitation(uuid) from public, anon;
grant execute on function public.decline_team_invitation(uuid) to authenticated;
-- El wrapper es INVOKER: quien lo llama necesita EXECUTE también en la privada
-- (igual que accept_team_invitation, cuyo grant vive en 20260901000000_harden_grants.sql).
grant execute on function private.decline_team_invitation(uuid) to authenticated;

-- =============================================================
-- PRUEBAS DE ABUSO (manuales, tras aplicar, con dos usuarios de prueba):
-- 1) El INVITADO rechaza su invitación pendiente → la fila queda status='revoked'
--    y desaparece de my_team_invitations().
-- 2) Otro usuario autenticado intenta rechazarla → 'invitation_email_mismatch'.
-- 3) El PROPIETARIO del equipo intenta rechazarla → 'owner_cannot_be_collaborator'.
-- 4) Un invitado con perfil pending → 'profile_not_approved'.
-- 5) Un usuario anónimo no puede ejecutar la función (EXECUTE revocado a anon).
-- =============================================================
