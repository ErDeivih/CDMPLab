-- =============================================================
-- EntrenoLab — Migración 00006: guardado ATÓMICO de sesión + tareas
--
-- Proyecto: vgwfjkhvzprsoixpzruq (PostgreSQL 17).
--
-- MOTIVO (riesgo de integridad): el cliente guardaba una sesión en tres llamadas
-- separadas (upsert de `sessions`, delete de `session_exercises`, insert de las
-- tareas). Si la tercera fallaba tras la segunda, la sesión perdía TODAS sus
-- tareas sin que hubiera forma de recuperarlas. Esta migración introduce una RPC
-- TRANSACCIONAL que hace todo en una única transacción: un error en cualquier
-- punto revierte el lote completo.
--
-- GARANTÍAS:
--   · SECURITY INVOKER + RLS: la autorización REAL la siguen aplicando las
--     policies de `sessions`/`session_exercises` (miembro del equipo). No se
--     usan SECURITY DEFINER aquí; solo se consulta el helper privado de
--     pertenencia `private.is_team_member`, que mantiene el patrón existente.
--   · Bloqueo optimista: la fila de `sessions` se carga con `SELECT ... FOR
--     UPDATE` y se exige que la `revision` enviada (p_revision) coincida con la
--     almacenada. Si no coinciden (otro usuario la modificó) se levanta
--     `revision_conflict` SIN mutar nada.
--   · Raíces de ejercicio de un solo equipo: se valida que CADA exercise_id de
--     las tareas pertenezca al MISMO equipo de la sesión; en caso contrario se
--     rechaza el lote (raised 'same_team_exercise_required').
--   · Reemplazo atómico de tareas: delete + insert dentro de la misma
--     transacción, con la misma `team_id` que la sesión.
--   · Mínimo privilegio: `set search_path=''`, EXECUTE solo a `authenticated`,
--     revocado de public/anon.
--
-- VERIFICACIÓN CONTRA LA BASE (2026-08-28): pg_proc del proyecto
-- vgwfjkhvzprsoixpzruq no contenía ninguna función homónima antes de aplicar
-- esta migración. La matriz real de supabase/tests/entrenolab_rls.sql cubre
-- creación, actualización, conflicto, referencia cruzada y revocación.
-- =============================================================

create or replace function public.save_session_with_tasks(
  p_session jsonb,
  p_revision integer,
  p_tasks jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_session_id uuid;
  v_title text;
  v_date date;
  v_duration smallint;
  v_notes text;
  v_existing public.sessions%rowtype;
  v_row public.sessions%rowtype;
  v_exercise_id uuid;
  v_task record;
begin
  if jsonb_typeof(p_session) is distinct from 'object' then
    raise exception 'invalid_session_payload';
  end if;
  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'invalid_session_tasks';
  end if;

  -- 1. Extrae los campos del payload (casts explícitos; tolera nulls).
  v_team_id := (p_session->>'team_id')::uuid;
  v_session_id := (p_session->>'id')::uuid;
  v_title := coalesce(p_session->>'title', '');
  v_date := nullif(p_session->>'date', '')::date;
  v_duration := nullif(p_session->>'duration_minutes', '')::smallint;
  v_notes := coalesce(p_session->>'notes', '');

  -- 2. Autorización: el llamante debe ser miembro (owner/editor) del equipo.
  if not private.is_team_member(v_team_id) then
    raise exception 'forbidden: not a member of the team' using errcode = '42501';
  end if;

  -- 3. Carga la fila de la sesión y BLOQUEA la fila (concurrencia optimista).
  --    `select ... for update` evita dos escrituras simultáneas sobre la misma
  --    sesión; la transacción se mantiene hasta el commit/rollback final.
  select * into v_existing
  from public.sessions
  where id = v_session_id
  for update;

  if found then
    -- 3a. La sesión pertenece a otro equipo: rechazo (aunque el llamante sea
    --     miembro de ambos, no puede mezclar tareas entre equipos).
    if v_existing.team_id <> v_team_id then
      raise exception 'forbidden: session belongs to another team' using errcode = '42501';
    end if;
    -- 3b. Concurrencia optimista: si la revisión esperada no coincide, NO se
    --     muta nada y se informa del conflicto.
    if v_existing.revision is distinct from p_revision then
      raise exception 'revision_conflict';
    end if;
    update public.sessions
       set title = v_title,
           date = v_date,
           duration_minutes = v_duration,
           notes = v_notes
     where id = v_session_id
     returning * into v_row;
  else
    -- 3c. Sesión nueva: insert (revision arranca en 1 vía default; el trigger
    --     bump_revision solo aplica en UPDATE).
    insert into public.sessions (id, team_id, title, date, duration_minutes, notes)
    values (v_session_id, v_team_id, v_title, v_date, v_duration, v_notes)
    returning * into v_row;
  end if;

  -- 4. Valida TODOS los exercise_id de las tareas: deben pertenecer al MISMO
  --    equipo. Si alguno no existe o es de otro equipo, se revierte el lote.
  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) as t
  loop
    v_exercise_id := nullif(v_task->>'exercise_id', '')::uuid;
    if v_exercise_id is not null then
      if not exists (
        select 1 from public.exercises
        where id = v_exercise_id and team_id = v_team_id
      ) then
        raise exception 'same_team_exercise_required';
      end if;
    end if;
  end loop;

  -- 5. Reemplaza las tareas de forma atómica (delete + insert, misma transacción).
  delete from public.session_exercises
   where session_id = v_session_id and team_id = v_team_id;

  insert into public.session_exercises
    (id, team_id, session_id, exercise_id, title, duration_minutes, material, sort_order)
  select
    coalesce(nullif(t->>'id', '')::uuid, gen_random_uuid()),
    v_team_id,
    v_session_id,
    nullif(t->>'exercise_id', '')::uuid,
    coalesce(t->>'title', ''),
    nullif(t->>'duration_minutes', '')::smallint,
    coalesce(t->>'material', ''),
    coalesce((t->>'sort_order')::smallint, 0)
  from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) as t
  order by coalesce((t->>'sort_order')::smallint, 0);

  -- 6. Devuelve la fila guardada (con su nueva revisión) para que el cliente la
  --    use como estado, sin necesidad de una consulta adicional.
  return to_jsonb(v_row);
end;
$$;

-- ---------- GRANTS: mínimo privilegio, sin acceso a PUBLIC/anon ----------
revoke execute on function public.save_session_with_tasks(jsonb, integer, jsonb) from public, anon;
grant execute on function public.save_session_with_tasks(jsonb, integer, jsonb) to authenticated;
