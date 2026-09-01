# Bootstrap de autenticación real (EntrenoLab)

Este documento describe el procedimiento para activar el flujo real de registro y
colaboración. **No se ejecuta aquí** y **no incluye correos ni identificadores reales
versionados**: los E2E que lo prueben deben leerlos de variables locales ignoradas por git.

Cuentas de prueba que David registrará manualmente con contraseñas privadas (no se
comparten por aquí):

- Administrador (propietario): `davidpeve01@gmail.com`
- Usuario colaborador: `davidpv2001@gmail.com`

## Procedimiento (paso a paso)

1. **Desplegar la aplicación** (build de producción + hosting con Supabase Auth configurado).
2. David **registra** `davidpeve01@gmail.com` desde la app.
3. Abre el **correo de confirmación** (lo envía Supabase Auth).

   > EntrenoLab **no** envía correo de bienvenida/invitación personalizado. El registro y la
   > recuperación de contraseña los gestiona Supabase Auth.

4. **Localizar su `user_id` real** (consulta de diagnóstico read-only, ver abajo).
5. **Aprobar su perfil** (`profiles.status = 'approved'`).
6. Introducir ese `user_id` en `private.platform_admins` (tabla privada usada solo desde
   funciones `SECURITY DEFINER`; no lleva políticas públicas por diseño).
7. Cerrar sesión y volver a entrar.
8. Crear el **primer equipo**.
9. David **registra y confirma** `davidpv2001@gmail.com`.
10. El administrador **aprueba** la segunda cuenta.
11. El propietario **crea la invitación** para el segundo correo (se crea un registro; la
    persona debe registrarse con ese correo y aceptar la invitación pendiente).
12. El segundo usuario **acepta** la invitación.
13. Probar **lectura, escritura, revocación y límite de 4 colaboradores**.
14. Probar **recuperación de contraseña** (Supabase Auth).

## Precondición: nada de correos reales en tests versionados

Los E2E deben leer la configuración de cuentas de prueba desde variables de entorno
**ignoradas por git** (`.env.local`, no versionada). No se versiona ningún correo ni id real.

## Consultas de diagnóstico (read-only)

Solo lectura; no modifican datos. Se ejecutan con un rol con acceso de lectura al catálogo.

```sql
-- Perfiles y estado de aprobación
select id, email, status, created_at
from public.profiles
order by created_at;

-- Equipos existentes
select id, name, owner_id, created_at
from public.teams
order by created_at;

-- Invitaciones pendientes
select id, team_id, email_normalized, status, created_at
from public.team_invitations
order by created_at;

-- Miembros de cada equipo
select tm.team_id, t.name, tm.user_id, tm.role, tm.created_at
from public.team_members tm
join public.teams t on t.id = tm.team_id
order by tm.team_id, tm.role;

-- Administradores de plataforma (tabla privada)
select * from private.platform_admins;
```

> Nota: estas consultas son de diagnóstico. **No** se inserta ningún administrador ni se
> modifican perfiles hasta que las cuentas existan realmente.

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
