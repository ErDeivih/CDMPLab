# Copropiedad — contrato aprobado y comprobación del estado

Fecha: 26/09/2026. Estado: **pendiente de implementación y despliegue**.

## Decisiones de David

- No habrá rol «encargado»: habrá propietarios y colaboradores.
- Cada propietario puede decidir por sí solo: gestionar contenido, invitar,
  cancelar, revocar, nombrar/quitar propietarios y borrar el equipo con confirmación.
- Siempre debe quedar al menos un propietario. Dos bajas simultáneas no pueden
  dejar el equipo sin ninguno.
- Una cuenta puede ser propietaria de varios equipos. Cada creación requiere
  autorización de administración de plataforma; aprobar la cuenta no autoriza
  por sí solo a crear equipos.
- Máximo **7 cuentas por equipo**, incluidos propietarios y colaboradores.
  Las invitaciones pendientes vigentes reservan plaza; las caducadas no.
- Administrador de plataforma y propietario son permisos independientes. El
  administrador puede entrar en todos los equipos, sin consumir una plaza salvo
  que además sea miembro. Los administradores no pueden borrar las cuentas de
  otros administradores; la baja propia conserva la protección del último admin.

## Catálogo real consultado antes de diseñar cambios

Proyecto `vgwfjkhvzprsoixpzruq`, consulta de solo lectura del 26/09/2026 sobre
`pg_proc`, `pg_constraint`, `pg_trigger` y `pg_policies`:

| Objeto                               | Resultado real                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `teams_owner_unique`                 | `UNIQUE (owner_user_id)`                                                                   |
| `teams_owner_user_id_fkey`           | `REFERENCES profiles(user_id) ON DELETE CASCADE`                                           |
| `team_members_role_check`            | Solo `owner` y `editor`                                                                    |
| `teams_add_owner_membership`         | Tras INSERT crea la pertenencia owner                                                      |
| `private.is_team_owner`              | Comprueba `teams.owner_user_id = auth.uid()`                                               |
| `private.team_role`                  | Primero owner por columna; después acceso global de admin como editor; después pertenencia |
| `teams_update_owner`                 | WITH CHECK exige que owner_user_id sea el usuario actual                                   |
| `private.enforce_collaborator_limit` | Excluye owners del contador y limita a 6                                                   |
| `private.accept_invitation`          | Bloquea invitación; hace upsert editor, incluso si existía otra pertenencia                |
| `public.admin_decide_team_request`   | Reutiliza el equipo ya poseído, no crea un segundo                                         |
| `public.create_my_team`              | Solo admin; ON CONFLICT(owner_user_id) reutiliza equipo                                    |
| `private.request_team_creation`      | Rechaza a quien ya posea equipo                                                            |
| `public.admin_delete_account`        | Rechaza borrar al propietario de la columna y revoca invitaciones por invited_user_id      |
| `public.delete_my_admin_account`     | Rechaza al propietario de la columna; exige otro admin                                     |

El cliente también presupone unicidad: `resolveAccess()` usa `maybeSingle()` para
el equipo propio. El selector actual no ofrece un catálogo remoto de todas las
pertenencias del usuario. Ninguna de estas constataciones significa que la
copropiedad esté implementada.

## Cambios que deben viajar juntos

1. Propiedad basada en pertenencias activas owner, no en un propietario único.
   Si se conserva `owner_user_id` como referencia de compatibilidad, no será la
   fuente de autorización; deberá reasignarse al abandonar su titular.
2. Eliminar la unicidad por cuenta y la cascada peligrosa desde perfil a equipo.
   Una baja de cuenta nunca borrará los datos compartidos de un equipo.
3. Promoción, degradación, revocación, salida, traspaso y borrado de cuentas:
   autorización reevaluada tras bloqueo, mismo orden de bloqueos y protección
   del último propietario. Contemplar también suspensión del último propietario.
4. Capacidad de 7 con reserva de invitaciones. Promover/degradar no consume otra
   plaza. Aceptar una invitación antigua nunca rebaja a un propietario a editor.
5. Una aprobación crea un equipo por solicitud, idempotente por solicitud, no
   por propietario. Mantener una sola solicitud pendiente por cuenta y cerrar
   el INSERT directo como vía alternativa.
6. Selector remoto de equipos accesibles, rol real por equipo, memoria por cuenta
   del equipo elegido y recuperación si el acceso desaparece. No descargar todos
   los ejercicios de todos los equipos para construir el selector.
7. No cambiar de equipo con escrituras pendientes ni descartar borradores. La
   vuelta tras salir, aceptar invitación o borrar un equipo debe resolver otro
   equipo disponible, no asumir que el usuario se ha quedado sin equipo.
8. Miembros y administración muestran todos los propietarios; confirmaciones
   claras de pérdida de permisos y borrado. Las vistas previas de bajas deben
   explicar todos los equipos afectados, no solo uno.

## Matriz de aceptación antes de activar

- Propietario A promueve a B, ambos mantienen gestión; editor C no puede hacerlo.
- B renombra, invita, cancela y gestiona roles sin aprobación adicional de A.
- Dos propietarios que intentan salir/revocarse simultáneamente: queda uno.
- Último propietario no sale, se degrada ni se elimina sin sustituto.
- Baja de un copropietario con sustituto conserva equipo, ejercicios y carpetas.
- Administradores protegidos entre sí; baja propia no elimina al último admin.
- Siete plazas con distintas combinaciones de owners/editors; octava rechazada.
- Dos invitaciones para la última plaza: solo una reserva tiene éxito.
- Invitación caducada, revocada, repetida, aceptada dos veces y cambio de rol
  concurrente no alteran indebidamente permisos ni capacidad.
- Dos equipos propios autorizados; selector, recarga y borradores aislados.
- Doble aprobación de una solicitud crea un solo equipo; una segunda solicitud
  aprobada crea otro; usuario sin autorización no crea por RPC ni INSERT.
- RLS niega contenido y gestión de equipo ajeno a un usuario normal.
- Admin global entra en todos los equipos sin confundirse con propietario.
- Instalación limpia y actualización del proyecto existente producen el mismo
  catálogo final; conservar el orden de la corrección `20260930000000`.

Las pruebas simuladas no sustituyen a la matriz en PostgreSQL. Ejecutar casos
con datos sintéticos y ROLLBACK; probar concurrencia con sesiones independientes.
No afirmar envío recibido por tener `provider_accepted`.
