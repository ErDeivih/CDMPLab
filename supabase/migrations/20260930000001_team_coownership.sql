-- Copropiedad, varias titularidades y siete plazas totales.
-- COMPROBACIÓN PREVIA AL DESPLIEGUE: catálogo consultado el 26/09/2026
-- (docs/copropiedad-contrato.md). Un equipo, cinco miembros, un propietario.
-- Creada con CLI; versión desplazada tras 20260930000000 para no perder sus arreglos.
-- Las mutaciones de gestión se serializan con un advisory lock transaccional.
-- Es deliberadamente global: operaciones poco frecuentes, ningún lock durante envío de correo.
-- No cambia ni elimina ejercicios, jugadores, carpetas o sesiones.
begin;

alter table public.teams drop constraint if exists teams_owner_unique;
alter table public.teams drop constraint if exists teams_owner_user_id_fkey;
alter table public.teams add constraint teams_owner_user_id_fkey
  foreign key (owner_user_id) references public.profiles(user_id) on delete restrict;
create index if not exists teams_owner_lookup on public.teams(owner_user_id);

create or replace function private.lock_team_management() returns void
language sql security definer set search_path = ''
as $$ select pg_catalog.pg_advisory_xact_lock(74192, 1) $$;
revoke all on function private.lock_team_management() from public, anon, authenticated;

