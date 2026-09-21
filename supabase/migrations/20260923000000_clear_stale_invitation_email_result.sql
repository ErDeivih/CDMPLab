-- La matriz RLS real detectó que un nuevo intento conservaba el identificador
-- del proveedor del intento anterior. Al abrir un intento, ambos resultados
-- anteriores dejan de describir el estado vigente y deben limpiarse.
create or replace function public.prepare_invitation_email(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.team_invitations%rowtype;
  v_team_name text;
  v_attempt uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_inv from public.team_invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'invitation_not_available';
  end if;
  if not private.is_team_owner(v_inv.team_id) then
    raise exception 'forbidden: not team owner' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    raise exception 'invitation_not_available';
  end if;
  if v_inv.email_status <> 'send_error'
     and v_inv.last_email_at is not null
     and v_inv.last_email_at > now() - interval '60 seconds' then
    raise exception 'email_cooldown';
  end if;
  if v_inv.email_attempts >= 5 then
    raise exception 'email_attempt_limit';
  end if;
  select t.name into v_team_name from public.teams t where t.id = v_inv.team_id;
  update public.team_invitations
  set email_status = 'send_pending',
      email_attempts = email_attempts + 1,
      last_email_at = now(),
      email_attempt_id = gen_random_uuid(),
      provider_message_id = null,
      last_email_error = null
  where id = v_inv.id
  returning email_attempt_id into v_attempt;
  return jsonb_build_object(
    'invitation_id', v_inv.id,
    'team_id', v_inv.team_id,
    'team_name', coalesce(v_team_name, ''),
    'email', v_inv.email_normalized,
    'link_path', '/invitations?invitation=' || v_inv.id::text,
    'attempt_id', v_attempt
  );
end;
$$;

revoke execute on function public.prepare_invitation_email(uuid) from public, anon;
grant execute on function public.prepare_invitation_email(uuid) to authenticated;
