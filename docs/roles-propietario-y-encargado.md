# Propietarios y un rol intermedio (encargado) — diseño, no implementación

> **Propuesta histórica, sustituida el 26/09/2026.** David ha descartado el rol
> encargado y aprobado copropietarios con decisiones individuales, varios equipos
> autorizados por cuenta y 7 plazas totales. El contrato vigente está en
> [copropiedad-contrato.md](copropiedad-contrato.md). Las recomendaciones y preguntas
> de este documento se conservan como antecedente; no son requisitos vigentes.

> **Estado: DISEÑO.** Aquí no hay nada implementado ni ninguna migración escrita o aplicada. Es el
> análisis de qué habría que hacer, con las decisiones que dependen del dueño marcadas como
> preguntas. La app sigue funcionando exactamente como hoy.

## 1. Qué se pide

Dos cosas que se parecen pero **son problemas distintos**:

1. **«Copropietario»**: que otra persona tenga los mismos permisos que el dueño dentro del equipo,
   sin que el dueño deje de serlo.
2. **Un rol intermedio**: algo **más que editor** pero **menos que propietario**, que pueda ver la
   gente del equipo y tocar ciertas configuraciones.

Hoy existe exactamente esto: rol `owner` o `editor`, y **nada en medio**.

## 2. Cómo está hoy (comprobado en el esquema y en las funciones)

| Pieza                        | Cómo es hoy                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles de equipo              | `team_members.role` con `check (role in ('owner','editor'))`; estados `pending_approval`, `active`, `revoked`                                                                                           |
| Propiedad                    | **Una sola columna**: `teams.owner_user_id`, `not null`, `references profiles(user_id) on delete cascade`, con `constraint teams_owner_unique unique (owner_user_id)`                                   |
| Consecuencia de esa unicidad | Un equipo tiene **un** propietario y una persona puede poseer **un solo** equipo                                                                                                                        |
| Pertenencia del propietario  | Un disparador (`teams_add_owner_membership`) **ya crea su fila** en `team_members` con `role = 'owner'`                                                                                                 |
| Quién manda en las políticas | `private.team_role(t)`: no aprobado → `none`; propietario → `owner`; administrador de plataforma → `editor`; si no, el rol de su pertenencia activa. **Es la fuente única de casi todas las políticas** |
| Permiso de propietario       | `private.is_team_owner(t)` = perfil aprobado **y** `teams.owner_user_id = auth.uid()`                                                                                                                   |
| Plazas                       | `private.enforce_collaborator_limit`: miembros activos con `role <> 'owner'` + invitaciones pendientes vigentes, máximo **6**                                                                           |
| Administrador de plataforma  | **Eje distinto**: `private.platform_admins`, ve todos los equipos como editor. No es un rol de equipo                                                                                                   |

**Dato clave para el diseño**: la tabla de pertenencias **ya tiene la forma** para varios
propietarios (guarda un rol por persona y el propietario ya aparece ahí como `owner`). Lo que ata el
modelo a un único dueño es `teams.owner_user_id` y los ayudantes que lo consultan.

### La frontera actual, sin inventar nada

| Capacidad                                          |     Propietario      |                         Editor                         |
| -------------------------------------------------- | :------------------: | :----------------------------------------------------: |
| Jugadores, carpetas, ejercicios, sesiones, pizarra |          ✅          |                           ✅                           |
| Ver la lista de personas del equipo                |          ✅          | ❌ (el servidor la niega: `forbidden: not team owner`) |
| Invitar, cancelar invitación, **enviar el correo** |          ✅          |                           ❌                           |
| Revocar a un colaborador                           |          ✅          |                           ❌                           |
| Traspasar la propiedad                             |          ✅          |                           ❌                           |
| Eliminar el equipo                                 | ✅ (o administrador) |                           ❌                           |
| Salir del equipo                                   | ❌ (antes traspasa)  |                           ✅                           |

Todo esto lo decide el **servidor**; la interfaz solo evita ofrecer lo que va a ser rechazado.

## 3. Opción A — Rol intermedio («encargado»)

**Qué es**: un tercer valor de rol que puede **gestionar personas y configuración** del equipo, pero
**no** puede traspasar la propiedad ni eliminar el equipo. Es lo que resuelve el caso real («que Pablo
vea quién hay y me ayude a gestionar, sin que yo deje de ser el dueño») con un cambio acotado.

