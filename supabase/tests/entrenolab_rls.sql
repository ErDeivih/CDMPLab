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
  select public.create_my_team('Equipo RLS', '#3056d3') into v_team_id;
  insert into public.players(team_id, name) values (v_team_id, 'Visible solo para el equipo');
  insert into public.exercise_folders(team_id, name) values (v_team_id, 'Raíz') returning id into owner_folder;

  select public.invite_team_member(v_team_id, 'rls-editor@test.local') into editor_invitation;
  select public.invite_team_member(v_team_id, 'rls-c2@test.local') into c2_invitation;
  perform public.invite_team_member(v_team_id, 'rls-c3@test.local');
  perform public.invite_team_member(v_team_id, 'rls-c4@test.local');
  begin
    perform public.invite_team_member(v_team_id, 'rls-c5@test.local');
    raise exception '__unexpected_success_fifth_invitation__';
  exception when others then
    if sqlerrm = '__unexpected_success_fifth_invitation__' then raise; end if;
    if position('collaborator_limit_exceeded' in sqlerrm) = 0 then
      raise exception 'FAIL fifth invitation: %', sqlerrm;
    end if;
  end;

  if (select count(*) from public.list_team_members(v_team_id)) <> 1 then
    raise exception 'FAIL owner member listing';
  end if;
  if public.is_platform_admin() then raise exception 'FAIL normal user is admin'; end if;

  perform set_config('request.jwt.claim.sub', editor_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  if (select count(*) from public.my_team_invitations()) <> 1 then
    raise exception 'FAIL invited user cannot list own invitation';
  end if;
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
  select public.create_my_team('Equipo ajeno', '#123456') into v_other_team_id;
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

  perform set_config('request.jwt.claim.sub', suspended_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', suspended_id, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.teams;
  if visible_count <> 0 then raise exception 'FAIL suspended user sees teams'; end if;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if not public.is_platform_admin() then raise exception 'FAIL admin not recognized'; end if;
  if (select count(*) from public.admin_list_profiles('rls-')) <> 10 then
    raise exception 'FAIL admin profile listing';
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
