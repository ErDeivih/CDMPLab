-- EntrenoLab — matriz RLS/RPC autocontenida contra el proyecto real.
-- Se ejecuta con rol administrativo y el ROLLBACK final no deja datos.
begin;

insert into auth.users
  (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
   role, raw_app_meta_data, raw_user_meta_data, aud)
values
  ('10000000-0000-4000-8000-000000000001', 'rls-owner@test.local',   crypt('Password123!', gen_salt('bf')), now(), now(), now(), 'authenticated', '{"provider":"email","providers":["email"]}', '{}', 'authenticated'),
  ('10000000-0000-4000-8000-000000000002', 'rls-editor@test.local',  crypt('Password123!', gen_salt('bf')), now(), now(), now(), 'authenticated', '{"provider":"email","providers":["email"]}', '{}', 'authenticated'),
  ('10000000-0000-4000-8000-000000000003', 'rls-other@test.local',   crypt('Password123!', gen_salt('bf')), now(), now(), now(), 'authenticated', '{"provider":"email","providers":["email"]}', '{}', 'authenticated'),
  ('10000000-0000-4000-8000-000000000004', 'rls-c2@test.local',      crypt('Password123!', gen_salt('bf')), now(), now(), now(), 'authenticated', '{"provider":"email","providers":["email"]}', '{}', 'authenticated'),
  ('10000000-0000-4000-8000-000000000005', 'rls-c3@test.local',      crypt('Password123!', gen_salt('bf')), now(), now(), now(), 'authenticated', '{"provider":"email","providers":["email"]}', '{}', 'authenticated'),
  ('10000000-0000-4000-8000-000000000006', 'rls-c4@test.local',      crypt('Password123!', gen_salt('bf')), now(), now(), now(), 'authenticated', '{"provider":"email","providers":["email"]}', '{}', 'authenticated'),
  ('10000000-0000-4000-8000-000000000007', 'rls-c5@test.local',      crypt('Password123!', gen_salt('bf')), now(), now(), now(), 'authenticated', '{"provider":"email","providers":["email"]}', '{}', 'authenticated'),
  ('10000000-0000-4000-8000-000000000008', 'rls-pending@test.local', crypt('Password123!', gen_salt('bf')), now(), now(), now(), 'authenticated', '{"provider":"email","providers":["email"]}', '{}', 'authenticated'),
  ('10000000-0000-4000-8000-000000000009', 'rls-susp@test.local',    crypt('Password123!', gen_salt('bf')), now(), now(), now(), 'authenticated', '{"provider":"email","providers":["email"]}', '{}', 'authenticated'),
  ('10000000-0000-4000-8000-000000000010', 'rls-admin@test.local',   crypt('Password123!', gen_salt('bf')), now(), now(), now(), 'authenticated', '{"provider":"email","providers":["email"]}', '{}', 'authenticated');

update public.profiles set status = 'approved', approved_at = now()
where user_id in (
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000010'
);
update public.profiles set status = 'suspended'
where user_id = '10000000-0000-4000-8000-000000000009';
insert into private.platform_admins(user_id)
values ('10000000-0000-4000-8000-000000000010');

set local role authenticated;

do $test$
declare
  owner_id constant uuid := '10000000-0000-4000-8000-000000000001';
  editor_id constant uuid := '10000000-0000-4000-8000-000000000002';
  other_id constant uuid := '10000000-0000-4000-8000-000000000003';
  pending_id constant uuid := '10000000-0000-4000-8000-000000000008';
  suspended_id constant uuid := '10000000-0000-4000-8000-000000000009';
  admin_id constant uuid := '10000000-0000-4000-8000-000000000010';
  v_team_id uuid;
  v_other_team_id uuid;
  -- Cierre del encargo (22/09/2026): solicitud de equipo y estado del correo.
  v_request_id uuid;
  v_request2_id uuid;
  v_request_other uuid;
  v_email jsonb;
  v_email_status text;
  v_provider_id text;
  v_err_len integer;
  v_attempt uuid;
  editor_invitation uuid;
  c2_invitation uuid;
  other_invitation uuid;
  owner_folder uuid;
  owner_exercise uuid;
  other_exercise uuid;
  saved_session jsonb;
  test_session constant uuid := '20000000-0000-4000-8000-000000000001';
  visible_count integer;
  -- Variables de la sección de importación atómica.
  v_canvas jsonb;
  v_payload jsonb;
  v_payload_broken jsonb;
  v_payload_conflict jsonb;
  v_payload_auth jsonb;
  v_counts jsonb;
  v_editor_inv uuid;
  v_editor_team uuid;
  v_import_editor constant uuid := '10000000-0000-4000-8000-000000000006';
