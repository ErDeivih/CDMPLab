-- Permite al administrador de plataforma consultar miembros de cualquier equipo
-- desde el panel global. El propietario mantiene el acceso habitual; ningún editor
-- normal obtiene este permiso.
create or replace function private.list_team_members(p_team_id uuid)
returns table(
  user_id uuid,
  display_name text,
  email_normalized text,
  role text,
  status text,
  accepted_at timestamptz,
  invited_by uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.is_team_owner(p_team_id) or private.is_platform_admin()) then
    raise exception 'forbidden: not team owner or platform admin';
  end if;
  return query
    select tm.user_id,
           p.display_name,
           p.email_normalized,
           tm.role::text,
           tm.status::text,
           tm.accepted_at,
           tm.invited_by
    from public.team_members tm
    join public.profiles p on p.user_id = tm.user_id
    where tm.team_id = p_team_id
    order by (tm.role = 'owner') desc, tm.created_at asc;
end;
$$;

revoke execute on function private.list_team_members(uuid) from public, anon;
grant execute on function private.list_team_members(uuid) to authenticated;
