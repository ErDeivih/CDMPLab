-- Aceptar una invitación convierte una plaza pendiente en una membresía activa.
-- No debe volver a exigir que el invitado sea propietario del equipo.
create or replace function private.accept_invitation(p_invitation_id uuid)
returns uuid
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
  if inv.email_normalized <> caller_email then
    raise exception 'invitation_email_mismatch';
  end if;
  if exists (
    select 1 from public.teams
    where id = inv.team_id and owner_user_id = auth.uid()
  ) then
    raise exception 'owner_cannot_be_collaborator';
  end if;

  -- La invitación pendiente ya consumía una de las cuatro plazas. Convertirla
  -- dentro de la misma transacción mantiene constante el contador.
  update public.team_invitations
  set status = 'accepted', invited_user_id = auth.uid()
  where id = inv.id;

  insert into public.team_members (
    team_id, user_id, role, status, invited_by, accepted_at
  ) values (
    inv.team_id, auth.uid(), 'editor', 'active', inv.invited_by, now()
  )
  on conflict (team_id, user_id) do update
    set role = 'editor',
        status = 'active',
        invited_by = excluded.invited_by,
        accepted_at = coalesce(public.team_members.accepted_at, now());

  return inv.team_id;
end;
$$;

revoke execute on function private.accept_invitation(uuid) from public, anon, authenticated;
