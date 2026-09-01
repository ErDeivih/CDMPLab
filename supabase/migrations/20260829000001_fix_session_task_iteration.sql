-- Corrige la iteración JSON de save_session_with_tasks.
-- La versión inicial declaró v_task como record, por lo que el operador ->>
-- fallaba en PostgreSQL real. Debe ser jsonb para representar cada elemento.
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
  v_task jsonb;
begin
  if jsonb_typeof(p_session) is distinct from 'object' then
    raise exception 'invalid_session_payload';
  end if;
  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'invalid_session_tasks';
  end if;

  v_team_id := (p_session->>'team_id')::uuid;
  v_session_id := (p_session->>'id')::uuid;
  v_title := coalesce(p_session->>'title', '');
  v_date := nullif(p_session->>'date', '')::date;
  v_duration := nullif(p_session->>'duration_minutes', '')::smallint;
  v_notes := coalesce(p_session->>'notes', '');

  if not private.is_team_member(v_team_id) then
    raise exception 'forbidden: not a member of the team' using errcode = '42501';
  end if;

  select * into v_existing
  from public.sessions
  where id = v_session_id
  for update;

  if found then
    if v_existing.team_id <> v_team_id then
      raise exception 'forbidden: session belongs to another team' using errcode = '42501';
    end if;
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
    insert into public.sessions (id, team_id, title, date, duration_minutes, notes)
    values (v_session_id, v_team_id, v_title, v_date, v_duration, v_notes)
    returning * into v_row;
  end if;

  for v_task in
    select value from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
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

  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.save_session_with_tasks(jsonb, integer, jsonb)
  from public, anon;
grant execute on function public.save_session_with_tasks(jsonb, integer, jsonb)
  to authenticated;