begin
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  -- ============================================================
  -- CIERRE DEL ENCARGO (22/09/2026) — el EQUIPO ya no lo crea el usuario.
  --   · intente `create_my_team` → team_creation_requires_approval;
  --   · intente `insert into teams` → sin GRANT y sin política de INSERT;
  --   · solicite el equipo (idempotente: una sola pendiente);
  --   · no pueda aprobarla él mismo (solo un administrador decide).
  -- ============================================================
  begin
    perform public.create_my_team('Equipo RLS', '#3056d3');
    raise exception '__unexpected_success_create_my_team__';
  exception when others then
    if sqlerrm = '__unexpected_success_create_my_team__' then raise; end if;
    if position('team_creation_requires_approval' in sqlerrm) = 0 then
      raise exception 'FAIL create_my_team bypass error: %', sqlerrm;
    end if;
  end;

  begin
    insert into public.teams (owner_user_id, name, accent_color)
    values (owner_id, 'Equipo por INSERT', '#3056d3');
    raise exception '__unexpected_success_direct_team_insert__';
  exception when others then
    if sqlerrm = '__unexpected_success_direct_team_insert__' then raise; end if;
  end;

  if exists (select 1 from public.teams where owner_user_id = owner_id) then
    raise exception 'FAIL bypass created a team for a non-admin user';
  end if;

  select public.request_team_creation('Equipo RLS', '#3056d3') into v_request_id;
  -- Segunda solicitud = ACTUALIZA la pendiente (no crea otra).
  select public.request_team_creation('Equipo RLS (v2)', '#3056d3') into v_request2_id;
  if v_request_id <> v_request2_id then
    raise exception 'FAIL request idempotency: se crearon dos solicitudes pendientes';
  end if;
  if (select count(*) from public.team_requests where user_id = owner_id and status = 'pending') <> 1 then
    raise exception 'FAIL more than one pending request for the same user';
  end if;
  -- La tabla solo se LEE: un INSERT directo debe fallar (sin GRANT y sin política).
  begin
    insert into public.team_requests (user_id, name) values (owner_id, 'Por INSERT');
    raise exception '__unexpected_success_direct_request_insert__';
  exception when others then
    if sqlerrm = '__unexpected_success_direct_request_insert__' then raise; end if;
  end;
  -- Un usuario NO administrador no puede decidir su propia solicitud.
  begin
    perform public.admin_decide_team_request(v_request_id, true, null);
    raise exception '__unexpected_success_self_approval__';
  exception when others then
    if sqlerrm = '__unexpected_success_self_approval__' then raise; end if;
    if position('platform_admin_required' in sqlerrm) = 0 then
      raise exception 'FAIL self-approval error: %', sqlerrm;
    end if;
  end;
  if exists (select 1 from public.teams where owner_user_id = owner_id) then
    raise exception 'FAIL self-approval created a team';
  end if;
  -- El solicitante ve SU solicitud (y solo la suya).
  if (select count(*) from public.team_requests) <> 1 then
    raise exception 'FAIL requester cannot read own request (or reads others)';
  end if;

  -- El ADMINISTRADOR aprueba: el equipo se crea en la misma transacción.
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if public.admin_decide_team_request(v_request_id, true, null) is null then
    raise exception 'FAIL approval did not return a team';
  end if;
  -- El test anterior leía el equipo aún con el JWT del administrador y fallaba:
  -- la política SELECT de teams solo permite leer al propietario/miembro, aunque
  -- el administrador tenga permiso para aprobar la solicitud. Comprobamos la fila
  -- como su propietario y restauramos al administrador para la idempotencia.
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  select id into v_team_id from public.teams where owner_user_id = owner_id;
  if v_team_id is null then raise exception 'FAIL approval did not create the team'; end if;
  if (select name from public.teams where id = v_team_id) <> 'Equipo RLS (v2)' then
    raise exception 'FAIL approved team does not carry the last requested name';
  end if;
  if (select count(*) from public.team_requests where user_id = owner_id and status = 'approved') <> 1 then
    raise exception 'FAIL request was not marked approved';
  end if;
  -- IDEMPOTENCIA: repetir la aprobación devuelve el MISMO equipo y no crea otro.
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if public.admin_decide_team_request(v_request_id, true, null) <> v_team_id then
    raise exception 'FAIL approval idempotency: second approval returned another team';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  if (select count(*) from public.teams where owner_user_id = owner_id) <> 1 then
    raise exception 'FAIL approval created more than one team';
  end if;

  -- De vuelta al propietario para el resto de la matriz (invitaciones, sesiones…).
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  insert into public.players(team_id, name) values (v_team_id, 'Visible solo para el equipo');
  insert into public.exercise_folders(team_id, name) values (v_team_id, 'Raíz') returning id into owner_folder;

  select public.invite_team_member(v_team_id, 'rls-editor@test.local') into editor_invitation;
  select public.invite_team_member(v_team_id, 'rls-c2@test.local') into c2_invitation;
  perform public.invite_team_member(v_team_id, 'rls-c3@test.local');
  perform public.invite_team_member(v_team_id, 'rls-c4@test.local');
  -- El límite vigente es propietario + SEIS colaboradores. El test previo
  -- esperaba el rechazo del quinto (límite antiguo) y por eso fallaba aunque
  -- la aplicación aceptara correctamente seis plazas.
  perform public.invite_team_member(v_team_id, 'rls-extra-a@test.local');
  perform public.invite_team_member(v_team_id, 'rls-extra-b@test.local');
  begin
    perform public.invite_team_member(v_team_id, 'rls-c5@test.local');
    raise exception '__unexpected_success_seventh_invitation__';
  exception when others then
    if sqlerrm = '__unexpected_success_seventh_invitation__' then raise; end if;
    if position('collaborator_limit_exceeded' in sqlerrm) = 0 then
      raise exception 'FAIL seventh invitation: %', sqlerrm;
    end if;
  end;

  if (select count(*) from public.list_team_members(v_team_id)) <> 1 then
    raise exception 'FAIL owner member listing';
  end if;
  if public.is_platform_admin() then raise exception 'FAIL normal user is admin'; end if;

  -- ============================================================
  -- CORREO DE INVITACIÓN (22/09/2026) — estados distinguibles, cooldown y topes.
  --   El enlace NO concede acceso: la aceptación vuelve a comprobar el correo.
  -- ============================================================
  v_email := public.prepare_invitation_email(editor_invitation);
  if v_email->>'team_name' <> 'Equipo RLS (v2)' then
    raise exception 'FAIL prepare_invitation_email team_name: %', v_email;
  end if;
  if v_email->>'email' <> 'rls-editor@test.local' then
    raise exception 'FAIL prepare_invitation_email email: %', v_email;
  end if;
  if v_email->>'link_path' <> '/invitations?invitation=' || editor_invitation::text then
    raise exception 'FAIL prepare_invitation_email link_path: %', v_email;
  end if;
  -- El intento preparado viene identificado: es lo que vincula el resultado del proveedor.
  v_attempt := (v_email->>'attempt_id')::uuid;
  if v_attempt is null then
    raise exception 'FAIL prepare_invitation_email no devuelve attempt_id: %', v_email;
  end if;
  select email_status into v_email_status
  from public.team_invitations where id = editor_invitation;
  if v_email_status <> 'send_pending' then
    raise exception 'FAIL prepare did not mark send_pending: %', v_email_status;
  end if;
  begin
    perform public.prepare_invitation_email(editor_invitation);
    raise exception '__unexpected_success_email_cooldown__';
  exception when others then
    if sqlerrm = '__unexpected_success_email_cooldown__' then raise; end if;
    if position('email_cooldown' in sqlerrm) = 0 then
      raise exception 'FAIL email cooldown error: %', sqlerrm;
    end if;
  end;

  -- ------------------------------------------------------------------
  -- REGISTRO DEL RESULTADO (revisión del dueño, 22/09/2026):
  --   · el PROPIETARIO autenticado NO puede ejecutarlo (EXECUTE revocado): no puede
  --     falsificar `provider_accepted` ni el identificador del proveedor;
  --   · solo la credencial de servicio (`service_role`) lo registra;
  --   · un resultado del intento ANTERIOR no cambia el estado del intento vigente.
  -- ------------------------------------------------------------------
  begin
    perform public.record_invitation_email_result(editor_invitation, v_attempt, 'provider_accepted', 'falsificado-999', null);
    raise exception '__unexpected_success_owner_record__';
  exception when others then
    if sqlerrm = '__unexpected_success_owner_record__' then raise; end if;
    if position('permission denied' in sqlerrm) = 0 then
      raise exception 'FAIL el propietario pudo registrar el resultado: %', sqlerrm;
    end if;
  end;
  select email_status, provider_message_id into v_email_status, v_provider_id
  from public.team_invitations where id = editor_invitation;
  if v_email_status <> 'send_pending' or v_provider_id is not null then
    raise exception 'FAIL el intento de falsificación cambió el estado: % / %', v_email_status, v_provider_id;
  end if;

  -- Con la credencial de servicio SÍ se registra (es lo que hace la Edge Function).
  perform set_config('role', 'service_role', true);
  perform public.record_invitation_email_result(editor_invitation, v_attempt, 'provider_accepted', 'prov-123', null);
  perform set_config('role', 'authenticated', true);
  select email_status, provider_message_id into v_email_status, v_provider_id
  from public.team_invitations where id = editor_invitation;
  if v_email_status <> 'provider_accepted' or v_provider_id <> 'prov-123' then
    raise exception 'FAIL provider_accepted not recorded: % / %', v_email_status, v_provider_id;
  end if;

  -- Un intento ANTIGUO: se rechaza y NO toca el estado vigente. Para provocarlo se abre un
  -- intento nuevo (el envío anterior fue correcto, así que primero se marca como fallido, que
  -- es lo que permite reintentar de inmediato).
  perform set_config('role', 'service_role', true);
  perform public.record_invitation_email_result(editor_invitation, v_attempt, 'send_error', null, repeat('x', 400));
  perform set_config('role', 'authenticated', true);
  select email_status, length(last_email_error) into v_email_status, v_err_len
  from public.team_invitations where id = editor_invitation;
  if v_email_status <> 'send_error' or v_err_len <> 300 then
    raise exception 'FAIL send_error not recorded or not truncated: % / %', v_email_status, v_err_len;
  end if;

  v_email := public.prepare_invitation_email(editor_invitation);
  if (v_email->>'attempt_id')::uuid = v_attempt then
    raise exception 'FAIL el reintento reutiliza el identificador del intento anterior';
  end if;
  begin
    perform set_config('role', 'service_role', true);
    perform public.record_invitation_email_result(editor_invitation, v_attempt, 'provider_accepted', 'prov-tardio', null);
    perform set_config('role', 'authenticated', true);
    raise exception '__unexpected_success_stale_attempt__';
  exception when others then
    if sqlerrm = '__unexpected_success_stale_attempt__' then raise; end if;
    perform set_config('role', 'authenticated', true);
    if position('stale_email_attempt' in sqlerrm) = 0 then
      raise exception 'FAIL resultado tardío: %', sqlerrm;
    end if;
  end;
  select email_status, provider_message_id into v_email_status, v_provider_id
  from public.team_invitations where id = editor_invitation;
  if v_email_status <> 'send_pending' or v_provider_id is not null then
    raise exception 'FAIL el resultado tardío pisó el intento nuevo: % / %', v_email_status, v_provider_id;
  end if;

  -- Un estado inventado no se admite.
  begin
    perform set_config('role', 'service_role', true);
    perform public.record_invitation_email_result(editor_invitation, (v_email->>'attempt_id')::uuid, 'delivered', null, null);
    perform set_config('role', 'authenticated', true);
    raise exception '__unexpected_success_invalid_email_status__';
  exception when others then
    if sqlerrm = '__unexpected_success_invalid_email_status__' then raise; end if;
    perform set_config('role', 'authenticated', true);
    if position('invalid_email_status' in sqlerrm) = 0 then
      raise exception 'FAIL invalid email status error: %', sqlerrm;
    end if;
  end;

  perform set_config('request.jwt.claim.sub', editor_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  if (select count(*) from public.my_team_invitations()) <> 1 then
    raise exception 'FAIL invited user cannot list own invitation';
  end if;
  -- El INVITADO (que no es propietario) no puede pedir el envío ni escribir el resultado.
  begin
    perform public.prepare_invitation_email(editor_invitation);
    raise exception '__unexpected_success_foreign_prepare__';
  exception when others then
    if sqlerrm = '__unexpected_success_foreign_prepare__' then raise; end if;
    if position('forbidden' in sqlerrm) = 0 then
      raise exception 'FAIL foreign prepare error: %', sqlerrm;
    end if;
  end;
  -- Al invitado (ni a ningún cliente) le llega «permission denied»: la RPC no es suya.
  begin
    perform public.record_invitation_email_result(editor_invitation, gen_random_uuid(), 'provider_accepted', null, null);
    raise exception '__unexpected_success_foreign_record__';
  exception when others then
    if sqlerrm = '__unexpected_success_foreign_record__' then raise; end if;
    if position('permission denied' in sqlerrm) = 0 then
      raise exception 'FAIL foreign record error: %', sqlerrm;
    end if;
  end;
  perform public.accept_team_invitation(editor_invitation);
  insert into public.exercises(team_id, folder_id, title)
  values (v_team_id, owner_folder, 'Ejercicio del editor')
  returning id into owner_exercise;

  select public.save_session_with_tasks(
    jsonb_build_object(
      'id', test_session,
      'team_id', v_team_id,
      'title', 'Sesión inicial',
      'date', '2026-08-28',
      'duration_minutes', 60,
      'notes', 'prueba real'
    ),
    null,
    jsonb_build_array(jsonb_build_object(
      'id', '30000000-0000-4000-8000-000000000001',
      'exercise_id', owner_exercise,
      'title', 'Tarea inicial',
      'duration_minutes', 15,
      'material', 'balones',
      'sort_order', 0
    ))
  ) into saved_session;
  if (saved_session->>'revision')::integer <> 1 then
    raise exception 'FAIL atomic session insert revision';
  end if;

  select public.save_session_with_tasks(
    jsonb_build_object(
      'id', test_session,
      'team_id', v_team_id,
      'title', 'Sesión actualizada',
      'date', '2026-08-29',
      'duration_minutes', 70,
      'notes', 'segunda versión'
    ),
    1,
    jsonb_build_array(jsonb_build_object(
      'id', '30000000-0000-4000-8000-000000000002',
      'exercise_id', owner_exercise,
      'title', 'Tarea actualizada',
      'duration_minutes', 20,
      'material', 'conos',
      'sort_order', 0
    ))
  ) into saved_session;
  if (saved_session->>'revision')::integer <> 2 then
    raise exception 'FAIL atomic session update revision';
  end if;
  if (select count(*) from public.session_exercises where session_id = test_session) <> 1 then
    raise exception 'FAIL atomic task replacement';
  end if;

  begin
    perform public.save_session_with_tasks(
      jsonb_build_object('id', test_session, 'team_id', v_team_id, 'title', 'No debe guardarse'),
      1,
      '[]'::jsonb
    );
    raise exception '__unexpected_success_stale_session__';
  exception when others then
    if sqlerrm = '__unexpected_success_stale_session__' then raise; end if;
    if position('revision_conflict' in sqlerrm) = 0 then
      raise exception 'FAIL unexpected stale-session error: %', sqlerrm;
    end if;
  end;
  if (select title from public.sessions where id = test_session) <> 'Sesión actualizada' then
    raise exception 'FAIL stale write mutated session';
  end if;
  begin
    perform 1 from public.list_team_members(v_team_id);
    raise exception '__unexpected_success_editor_member_list__';
  exception when others then
    if sqlerrm = '__unexpected_success_editor_member_list__' then raise; end if;
    if position('forbidden' in sqlerrm) = 0 then
      raise exception 'FAIL unexpected list-members error: %', sqlerrm;
    end if;
  end;
  begin
    insert into public.team_members(team_id, user_id, role, status)
    values (v_team_id, other_id, 'editor', 'active');
    raise exception '__unexpected_success_direct_member_insert__';
  exception when others then
    if sqlerrm = '__unexpected_success_direct_member_insert__' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.players p where p.team_id = v_team_id;
  if visible_count <> 0 then raise exception 'FAIL outsider sees players'; end if;

  -- Otra cuenta solicita su equipo: primero RECHAZO (no crea nada, deja motivo) y
  -- después una solicitud NUEVA aprobada (el rechazo no bloquea definitivamente).
  select public.request_team_creation('Equipo ajeno', '#123456') into v_request_other;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if public.admin_decide_team_request(v_request_other, false, 'Falta documentación del club.') is not null then
    raise exception 'FAIL rejection returned a team';
  end if;
  if exists (select 1 from public.teams where owner_user_id = other_id) then
    raise exception 'FAIL rejection created a team';
  end if;
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  if (select note from public.team_requests where id = v_request_other) <> 'Falta documentación del club.' then
    raise exception 'FAIL the requester cannot read the rejection reason';
  end if;
  select public.request_team_creation('Equipo ajeno', '#123456') into v_request_other;
  if (select count(*) from public.team_requests where user_id = other_id and status = 'pending') <> 1 then
    raise exception 'FAIL re-request after rejection';
  end if;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select public.admin_decide_team_request(v_request_other, true, null) into v_other_team_id;
  if v_other_team_id is null then raise exception 'FAIL approval of the second requester'; end if;
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);

  insert into public.exercises(team_id, title)
  values (v_other_team_id, 'Ejercicio ajeno') returning id into other_exercise;
  select public.invite_team_member(v_other_team_id, 'rls-c5@test.local') into other_invitation;
  begin
    insert into public.exercise_folders(team_id, parent_id, name)
    values (v_other_team_id, owner_folder, 'Referencia cruzada');
    raise exception '__unexpected_success_cross_team_fk__';
  exception when others then
    if sqlerrm = '__unexpected_success_cross_team_fk__' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', editor_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  begin
    perform public.save_session_with_tasks(
      jsonb_build_object('id', test_session, 'team_id', v_team_id, 'title', 'Referencia cruzada'),
      2,
      jsonb_build_array(jsonb_build_object(
        'id', '30000000-0000-4000-8000-000000000003',
        'exercise_id', other_exercise,
        'title', 'No válida',
        'sort_order', 0
      ))
    );
    raise exception '__unexpected_success_cross_team_session__';
  exception when others then
    if sqlerrm = '__unexpected_success_cross_team_session__' then raise; end if;
    if position('same_team_exercise_required' in sqlerrm) = 0 then
      raise exception 'FAIL unexpected cross-team-session error: %', sqlerrm;
    end if;
  end;
  if (select title from public.sessions where id = test_session) <> 'Sesión actualizada'
     or (select count(*) from public.session_exercises where session_id = test_session) <> 1 then
    raise exception 'FAIL rejected session write was not atomic';
  end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  begin
    perform public.cancel_team_invitation(other_invitation);
    raise exception '__unexpected_success_foreign_cancel__';
  exception when others then
    if sqlerrm = '__unexpected_success_foreign_cancel__' then raise; end if;
    if position('forbidden' in sqlerrm) = 0 then
      raise exception 'FAIL unexpected foreign-cancel error: %', sqlerrm;
    end if;
  end;
  perform public.cancel_team_invitation(c2_invitation);
  perform public.revoke_team_member(v_team_id, editor_id);

  perform set_config('request.jwt.claim.sub', editor_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.players p where p.team_id = v_team_id;
  if visible_count <> 0 then raise exception 'FAIL revoked editor still sees data'; end if;
  begin
    perform public.save_session_with_tasks(
      jsonb_build_object('id', test_session, 'team_id', v_team_id, 'title', 'Revocado'),
      2,
      '[]'::jsonb
    );
    raise exception '__unexpected_success_revoked_session__';
  exception when others then
    if sqlerrm = '__unexpected_success_revoked_session__' then raise; end if;
    if position('forbidden' in sqlerrm) = 0 then
      raise exception 'FAIL unexpected revoked-session error: %', sqlerrm;
    end if;
  end;

  perform set_config('request.jwt.claim.sub', pending_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pending_id, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.teams;
  if visible_count <> 0 then raise exception 'FAIL pending user sees teams'; end if;
  -- Un perfil SIN aprobar tampoco puede solicitar equipo.
  begin
    perform public.request_team_creation('Equipo pendiente', '#3056d3');
    raise exception '__unexpected_success_pending_request__';
  exception when others then
    if sqlerrm = '__unexpected_success_pending_request__' then raise; end if;
    if position('profile_not_approved' in sqlerrm) = 0 then
      raise exception 'FAIL pending request error: %', sqlerrm;
    end if;
  end;

  perform set_config('request.jwt.claim.sub', suspended_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', suspended_id, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.teams;
  if visible_count <> 0 then raise exception 'FAIL suspended user sees teams'; end if;
  begin
    perform public.request_team_creation('Equipo suspendido', '#3056d3');
    raise exception '__unexpected_success_suspended_request__';
  exception when others then
    if sqlerrm = '__unexpected_success_suspended_request__' then raise; end if;
    if position('profile_not_approved' in sqlerrm) = 0 then
      raise exception 'FAIL suspended request error: %', sqlerrm;
    end if;
  end;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if not public.is_platform_admin() then raise exception 'FAIL admin not recognized'; end if;
  if (select count(*) from public.admin_list_profiles('rls-')) <> 10 then
    raise exception 'FAIL admin profile listing';
  end if;

  -- ---- Cola de solicitudes de equipo (solo el administrador) --------------
  -- Tramitadas hasta ahora: owner (aprobada) + other (rechazada y luego aprobada) = 3 filas.
  if (select count(*) from public.admin_list_team_requests('')) <> 3 then
    raise exception 'FAIL admin request queue size';
  end if;
  if not exists (
    select 1 from public.admin_list_team_requests('Equipo RLS (v2)') r
    where r.status = 'approved' and r.display_name is not null
  ) then
    raise exception 'FAIL admin request queue does not identify the requester';
  end if;

  -- ---- Una solicitud cuyo solicitante dejó de estar aprobado NO se aprueba ----
  -- rls-c5 (…007) está aprobado, sin equipo y sin invitación pendiente: solicita.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '10000000-0000-4000-8000-000000000007', 'role', 'authenticated')::text, true);
  select public.request_team_creation('Equipo c5', '#1f7a4d') into v_request_other;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform public.admin_set_profile_status('10000000-0000-4000-8000-000000000007', 'suspended');
  begin
    perform public.admin_decide_team_request(v_request_other, true, null);
    raise exception '__unexpected_success_approve_suspended__';
  exception when others then
    if sqlerrm = '__unexpected_success_approve_suspended__' then raise; end if;
    if position('requester_not_approved' in sqlerrm) = 0 then
      raise exception 'FAIL approval of a non-approved requester: %', sqlerrm;
    end if;
  end;
  if exists (select 1 from public.teams where owner_user_id = '10000000-0000-4000-8000-000000000007') then
    raise exception 'FAIL a suspended requester got a team';
  end if;
  -- Se reactiva la cuenta y entonces SÍ se aprueba (la solicitud sigue pendiente).
  perform public.admin_set_profile_status('10000000-0000-4000-8000-000000000007', 'approved');
  if public.admin_decide_team_request(v_request_other, true, null) is null then
    raise exception 'FAIL approval after reactivation';
  end if;
  if (select count(*) from public.admin_list_team_requests('Equipo c5')) <> 1 then
    raise exception 'FAIL admin request queue after reactivation';
  end if;

  -- ============================================================
  -- IMPORTACIÓN ATÓMICA (public.import_team_dataset)
  --   · gráfo completo + canvas + tarea → se crea y enlaza
  --   · reimportación idéntica = idempotente (skipped)
  --   · referencia rota, colisión cross-team → nada se escribe
  --   · autorización: ajeno/pending/suspended/revocado → forbidden;
  --     owner y editor activo → permitidos
  --   Verificado contra el proyecto real vgwfjkhvzprsoixpzruq el 2026-08-28.
  --   El bloque termina en ROLLBACK y no deja usuarios ni datos residuales.
  -- ============================================================
  v_canvas := '{"version":2,"field":"full","frames":[{"duration":0,"elements":[{"id":"e1","t":"cone","x":0.5,"y":0.5}]}]}'::jsonb;

  -- ---- 1. Importación completa (owner) ----------------------------------
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

    v_payload := jsonb_build_object(
      'folders', jsonb_build_array(
        jsonb_build_object('id', '40000000-0000-4000-8000-000000000001', 'team_id', v_team_id, 'parent_id', null, 'name', 'Raíz importada'),
        jsonb_build_object('id', '40000000-0000-4000-8000-000000000002', 'team_id', v_team_id, 'parent_id', '40000000-0000-4000-8000-000000000001', 'name', 'Hijo importado')
      ),
      'players', jsonb_build_array(
        jsonb_build_object('id', '60000000-0000-4000-8000-000000000001', 'team_id', v_team_id, 'name', 'Jugador importado', 'number', 2, 'position', 'DF', 'color', '#1a73e8', 'active', true)
      ),
      'exercises', jsonb_build_array(
        jsonb_build_object(
          'id', '50000000-0000-4000-8000-000000000001', 'team_id', v_team_id, 'folder_id', '40000000-0000-4000-8000-000000000002',
          'title', 'Ejercicio importado', 'description', 'desc', 'explanation', 'expl', 'category', 'Técnica',
          'objectives', jsonb_build_array('objetivo'), 'materials', jsonb_build_array('conos'),
          'duration_minutes', 15, 'min_players', null, 'max_players', null, 'load_mode', 'fixed',
          'series_count', null, 'repetitions_count', null, 'work_seconds', null, 'rest_seconds', null,
          'is_template', false, 'canvas_data', v_canvas, 'thumbnail', null
        )
      ),
      'sessions', jsonb_build_array(
        jsonb_build_object(
          'id', '70000000-0000-4000-8000-000000000001', 'team_id', v_team_id, 'title', 'Sesión importada',
          'date', '2026-08-30', 'duration_minutes', 60, 'notes', 'nota',
          'tasks', jsonb_build_array(
            jsonb_build_object(
              'id', '80000000-0000-4000-8000-000000000001', 'exercise_id', '50000000-0000-4000-8000-000000000001',
              'title', 'Tarea importada', 'duration_minutes', 15, 'material', 'balones', 'sort_order', 0
            )
          )
        )
      )
    );

    v_counts := public.import_team_dataset(v_team_id, v_payload);
    if (v_counts->'created'->>'folders')::integer <> 2
       or (v_counts->'created'->>'players')::integer <> 1
       or (v_counts->'created'->>'exercises')::integer <> 1
       or (v_counts->'created'->>'sessions')::integer <> 1
       or (v_counts->'skipped'->>'folders')::integer <> 0
       or (v_counts->'skipped'->>'players')::integer <> 0
       or (v_counts->'skipped'->>'exercises')::integer <> 0
       or (v_counts->'skipped'->>'sessions')::integer <> 0 then
      raise exception 'FAIL import created/skipped counts: %', v_counts;
    end if;

    -- Grafo/tree: hijo → padre; ejercicio → carpeta hija; canvas conservado;
    -- la tarea usa su id determinista y enlaza el ejercicio importado.
    if (select parent_id from public.exercise_folders where id = '40000000-0000-4000-8000-000000000002') <> '40000000-0000-4000-8000-000000000001'::uuid then
      raise exception 'FAIL import folder parent linkage';
    end if;
    if (select folder_id from public.exercises where id = '50000000-0000-4000-8000-000000000001') <> '40000000-0000-4000-8000-000000000002'::uuid then
      raise exception 'FAIL import exercise folder linkage';
    end if;
    if (select canvas_data from public.exercises where id = '50000000-0000-4000-8000-000000000001') <> v_canvas then
      raise exception 'FAIL import canvas preservation';
    end if;
    if (select id from public.session_exercises where session_id = '70000000-0000-4000-8000-000000000001' and sort_order = 0) <> '80000000-0000-4000-8000-000000000001'::uuid
       or (select exercise_id from public.session_exercises where session_id = '70000000-0000-4000-8000-000000000001' and sort_order = 0) <> '50000000-0000-4000-8000-000000000001'::uuid then
      raise exception 'FAIL import session task linkage';
    end if;

    -- ---- 2. Reimportación idéntica → idempotente --------------------------
    v_counts := public.import_team_dataset(v_team_id, v_payload);
    if (v_counts->'created'->>'folders')::integer <> 0
       or (v_counts->'created'->>'players')::integer <> 0
       or (v_counts->'created'->>'exercises')::integer <> 0
       or (v_counts->'created'->>'sessions')::integer <> 0
       or (v_counts->'skipped'->>'folders')::integer <> 2
       or (v_counts->'skipped'->>'players')::integer <> 1
       or (v_counts->'skipped'->>'exercises')::integer <> 1
       or (v_counts->'skipped'->>'sessions')::integer <> 1 then
      raise exception 'FAIL import idempotency: %', v_counts;
    end if;
    if (select count(*) from public.exercise_folders where id in ('40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002')) <> 2
       or (select count(*) from public.players where id = '60000000-0000-4000-8000-000000000001') <> 1
       or (select count(*) from public.exercises where id = '50000000-0000-4000-8000-000000000001') <> 1
       or (select count(*) from public.sessions where id = '70000000-0000-4000-8000-000000000001') <> 1
       or (select count(*) from public.session_exercises where session_id = '70000000-0000-4000-8000-000000000001') <> 1 then
      raise exception 'FAIL import idempotency duplicates';
    end if;

    -- ---- 3. Referencia rota → broken_folder_reference y cero escrituras ----
    v_payload_broken := jsonb_build_object(
      'folders', jsonb_build_array(
        jsonb_build_object('id', '90000000-0000-4000-8000-000000000001', 'team_id', v_team_id, 'parent_id', '90000000-0000-4000-8000-000000000099', 'name', 'Broken'),
        jsonb_build_object('id', '90000000-0000-4000-8000-000000000002', 'team_id', v_team_id, 'parent_id', null, 'name', 'Válida')
      ),
      'players', jsonb_build_array(),
      'exercises', jsonb_build_array(),
      'sessions', jsonb_build_array()
    );
    begin
      perform public.import_team_dataset(v_team_id, v_payload_broken);
      raise exception '__unexpected_success_broken_import__';
    exception when others then
      if sqlerrm = '__unexpected_success_broken_import__' then raise; end if;
      if position('broken_folder_reference' in sqlerrm) = 0 then
        raise exception 'FAIL broken import error: %', sqlerrm;
      end if;
    end;
    if (select count(*) from public.exercise_folders where id in ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002')) <> 0 then
      raise exception 'FAIL broken import wrote data';
    end if;

    -- ---- 4. Colisión de id con OTRO equipo → cross_team_id_conflict -------
    v_payload_conflict := jsonb_build_object(
      'folders', jsonb_build_array(),
      'players', jsonb_build_array(),
      'exercises', jsonb_build_array(
        jsonb_build_object(
          'id', other_exercise, 'team_id', v_team_id, 'title', 'Colisión', 'description', '',
          'explanation', '', 'category', 'Técnica', 'objectives', jsonb_build_array(),
          'materials', jsonb_build_array(), 'load_mode', 'fixed', 'is_template', false
        )
      ),
      'sessions', jsonb_build_array()
    );
    begin
      perform public.import_team_dataset(v_team_id, v_payload_conflict);
      raise exception '__unexpected_success_cross_team_import__';
    exception when others then
      if sqlerrm = '__unexpected_success_cross_team_import__' then raise; end if;
      if position('cross_team_id_conflict' in sqlerrm) = 0 then
        raise exception 'FAIL cross-team import error: %', sqlerrm;
      end if;
    end;
    if exists (select 1 from public.exercises where id = other_exercise and team_id = v_team_id) then
      raise exception 'FAIL cross-team import wrote data';
    end if;

    -- ---- 5. Autorización explícita (rechazo, nada escrito) ----------------
    v_payload_auth := jsonb_build_object(
      'folders', jsonb_build_array(
        jsonb_build_object('id', '0a000000-0000-4000-8000-000000000001', 'team_id', v_team_id, 'parent_id', null, 'name', 'Auth')
      ),
      'players', jsonb_build_array(),
      'exercises', jsonb_build_array(),
      'sessions', jsonb_build_array()
    );

    -- 5a. Usuario AJENO (owner de otro equipo).
    perform set_config('request.jwt.claim.sub', other_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
    begin
      perform public.import_team_dataset(v_team_id, v_payload_auth);
      raise exception '__unexpected_success_foreign_import__';
    exception when others then
      if sqlerrm = '__unexpected_success_foreign_import__' then raise; end if;
      if position('forbidden' in sqlerrm) = 0 then
        raise exception 'FAIL foreign import error: %', sqlerrm;
      end if;
    end;
    if exists (select 1 from public.exercise_folders where id = '0a000000-0000-4000-8000-000000000001') then
      raise exception 'FAIL foreign import wrote data';
    end if;

    -- 5b. Usuario PENDING (perfil sin aprobar).
    perform set_config('request.jwt.claim.sub', pending_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', pending_id, 'role', 'authenticated')::text, true);
    begin
      perform public.import_team_dataset(v_team_id, v_payload_auth);
      raise exception '__unexpected_success_pending_import__';
    exception when others then
      if sqlerrm = '__unexpected_success_pending_import__' then raise; end if;
      if position('forbidden' in sqlerrm) = 0 then
        raise exception 'FAIL pending import error: %', sqlerrm;
      end if;
    end;
    if exists (select 1 from public.exercise_folders where id = '0a000000-0000-4000-8000-000000000001') then
      raise exception 'FAIL pending import wrote data';
    end if;

    -- 5c. Usuario SUSPENDED.
    perform set_config('request.jwt.claim.sub', suspended_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', suspended_id, 'role', 'authenticated')::text, true);
    begin
      perform public.import_team_dataset(v_team_id, v_payload_auth);
      raise exception '__unexpected_success_suspended_import__';
    exception when others then
      if sqlerrm = '__unexpected_success_suspended_import__' then raise; end if;
      if position('forbidden' in sqlerrm) = 0 then
        raise exception 'FAIL suspended import error: %', sqlerrm;
      end if;
    end;
    if exists (select 1 from public.exercise_folders where id = '0a000000-0000-4000-8000-000000000001') then
      raise exception 'FAIL suspended import wrote data';
    end if;

    -- 5d. Editor REVOCADO.
    perform set_config('request.jwt.claim.sub', editor_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
    begin
      perform public.import_team_dataset(v_team_id, v_payload_auth);
      raise exception '__unexpected_success_revoked_import__';
    exception when others then
      if sqlerrm = '__unexpected_success_revoked_import__' then raise; end if;
      if position('forbidden' in sqlerrm) = 0 then
        raise exception 'FAIL revoked editor import error: %', sqlerrm;
      end if;
    end;
    if exists (select 1 from public.exercise_folders where id = '0a000000-0000-4000-8000-000000000001') then
      raise exception 'FAIL revoked editor import wrote data';
    end if;

    -- ---- 6. Editor ACTIVO permitido (puede crear) -------------------------
    -- c4 (v_import_editor) acepta su invitación pendiente a v_team_id.
    perform set_config('request.jwt.claim.sub', v_import_editor::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_import_editor, 'role', 'authenticated')::text, true);
    select id into v_editor_inv
    from public.my_team_invitations()
    where team_id = v_team_id
    limit 1;
    if v_editor_inv is null then
      raise exception 'FAIL active editor: no pending invitation';
    end if;
    select public.accept_team_invitation(v_editor_inv) into v_editor_team;
    if v_editor_team <> v_team_id then
      raise exception 'FAIL active editor: accepted wrong team';
    end if;

    v_counts := public.import_team_dataset(v_team_id, v_payload_auth);
    if (v_counts->'created'->>'folders')::integer <> 1
       or (v_counts->'skipped'->>'folders')::integer <> 0 then
      raise exception 'FAIL active editor import: %', v_counts;
    end if;
    if not exists (select 1 from public.exercise_folders where id = '0a000000-0000-4000-8000-000000000001' and team_id = v_team_id) then
      raise exception 'FAIL active editor did not create folder';
    end if;

  raise notice 'all_remote_rls_rpc_tests_passed';
end
$test$;

reset role;
rollback;
