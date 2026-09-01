-- INSERT ... RETURNING exige también la policy SELECT antes de que la fila sea
-- visible para los helpers de pertenencia. Generar el UUID antes evita ese falso
-- rechazo y mantiene el RPC como SECURITY INVOKER.
create or replace function public.create_my_team(
  p_name text,
  p_accent_color text default '#3056d3'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  team_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or not private.is_approved() then
    raise exception 'profile_not_approved' using errcode = '42501';
  end if;
  if trim(p_name) = '' then
    raise exception 'team_name_required';
  end if;
  if p_accent_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid_accent_color';
  end if;
  insert into public.teams (id, owner_user_id, name, accent_color)
  values (team_id, auth.uid(), trim(p_name), p_accent_color);
  return team_id;
end;
$$;
