-- =============================================================
-- EntrenoLab — Migración 00002 (post-20260829000001): IMPORTACIÓN ATÓMICA
-- local → Supabase.
--
-- Proyecto: vgwfjkhvzprsoixpzruq (PostgreSQL 17).
--
-- MOTIVO: el cliente importaba los datos locales a Supabase con MUCHAS llamadas
-- `from().insert()` separadas (una por entidad) y un try/catch por entidad que
-- contaba errores. Eso no era atómico: si una sesión fallaba tras insertar las
-- carpetas/ejercicios, el lote quedaba a medias y además no se podía garantizar
-- la integridad del grafo (referencias rotas, ciclos, ids de otro equipo).
--
-- SOLUCIÓN: una única RPC transaccional `public.import_team_dataset(uuid, jsonb)`
-- que valida TODO el grafo ANTES de escribir nada y, si hay cualquier problema,
-- revierte el lote completo. El cliente prepara ids deterministas y referencias
-- ya traducidas; la RPC los confía pero los VALIDA.
--
-- GARANTÍAS:
--   · Una sola transacción (función PL/pgSQL): cualquier `raise exception`
--     revierte TODO.
--   · SECURITY INVOKER + `set search_path=''`. Sin `service_role`, sin
--     `SECURITY DEFINER` en la RPC.
--   · Autorización real vía `private.is_team_member(p_team_id)` (owner o editor
--     activo y aprobado). Rechazo con errcode '42501'.
--   · Valida que todos los `id`/`parent_id`/`folder_id`/`exercise_id`/
--     `session_id`/task `id`/`exercise_id` sean UUIDs válidos (`invalid_uuid`).
--   · Valida el grafo completo antes de insertar: referencias de carpetas
--     (parents), ciclos (`folder_cycle`), `folder_id` de ejercicios
--     (`broken_folder_reference`), `exercise_id` de tareas
--     (`broken_exercise_reference`), `team_id` de cada entidad
--     (`wrong_team_reference`), y colisiones de PK con OTRO equipo
--     (`cross_team_id_conflict`).
--   · Idempotente: si una entidad ya existe con el mismo id y el MISMO equipo,
--     se salta (contada en `skipped`) cuando su contenido coincide; si el
--     contenido es INCOMPATIBLE se lanza `id_content_conflict`.
--   · Carpetas importadas en orden topológico (padres antes que hijos),
--     preservando su jerarquía, con las referencias ya traducidas por el cliente.
--   · EXECUTE solo a `authenticated`, revocado de `public`/`anon`.
--
-- VERIFICACIÓN CONTRA LA BASE (2026-08-28): el catálogo del proyecto
-- vgwfjkhvzprsoixpzruq confirmó que estas tres funciones no existían. La
-- matriz real detectó además que RLS oculta las PK de equipos ajenos; por eso
-- el manejador final traduce unique_violation a cross_team_id_conflict sin
-- revelar a qué equipo pertenece la fila y conservando la atomicidad.
-- =============================================================

-- ---------- HELPERS PRIVADOS (SECURITY INVOKER, sin datos privilegiados) ----------

