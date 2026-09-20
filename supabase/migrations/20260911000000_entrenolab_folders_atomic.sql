-- =============================================================
-- CDMPLab — operaciones de CARPETA atómicas (Fase 6 de la auditoría)
--
-- PROBLEMA (defecto real de la auditoría): el cliente hacía estas dos operaciones con N escrituras
-- secuenciales —`deleteFolder()` un DELETE por carpeta del subárbol, `duplicateFolderTree()` un
-- INSERT por carpeta y otro por ejercicio—. Si una petición intermedia falla, el servidor queda con
-- el árbol PARCIALMENTE borrado o duplicado y el cliente solo puede recargar: no hay transacción.
--
-- SOLUCIÓN: dos funciones que hacen el trabajo COMPLETO dentro de una transacción de PostgreSQL.
--
-- AUTORIZACIÓN: se resuelve con `private.team_role(uuid)` (ya existente en el esquema), que mira
-- `public.teams.owner_user_id` y `public.team_members` con el estado activo. NO se usa
-- `user_metadata` para autorizar nada. Se exige pertenencia al equipo de la carpeta (owner o
-- editor), que es lo mismo que exige la RLS de las tablas: la función no es una puerta trasera.
--
-- AISLAMIENTO: todas las consultas llevan `team_id`, así que una carpeta de OTRO equipo no se puede
-- tocar ni leer aunque se conozca su id (además, `private.folder_team` devuelve el equipo real).
--
-- `set search_path = ''` + nombres completos en todo, como el resto de funciones del proyecto.
--
-- ESTADO: **preparado LOCALMENTE. NO aplicado ni verificado contra el catálogo remoto.** El cliente
-- TypeScript NO llama todavía a estas funciones (siguen `deleteFolder`/`duplicateFolderTree`
-- actuales): cambiar el cliente antes de aplicar la migración rompería la app en producción.
-- =============================================================

-- Equipo de una carpeta (null si no existe). Solo lo usan las funciones de debajo.
create or replace function private.folder_team(p_folder uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.team_id from public.exercise_folders f where f.id = p_folder;
$$;

revoke execute on function private.folder_team(uuid) from public, anon, authenticated;

-- Borra una carpeta y TODO su subárbol (carpetas hijas), desvinculando sus ejercicios, en UNA
-- transacción: o desaparece el árbol entero o no cambia nada.
create or replace function public.delete_folder_tree(p_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_role text;
  v_ids  uuid[];
begin
  v_team := private.folder_team(p_folder_id);
  if v_team is null then
    raise exception 'folder_not_found';
  end if;
  v_role := private.team_role(v_team);
  if v_role not in ('owner', 'editor') then
    raise exception 'forbidden: not team member';
  end if;

  -- Subárbol completo (la recursión se queda SIEMPRE dentro del equipo).
  with recursive sub as (
    select f.id
    from public.exercise_folders f
    where f.id = p_folder_id and f.team_id = v_team
    union all
    select c.id
    from public.exercise_folders c
    join sub s on c.parent_id = s.id
    where c.team_id = v_team
  )
  select coalesce(array_agg(sub.id), '{}'::uuid[]) into v_ids from sub;

  -- Los ejercicios NO se borran: se desvinculan (mismo criterio que el cliente y que el
  -- `on delete set null` del FK). Así la sesión que los referenciaba sigue siendo válida.
  update public.exercises e
     set folder_id = null
   where e.team_id = v_team and e.folder_id = any(v_ids);

  delete from public.exercise_folders f
   where f.team_id = v_team and f.id = any(v_ids);
end;
$$;

-- Duplica una carpeta con TODO su subárbol y con los ejercicios de cada carpeta, en UNA
-- transacción. Devuelve el id de la carpeta nueva (raíz de la copia).
create or replace function public.duplicate_folder_tree(p_folder_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_role text;
  v_root uuid;
  v_new  uuid;
  v_map  jsonb := '{}'::jsonb;
  r      record;
begin
  v_team := private.folder_team(p_folder_id);
  if v_team is null then
    raise exception 'folder_not_found';
  end if;
  v_role := private.team_role(v_team);
  if v_role not in ('owner', 'editor') then
    raise exception 'forbidden: not team member';
  end if;

  -- De padre a hijo (`order by depth`): cuando se crea una copia, su padre copiado ya existe.
  for r in
    with recursive sub as (
      select f.id, f.parent_id, f.name, 0 as depth
      from public.exercise_folders f
      where f.id = p_folder_id and f.team_id = v_team
      union all
      select c.id, c.parent_id, c.name, s.depth + 1
      from public.exercise_folders c
      join sub s on c.parent_id = s.id
      where c.team_id = v_team
    )
    select sub.id, sub.parent_id, sub.name, sub.depth from sub order by sub.depth
  loop
    if r.depth = 0 then
      -- CONTRATO (igual que `duplicateFolderTree` de store.service.ts, que es la referencia):
      -- la copia es una carpeta RAÍZ. Antes esta función copiaba el `parent_id` del original, así
      -- que duplicar una subcarpeta la dejaba colgando del mismo padre y duplicar una raíz
      -- funcionaba por casualidad. Se fija `null` explícito.
      insert into public.exercise_folders (team_id, name, parent_id)
      values (v_team, r.name || ' (copia)', null)
      returning id into v_new;
      v_root := v_new;
    else
      insert into public.exercise_folders (team_id, name, parent_id)
      values (v_team, r.name, (v_map ->> r.parent_id::text)::uuid)
      returning id into v_new;
    end if;
    v_map := v_map || jsonb_build_object(r.id::text, v_new::text);

    -- Los ejercicios de la carpeta se copian con ella (pizarra y miniatura incluidas).
    -- El título lleva el sufijo « (copia)», igual que en la implementación local: antes se
    -- copiaba el título literal y dos ejercicios distintos quedaban con el MISMO nombre.
    insert into public.exercises (
      team_id, folder_id, title, description, explanation, category, objectives, materials,
      duration_minutes, min_players, max_players, load_mode, series_count, repetitions_count,
      work_seconds, rest_seconds, is_template, canvas_data, thumbnail
    )
    select
      e.team_id, v_new, e.title || ' (copia)', e.description, e.explanation, e.category,
      e.objectives, e.materials, e.duration_minutes, e.min_players, e.max_players, e.load_mode,
      e.series_count, e.repetitions_count, e.work_seconds, e.rest_seconds, e.is_template,
      e.canvas_data, e.thumbnail
    from public.exercises e
    where e.team_id = v_team and e.folder_id = r.id;
  end loop;

  return v_root;
end;
$$;

-- Solo usuarios autenticados (y con pertenencia comprobada dentro) pueden ejecutarlas.
revoke execute on function public.delete_folder_tree(uuid) from public, anon;
revoke execute on function public.duplicate_folder_tree(uuid) from public, anon;
grant execute on function public.delete_folder_tree(uuid) to authenticated;
grant execute on function public.duplicate_folder_tree(uuid) to authenticated;