create or replace function private.is_team_owner(t uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
 select private.is_approved() and exists (
   select 1 from public.team_members where team_id=t and user_id=auth.uid()
     and status='active' and role='owner'
 );
$$;

create or replace function private.team_role(t uuid) returns text
language sql stable security definer set search_path = ''
as $$
 select case when not private.is_approved() then 'none'
 when exists(select 1 from public.team_members where team_id=t and user_id=auth.uid()
   and status='active' and role='owner') then 'owner'
 when private.is_platform_admin() and exists(select 1 from public.teams where id=t) then 'editor'
 else coalesce((select role from public.team_members where team_id=t and user_id=auth.uid()
   and status='active'),'none') end;
$$;

-- Referencia heredada: siempre apunta a un propietario, pero NO decide permisos.
create or replace function private.prepare_owner_departure(t uuid, u uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare replacement uuid;
begin
 perform private.lock_team_management();
 perform 1 from public.teams where id=t for update;
 if not found then return; end if; -- cascada de un borrado explícito de EQUIPO
 if not exists(select 1 from public.team_members where team_id=t and user_id=u
   and role='owner' and status='active') then return; end if;
 select m.user_id into replacement from public.team_members m
 join public.profiles p on p.user_id=m.user_id
 where m.team_id=t and m.user_id<>u and m.role='owner' and m.status='active'
   and p.status='approved' order by m.user_id limit 1;
 if replacement is null then raise exception 'last_team_owner'; end if;
 update public.teams set owner_user_id=replacement where id=t and owner_user_id=u;
end;
$$;
revoke all on function private.prepare_owner_departure(uuid,uuid) from public, anon, authenticated;

create or replace function private.guard_team_membership() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare t uuid; used integer;
begin
 perform private.lock_team_management();
 t := case when tg_op='DELETE' then old.team_id else new.team_id end;
 if tg_op='UPDATE' and (new.team_id<>old.team_id or new.user_id<>old.user_id) then
   raise exception 'membership_identity_immutable';
 end if;
 if tg_op='DELETE' then
   perform private.prepare_owner_departure(t,old.user_id);
   return old;
 end if;
 if tg_op='UPDATE' and old.role='owner' and old.status='active'
   and (new.role<>'owner' or new.status<>'active') then
   perform private.prepare_owner_departure(t,old.user_id);
 end if;
 if new.role='owner' and new.status='active' and not exists(
   select 1 from public.profiles where user_id=new.user_id and status='approved'
 ) then raise exception 'new_owner_not_approved'; end if;
 if new.status='active' and (tg_op='INSERT' or old.status<>'active') and not exists(
   select 1 from public.team_members where team_id=t and user_id=new.user_id and status='active'
 ) then
   select (select count(*) from public.team_members where team_id=t and status='active')
     + (select count(*) from public.team_invitations where team_id=t
        and status='pending' and expires_at>now()) into used;
   if used>=7 then raise exception 'collaborator_limit_exceeded'; end if;
 end if;
 return new;
end;
$$;
revoke all on function private.guard_team_membership() from public, anon, authenticated;
drop trigger if exists team_members_protect_ownership on public.team_members;
create trigger team_members_protect_ownership before insert or update or delete on public.team_members
 for each row execute function private.guard_team_membership();

create or replace function private.prepare_account_removal(u uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare t uuid;
begin
 perform private.lock_team_management();
 for t in select team_id from public.team_members where user_id=u
   and role='owner' and status='active' order by team_id loop
   perform private.prepare_owner_departure(t,u);
 end loop;
end;
$$;
revoke all on function private.prepare_account_removal(uuid) from public, anon, authenticated;

create or replace function private.guard_profile_ownership() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
 if tg_op='DELETE' or (old.status='approved' and new.status<>'approved') then
   perform private.prepare_account_removal(old.user_id);
 end if;
 if tg_op='DELETE' then
   update public.team_invitations set status='revoked'
    where status='pending' and (invited_user_id=old.user_id or email_normalized=old.email_normalized);
   return old;
 end if;
 return new;
end;
$$;
revoke all on function private.guard_profile_ownership() from public, anon, authenticated;
drop trigger if exists profiles_protect_ownership on public.profiles;
create trigger profiles_protect_ownership before delete or update of status on public.profiles
 for each row execute function private.guard_profile_ownership();

drop policy if exists teams_update_owner on public.teams;
create policy teams_update_owner on public.teams for update to authenticated
 using(private.is_team_owner(id)) with check(private.is_team_owner(id));
-- La columna heredada y el alta NO se pueden modificar directamente desde el navegador.
revoke insert, update, delete on public.teams from authenticated;
grant update(name,accent_color) on public.teams to authenticated;
revoke insert, update, delete on public.team_members from authenticated;

create or replace function private.enforce_collaborator_limit(t uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare used integer;
begin
 perform private.lock_team_management();
 if not private.is_team_owner(t) then raise exception 'forbidden: not team owner'; end if;
 perform 1 from public.teams where id=t for update;
 if not found then raise exception 'team_not_found'; end if;
 select (select count(*) from public.team_members where team_id=t and status='active')
   + (select count(*) from public.team_invitations where team_id=t and status='pending'
      and expires_at>now()) into used;
 if used>=7 then raise exception 'collaborator_limit_exceeded'; end if;
end;
$$;

create or replace function private.set_team_member_role(t uuid,u uuid,new_role text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
 perform private.lock_team_management();
 if not private.is_team_owner(t) then raise exception 'forbidden: not team owner'; end if;
 if new_role is null or new_role not in ('owner','editor') then raise exception 'invalid_member_role'; end if;
 update public.team_members set role=new_role
  where team_id=t and user_id=u and status='active';
 if not found then raise exception 'new_owner_must_be_active_member'; end if;
end;
$$;
revoke all on function private.set_team_member_role(uuid,uuid,text) from public, anon;
grant execute on function private.set_team_member_role(uuid,uuid,text) to authenticated;
create or replace function public.set_team_member_role(p_team_id uuid,p_user_id uuid,p_role text)
returns void language sql security invoker set search_path = ''
as $$ select private.set_team_member_role(p_team_id,p_user_id,p_role) $$;
revoke all on function public.set_team_member_role(uuid,uuid,text) from public, anon;
grant execute on function public.set_team_member_role(uuid,uuid,text) to authenticated;

create or replace function private.accept_invitation(p_invitation_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare inv public.team_invitations%rowtype; caller_email text;
begin
 perform private.lock_team_management();
 select lower(email) into caller_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if caller_email is null then raise exception 'email_not_confirmed'; end if;
 if not private.is_approved() then raise exception 'profile_not_approved'; end if;
 select * into inv from public.team_invitations where id=p_invitation_id for update;
 if not found then raise exception 'invitation_not_available'; end if;
 if inv.email_normalized<>caller_email then raise exception 'invitation_email_mismatch'; end if;
 if inv.status='accepted' and exists(select 1 from public.team_members
   where team_id=inv.team_id and user_id=auth.uid() and status='active') then return inv.team_id; end if;
 if inv.status<>'pending' or inv.expires_at<=now() then raise exception 'invitation_not_available'; end if;
 update public.team_invitations set status='accepted',invited_user_id=auth.uid() where id=inv.id;
 insert into public.team_members(team_id,user_id,role,status,invited_by,accepted_at)
 values(inv.team_id,auth.uid(),'editor','active',inv.invited_by,now())
 on conflict(team_id,user_id) do update set role='editor',status='active',
   invited_by=excluded.invited_by,accepted_at=now()
 where public.team_members.status<>'active';
 return inv.team_id;
end;
$$;

create or replace function public.my_accessible_teams()
returns table(id uuid,name text,accent_color text,created_at timestamptz,role text)
language sql stable security invoker set search_path = ''
as $$
 select t.id,t.name,t.accent_color,t.created_at,private.team_role(t.id)
 from public.teams t where private.team_role(t.id) in ('owner','editor') order by t.created_at,t.id;
$$;
revoke all on function public.my_accessible_teams() from public,anon;
grant execute on function public.my_accessible_teams() to authenticated;
create or replace function private.request_team_creation(p_name text, p_accent_color text DEFAULT '#3056d3'::text)
 returns uuid
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_color text := lower(coalesce(p_accent_color, '#3056d3'));
  v_id uuid;
begin
  perform private.lock_team_management();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_approved() then
    raise exception 'profile_not_approved' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'team_name_required';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'team_name_too_long';
  end if;
  if v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_accent_color';
  end if;

  insert into public.team_requests (user_id, name, accent_color)
  values (v_uid, v_name, v_color)
  on conflict (user_id) where status = 'pending' do update
    set name = excluded.name,
        accent_color = excluded.accent_color,
        revision = public.team_requests.revision + 1,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.admin_decide_team_request(p_request_id uuid, p_approve boolean, p_note text default null)
 returns uuid
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_admin uuid := auth.uid();
  v_req public.team_requests%rowtype;
  v_team uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.lock_team_management();
  if v_admin is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select * into v_req from public.team_requests where id = p_request_id for update;
  if not found then
    raise exception 'team_request_not_found';
  end if;

  if v_req.status = 'approved' then
    if p_approve then
      return v_req.created_team_id;
    end if;
    raise exception 'team_request_already_approved';
  end if;
  if v_req.status = 'rejected' and not p_approve then
    return null;
  end if;

  if not p_approve then
    update public.team_requests
    set status = 'rejected',
        note = v_note,
        decided_at = now(),
        decided_by = v_admin,
        created_team_id = null
    where id = v_req.id;
    return null;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.user_id = v_req.user_id and p.status = 'approved'
  ) then
    raise exception 'requester_not_approved';
  end if;

  insert into public.teams (owner_user_id, name, accent_color)
  values (v_req.user_id, v_req.name, v_req.accent_color) returning id into v_team;

  update public.team_requests
  set status = 'approved',
      note = null,
      decided_at = now(),
      decided_by = v_admin,
      created_team_id = v_team
  where id = v_req.id;

  update public.team_requests
  set status = 'rejected',
      note = coalesce(note, 'Cerrada: ya se aprobó otra solicitud de este usuario.'),
      decided_at = coalesce(decided_at, now()),
      decided_by = coalesce(decided_by, v_admin)
  where user_id = v_req.user_id
    and status = 'pending'
    and id <> v_req.id;

  return v_team;
end;
$function$;

create or replace function public.create_my_team(p_name text, p_accent_color text DEFAULT '#3056d3'::text)
 returns uuid
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_color text := lower(coalesce(p_accent_color, '#3056d3'));
  v_team uuid;
begin
  perform private.lock_team_management();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_platform_admin() then
    raise exception 'team_creation_requires_approval' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'team_name_required';
  end if;
  if v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_accent_color';
  end if;
  insert into public.teams (owner_user_id, name, accent_color)
  values (v_uid, v_name, v_color)
  returning id into v_team;
  return v_team;
end;
$function$;

create or replace function public.leave_team(p_team_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  perform private.lock_team_management();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_approved() then
    raise exception 'profile_not_approved';
  end if;

  perform 1 from public.teams where id = p_team_id for update;

  if not exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = v_uid and m.status = 'active'
  ) then
    raise exception 'not_a_member';
  end if;

  update public.team_invitations
     set status = 'revoked'
   where team_id = p_team_id and invited_user_id = v_uid and status = 'pending';
  update public.team_members
     set status = 'revoked', accepted_at = null
   where team_id = p_team_id and user_id = v_uid and status = 'active';
end;
$function$;

create or replace function private.revoke_team_member(p_team_id uuid, p_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  perform private.lock_team_management();
  if not private.is_team_owner(p_team_id) then
    raise exception 'forbidden: not team owner';
  end if;

  update public.team_members
     set status = 'revoked', accepted_at = null
   where team_id = p_team_id and user_id = p_user_id and status = 'active';
  update public.team_invitations
     set status = 'revoked'
   where team_id = p_team_id and invited_user_id = p_user_id and status = 'pending';
end;
$function$;

create or replace function public.transfer_team_ownership(p_team_id uuid, p_new_owner_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  perform private.lock_team_management();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  perform 1 from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'team_not_found';
  end if;

  if not private.is_team_owner(p_team_id) then
    raise exception 'forbidden: not team owner';
  end if;
  if p_new_owner_user_id = v_uid then
    raise exception 'already_owner';
  end if;
  if not exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id
      and m.user_id = p_new_owner_user_id
      and m.status = 'active'
      and m.role = 'editor'
  ) then
    raise exception 'new_owner_must_be_active_member';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.user_id = p_new_owner_user_id and p.status = 'approved'
  ) then
    raise exception 'new_owner_not_approved';
  end if;

  update public.teams set owner_user_id = p_new_owner_user_id where id = p_team_id;

  update public.team_members
     set role = 'owner', status = 'active', accepted_at = coalesce(accepted_at, now())
   where team_id = p_team_id and user_id = p_new_owner_user_id;
  update public.team_members
     set role = 'editor', status = 'active', accepted_at = coalesce(accepted_at, now())
   where team_id = p_team_id and user_id = v_uid;
end;
$function$;

create or replace function public.admin_delete_account(p_user_id uuid, p_reason text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_admin uuid := auth.uid();
  v_prof public.profiles%rowtype;
  v_email text;
  v_invitaciones integer;
begin
  perform private.lock_team_management();
  if v_admin is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

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

  perform private.prepare_account_removal(p_user_id);

  v_email := v_prof.email_normalized;

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

  update public.team_invitations
     set status = 'revoked'
   where invited_user_id = p_user_id
     and status = 'pending';
  get diagnostics v_invitaciones = row_count;

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
$function$;

create or replace function public.delete_my_admin_account(p_confirm_email text)
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare v_profile public.profiles%rowtype;
begin
  perform private.lock_team_management();
  if not private.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;

  lock table private.platform_admins in share row exclusive mode;
  if (select count(*) from private.platform_admins) < 2 then raise exception 'last_platform_admin'; end if;
  select * into v_profile from public.profiles where user_id=auth.uid() for update;
  if lower(btrim(coalesce(p_confirm_email,''))) <> v_profile.email_normalized then raise exception 'email_confirmation_mismatch'; end if;
  perform private.prepare_account_removal(auth.uid());
  insert into public.account_deletions(deleted_user_id,email_normalized,display_name,status_before,reason,deleted_by)
  values(v_profile.user_id,v_profile.email_normalized,v_profile.display_name,v_profile.status,'Baja voluntaria del administrador',auth.uid());
  delete from auth.users where id=auth.uid();
end;
$function$;

create or replace function public.delete_team(p_team_id uuid, p_confirm_name text, p_reason text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_team public.teams%rowtype;
  v_owner public.profiles%rowtype;
  v_nombre text;
  v_resumen jsonb;
begin
  perform private.lock_team_management();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_team from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'team_not_found';
  end if;

  if not private.is_team_owner(p_team_id) and not private.is_platform_admin() then
    raise exception 'not_authorized_for_team_deletion' using errcode = '42501';
  end if;

  v_nombre := btrim(coalesce(p_confirm_name, ''));
  if v_nombre = '' or v_nombre <> v_team.name then
    raise exception 'team_name_confirmation_mismatch';
  end if;

  select * into v_owner from public.profiles where user_id = v_team.owner_user_id;
  v_resumen := jsonb_build_object(
    'players', (select count(*) from public.players p where p.team_id = v_team.id),
    'folders', (select count(*) from public.exercise_folders f where f.team_id = v_team.id),
    'exercises', (select count(*) from public.exercises e where e.team_id = v_team.id),
    'sessions', (select count(*) from public.sessions s where s.team_id = v_team.id),
    'members', (select count(*) from public.team_members m where m.team_id = v_team.id),
    'pending_invitations',
      (select count(*) from public.team_invitations i
        where i.team_id = v_team.id and i.status = 'pending')
  );

  insert into public.team_deletions
    (deleted_team_id, team_name, owner_user_id, owner_email, data_summary, reason, deleted_by)
  values (
    v_team.id,
    v_team.name,
    v_team.owner_user_id,
    coalesce(v_owner.email_normalized, ''),
    v_resumen,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_uid
  );

  delete from public.teams where id = v_team.id;
  if not found then
    raise exception 'team_not_found';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'team_id', v_team.id,
    'name', v_team.name,
    'data', v_resumen
  );
end;
$function$;

create or replace function public.team_deletion_preview(p_team_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_team public.teams%rowtype;
  v_owner public.profiles%rowtype;
  v_es_propietario boolean;
  v_es_admin boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_team from public.teams where id = p_team_id;
  if not found then
    return jsonb_build_object('found', false, 'team_id', p_team_id);
  end if;
  v_es_propietario := private.is_team_owner(p_team_id);
  v_es_admin := private.is_platform_admin();

  if not v_es_propietario and not v_es_admin then
    raise exception 'not_authorized_for_team_deletion' using errcode = '42501';
  end if;
  select * into v_owner from public.profiles where user_id = v_team.owner_user_id;

  return jsonb_build_object(
    'found', true,
    'team_id', v_team.id,
    'name', v_team.name,
    'accent_color', v_team.accent_color,
    'owner_user_id', v_team.owner_user_id,
    'owner_email', coalesce(v_owner.email_normalized, ''),
    'is_owner', v_es_propietario,
    'is_platform_admin', v_es_admin,
    'can_delete', v_es_propietario or v_es_admin,
    'confirm_name_required', v_team.name,
    'data', jsonb_build_object(
      'players', (select count(*) from public.players p where p.team_id = v_team.id),
      'folders', (select count(*) from public.exercise_folders f where f.team_id = v_team.id),
      'exercises', (select count(*) from public.exercises e where e.team_id = v_team.id),
      'sessions', (select count(*) from public.sessions s where s.team_id = v_team.id),
      'members', (select count(*) from public.team_members m where m.team_id = v_team.id),
      'pending_invitations',
        (select count(*) from public.team_invitations i
          where i.team_id = v_team.id and i.status = 'pending')
    )
  );
end;
$function$;

create or replace function public.admin_team_overview()
 returns TABLE(team_id uuid, name text, accent_color text, owner_user_id uuid, owner_email text, created_at timestamp with time zone, updated_at timestamp with time zone, members_active integer, members_revoked integer, members_pending integer, invitations_pending integer, players_active integer, players_inactive integer, folders integer, exercises integer, sessions integer, invitations_expired_pending integer)
 language plpgsql
 stable security definer
 set search_path = ''
as $function$
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  return query
    select t.id,
           t.name,
           t.accent_color,
           t.owner_user_id,
           coalesce((select string_agg(pr.email_normalized, ', ' order by pr.email_normalized)
             from public.team_members m join public.profiles pr on pr.user_id=m.user_id
             where m.team_id=t.id and m.role='owner' and m.status='active'), ''),
           t.created_at,
           t.updated_at,

           (select count(*) from public.team_members m
             where m.team_id = t.id and m.status = 'active')::integer,
           (select count(*) from public.team_members m
             where m.team_id = t.id and m.status = 'revoked')::integer,
           (select count(*) from public.team_members m
             where m.team_id = t.id and m.status = 'pending_approval')::integer,

           (select count(*) from public.team_invitations i
             where i.team_id = t.id and i.status = 'pending' and i.expires_at > now())::integer,

           (select count(*) from public.players pl
             where pl.team_id = t.id and pl.active)::integer,
           (select count(*) from public.players pl
             where pl.team_id = t.id and not pl.active)::integer,
           (select count(*) from public.exercise_folders f where f.team_id = t.id)::integer,
           (select count(*) from public.exercises e where e.team_id = t.id)::integer,
           (select count(*) from public.sessions s where s.team_id = t.id)::integer,

           (select count(*) from public.team_invitations i
             where i.team_id = t.id and i.status = 'pending' and i.expires_at <= now())::integer
      from public.teams t
      left join public.profiles p on p.user_id = t.owner_user_id
     order by t.created_at asc, t.name asc;
end;
$function$;

create or replace function private.create_invitation(p_team_id uuid, p_email_normalized text)
 returns uuid
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  inv_id uuid;
  normalized text := lower(trim(p_email_normalized));
  target_user uuid;
begin
  perform private.lock_team_management();
  if normalized = '' or normalized !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_invitation_email';
  end if;
  perform private.enforce_collaborator_limit(p_team_id);
  select user_id into target_user
  from public.profiles
  where email_normalized = normalized;
  if exists(select 1 from public.team_members where team_id=p_team_id and user_id=target_user and status='active') then
    raise exception 'already_team_member';
  end if;
  insert into public.team_invitations (team_id, email_normalized, invited_by)
  values (p_team_id, normalized, auth.uid())
  returning id into inv_id;
  if target_user is not null then
    update public.team_invitations
    set invited_user_id = target_user
    where id = inv_id;
  end if;
  return inv_id;
end;
$function$;

create or replace function private.set_profile_status(p_user_id uuid, p_status text)
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  perform private.lock_team_management();
  if not private.is_platform_admin() then
    raise exception 'forbidden: platform admin required';
  end if;
  if p_status not in ('pending','approved','rejected','suspended') then
    raise exception 'invalid_profile_status';
  end if;
  update public.profiles
  set status = p_status,
      approved_at = case when p_status = 'approved' then now() else null end,
      approved_by = case when p_status = 'approved' then auth.uid() else null end
  where user_id = p_user_id;
  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$function$;

create or replace function public.admin_deletion_preview(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare p public.profiles%rowtype; blockers text[] := '{}'; teams text;
begin
 if not private.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
 select * into p from public.profiles where user_id=p_user_id;
 if not found then return jsonb_build_object('found',false,'user_id',p_user_id); end if;
 select string_agg(t.name, ', ' order by t.name) into teams from public.teams t
 join public.team_members own on own.team_id=t.id and own.user_id=p_user_id
 where own.role='owner' and own.status='active' and not exists(
   select 1 from public.team_members m join public.profiles other on other.user_id=m.user_id
   where m.team_id=t.id and m.user_id<>p_user_id and m.role='owner'
     and m.status='active' and other.status='approved'
 );
 if teams is not null then blockers:=array_append(blockers,'owns_team'); end if;
 if p_user_id=auth.uid() then blockers:=array_append(blockers,'self'); end if;
 if exists(select 1 from private.platform_admins where user_id=p_user_id) then
   blockers:=array_append(blockers,'platform_admin');
 end if;
 return jsonb_build_object(
   'found',true,'user_id',p.user_id,'display_name',p.display_name,'email_normalized',p.email_normalized,
   'status',p.status,'is_platform_admin','platform_admin'=any(blockers),'is_self',p_user_id=auth.uid(),
   'owns_team',teams is not null,'owned_team_name',teams,
   'owned_team_data',jsonb_build_object(
     'players',(select count(*) from public.players where team_id in
       (select team_id from public.team_members where user_id=p_user_id and role='owner' and status='active')),
     'folders',(select count(*) from public.exercise_folders where team_id in
       (select team_id from public.team_members where user_id=p_user_id and role='owner' and status='active')),
     'exercises',(select count(*) from public.exercises where team_id in
       (select team_id from public.team_members where user_id=p_user_id and role='owner' and status='active')),
     'sessions',(select count(*) from public.sessions where team_id in
       (select team_id from public.team_members where user_id=p_user_id and role='owner' and status='active'))),
   'active_memberships',(select count(*) from public.team_members where user_id=p_user_id and status='active'),
   'pending_invitations',(select count(*) from public.team_invitations where status='pending'
     and (invited_user_id=p_user_id or email_normalized=p.email_normalized)),
   'blockers',to_jsonb(blockers),'deletable',cardinality(blockers)=0
 );
end;
$$;

revoke all on function public.admin_delete_account(uuid, text) from public, anon;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;

revoke all on function public.admin_deletion_preview(uuid) from public, anon;
grant execute on function public.admin_deletion_preview(uuid) to authenticated;

revoke all on function public.delete_my_admin_account(text) from public, anon;
grant execute on function public.delete_my_admin_account(text) to authenticated;

revoke all on function public.delete_team(uuid, text, text) from public, anon;
grant execute on function public.delete_team(uuid, text, text) to authenticated;

revoke all on function public.team_deletion_preview(uuid) from public, anon;
grant execute on function public.team_deletion_preview(uuid) to authenticated;

revoke all on function public.admin_team_overview() from public, anon;
grant execute on function public.admin_team_overview() to authenticated;

revoke all on function public.admin_decide_team_request(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_team_request(uuid, boolean, text) to authenticated;

revoke all on function public.create_my_team(text,text) from public, anon;
grant execute on function public.create_my_team(text,text) to authenticated;

revoke all on function public.transfer_team_ownership(uuid,uuid) from public, anon;
grant execute on function public.transfer_team_ownership(uuid,uuid) to authenticated;

revoke all on function public.leave_team(uuid) from public, anon;
grant execute on function public.leave_team(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
