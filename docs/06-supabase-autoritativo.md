# CDMPLab — Esquema/autoridad Supabase (estado aplicado y verificado)

> Proyecto: `vgwfjkhvzprsoixpzruq`. ChatGPT aplicó y verificó estas 5 migraciones
> contra el remoto. **No modificar migraciones aplicadas (hasta 20260827000004).**
> Cualquier cambio nuevo va en una migración incremental posterior (>= 00005).

## Migraciones aplicadas
- `20260827000000_entrenolab_schema.sql`
- `20260827000001_entrenolab_hardening.sql`
- `20260827000002_fix_invitation_acceptance.sql`
- `20260827000003_rpc_security_invoker.sql`
- `20260827000004_fix_team_rpc_returning.sql`

## Tablas (public)
`profiles`, `teams`, `team_members`, `team_invitations`, `players`,
`exercise_folders`, `exercises`, `sessions`, `session_exercises`.

### profiles
- user_id uuid PK → auth.users(id) on delete cascade
- display_name text not null default ''
- email_normalized text not null unique
- status text check ('pending','approved','rejected','suspended') default 'pending'
- approved_at, approved_by (uuid → auth.users on delete set null), created_at, updated_at

### teams
- id uuid PK default gen_random_uuid()
- owner_user_id uuid not null → profiles(user_id) on delete cascade
- name text, accent_color text default '#3056d3'
- created_at, updated_at
- constraint teams_owner_unique unique(owner_user_id) (máx. 1 equipo propio)

### team_members
- team_id uuid, user_id uuid, role text ('owner','editor'), status text ('pending_approval','active','revoked')
- invited_by uuid → profiles on delete set null, accepted_at, created_at
- primary key (team_id, user_id)

### team_invitations
- id uuid PK, team_id uuid, email_normalized text, invited_user_id uuid → profiles on delete set null
- status text ('pending','accepted','revoked','expired') default 'pending'
- invited_by uuid, expires_at timestamptz default now()+7 days, created_at
- unique index parcial team_invitations_pending_unique(team_id, lower(email_normalized)) where status='pending'

### players
- id uuid PK, team_id uuid, name, number smallint, position, color, active boolean
- created_at, updated_at

### exercise_folders
- id uuid PK, team_id uuid, parent_id uuid, name, created_at
- constraint exercise_folders_team_id_id_unique unique(team_id, id)
- constraint exercise_folders_parent_same_team_fk foreign key (team_id, parent_id) → exercise_folders(team_id, id) on delete set null (parent_id)

### exercises
- id uuid PK, team_id uuid, folder_id uuid, title, description, explanation, category,
  objectives text[], materials text[], duration_minutes, min_players, max_players,
  load_mode ('fixed','interval'), series_count, repetitions_count, work_seconds,
  rest_seconds, is_template, canvas_data jsonb, thumbnail, revision integer default 1,
  created_at, updated_at
- constraint exercises_team_id_id_unique unique(team_id, id)
- constraint exercises_folder_same_team_fk foreign key (team_id, folder_id) → exercise_folders(team_id, id) on delete set null (folder_id)
- constraint exercises_duration check

### sessions
- id uuid PK, team_id uuid, title, date date, duration_minutes, notes, revision default 1, created_at, updated_at
- constraint sessions_team_id_id_unique unique(team_id, id)

### session_exercises
- id uuid PK, team_id uuid, session_id uuid, exercise_id uuid, title, duration_minutes, material, sort_order
- constraint session_exercises_session_same_team_fk foreign key (team_id, session_id) → sessions(team_id, id) on delete cascade
- constraint session_exercises_exercise_same_team_fk foreign key (team_id, exercise_id) → exercises(team_id, id) on delete set null (exercise_id)

## Helpers (esquema private, SECURITY DEFINER, set search_path='', EXECUTE concedido a authenticated, no a PUBLIC/anon)
private.is_platform_admin() → bool
private.is_approved() → bool
private.team_role(uuid) → text ('owner'|'editor'|'none')
private.is_team_owner(uuid) → bool
private.is_team_member(uuid) → bool
private.owned_team_id() → uuid
private.enforce_collaborator_limit(uuid) → void  (bloquea fila FOR UPDATE; cuenta activos no-owner + pending no caducados; si >=4 raise 'collaborator_limit_exceeded')
private.add_collaborator(uuid, uuid, text) → void  (solo editor; rechaza owner_cannot_be_collaborator, collaborator_not_approved)
private.create_invitation(uuid, text) → uuid
private.accept_invitation(uuid) → uuid
private.set_profile_status(uuid, text) → void  (solo platform admin)

Triggers: handle_auth_user (crea profile al registrar), add_owner_membership (owner en team_members al crear team), guard_folder_hierarchy (evita ciclos).

## RPC PÚBLICAS (security invoker, validadas con auth.uid(); sola superficie de mutación de membresías/aprobaciones)
public.create_my_team(p_name text, p_accent_color text default '#3056d3') → uuid   (EXECUTE a authenticated; revocado a PUBLIC/anon)
public.invite_team_member(p_team_id uuid, p_email text) → uuid
public.accept_team_invitation(p_invitation_id uuid) → uuid
public.admin_set_profile_status(p_user_id uuid, p_status text) → void

> ⚠️ NOTA: la migración 00001 hardening marcó estas RPC como SECURITY DEFINER,
> pero 00003 las devolvió a SECURITY INVOKER. Estado final: **SECURITY INVOKER**.

## RLS
- RLS activa en TODAS las tablas public.
- profiles: police select_own (user_id=auth.uid()), select_admin (is_platform_admin), update_own.
- teams: select_owner (owner o miembro), insert_owner (auth.uid()+is_approved, sin NOT EXISTS redundante tras hardening), update_owner (solo owner), delete_owner.
- team_members: select_member (miembro), select_admin. SIN escritura directa (todo por RPC).
- team_invitations: select_owner (owner o invitado aprobado), select_admin. SIN escritura directa.
- players/folders/exercises/sessions/session_exercises: select/insert/update/delete_member (miembro activo del equipo).
- Ninguna policy permite leer correos ni datos de otro equipo.

## Grants
- select en todas las tablas public a authenticated.
- insert/update/delete en players/folders/exercises/sessions/session_exercises a authenticated.
- update (name, accent_color) on teams; update (display_name) on profiles.
- RPCs públicas EXECUTE a authenticated, revocado a PUBLIC/anon.
- Helpers private EXECUTE a authenticated (concedido en 00003), schema private usage.

## Estado verificado
- Matriz RLS remota pasó (owner/editor/ajeno/pending/suspended/admin, invitaciones,
  límite 4 colaboradores, referencias entre equipos, ciclos de carpetas).
- Asesor de seguridad Supabase: 0 alertas.
- 5 migraciones aplicadas; 220 sentencias SQL válidas.
