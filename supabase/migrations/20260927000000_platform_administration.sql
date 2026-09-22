-- Catálogo remoto consultado el 22/09/2026: estas RPC no existen.
-- Los administradores entran como editores en cualquier equipo sin ocupar plazas.
create or replace function private.team_role(t uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not private.is_approved() then 'none'
    when exists (select 1 from public.teams x where x.id=t and x.owner_user_id=auth.uid()) then 'owner'
    when private.is_platform_admin() and exists (select 1 from public.teams x where x.id=t) then 'editor'
    else coalesce((select role from public.team_members where team_id=t and user_id=auth.uid() and status='active' limit 1),'none')
  end;
$$;

create or replace function public.admin_list_administrators()
returns table(user_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
  return query select a.user_id from private.platform_admins a;
end;
$$;

create or replace function public.admin_grant_platform_admin(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
  perform 1 from public.profiles where user_id=p_user_id and status='approved' for update;
  if not found then raise exception 'profile_not_approved'; end if;
  insert into private.platform_admins(user_id) values(p_user_id) on conflict do nothing;
end;
$$;

-- Impide expulsar indirectamente a otro administrador suspendiendo su perfil.
create or replace function private.protect_admin_profile()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status and new.status <> 'approved'
     and exists(select 1 from private.platform_admins where user_id=old.user_id) then
    raise exception 'cannot_suspend_platform_admin' using errcode='42501';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_admin_profile on public.profiles;
create trigger protect_admin_profile before update of status on public.profiles
for each row execute function private.protect_admin_profile();
revoke all on function private.protect_admin_profile() from public,anon,authenticated;

revoke all on function public.admin_list_administrators() from public,anon;
revoke all on function public.admin_grant_platform_admin(uuid) from public,anon;
grant execute on function public.admin_list_administrators() to authenticated;
grant execute on function public.admin_grant_platform_admin(uuid) to authenticated;

-- Baja voluntaria: solo afecta a la identidad autenticada, nunca a otro administrador.
create or replace function public.delete_my_admin_account(p_confirm_email text)
returns void language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype;
begin
  if not private.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
  -- Serializa las bajas: dos administradores no pueden dejar la plataforma sin ninguno.
  lock table private.platform_admins in share row exclusive mode;
  if (select count(*) from private.platform_admins) < 2 then raise exception 'last_platform_admin'; end if;
  select * into v_profile from public.profiles where user_id=auth.uid() for update;
  if lower(btrim(coalesce(p_confirm_email,''))) <> v_profile.email_normalized then raise exception 'email_confirmation_mismatch'; end if;
  if exists(select 1 from public.teams where owner_user_id=auth.uid()) then raise exception 'target_owns_team'; end if;
  insert into public.account_deletions(deleted_user_id,email_normalized,display_name,status_before,reason,deleted_by)
  values(v_profile.user_id,v_profile.email_normalized,v_profile.display_name,v_profile.status,'Baja voluntaria del administrador',auth.uid());
  delete from auth.users where id=auth.uid();
end;
$$;
revoke all on function public.delete_my_admin_account(text) from public,anon;
grant execute on function public.delete_my_admin_account(text) to authenticated;