-- ¿Es una cadena un UUID canónico 8-4-4-4-12 (válido para PostgreSQL)?
create or replace function private.is_valid_uuid(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null
     and p_value ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
$$;

-- Convierte un jsonb a text[] de forma segura (vacío si no es array).
create or replace function private.jsonb_text_array(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'array' then '{}'::text[]
    else (select coalesce(array_agg(x), '{}'::text[])
          from jsonb_array_elements_text(p_value) as t(x))
  end;
$$;

revoke execute on function private.is_valid_uuid(text) from public, anon;
revoke execute on function private.jsonb_text_array(jsonb) from public, anon;
grant execute on function private.is_valid_uuid(text) to authenticated;
grant execute on function private.jsonb_text_array(jsonb) to authenticated;

-- =============================================================
-- RPC: importación atómica del dataset local a UN equipo.
-- =============================================================
create or replace function public.import_team_dataset(p_team_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Contadores created / skipped
  v_cf int := 0; v_cp int := 0; v_ce int := 0; v_cs int := 0;
  v_sf int := 0; v_sp int := 0; v_se int := 0; v_ss int := 0;

  -- Arrays del payload
  v_folders jsonb; v_players jsonb; v_exercises jsonb; v_sessions jsonb;

  -- Conjuntos de ids del payload (para resolver referencias)
  v_payload_folder_ids uuid[];
  v_payload_exercise_ids uuid[];

  -- Iteradores / temporales
  v_item jsonb; v_entity jsonb;
  v_id uuid; v_id_text text; v_team_text text; v_team_id uuid;
  v_parent_id uuid; v_parent_text text;
  v_folder_id uuid; v_folder_text text;
  v_exercise_id uuid; v_exercise_text text;
  v_name text; v_title text; v_date date; v_duration smallint; v_notes text;

  -- Topo de carpetas
  v_pending_folders jsonb; v_placed uuid[]; v_advanced boolean;

  -- Filas existentes (para comparar contenido)
  v_frow public.exercise_folders%rowtype;
  v_prow public.players%rowtype;
  v_erow public.exercises%rowtype;
  v_srow public.sessions%rowtype;
  v_incoming_sig jsonb; v_stored_sig jsonb;

  -- Campos de jugador
  v_number smallint; v_position text; v_color text; v_active boolean;

  -- Campos de ejercicio
  v_description text; v_explanation text; v_category text;
  v_objectives text[]; v_materials text[]; v_min_players smallint; v_max_players smallint;
  v_load_mode text; v_series_count smallint; v_repetitions_count smallint;
  v_work_seconds smallint; v_rest_seconds smallint; v_is_template boolean;
  v_canvas_data jsonb; v_thumbnail text;

  -- Sesión / tareas
  v_session jsonb; v_tasks jsonb; v_task jsonb;
  v_task_id uuid; v_task_ex_id uuid; v_task_ex_text text;
  v_payload_tasks_sig jsonb; v_stored_tasks_sig jsonb;
begin
  -- 0. Diagrama y seguridad ------------------------------------------------
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid_import_payload';
  end if;
  if not private.is_team_member(p_team_id) then
    raise exception 'forbidden: not a member of the team' using errcode = '42501';
  end if;

  v_folders  := coalesce(p_payload->'folders', '[]'::jsonb);
  v_players  := coalesce(p_payload->'players', '[]'::jsonb);
  v_exercises:= coalesce(p_payload->'exercises', '[]'::jsonb);
  v_sessions := coalesce(p_payload->'sessions', '[]'::jsonb);

  if jsonb_typeof(v_folders) is distinct from 'array'
     or jsonb_typeof(v_players) is distinct from 'array'
     or jsonb_typeof(v_exercises) is distinct from 'array'
     or jsonb_typeof(v_sessions) is distinct from 'array' then
    raise exception 'invalid_import_payload';
  end if;

  -- 1. Validación de UUIDs y team_id + colección de ids del payload ----------
  -- 1a. Carpetas
  for v_item in select value from jsonb_array_elements(v_folders) loop
    v_id_text := v_item->>'id';
    if v_id_text is null or not private.is_valid_uuid(v_id_text) then
      raise exception 'invalid_uuid';
    end if;
    v_team_text := v_item->>'team_id';
    if v_team_text is null or not private.is_valid_uuid(v_team_text) then
      raise exception 'invalid_uuid';
    end if;
    if v_team_text::uuid <> p_team_id then
      raise exception 'wrong_team_reference';
    end if;
    if v_item ? 'parent_id' and v_item->>'parent_id' <> '' then
      v_parent_text := v_item->>'parent_id';
      if not private.is_valid_uuid(v_parent_text) then
        raise exception 'invalid_uuid';
      end if;
    end if;
  end loop;

  -- 1b. Jugadores
  for v_item in select value from jsonb_array_elements(v_players) loop
    v_id_text := v_item->>'id';
    if v_id_text is null or not private.is_valid_uuid(v_id_text) then
      raise exception 'invalid_uuid';
    end if;
    v_team_text := v_item->>'team_id';
    if v_team_text is null or not private.is_valid_uuid(v_team_text) then
      raise exception 'invalid_uuid';
    end if;
    if v_team_text::uuid <> p_team_id then
      raise exception 'wrong_team_reference';
    end if;
  end loop;

  -- 1c. Ejercicios
  for v_item in select value from jsonb_array_elements(v_exercises) loop
    v_id_text := v_item->>'id';
    if v_id_text is null or not private.is_valid_uuid(v_id_text) then
      raise exception 'invalid_uuid';
    end if;
    v_team_text := v_item->>'team_id';
    if v_team_text is null or not private.is_valid_uuid(v_team_text) then
      raise exception 'invalid_uuid';
    end if;
    if v_team_text::uuid <> p_team_id then
      raise exception 'wrong_team_reference';
    end if;
    if v_item ? 'folder_id' and v_item->>'folder_id' <> '' then
      v_folder_text := v_item->>'folder_id';
      if not private.is_valid_uuid(v_folder_text) then
        raise exception 'invalid_uuid';
      end if;
    end if;
  end loop;

  -- 1d. Sesiones + tareas
  for v_session in select value from jsonb_array_elements(v_sessions) loop
    v_id_text := v_session->>'id';
    if v_id_text is null or not private.is_valid_uuid(v_id_text) then
      raise exception 'invalid_uuid';
    end if;
    v_team_text := v_session->>'team_id';
    if v_team_text is null or not private.is_valid_uuid(v_team_text) then
      raise exception 'invalid_uuid';
    end if;
    if v_team_text::uuid <> p_team_id then
      raise exception 'wrong_team_reference';
    end if;
    v_tasks := coalesce(v_session->'tasks', '[]'::jsonb);
    if jsonb_typeof(v_tasks) is distinct from 'array' then
      raise exception 'invalid_import_payload';
    end if;
    for v_task in select value from jsonb_array_elements(v_tasks) loop
      v_id_text := v_task->>'id';
      if v_id_text is null or not private.is_valid_uuid(v_id_text) then
        raise exception 'invalid_uuid';
      end if;
      if v_task ? 'exercise_id' and v_task->>'exercise_id' <> '' then
        v_task_ex_text := v_task->>'exercise_id';
        if not private.is_valid_uuid(v_task_ex_text) then
          raise exception 'invalid_uuid';
        end if;
      end if;
    end loop;
  end loop;

  -- 2. Conjuntos de ids del payload (validados; cast seguro) ----------------
  select coalesce(array_agg(x), '{}'::uuid[]) into v_payload_folder_ids
  from (select (value->>'id')::uuid as x from jsonb_array_elements(v_folders)) s;
  select coalesce(array_agg(x), '{}'::uuid[]) into v_payload_exercise_ids
  from (select (value->>'id')::uuid as x from jsonb_array_elements(v_exercises)) s;

  -- 3. Colisión de PK con OTRO equipo (cross_team_id_conflict) --------------
  for v_item in select value from jsonb_array_elements(v_folders) loop
    v_id := (v_item->>'id')::uuid;
    if exists (select 1 from public.exercise_folders where id = v_id and team_id <> p_team_id) then
      raise exception 'cross_team_id_conflict';
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(v_players) loop
    v_id := (v_item->>'id')::uuid;
    if exists (select 1 from public.players where id = v_id and team_id <> p_team_id) then
      raise exception 'cross_team_id_conflict';
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(v_exercises) loop
    v_id := (v_item->>'id')::uuid;
    if exists (select 1 from public.exercises where id = v_id and team_id <> p_team_id) then
      raise exception 'cross_team_id_conflict';
    end if;
  end loop;
  for v_session in select value from jsonb_array_elements(v_sessions) loop
    v_id := (v_session->>'id')::uuid;
    if exists (select 1 from public.sessions where id = v_id and team_id <> p_team_id) then
      raise exception 'cross_team_id_conflict';
    end if;
    for v_task in select value from jsonb_array_elements(coalesce(v_session->'tasks', '[]'::jsonb)) loop
      v_id := (v_task->>'id')::uuid;
      if exists (select 1 from public.session_exercises where id = v_id and team_id <> p_team_id) then
        raise exception 'cross_team_id_conflict';
      end if;
    end loop;
  end loop;

  -- 4. Referencias del grafo + ciclos de carpetas (antes de INSERT) ---------
  -- 4a. parent_id de carpetas: debe estar en el payload o ya en el equipo.
  for v_item in select value from jsonb_array_elements(v_folders) loop
    v_id := (v_item->>'id')::uuid;
    if v_item ? 'parent_id' and v_item->>'parent_id' <> '' then
      v_parent_id := (v_item->>'parent_id')::uuid;
      if not (v_parent_id = any(v_payload_folder_ids))
         and not exists (select 1 from public.exercise_folders where id = v_parent_id and team_id = p_team_id) then
        raise exception 'broken_folder_reference';
      end if;
    end if;
  end loop;

  -- 4b. Ciclos: la cadena parent_id de cada carpeta no puede volver a sí misma.
  declare
    v_seen uuid[];
    v_cur uuid;
    v_cur_parent_text text;
  begin
    for v_item in select value from jsonb_array_elements(v_folders) loop
      v_seen := '{}'::uuid[];
      v_cur := (v_item->>'id')::uuid;
      loop
        if v_cur is null then exit; end if;
        if v_cur = any (v_seen) then
          raise exception 'folder_cycle';
        end if;
        v_seen := v_seen || v_cur;
        select value->>'parent_id' into v_cur_parent_text
        from jsonb_array_elements(v_folders) as f
        where (f.value->>'id')::uuid = v_cur;
        if v_cur_parent_text is null or v_cur_parent_text = '' then exit; end if;
        if not private.is_valid_uuid(v_cur_parent_text) then exit; end if;
        if not ((v_cur_parent_text::uuid) = any (v_payload_folder_ids)) then exit; end if;
        v_cur := v_cur_parent_text::uuid;
      end loop;
    end loop;
  end;

  -- 4c. folder_id de ejercicios: en el payload o ya en el equipo.
  for v_item in select value from jsonb_array_elements(v_exercises) loop
    if v_item ? 'folder_id' and v_item->>'folder_id' <> '' then
      v_folder_id := (v_item->>'folder_id')::uuid;
      if not (v_folder_id = any(v_payload_folder_ids))
         and not exists (select 1 from public.exercise_folders where id = v_folder_id and team_id = p_team_id) then
        raise exception 'broken_folder_reference';
      end if;
    end if;
  end loop;

  -- 4d. exercise_id de tareas: en el payload o ya en el equipo.
  for v_session in select value from jsonb_array_elements(v_sessions) loop
    for v_task in select value from jsonb_array_elements(coalesce(v_session->'tasks', '[]'::jsonb)) loop
      if v_task ? 'exercise_id' and v_task->>'exercise_id' <> '' then
        v_exercise_id := (v_task->>'exercise_id')::uuid;
        if not (v_exercise_id = any(v_payload_exercise_ids))
           and not exists (select 1 from public.exercises where id = v_exercise_id and team_id = p_team_id) then
          raise exception 'broken_exercise_reference';
        end if;
      end if;
    end loop;
  end loop;

  -- 5. INSERCIÓN (todo validado; empezamos a escribir de forma atómica) -------

  -- 5a. Carpetas en orden topológico (padres antes que hijos).
  v_pending_folders := v_folders;
  v_placed := '{}'::uuid[];
  v_advanced := true;
  while v_advanced loop
    v_advanced := false;
    for v_item in select value from jsonb_array_elements(v_pending_folders) loop
      v_id := (v_item->>'id')::uuid;
      if v_placed @> array[v_id] then
        continue;
      end if;
      v_parent_id := null;
      if v_item ? 'parent_id' and v_item->>'parent_id' <> '' then
        v_parent_id := (v_item->>'parent_id')::uuid;
      end if;
      -- Listo si: no tiene padre, su padre ya está colocado, o su padre no es
      -- una carpeta del payload (existe ya en el equipo). Se evalúa con un flag
      -- para no aplicar `array[null]` cuando el padre es null.
      if v_parent_id is null
         or v_placed @> array[v_parent_id]
         or not (v_parent_id = any(v_payload_folder_ids)) then
        v_name := coalesce(v_item->>'name', '');
        select * into v_frow
        from public.exercise_folders
        where id = v_id and team_id = p_team_id;
        if found then
          v_incoming_sig := jsonb_build_object('name', v_name, 'parent_id', v_parent_id);
          v_stored_sig := jsonb_build_object('name', v_frow.name, 'parent_id', v_frow.parent_id);
          if v_incoming_sig = v_stored_sig then
            v_sf := v_sf + 1;
          else
            raise exception 'id_content_conflict';
          end if;
        else
          insert into public.exercise_folders (id, team_id, parent_id, name)
          values (v_id, p_team_id, v_parent_id, v_name);
          v_cf := v_cf + 1;
        end if;
        v_placed := v_placed || v_id;
        v_advanced := true;
      end if;
    end loop;
  end loop;

  -- 5b. Jugadores.
  for v_item in select value from jsonb_array_elements(v_players) loop
    v_id := (v_item->>'id')::uuid;
    v_name := coalesce(v_item->>'name', '');
    v_number := nullif(v_item->>'number', '')::smallint;
    v_position := coalesce(v_item->>'position', '');
    v_color := coalesce(v_item->>'color', '#1a73e8');
    v_active := coalesce((v_item->>'active')::boolean, true);
    select * into v_prow
    from public.players
    where id = v_id and team_id = p_team_id;
    if found then
      v_incoming_sig := jsonb_build_object('name', v_name, 'number', v_number, 'position', v_position, 'color', v_color, 'active', v_active);
      v_stored_sig := jsonb_build_object('name', v_prow.name, 'number', v_prow.number, 'position', v_prow.position, 'color', v_prow.color, 'active', v_prow.active);
      if v_incoming_sig = v_stored_sig then
        v_sp := v_sp + 1;
      else
        raise exception 'id_content_conflict';
      end if;
    else
      insert into public.players (id, team_id, name, number, position, color, active)
      values (v_id, p_team_id, v_name, v_number, v_position, v_color, v_active);
      v_cp := v_cp + 1;
    end if;
  end loop;

  -- 5c. Ejercicios (folder_id traducido por el cliente; canvas conservado).
  for v_item in select value from jsonb_array_elements(v_exercises) loop
    v_id := (v_item->>'id')::uuid;
    v_folder_id := null;
    if v_item ? 'folder_id' and v_item->>'folder_id' <> '' then
      v_folder_id := (v_item->>'folder_id')::uuid;
    end if;
    v_title := coalesce(v_item->>'title', '');
    v_description := coalesce(v_item->>'description', '');
    v_explanation := coalesce(v_item->>'explanation', '');
    v_category := coalesce(v_item->>'category', 'Técnica');
    v_objectives := private.jsonb_text_array(v_item->'objectives');
    v_materials := private.jsonb_text_array(v_item->'materials');
    v_duration := nullif(v_item->>'duration_minutes', '')::smallint;
    v_min_players := nullif(v_item->>'min_players', '')::smallint;
    v_max_players := nullif(v_item->>'max_players', '')::smallint;
    v_load_mode := coalesce(v_item->>'load_mode', 'fixed');
    v_series_count := nullif(v_item->>'series_count', '')::smallint;
    v_repetitions_count := nullif(v_item->>'repetitions_count', '')::smallint;
    v_work_seconds := nullif(v_item->>'work_seconds', '')::smallint;
    v_rest_seconds := nullif(v_item->>'rest_seconds', '')::smallint;
    v_is_template := coalesce((v_item->>'is_template')::boolean, false);
    v_canvas_data := v_item->'canvas_data';
    v_thumbnail := v_item->>'thumbnail';
    select * into v_erow
    from public.exercises
    where id = v_id and team_id = p_team_id;
    if found then
      v_incoming_sig := jsonb_build_object(
        'folder_id', v_folder_id, 'title', v_title, 'description', v_description,
        'explanation', v_explanation, 'category', v_category, 'objectives', v_objectives,
        'materials', v_materials, 'duration_minutes', v_duration, 'min_players', v_min_players,
        'max_players', v_max_players, 'load_mode', v_load_mode, 'series_count', v_series_count,
        'repetitions_count', v_repetitions_count, 'work_seconds', v_work_seconds,
        'rest_seconds', v_rest_seconds, 'is_template', v_is_template,
        'canvas_data', v_canvas_data, 'thumbnail', v_thumbnail
      );
      v_stored_sig := jsonb_build_object(
        'folder_id', v_erow.folder_id, 'title', v_erow.title, 'description', v_erow.description,
        'explanation', v_erow.explanation, 'category', v_erow.category, 'objectives', v_erow.objectives,
        'materials', v_erow.materials, 'duration_minutes', v_erow.duration_minutes,
        'min_players', v_erow.min_players, 'max_players', v_erow.max_players,
        'load_mode', v_erow.load_mode, 'series_count', v_erow.series_count,
        'repetitions_count', v_erow.repetitions_count, 'work_seconds', v_erow.work_seconds,
        'rest_seconds', v_erow.rest_seconds, 'is_template', v_erow.is_template,
        'canvas_data', v_erow.canvas_data, 'thumbnail', v_erow.thumbnail
      );
      if v_incoming_sig = v_stored_sig then
        v_se := v_se + 1;
      else
        raise exception 'id_content_conflict';
      end if;
    else
      insert into public.exercises (
        id, team_id, folder_id, title, description, explanation, category,
        objectives, materials, duration_minutes, min_players, max_players,
        load_mode, series_count, repetitions_count, work_seconds, rest_seconds,
        is_template, canvas_data, thumbnail
      ) values (
        v_id, p_team_id, v_folder_id, v_title, v_description, v_explanation, v_category,
        v_objectives, v_materials, v_duration, v_min_players, v_max_players,
        v_load_mode, v_series_count, v_repetitions_count, v_work_seconds, v_rest_seconds,
        v_is_template, v_canvas_data, v_thumbnail
      );
      v_ce := v_ce + 1;
    end if;
  end loop;

  -- 5d. Sesiones + tareas.
  for v_session in select value from jsonb_array_elements(v_sessions) loop
    v_id := (v_session->>'id')::uuid;
    v_title := coalesce(v_session->>'title', '');
    v_date := nullif(v_session->>'date', '')::date;
    v_duration := nullif(v_session->>'duration_minutes', '')::smallint;
    v_notes := coalesce(v_session->>'notes', '');
    select * into v_srow
    from public.sessions
    where id = v_id and team_id = p_team_id;
    if found then
      -- Construye la firma de tareas del payload (ordenadas por sort_order, id).
      v_payload_tasks_sig := coalesce(
        (select jsonb_agg(jsonb_build_object(
            'id', (t->>'id')::uuid,
            'exercise_id', nullif(t->>'exercise_id', '')::uuid,
            'title', coalesce(t->>'title', ''),
            'duration_minutes', nullif(t->>'duration_minutes', ''),
            'material', coalesce(t->>'material', ''),
            'sort_order', coalesce((t->>'sort_order')::smallint, 0)
          ) order by coalesce((t->>'sort_order')::smallint, 0), t->>'id')
         from jsonb_array_elements(coalesce(v_session->'tasks', '[]'::jsonb)) as t),
        '[]'::jsonb
      );
      -- Firma de las tareas almacenadas en la sesión existente.
      v_stored_tasks_sig := coalesce(
        (select jsonb_agg(jsonb_build_object(
            'id', se.id,
            'exercise_id', se.exercise_id,
            'title', se.title,
            'duration_minutes', se.duration_minutes::text,
            'material', se.material,
            'sort_order', se.sort_order
          ) order by se.sort_order, se.id)
         from public.session_exercises se
         where se.session_id = v_id and se.team_id = p_team_id),
        '[]'::jsonb
      );
      v_incoming_sig := jsonb_build_object(
        'title', v_title, 'date', v_date, 'duration_minutes', v_duration,
        'notes', v_notes, 'tasks', v_payload_tasks_sig
      );
      v_stored_sig := jsonb_build_object(
        'title', v_srow.title, 'date', v_srow.date, 'duration_minutes', v_srow.duration_minutes,
        'notes', v_srow.notes, 'tasks', v_stored_tasks_sig
      );
      if v_incoming_sig = v_stored_sig then
        v_ss := v_ss + 1;
      else
        raise exception 'id_content_conflict';
      end if;
    else
      insert into public.sessions (id, team_id, title, date, duration_minutes, notes)
      values (v_id, p_team_id, v_title, v_date, v_duration, v_notes);
      v_cs := v_cs + 1;
      insert into public.session_exercises
        (id, team_id, session_id, exercise_id, title, duration_minutes, material, sort_order)
      select
        (t->>'id')::uuid,
        p_team_id,
        v_id,
        nullif(t->>'exercise_id', '')::uuid,
        coalesce(t->>'title', ''),
        nullif(t->>'duration_minutes', '')::smallint,
        coalesce(t->>'material', ''),
        coalesce((t->>'sort_order')::smallint, 0)
      from jsonb_array_elements(coalesce(v_session->'tasks', '[]'::jsonb)) as t
      order by coalesce((t->>'sort_order')::smallint, 0);
    end if;
  end loop;

  -- 6. Resultado con conteos exactos --------------------------------------
  return jsonb_build_object(
    'created', jsonb_build_object(
      'folders', v_cf, 'players', v_cp, 'exercises', v_ce, 'sessions', v_cs
    ),
    'skipped', jsonb_build_object(
      'folders', v_sf, 'players', v_sp, 'exercises', v_se, 'sessions', v_ss
    )
  );
exception
  -- Con SECURITY INVOKER, RLS oculta las filas de equipos ajenos durante la
  -- prevalidación. La restricción PK sigue siendo la última barrera fiable.
  -- Convertimos su error sin filtrar información sobre la fila existente.
  when unique_violation then
    raise exception 'cross_team_id_conflict';
end;
$$;

-- ---------- GRANTS: mínimo privilegio, sin acceso a PUBLIC/anon ----------
revoke execute on function public.import_team_dataset(uuid, jsonb) from public, anon;
grant execute on function public.import_team_dataset(uuid, jsonb) to authenticated;
