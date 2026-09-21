-- =============================================================
-- EntrenoLab / CDMPLab — SOLICITUD de equipo aprobada por un administrador
-- y ESTADO DEL CORREO de invitación.
--
-- Proyecto: PostgreSQL 17 · Supabase.
--
-- MOTIVO (encargo del dueño, 22/09/2026)
--   Hoy `decideAccess()` manda a /onboarding/team a cualquier cuenta APROBADA sin
--   equipo y la RPC `create_my_team` (más la política `teams_insert_owner` y el
--   GRANT INSERT sobre public.teams) le permiten crear el equipo por su cuenta.
--   El panel de administración solo aprueba PERFILES: no existe forma de que un
--   administrador acepte la creación de un equipo.
--
--   Este cambio separa las dos decisiones (aprobación de la CUENTA ≠ creación del
--   EQUIPO) y las cierra en el SERVIDOR, no en la interfaz:
--     · una cuenta aprobada sin equipo puede presentar una SOLICITUD (`team_requests`);
--     · solo un administrador de plataforma la ve, la aprueba o la rechaza, y al
--       aprobarla el equipo se crea EN LA MISMA TRANSACCIÓN;
--     · `create_my_team` deja de crear equipos a quien no sea administrador;
--     · se retira el INSERT directo sobre public.teams (política y GRANT), así que
--       `insert into teams` desde el cliente ya no es una vía alternativa.
--
-- QUÉ NO CAMBIA (contrato conservado a propósito)
--   · Los equipos y datos existentes: esta migración NO borra ni reescribe filas.
--   · El flujo de aceptar una invitación (`accept_team_invitation`) y el de
--     invitar (`invite_team_member`) con su límite de 6 colaboradores.
--   · `renameTeam` sigue usando UPDATE directo (GRANT de (name, accent_color)).
--   · La aprobación de una CUENTA sigue siendo `admin_set_profile_status`.
--
-- CATÁLOGO REMOTO VERIFICADO ANTES DE APLICAR (21/09/2026, proyecto EntrenoLab):
--   · public.team_requests: no existe;
--   · public.create_my_team(text,text): existe y permite crear a perfiles aprobados;
--   · teams_insert_owner: existe y authenticated tiene INSERT sobre teams;
--   · team_invitations solo tiene email_normalized entre las columnas email_*;
--   · existe unicidad sobre teams.owner_user_id y hay un administrador de plataforma.
--   Estas comprobaciones no significan que la migración esté aplicada: son la base
--   contra la que se preparó y revisó el cambio incremental.
--
-- IDEMPOTENTE: ejecutable varias veces con el mismo resultado final.
-- =============================================================

-- =============================================================
-- 1) TABLA DE SOLICITUDES
-- =============================================================
-- Una fila por solicitud. El histórico se conserva: una solicitud rechazada NO se
-- borra (sirve de registro de quién la pidió y qué se decidió) y permite pedirla
-- otra vez creando una fila nueva.
create table if not exists public.team_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null,
  accent_color text not null default '#3056d3',
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  -- Motivo del rechazo (lo escribe el administrador). Null mientras está pendiente.
  note text,
  -- Equipo realmente creado al aprobar (null si se rechazó).
  created_team_id uuid references public.teams(id) on delete set null,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(user_id) on delete set null,
  -- Se incrementa al reenviar una solicitud pendiente (editar nombre/color).
  revision integer not null default 1,
  constraint team_requests_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint team_requests_color_fmt check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint team_requests_decided_consistency check (
    (status = 'pending' and decided_at is null and decided_by is null and created_team_id is null)
    or (status = 'rejected' and decided_at is not null and created_team_id is null)
    or (status = 'approved' and decided_at is not null and created_team_id is not null)
  )
);

-- UNA SOLA solicitud PENDIENTE por usuario (índice único parcial). Es la garantía
-- de que el solicitante no puede acumular solicitudes ni el administrador aprobar
-- dos veces "dos equipos diferentes".
create unique index if not exists team_requests_one_pending_per_user
  on public.team_requests (user_id) where status = 'pending';

-- Cola de trabajo del administrador: pendientes primero, por antigüedad.
create index if not exists team_requests_queue_idx
  on public.team_requests (status, requested_at);