### Capacidades propuestas

| Capacidad                                                    |     Propietario      |               **Encargado (nuevo)**               | Editor |
| ------------------------------------------------------------ | :------------------: | :-----------------------------------------------: | :----: |
| Todo el contenido (jugadores, ejercicios, sesiones, pizarra) |          ✅          |                        ✅                         |   ✅   |
| Ver la gente del equipo (nombre y correo)                    |          ✅          |                      **✅**                       |   ❌   |
| Invitar, cancelar invitación, enviar/reenviar el correo      |          ✅          |                      **✅**                       |   ❌   |
| Revocar a un colaborador                                     |          ✅          | **✅** (nunca al propietario ni a otro encargado) |   ❌   |
| Cambiar el nombre del equipo                                 |          ✅          |                      **✅**                       |   ❌   |
| Nombrar o quitar encargados                                  |          ✅          |           **❌** (solo el propietario)            |   ❌   |
| Traspasar la propiedad                                       |          ✅          |                        ❌                         |   ❌   |
| Eliminar el equipo                                           | ✅ (o administrador) |                        ❌                         |   ❌   |
| Salir del equipo                                             | ❌ (antes traspasa)  |                        ✅                         |   ✅   |

### Qué habría que tocar

1. **Base de datos** (una migración nueva, con versión superior a todas las actuales):
   - ampliar el `CHECK` de `team_members.role` a `('owner','editor','manager')` — hay que **dropear y
     recrear la restricción** (un `check` no se modifica en sitio); es instantáneo y con la
     transacción abierta;
   - `private.team_role` **no cambia**: ya devuelve el rol de la pertenencia;
   - un ayudante nuevo `private.is_team_manager(t)` = propietario **o** pertenencia activa con rol
     `manager`;
   - cambiar de `is_team_owner` a `is_team_manager` en: `private.list_team_members`,
     `private.enforce_collaborator_limit` (de ahí hereda `create_invitation`) y
     `private.prepare_invitation_email` (el envío del correo);
   - en `private.cancel_team_invitation` y `private.revoke_team_member`: permitir encargado, con
     guardas nuevas (`cannot_revoke_manager`) y las que ya existen (`cannot_revoke_owner`);
   - **dejar igual**: `transfer_team_ownership`, `delete_team`, la salida del propietario y las
     guardas de borrado de cuentas;
   - permisos (`revoke`/`grant`) de la función nueva y de las reescritas, y comprobación previa del
     catálogo antes de aplicar (regla del proyecto).
2. **Cliente**: `MemberRole` pasa a tres valores; el tipo de las filas de `team_members`; el
   `MembersComponent` deja de razonar con «¿soy propietario?» (`isOwner`) y pasa a «¿puedo
   gestionar?»; las reglas puras de `team-management.ts` (quién puede salir, quién puede traspasar) y
   sus pruebas. **La navegación no hay que tocarla para que el encargado vea «Miembros»**: la
   condición actual oculta esa entrada solo cuando el rol es exactamente `editor` (o cuando es
   editor sin ser administrador de plataforma), así que un rol nuevo ya la vería — lo que **sí**
   hay que revisar es que la pantalla no le ofrezca las acciones que el servidor le va a negar
   (traspasar, borrar el equipo, nombrar encargados).
3. **Pruebas**: unitarias de las reglas puras y del componente; el backend simulado
   (`multiuser-flow.spec.ts`) con el rol nuevo y sus guardas; **matriz SQL** con los casos de
   encargado (puede ver miembros, invitar y revocar; **no** puede traspasar ni borrar el equipo; no
   puede revocar a otro encargado; el límite de plazas lo cuenta); y comprobaciones estáticas nuevas
   en `validate-migration.mjs` (CHECK ampliado, guardas, permisos).
4. **Documentación**: esta decisión y sus límites en `docs/FASE-10-solicitud-de-equipo.md`.

**Riesgo principal y cómo se controla**: `private.team_role` es la fuente única de las políticas, así
que tocar los permisos mueve el suelo de la seguridad **de golpe**. Por eso el orden es: cambio de
servidor + matriz SQL primero, cliente después, y la matriz ejecutada contra PostgreSQL antes de
publicar.

