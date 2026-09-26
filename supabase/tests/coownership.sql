-- Pruebas de contrato sobre PostgreSQL real. Fixtures aisladas, siempre ROLLBACK.
-- Ejecutar con psql -v ON_ERROR_STOP=1; no sustituyen las pruebas de concurrencia.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,role,aud)
select ('31000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'coowner-'||n||'@test.local',now(),'{}','{}','authenticated','authenticated'
from generate_series(1,10) n;
update public.profiles set status='approved',approved_at=now()
where user_id::text like '31000000-0000-4000-8000-%';
insert into private.platform_admins(user_id) values('31000000-0000-4000-8000-000000000010');


set local role authenticated;
do $$
declare
 a uuid := '31000000-0000-4000-8000-000000000001';
 b uuid := '31000000-0000-4000-8000-000000000002';
 c uuid := '31000000-0000-4000-8000-000000000003';
 admin uuid := '31000000-0000-4000-8000-000000000010';
 t uuid; t2 uuid; req uuid; invitation uuid; item uuid; n integer;
begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 begin
  execute $q$select public.create_my_team('Unauthorized','#123456')$q$;
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('team_creation_requires_approval' in sqlerrm)=0 then raise; end if;
 end;
 begin
  execute format('insert into public.teams(owner_user_id,name) values(%L,%L)',a,'Bypass');
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('permission denied' in sqlerrm)=0 then raise; end if;
 end;
 req := public.request_team_creation('Coownership fixture','#123456');
 perform set_config('request.jwt.claim.sub',admin::text,true);
 t := public.admin_decide_team_request(req,true,null);
 assert public.admin_decide_team_request(req,true,null)=t, 'Approval must be idempotent';
 perform set_config('request.jwt.claim.sub',a::text,true);
 req := public.request_team_creation('Second authorized team','#123456');
 perform set_config('request.jwt.claim.sub',admin::text,true);
 t2 := public.admin_decide_team_request(req,true,null);
 assert t2<>t,'Multiple requests must create distinct teams';
 assert (select role from public.my_accessible_teams() where id=t)='editor','Global admin is not an owner';
 begin
  execute format('select public.set_team_member_role(%L,%L,%L)',t,admin,'owner');
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('not team owner' in sqlerrm)=0 then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',a::text,true);
 assert (select count(*) from public.my_accessible_teams())=2,'Owner must access both teams';
 insert into public.exercises(team_id,title,canvas_data) values(t,'Keep shared data','{"elements":[{"id":"keep"}]}') returning id into item;
 invitation := public.invite_team_member(t,'coowner-2@test.local');
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform public.accept_team_invitation(invitation);
 assert public.accept_team_invitation(invitation)=t,'Accept retry must be idempotent';
 begin
  execute format('select public.set_team_member_role(%L,%L,%L)',t,b,'owner');
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('not team owner' in sqlerrm)=0 then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform public.set_team_member_role(t,b,'owner');
 assert (select role from public.my_accessible_teams() where id=t)='owner','Promoting another must not demote actor';
 perform set_config('request.jwt.claim.sub',b::text,true);
 assert (select role from public.my_accessible_teams() where id=t)='owner','Coowner needs actual owner role';
 update public.teams set name='Renamed by coowner' where id=t;
 assert (select name from public.teams where id=t)='Renamed by coowner','Coowner can rename';
 begin
  execute format('update public.teams set owner_user_id=%L where id=%L',b,t);
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('permission denied' in sqlerrm)=0 then raise; end if;
 end;
 perform public.set_team_member_role(t,a,'editor');
 begin
  execute format('select public.leave_team(%L)',t);
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('last_team_owner' in sqlerrm)=0 then raise; end if;
 end;
 begin
  execute format('select public.set_team_member_role(%L,%L,%L)',t,b,'editor');
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('last_team_owner' in sqlerrm)=0 then raise; end if;
 end;
 begin
  execute format('select public.revoke_team_member(%L,%L)',t,b);
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('last_team_owner' in sqlerrm)=0 then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 begin
  execute format('select public.admin_set_profile_status(%L,%L)',b,'suspended');
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('last_team_owner' in sqlerrm)=0 then raise; end if;
 end;
 begin
  execute format('select public.admin_delete_account(%L)',b);
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('last_team_owner' in sqlerrm)=0 then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform public.set_team_member_role(t,a,'owner');
 -- Invitar a quien ya pertenece no debe ocupar una segunda plaza.
 begin
  execute format('select public.invite_team_member(%L,%L)',t,'coowner-1@test.local');
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('already_team_member' in sqlerrm)=0 then raise; end if;
 end;
 -- Dos propietarios + cinco invitaciones llenan exactamente siete plazas.
 for n in 3..7 loop
   invitation := public.invite_team_member(t,'coowner-'||n||'@test.local');
 end loop;
 begin
  execute format('select public.invite_team_member(%L,%L)',t,'coowner-8@test.local');
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('collaborator_limit_exceeded' in sqlerrm)=0 then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',c::text,true);
 select id into invitation from public.my_team_invitations() where team_id=t;
 perform public.accept_team_invitation(invitation);
 perform set_config('request.jwt.claim.sub',admin::text,true);
 assert (select members_active+invitations_pending from public.admin_team_overview() where team_id=t)=7,'Seat count mismatch';
 -- Al borrar un copropietario que NO es el último se mantiene equipo y contenido.
 perform public.admin_delete_account(b);
 assert (select count(*) from public.teams where id=t)=1,'Shared team deleted with account';
 assert (select canvas_data->'elements'->0->>'id' from public.exercises where id=item)='keep','Shared drawing lost';
 perform set_config('request.jwt.claim.sub',a::text,true);
 assert (select role from public.my_accessible_teams() where id=t)='owner','Remaining owner lost access';
 -- Borrado explícito de equipo con su nombre, incluso siendo su último propietario.
 begin
  execute format('select public.delete_team(%L,%L)',t,'wrong');
  raise exception 'Operation unexpectedly succeeded' using errcode='XX001';
 exception when others then
  if sqlstate='XX001' or position('team_name_confirmation_mismatch' in sqlerrm)=0 then raise; end if;
 end;
 perform public.delete_team(t,'Renamed by coowner');
 assert not exists(select 1 from public.teams where id=t),'Explicit team deletion failed';
 assert exists(select 1 from public.teams where id=t2),'Other team was altered';
 raise notice 'PASS: approval, roles, RLS, capacity, departures, deletion and data retention';
end $$;
rollback;