create index if not exists team_requests_created_team_idx
  on public.team_requests (created_team_id) where created_team_id is not null;
create index if not exists team_requests_decided_by_idx
  on public.team_requests (decided_by) where decided_by is not null;

drop trigger if exists team_requests_touch on public.team_requests;
create trigger team_requests_touch before update on public.team_requests
  for each row execute function public.touch_updated_at();

-- =============================================================
-- 2) RLS: leer SÍ, escribir NO
-- =============================================================
alter table public.team_requests enable row level security;

-- El solicitante ve SU solicitud (para conocer el estado) y el administrador las ve
-- todas (para decidir). No hay políticas de INSERT/UPDATE/DELETE: toda mutación pasa
-- por las RPC de abajo, que validan identidad, aprobación y permiso de plataforma.
drop policy if exists team_requests_select_own_or_admin on public.team_requests;
create policy team_requests_select_own_or_admin on public.team_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_admin());

-- =============================================================
-- 3) SOLICITAR (cuenta aprobada sin equipo)
-- =============================================================
create or replace function private.request_team_creation(
  p_name text,
  p_accent_color text default '#3056d3'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_color text := lower(coalesce(p_accent_color, '#3056d3'));
  v_id uuid;
begin
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
  -- Quien YA tiene equipo no solicita nada (una cuenta = un equipo propio).
  if exists (select 1 from public.teams t where t.owner_user_id = v_uid) then
    raise exception 'already_has_team';
  end if;
  -- IDEMPOTENTE: si ya hay una solicitud pendiente se ACTUALIZA (no se duplica);
  -- si no, se crea. El `on conflict` sobre el índice parcial resuelve la carrera de
  -- dos peticiones simultáneas sin dejar filas de más.
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
$$;

-- Envoltorio público. Es SECURITY DEFINER porque el cliente NO tiene (ni debe
-- tener) INSERT sobre public.team_requests: si tuviera DML directo podría escribir
-- `status = 'approved'` a mano y saltarse al administrador.
create or replace function public.request_team_creation(
  p_name text,
  p_accent_color text default '#3056d3'
)
returns uuid
language sql
security definer
set search_path = ''
as $$ select private.request_team_creation(p_name, p_accent_color) $$;

-- =============================================================
-- 4) LISTAR (solo administrador de plataforma)
-- =============================================================
create or replace function public.admin_list_team_requests(p_search text default '')
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  email_normalized text,
  name text,
  accent_color text,
  status text,
  note text,
  requested_at timestamptz,
  decided_at timestamptz,
  decided_by uuid,
  created_team_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := lower(btrim(coalesce(p_search, '')));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  return query
  select r.id,
         r.user_id,
         p.display_name,
         p.email_normalized,
         r.name,
         r.accent_color,
         r.status,
         r.note,
         r.requested_at,
         r.decided_at,
         r.decided_by,
         r.created_team_id
  from public.team_requests r
  join public.profiles p on p.user_id = r.user_id
  where v_search = ''
     or lower(p.email_normalized) like ('%' || v_search || '%')
     or lower(p.display_name) like ('%' || v_search || '%')
     or lower(r.name) like ('%' || v_search || '%')
  -- Pendientes primero (true > false), y dentro de cada grupo lo más reciente arriba.
  order by (r.status = 'pending') desc, r.requested_at desc
  limit 200;
end;
$$;

