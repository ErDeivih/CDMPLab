-- Seven accounts per team: one owner plus six active/pending collaborators.
-- Remote catalog checked on 2026-09-21: private.enforce_collaborator_limit(uuid)
-- exists, is SECURITY DEFINER with search_path='', locks the team row, and
-- currently rejects when used >= 4. Preserve those protections.
create or replace function private.enforce_collaborator_limit(t uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  if not private.is_team_owner(t) then
    raise exception 'forbidden: not team owner';
  end if;
  perform 1 from public.teams where id = t for update;
  if not found then
    raise exception 'team_not_found';
  end if;
  select
    (select count(*) from public.team_members
      where team_id = t and status = 'active' and role <> 'owner')
    + (select count(*) from public.team_invitations
      where team_id = t and status = 'pending' and expires_at > now())
  into used;
  if used >= 6 then
    raise exception 'collaborator_limit_exceeded';
  end if;
end;
$$;

revoke execute on function private.enforce_collaborator_limit(uuid)
  from public, anon, authenticated;