**Coste**: contenido y sin sorpresas. Una migración, un puñado de funciones, tipos y pantalla.

## 4. Opción B — Copropiedad (varios propietarios)

Es **otra cosa**: aquí no se añade un rol, se cambia **qué significa poseer un equipo**. Todo
propietario tendría **todo** lo del propietario actual.

### El nudo: `teams.owner_user_id`

Es una columna única con unicidad, y hoy la leen muchísimas cosas. Hay que decidir qué pasa con cada
una (esto es la lista de decisiones, no de trabajo mecánico):

| Pieza que usa `owner_user_id`                                          | Qué habría que decidir                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constraint teams_owner_unique unique (owner_user_id)`                 | ¿Un copropietario puede además poseer su propio equipo? **Recomendación: no**, para no complicar el arranque de la app (hoy «equipo propio» es único)                                                                                                                                    |
| `references profiles(user_id) on delete cascade`                       | **Arista peligrosa**: si se borra el perfil del propietario que vive en esa columna, **el equipo cae con él**. Hoy no puede pasar (los borrados están bloqueados con `target_owns_team`), pero con copropietarios hay que decidir quién ocupa esa columna y mantener la guarda coherente |
| `private.is_team_owner`                                                | Pasa a consultar la **pertenencia** con rol `owner` (varios), no la columna                                                                                                                                                                                                              |
| `private.team_role`                                                    | Devuelve `owner` si la pertenencia es `owner` (hoy mira la columna) → **un solo sitio, pero es el sitio que gobierna todas las políticas**                                                                                                                                               |
| Traspaso de la propiedad                                               | ¿Cualquier propietario puede nombrar a otro? ¿Se exige que quede uno?                                                                                                                                                                                                                    |
| Eliminar el equipo                                                     | ¿Cualquier propietario, con el nombre escrito?                                                                                                                                                                                                                                           |
| Salir del equipo                                                       | Deja de ser «el propietario no puede» y pasa a ser «un propietario puede salir **si queda otro**»                                                                                                                                                                                        |
| Borrado de cuentas (`admin_delete_account`, `delete_my_admin_account`) | La guarda `target_owns_team` hoy bloquea a cualquiera que posea un equipo: con copropiedad, ¿puede darse de baja un copropietario si queda otro? ¿y el último?                                                                                                                           |
| Panel de administración (`admin_team_overview.owner_email`)            | Mostrar **todos** los propietarios, no uno                                                                                                                                                                                                                                               |
| Plazas (límite de 6)                                                   | Los propietarios ya **no** cuentan como colaboradores (`role <> 'owner'`), así que copropietarios no gastarían plaza: decidir si eso es lo que se quiere                                                                                                                                 |
| Arranque de la app (`decideAccess`)                                    | Hoy «equipo propio» es uno; con dos equipos propios hay que decidir **cuál abre** y añadir selector                                                                                                                                                                                      |

**Invariante que cambiaría** (está escrito en las reglas del proyecto): «un equipo siempre tiene al
menos un propietario». Con copropiedad se convierte en «siempre queda **al menos uno**», y todas las
operaciones que hoy protegen a ese propietario único (salir, borrar la cuenta, traspasar) tienen que
respetarlo.

**Coste**: una migración de más calado (varias funciones reescritas + la columna redefinida), cambio
de invariante, matriz SQL ampliada y decisiones de producto que solo puede tomar el dueño. No es
imposible ni mucho menos, pero **no es un interruptor**.

## 5. Lo que NO hay que hacer

- **Usar el administrador de plataforma como atajo.** Es un eje distinto (`private.platform_admins`) y
  es **global**: esa persona entra en _todos_ los equipos y puede aprobar cuentas, nombrar
  administradores y borrar equipos. Para «que Pablo me ayude con mi equipo» es demasiado, y mezclar
  los dos conceptos rompería la separación que ya está probada.
- **Autorizar por correo o por metadatos.** La lista de administradores sale de una tabla privada; un
  rol de equipo tiene que salir de `team_members`. Nunca de un correo.
- **Ocultar botones y ya.** La interfaz solo evita ofrecer lo que el servidor rechaza; la barrera son
  las funciones y RLS.
- **Tocar migraciones ya aplicadas** o renombrarlas sin revisar el orden completo (hoy ya nos mordió
  una vez: el arreglo del borrado de cuentas quedó tapado por una migración posterior).
- **Inventar el rol en el cliente antes que en el servidor**: si la base no lo acepta, la pantalla
  estaría mintiendo.

## 6. Plan recomendado, por fases

**Fase 1 — Encargado** (resuelve el 90 % del caso con un riesgo controlado)

1. Decidir la tabla de capacidades de §3 (son tus respuestas a §7).
2. Migración nueva + comprobación previa del catálogo; **no** se toca ninguna migración aplicada.
3. Comprobaciones estáticas nuevas en el validador (que el `CHECK` incluya `manager`, que el encargado
   no pueda traspasar ni borrar el equipo, que no pueda revocar a otro encargado, que las plazas lo
   cuenten) y **probarlas rompiendo el SQL a propósito**.
4. Casos nuevos en la matriz `supabase/tests/entrenolab_rls.sql` y **ejecutarla contra PostgreSQL**
   con `ROLLBACK`.
5. Cliente: tipos, reglas puras, pantalla de Miembros y navegación, con pruebas unitarias.
6. E2E de contrato visible: un encargado ve la gestión, un editor no; nada destructivo nuevo.
7. Documentación y puertas completas (unitarias, validador, E2E, build, Pages).

**Fase 2 — Copropiedad** (solo si de verdad hace falta tener dos propietarios)

1. Responder las decisiones de §4 (columna, unicidad, traspaso, borrado, bajas, equipo por defecto).
2. Migración con las funciones reescritas y `private.team_role` como único punto de cambio de
   políticas, con la matriz SQL delante.
3. Cambio de invariante documentado y probado: «queda al menos un propietario».
4. Cliente: selector de equipo cuando haya más de uno propio, y auditoría visible (quién es
   propietario).

Se puede hacer **solo la Fase 1** y quedarse ahí: cubre «ver la gente y gestionar» sin abrir la caja
de la propiedad. La Fase 2 no es un requisito para la 1.

## 7. Decisiones que necesito del dueño

Con mi recomendación entre paréntesis, para que puedas contestar en una línea cada una:

1. ¿Hacemos **primero el encargado** y dejamos la copropiedad para después? (**sí**)
2. ¿El encargado puede **invitar, cancelar invitaciones, enviar el correo y revocar** colaboradores?
   (**sí**, no revocar a otro encargado ni al propietario)
3. ¿Puede **cambiar el nombre del equipo**? (**sí**: es configuración, no permisos)
4. ¿Puede **nombrar a otro encargado**? (**no**: eso es reparto de poder, y para eso ya estás tú)
5. ¿El encargado **ocupa plaza** de las 6 del equipo? (**sí**, es un colaborador más con más permisos)
6. ¿Cómo se llama en la pantalla: **«Encargado»**, «Administrador del equipo», «Coordinador»?
   (**«Encargado»**)
7. ¿Cuántos encargados como máximo? (**sin límite propio**: lo limita el número de plazas)
8. Copropiedad, solo si la quieres: ¿cuántos propietarios, puede un copropietario poseer además su
   propio equipo (**no**), quién puede eliminar el equipo (**cualquier propietario, con el nombre
   escrito**), y qué pasa cuando un copropietario borra su cuenta (**puede, si queda otro**).

## 8. Qué haría yo en cuanto contestes

Con la Fase 1 aprobada, el orden sería: escribir la migración y sus comprobaciones de catálogo →
ampliar el validador y **comprobar que las comprobaciones nuevas fallan con el SQL roto** → ampliar la
matriz y ejecutarla contra PostgreSQL con `ROLLBACK` → cambiar el cliente y sus pruebas → E2E de
contrato → documentar y pasar todas las puertas. Nada se publica hasta que la matriz pase contra la
base real, y la migración no se declara aplicada hasta que esté aplicada.

Ficheros que tocaría, para que sepas el alcance: una migración nueva en `supabase/migrations/`, los
tipos y reglas de `src/app/core/` (`repositories/data-source.ts`, `database.types.ts`,
`team-management.ts`, `access.service.ts`), la pantalla `members.component.*` y la navegación
(`app.ts`), más `scripts/validate-migration.mjs`, `supabase/tests/entrenolab_rls.sql` y
`docs/FASE-10-solicitud-de-equipo.md`.
