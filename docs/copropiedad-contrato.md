# Copropiedad — contrato aprobado y comprobación del estado

Fecha: 26/09/2026. Estado: **implementada; migración aplicada y verificada en remoto**.

## Implementación y comprobaciones de esta ronda

- `team_members.role='owner'` es la autoridad de propiedad; `teams.owner_user_id`
  queda como referencia compatible, reasignada al salir su titular.
- Eliminada la unicidad por propietario y sustituida la cascada de borrado de cuenta
  por `RESTRICT`. Borrar una cuenta copropietaria conserva el equipo y su contenido.
- Las operaciones de gestión toman un bloqueo transaccional compartido entre ellas
  antes de comprobar permisos/plazas. No bloquea lecturas ni las ediciones de ejercicios.
  Es global deliberadamente: prioriza corrección en operaciones poco frecuentes;
  si el volumen crece, medir contención antes de sustituirlo por bloqueos por equipo.
- La promoción conserva el rol del actor; el traspaso es otra acción, con otra
  confirmación. Todos los propietarios pueden decidir solos. Siempre queda al menos
  uno activo con perfil aprobado, también al suspender o borrar una cuenta.
- El selector obtiene equipos y roles de `my_accessible_teams()`, sin inferirlos
  del propietario heredado. Protege escrituras pendientes y el guard de borradores;
  descarta una respuesta si la sesión se cerró durante la carga.
- Miembros cuenta las siete plazas totales. Botones de permisos de 44px;
  corregida la base flex que se convertía en 240px de altura en móvil.
- La solicitud de otro equipo no saca al usuario de su equipo actual. Cada solicitud
  aprobada crea un equipo independiente, sin crear duplicados al reintentar la aprobación.

Comprobación real antes/después en Supabase: **1 equipo, 5 miembros activos,
1 propietario, 11 ejercicios, 8 carpetas, 0 sesiones**. No se modificaron las
pertenencias reales. Las pruebas terminaron con `ROLLBACK`; fixtures restantes: **0**.

`supabase/tests/coownership.sql` y la matriz `entrenolab_rls.sql` pasaron tanto
en PostgreSQL 16 aislado como en Supabase remoto. Incluyen creación aprobada de varios
equipos, aislamiento RLS, promoción, degradación, último propietario, cuenta compartida,
conservación del canvas, siete plazas y borrado explícito de equipo.
`scripts/test-coownership-concurrency.mjs` probó dos conexiones locales reales:
una sola obtiene la última plaza y una sola puede abandonar cuando quedan dos propietarios.

`npm run test:postgres` reconstruye desde cero **todas** las migraciones y ejecuta
las dos matrices y la concurrencia en un contenedor efímero sin puertos públicos.
Está incorporado al CI. `local-auth-bootstrap.sql` emula solo la interfaz de Auth
necesaria para estas pruebas; **no** se aplica a Supabase.

Pruebas de interfaz: `copropiedad-ui.spec.ts` usa el componente real con respuestas
simuladas para comprobar confirmaciones y tamaños en 390/1366px. Sus capturas fueron
inspeccionadas visualmente; esta prueba no se presenta como prueba de autorización remota.

Registro remoto: `20260926131555 / team_coownership`. El fichero local mantiene
`20260930000001_team_coownership.sql` para ganar a las definiciones anteriores en un
arranque limpio. **No renombrarlo a la versión remota**, que invertiría ese orden.
La reconciliación del historial CLI debe preservar este orden, no hacer `db push`
indiscriminadamente contra el historial histórico divergente.

Puertas de esta ronda: **680 unitarias**, **155 E2E dirigidas** (cuentas, solicitud,
copropiedad, shell, accesibilidad, móvil, biblioteca y persistencia). La suite E2E
completa no se repitió en esta ronda. PostgreSQL aislado (migraciones desde cero,
matrices y dos conexiones concurrentes) y ambas matrices remotas: exit/success correcto.
Lint, formato, tipos E2E y codificación sin deuda nueva. No se ha probado en esta ronda
la entrega de correo a un buzón real ni se ha cambiado la configuración de Brevo.
Paquete final de producción: **10 E2E**; artefacto GitHub Pages: **14 E2E**,
ambos compilados y probados correctamente tras el último cambio de código.

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
