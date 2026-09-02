# Bootstrap de autenticación real (CDMPLab)

> **Estado:** el esquema y la migración remota de endurecimiento están aplicados y
> verificados. Este documento describe lo que aún falta para activar el flujo real de
> registro y colaboración: configuración de Auth/SMTP y cuentas humanas. No contiene
> correos, identificadores ni claves reales versionados. Los pasos marcados como
> **[NO EJECUTADO]** requieren intervención humana.

Cuentas de prueba que David registrará manualmente con contraseñas privadas (no se
comparten por aquí, y la suite E2E opt-in las lee de variables de entorno ignoradas
por git — ver `docs/supabase-real-e2e.md`). Los correos reales **no** se versionan:
se indican como marcadores que hay que sustituir por valores locales o del gestor
de secretos.

- Administrador (propietario): `<ADMIN_EMAIL>`
- Usuario colaborador: `<COLLABORATOR_EMAIL>`

## Esquema real (columnas correctas)

> Verificado contra `supabase/migrations/20260827000000_entrenolab_schema.sql`.
> **No** uses `id` ni `owner_id` en consultas de diagnóstico: esas columnas no existen.

| Tabla | Columna de identidad | Nota |
|---|---|---|
| `public.profiles` | **`user_id`** (PK, referencia a `auth.users.id`) | `id` **no** existe. Tiene `display_name`, `email_normalized`, `status`. |
| `public.teams` | **`owner_user_id`** (referencia a `public.profiles(user_id)`) | `owner_id` **no** existe. Tiene `name`, `accent_color`. |
| `public.team_members` | `(team_id, user_id)` | `role`, `status`, `invited_by`. |
| `public.team_invitations` | `id` | `email_normalized`, `invited_user_id`, `invited_by`, `status`. |
| `private.platform_admins` | **`user_id`** (PK, referencia a `auth.users.id`) | Esquema **privado**; solo accesible desde funciones `SECURITY DEFINER`. |

## Procedimiento (paso a paso)

1. **[CONFIG] Configurar Supabase Auth (no ejecutado aquí).** En Auth → URL
   Configuration: fijar la **Site URL** de producción y **añadir las Redirect URLs**
   (por ejemplo `https://<org>.github.io/CDMPLab/**` y `http://localhost:4200/**`).
   Activar el **SMTP** (provider de correo) para que lleguen confirmaciones y
   recuperaciones. Sin esto, Supabase Auth no envía correos.
2. **[CÓDIGO] Desplegar la aplicación** (build de producción + hosting con Supabase
   Auth configurado). La build de GitHub Pages (ver `README`) se despliega con la
   configuración de pestaña C en modo `production`.
3. **[NO EJECUTADO] El administrador registra `<ADMIN_EMAIL>`** desde la app
   (`/auth/register`).
4. **[NO EJECUTADO] Confirma el correo** — lo envía Supabase Auth. CDMPLab **no**
   envía correo de bienvenida/invitación personalizado; el registro y la
   recuperación los gestiona Supabase Auth.
5. **[NO EJECUTADO] Localizar su `user_id` real** (consulta de diagnóstico
   read-only, ver abajo): es el `user_id` de `public.profiles`, **no** un `id`.
6. **[NO EJECUTADO] Aprobar su perfil** (`public.profiles.status = 'approved'`).
7. **[NO EJECUTADO] Insertar ese `user_id` en `private.platform_admins`** (tabla
   privada usada solo desde funciones `SECURITY DEFINER`; no lleva políticas
   públicas por diseño).
8. **[NO EJECUTADO] Cerrar sesión y volver a entrar** (el perfil aprobado + la
   pertenencia a `private.platform_admins` habilitan el panel `/admin`).
9. **[NO EJECUTADO] Crear el primer equipo** (propietario → hasta 4 colaboradores).
10. **[NO EJECUTADO] El colaborador registra y confirma `<COLLABORATOR_EMAIL>`** y el
    administrador lo aprueba.
11. **[NO EJECUTADO] El propietario crea la invitación** para el segundo correo (se
    crea un registro; la persona debe registrarse con ese correo y luego aceptar).
12. **[NO EJECUTADO] El segundo usuario acepta la invitación** y pasa a trabajar
    como editor del equipo.
13. **[NO EJECUTADO] Probar lectura, escritura, revocación y límite de 4
    colaboradores.**
14. **[NO EJECUTADO] Probar recuperación de contraseña** (Supabase Auth).

> Resumen: los pasos **1–2** son configuración/despliegue y **no** se han ejecutado
> aquí; los pasos **3–14** dependen del proyecto real y quedan **pendientes de
> ejecución por David** (no forman parte de la auditoría local).

## Precondición: nada de correos reales en tests versionados

Los E2E deben leer la configuración de cuentas de prueba desde variables de entorno
**ignoradas por git** (`.env.local`, no versionada). No se versiona ningún correo ni
id real. La suite opt-in `npm run test:e2e:supabase-real` está documentada en
`docs/supabase-real-e2e.md` y se omite (sin falso pase) si faltan variables.

## Consultas de diagnóstico (read-only)

Solo lectura; no modifican datos. Se ejecutan con un rol con acceso de lectura al
catálogo. Usa siempre la columna correcta (`user_id`, `owner_user_id`).

```sql
-- Perfiles y estado de aprobación
select user_id, display_name, email_normalized, status, created_at
from public.profiles
order by created_at;

-- Equipos existentes
select id, owner_user_id, name, accent_color, created_at
from public.teams
order by created_at;

-- Invitaciones pendientes
select id, team_id, email_normalized, status, created_at
from public.team_invitations
order by created_at;

-- Miembros de cada equipo
select tm.team_id, t.name, tm.user_id, tm.role, tm.status, tm.created_at
from public.team_members tm
join public.teams t on t.id = tm.team_id
order by tm.team_id, tm.role;

-- Administradores de plataforma (tabla privada; solo rol con privilegio)
select * from private.platform_admins;
```

> Nota: estas consultas son de diagnóstico. **No** se inserta ningún administrador
> ni se modifican perfiles hasta que las cuentas existan realmente.

## ⚠️ Rotación de la clave secreta compartida

Durante el desarrollo se compartió **fuera del gestor de secretos** la clave
**Service Role / secret key** del proyecto Supabase (por ejemplo, en chat). Aunque
esta clave **no** está versionada en el repositorio, al haber salido del gestor debe
considerarse **comprometida**.

- **Acción requerida:** **rotar** la clave Service Role / secret key en el panel de
  Supabase (Settings → API → regenerate) **antes** de cualquier despliegue público.
- La clave nueva **solo** debe guardarse en el gestor de secretos (GitHub Actions
  secrets, `.env` local ignorado, etc.). **Nunca** se escribe en el repositorio, en
  este documento ni en ningún artefacto.
- El frontend **solo** usa la clave **publishable/anon** (pública por diseño). La
  Service Role **jamás** va al navegador.

> Por seguridad, la clave rotada **no** se reproduce en este documento.

## Verificación tras el bootstrap

- Un perfil `pending` **no** accede a datos.
- El admin de plataforma puede aprobar/rechazar.
- Cada propietario crea **un** equipo; como máximo **4 colaboradores**.
- Un invitado aprobado acepta la invitación dirigida a su correo.
- Un editor trabaja con jugadores/ejercicios del equipo pero **no** gestiona miembros ni invita.
- Revocar elimina de inmediato lectura y escritura.
- Un usuario externo no lee ni modifica otro equipo.
- Un conflicto de revisión nunca sobrescribe silenciosamente.
- Ninguna **Secret/Service Role** aparece en frontend, repo, logs, capturas ni artefactos.