-- =============================================================
-- 5) DECIDIR (solo administrador de plataforma) — crea el equipo al aprobar
-- =============================================================
create or replace function public.admin_decide_team_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_req public.team_requests%rowtype;
  v_team uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_admin is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- El permiso NO se deduce del correo ni de metadatos editables por el usuario:
  -- se lee de private.platform_admins, que no tiene acceso de tabla para el cliente.
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  -- Bloqueo de fila: dos aprobaciones simultáneas de la MISMA solicitud se
  -- serializan aquí y la segunda ve el estado ya decidido (idempotencia).
  select * into v_req from public.team_requests where id = p_request_id for update;
  if not found then
    raise exception 'team_request_not_found';
  end if;

  -- IDEMPOTENCIA: repetir la aprobación devuelve el MISMO equipo; repetir el
  -- rechazo no cambia nada. Así un doble clic (o un reintento de red) no crea dos equipos.
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

  -- APROBAR. El solicitante debe seguir aprobado: crear un equipo para una cuenta
  -- suspendida o rechazada dejaría datos huérfanos de acceso.
  if not exists (
    select 1 from public.profiles p
    where p.user_id = v_req.user_id and p.status = 'approved'
  ) then
    raise exception 'requester_not_approved';
  end if;

  -- Equipo del solicitante: si ya existe (aprobación previa, alta histórica o
  -- carrera) se REUTILIZA; no se crea un segundo equipo.
  select t.id into v_team from public.teams t where t.owner_user_id = v_req.user_id;
  if v_team is null then
    begin
      insert into public.teams (owner_user_id, name, accent_color)
      values (v_req.user_id, v_req.name, v_req.accent_color)
      returning id into v_team;
    exception
      when unique_violation then
        -- La unicidad `teams_owner_unique` la ganó otra transacción simultánea.
        select t.id into v_team from public.teams t where t.owner_user_id = v_req.user_id;
    end;
  end if;
  if v_team is null then
    raise exception 'team_creation_failed';
  end if;

  update public.team_requests
  set status = 'approved',
      note = null,
      decided_at = now(),
      decided_by = v_admin,
      created_team_id = v_team
  where id = v_req.id;

  -- Una sola solicitud aprobada por usuario: cualquier otra pendiente suya se cierra
  -- como rechazada para que la cola del administrador no quede con fantasmas.
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
$$;

-- =============================================================
-- 6) CIERRE DE LA VÍA ANTIGUA: `create_my_team` deja de crear equipos
-- =============================================================
-- CAMBIO DE CONTRATO EXPLÍCITO. Antes: cualquier perfil aprobado podía llamar a
-- esta RPC (SECURITY INVOKER + GRANT INSERT sobre teams + política
-- `teams_insert_owner`) y crear su equipo sin intervención del administrador. Ese
-- contrato es JUSTO el agujero que se cierra. Ahora la función se conserva (una
-- pestaña con el bundle antiguo recibe un error claro en vez de un 404 de función
-- inexistente) pero solo un administrador de plataforma puede crear su propio equipo.
create or replace function public.create_my_team(
  p_name text,
  p_accent_color text default '#3056d3'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_color text := lower(coalesce(p_accent_color, '#3056d3'));
  v_team uuid;
begin
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
  on conflict (owner_user_id) do nothing
  returning id into v_team;
  if v_team is null then
    select t.id into v_team from public.teams t where t.owner_user_id = v_uid;
  end if;
  return v_team;
end;
$$;

-- Se retira la política de INSERT del cliente y el GRANT que la hacía posible.
-- `drop policy if exists` es idempotente y deja claro que NO hay política de INSERT
-- (con RLS activa, sin política no se inserta).
drop policy if exists teams_insert_owner on public.teams;
revoke insert on table public.teams from authenticated;
revoke insert on table public.teams from anon, public;

-- =============================================================
-- 7) ESTADO DEL CORREO DE INVITACIÓN
-- =============================================================
-- La invitación se sigue creando con `invite_team_member` (contrato intacto). Lo que
-- se añade es el estado del ENVÍO, en columnas propias y distinguibles:
--   · created           → invitación creada, sin intento de envío todavía;
--   · send_pending      → entregada al proveedor, pendiente de su respuesta;
--   · provider_accepted → el proveedor ACEPTÓ el envío (NO es entrega confirmada);
--   · send_error        → el envío falló (con el motivo, redactado y truncado).
-- El estado de la invitación (`status`) es otra cosa: `accepted` = la persona la aceptó.
alter table public.team_invitations
  add column if not exists email_status text not null default 'created';
alter table public.team_invitations
  drop constraint if exists team_invitations_email_status_check;
alter table public.team_invitations
  add constraint team_invitations_email_status_check
  check (email_status in ('created','send_pending','provider_accepted','send_error'));
alter table public.team_invitations
  add column if not exists email_attempts integer not null default 0;
alter table public.team_invitations
  add column if not exists last_email_at timestamptz;
alter table public.team_invitations
  add column if not exists last_email_error text;
alter table public.team_invitations
  add column if not exists provider_message_id text;
