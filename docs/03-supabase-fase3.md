# EntrenoLab — Fase 3: Esquema Supabase (nuevo planteamiento, v2)

> Proyecto real: `vgwfjkhvzprsoixpzruq` · región eu-west-1 · PostgreSQL 17.
> Autenticación **solo correo/contraseña** (sin Google). Despliegue inicial gratuito.

## Estado de verificación del catálogo remoto

La verificación del catálogo en esta sesión **no se ha podido ejecutar**: no hay
herramienta MCP llamable (sin `execute_sql`/`get_advisors`/`apply_migration`), el
CLI `supabase` no está autenticado (`Access token not provided`) y no existe
`EntrenoLab/.env` ni `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_URL`. No se ha usado Docker.

Estado remoto **reportado por el usuario** (fecha 27/08/2026), a re-verificar antes
de aplicar:

| Consulta | Valor esperado |
|---|---|
| Proyecto | `ACTIVE_HEALTHY` |
| Región | eu-west-1 |
| PostgreSQL | 17 |
| `public` tablas | 0 |
| `private` tablas | 0 |
| Migraciones | 0 |
| Funciones propias | 0 |
| Índices propios | 0 |
| Advisors seguridad | 0 avisos |
| Advisors rendimiento | 0 avisos |

> **Regla**: antes de aplicar la migración hay que volver a consultar
> `pg_class`/`pg_index`/`pg_proc` y pegar aquí el resultado real.

## Migración

Archivo: [`supabase/migrations/20260827000000_entrenolab_schema.sql`](../supabase/migrations/20260827000000_entrenolab_schema.sql)

**Estado: DISEÑADA — sintaxis SQL VALIDADA, pero NO aplicada.** La migración se ha
parseado correctamente con `libpg-query` (gramática de PostgreSQL): **170 statements,
0 errores de sintaxis** (ver `scripts/validate-migration.mjs`). Aún **no se ha
ejecutado contra ninguna base**, por lo que sigue requiriendo verificación del
catálogo y aplicación con el flujo oficial antes de usarse en producción.

### Tablas creadas

| Tabla | Esquema | Notas |
|---|---|---|
| `profiles` | public | `user_id` PK→`auth.users`; `status` pending/approved/rejected/suspended; `approved_at`, `approved_by`, `email_normalized` |
| `platform_admins` | **private** | no expuesto; `user_id` PK→`auth.users`; se inserta manualmente por UUID |
| `teams` | public | `owner_user_id`→profiles, **UNIQUE** (máx. 1 equipo propio); `name`, `accent_color` |
| `team_members` | public | PK(`team_id`,`user_id`); `role` owner/editor; `status` pending_approval/active/revoked |
| `team_invitations` | public | `email_normalized`, `status`, `expires_at`; índice único parcial (1 pendiente por correo+equipo) |
| `players` | public | `team_id`, nombre, dorsal, posición, color, activo |
| `exercise_folders` | public | `team_id`, `parent_id` (mismo equipo garantizado por RLS) |
| `exercises` | public | `canvas_data` jsonb (canvas), `revision` int (concurrencia optimista), inputs |
| `sessions` | public | `revision` int, notas, fecha |
| `session_exercises` | public | vínculo sesión↔ejercicio con RLS que exige mismo equipo |

### Diseño clave

- **Aprobación manual separada** de la confirmación de correo: `profiles.status`.
  `pending` (tras confirmar el correo) → `approved` (David aprueba) → acceso.
- **Máx. 1 equipo propio** por usuario: `UNIQUE(owner_user_id)` + RLS `teams_insert_owner`.
- **Límite de colaboradores (≤4, el propietario no cuenta)**: función transaccional
  `private.enforce_collaborator_limit` (bloquea la fila con `FOR UPDATE`, cuenta
  activos no-owner + pendientes no caducados, rechaza el quinto). Se invoca desde
  `private.add_collaborator` y `private.create_invitation`.
- **Helpers privilegiados** en `private` (no expuesto): `is_platform_admin`,
  `is_approved`, `team_role`, `is_team_owner`, `is_team_member`, `owned_team_id`,
  `enforce_collaborator_limit`, `add_collaborator`, `create_invitation`.
  Todos `SECURITY DEFINER` con `set search_path = ''` y EXECUTE revocado a PUBLIC/anon.
- **RLS** activada en todas las tablas expuestas. Autorización real con `auth.uid()`
  (nunca `user_metadata`). UPDATE con `USING` y `WITH CHECK`. Solo el propietario
  gestiona miembros/invitaciones. Solo `platform_admin` aprueba/suspende/revoca.
  `profiles` sin `using(true)`.

### Integridad de equipo entre tablas hijas

Carpetas/ejercicios/sesiones exigen `team_id` y su RLS comprueba que el usuario sea
miembro de ese equipo. El vínculo `session_exercises` comprueba que la sesión sea del
equipo del usuario mediante subconsulta (implica mismo equipo porque la política de
`sessions` ya exige pertenencia al equipo).

### Nota post-migración (no forma parte del esquema)

Designar al primer administrador (después de que David se registre):

```sql
insert into private.platform_admins (user_id) values ('<UUID de David tras registrarse>');
```

Nunca hardcodear el correo de David en el frontend. El UUID se obtiene de `auth.users`.

### Pendiente de verificación (lo hará la comprobación externa)

1. Validar sintaxis SQL y aplicarla con el flujo oficial.
2. Re-consultar catálogo real y pegar el volcado aquí.
3. Ejecutar advisors de seguridad y rendimiento, corregir avisos.
4. Probar RLS con propietario/editor/ajeno/pending/suspended/admin.
5. Comprobar que el 5º colaborador se rechaza concurrentemente.
6. Generar tipos TypeScript desde el proyecto.