-- Identificador del INTENTO DE ENVÍO en curso. Lo genera `prepare_invitation_email` y el
-- resultado del proveedor se registra CONTRA ÉL: así una respuesta tardía de un intento viejo
-- (reintento posterior, reintento manual, webhook con retraso) no puede sobrescribir el estado
-- del intento más nuevo.
alter table public.team_invitations
  add column if not exists email_attempt_id uuid;

-- Preparar un envío: autoriza (solo el propietario del equipo), comprueba que la
-- invitación sigue viva, aplica el límite de intentos y el cooldown, marca
-- `send_pending`, ABRE UN INTENTO con identificador propio y devuelve lo necesario para
-- enviar el correo.
-- El enlace NO concede acceso: la aceptación vuelve a comprobar en el servidor el
-- correo confirmado del que llama (`private.accept_invitation`).
create or replace function public.prepare_invitation_email(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.team_invitations%rowtype;
  v_team_name text;
  v_attempt uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_inv from public.team_invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'invitation_not_available';
  end if;
  if not private.is_team_owner(v_inv.team_id) then
    raise exception 'forbidden: not team owner' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    raise exception 'invitation_not_available';
  end if;
  -- Cooldown entre envíos correctos; un envío FALLIDO sí se puede reintentar en
  -- seguida (el dueño acaba de ver el error), pero siempre dentro del tope de intentos.
  if v_inv.email_status <> 'send_error'
     and v_inv.last_email_at is not null
     and v_inv.last_email_at > now() - interval '60 seconds' then
    raise exception 'email_cooldown';
  end if;
  if v_inv.email_attempts >= 5 then
    raise exception 'email_attempt_limit';
  end if;
  select t.name into v_team_name from public.teams t where t.id = v_inv.team_id;
  -- El intento se abre con un identificador NUEVO: el que tuviera un envío anterior deja de
  -- ser válido en este mismo instante (su resultado llegará como `stale_email_attempt`).
  update public.team_invitations
  set email_status = 'send_pending',
      email_attempts = email_attempts + 1,
      last_email_at = now(),
      email_attempt_id = gen_random_uuid()
  where id = v_inv.id
  returning email_attempt_id into v_attempt;
  return jsonb_build_object(
    'invitation_id', v_inv.id,
    'team_id', v_inv.team_id,
    'team_name', coalesce(v_team_name, ''),
    'email', v_inv.email_normalized,
    'link_path', '/invitations?invitation=' || v_inv.id::text,
    'attempt_id', v_attempt
  );
end;
$$;

-- Registrar el resultado REAL del envío. Se guarda el motivo redactado y truncado:
-- nunca un token ni el cuerpo completo de la respuesta del proveedor.
--
-- QUIÉN PUEDE LLAMARLA (esto es un cambio de contrato del 22/09/2026, tras la revisión del
-- dueño): SOLO la función de servidor, con la credencial de servicio
-- (`service_role`, que NUNCA llega al navegador). Antes estaba concedida a `authenticated` y
-- solo comprobaba que quien llamaba fuera el propietario: eso permitía a un propietario
-- **falsificar** `provider_accepted` (y el identificador del proveedor) con una llamada
-- directa a la RPC, sin enviar ningún correo. Ahora:
--   · `revoke execute … from public, anon, authenticated` + `grant execute … to service_role`;
--   · el resultado se vincula al INTENTO preparado (`p_attempt_id`): un resultado de un intento
--     antiguo NO cambia el estado del intento vigente (`stale_email_attempt`);
--   · no se comprueba `auth.uid()` a propósito: la credencial de servicio no tiene usuario, y
--     la autorización la dio `prepare_invitation_email` (propietario) al abrir el intento.
create or replace function public.record_invitation_email_result(
  p_invitation_id uuid,
  p_attempt_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.team_invitations%rowtype;
begin
  if p_status not in ('provider_accepted','send_error') then
    raise exception 'invalid_email_status';
  end if;
  if p_attempt_id is null then
    raise exception 'email_attempt_required';
  end if;
  select * into v_inv from public.team_invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'invitation_not_available';
  end if;
  -- Vinculación al intento: solo el intento VIGENTE puede escribir el resultado.
  if v_inv.email_attempt_id is distinct from p_attempt_id then
    raise exception 'stale_email_attempt';
  end if;
  update public.team_invitations
  set email_status = p_status,
      provider_message_id = case
        when p_status = 'provider_accepted' then left(coalesce(p_provider_message_id, ''), 120)
        else provider_message_id
      end,
      last_email_error = case
        when p_status = 'send_error' then
          left(regexp_replace(coalesce(p_error, ''), E'[\\n\\r\\t]+', ' ', 'g'), 300)
        else null
      end
  where id = v_inv.id;
end;
$$;

-- Cualquier sobrecarga anterior (la firma sin el identificador de intento) se retira: si
-- existiera, `authenticated` podría seguir llamándola y el agujero seguiría abierto.
drop function if exists public.record_invitation_email_result(uuid, text, text, text);

-- =============================================================
-- 8) GRANTS MINIMOS (mínimo privilegio, al estilo de 20260901000000)
-- =============================================================
-- team_requests: SOLO lectura (la propia o todas si es administrador). Cero DML
-- directo: toda mutación pasa por las RPC, que validan el permiso.
revoke all on table public.team_requests from public, anon, authenticated;
grant select on table public.team_requests to authenticated;

-- RPC de solicitud.
revoke execute on function private.request_team_creation(text, text) from public, anon, authenticated;
revoke execute on function public.request_team_creation(text, text) from public, anon;
grant execute on function public.request_team_creation(text, text) to authenticated;

-- RPC de administración (la propia función comprueba is_platform_admin()).
revoke execute on function public.admin_list_team_requests(text) from public, anon;
grant execute on function public.admin_list_team_requests(text) to authenticated;
revoke execute on function public.admin_decide_team_request(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_team_request(uuid, boolean, text) to authenticated;

-- RPC del correo de invitación. `prepare_invitation_email` sigue siendo del PROPIETARIO
-- (autoriza dentro con private.is_team_owner), pero el REGISTRO del resultado solo lo puede
-- hacer la función de servidor con la credencial de servicio: el navegador no tiene (ni debe
-- tener) forma de escribir un `provider_accepted` que no haya ocurrido.
revoke execute on function public.prepare_invitation_email(uuid) from public, anon;
grant execute on function public.prepare_invitation_email(uuid) to authenticated;
revoke execute on function public.record_invitation_email_result(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_invitation_email_result(uuid, uuid, text, text, text)
  to service_role;

-- `create_my_team` sigue siendo ejecutable por un usuario autenticado, pero responde
-- `team_creation_requires_approval` si no es administrador (error claro en vez de un
-- permiso denegado opaco). NO se concede nada nuevo.
revoke execute on function public.create_my_team(text, text) from public, anon;
grant execute on function public.create_my_team(text, text) to authenticated;

-- =============================================================
-- 9) COMPROBACIÓN POSTERIOR (a ejecutar a mano tras aplicar en remoto)
-- =============================================================
--   -- a) no debe quedar política de INSERT en teams:
--   select polname from pg_policy where polrelid = 'public.teams'::regclass and polcmd = 'a';
--   -- b) authenticated NO debe tener INSERT sobre teams:
--   select privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name='teams' and grantee='authenticated';
--   -- c) el índice parcial de solicitudes existe:
--   select indexname from pg_indexes where tablename='team_requests';
--   -- d) un usuario no administrador NO puede crear equipo (debe fallar):
--   --    select public.create_my_team('X', '#3056d3');  → team_creation_requires_approval
--   --    insert into public.teams (owner_user_id, name) values (auth.uid(), 'X'); → RLS
--   -- e) dos aprobaciones simultáneas de la misma solicitud devuelven el mismo uuid.
--   -- f) el REGISTRO del correo: `authenticated` NO puede ejecutarlo (debe responder
--   --    «permission denied for function record_invitation_email_result»), y
--   --    `service_role` sí:
--   select has_function_privilege('authenticated',
--     'public.record_invitation_email_result(uuid,uuid,text,text,text)', 'EXECUTE');  -- false
--   select has_function_privilege('service_role',
--     'public.record_invitation_email_result(uuid,uuid,text,text,text)', 'EXECUTE');  -- true
--   -- g) no debe quedar la firma antigua (sin identificador de intento):
--   select proname, pg_get_function_identity_arguments(oid) from pg_proc
--    where proname = 'record_invitation_email_result';
