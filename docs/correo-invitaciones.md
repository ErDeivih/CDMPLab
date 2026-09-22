# Correo de invitación a un equipo — qué se ha implementado y qué NO está verificado

> **Actualización 21/09/2026.** Las RPC y sus permisos ya se probaron en el proyecto real
> mediante `supabase/tests/entrenolab_rls.sql` (transacción revertida). La Edge Function
> `invite-team-member` está desplegada (versión 3) con verificación JWT; una petición anónima
> devolvió HTTP 401. La falta de credencial de registro se rechaza antes de abrir intento o enviar.
> **No se ha enviado correo real:** faltan proveedor transaccional, dominio y secretos.
> Las frases posteriores sobre «no aplicada» o «no desplegada» describen la ronda anterior.

> Encargo: _«Añadir el envío REAL del correo de invitación desde una función de servidor, con
> estados distinguibles, reintento sin duplicados ni spam y sin exponer secretos en el
> navegador»_. Este documento describe lo que hay en el repositorio y, en su última sección,
> todo lo que **no** se ha podido comprobar. La otra mitad del trabajo (SQL y cliente) se
> escribe en paralelo; aquí se cita lo que ya está en el árbol, con la fecha de esta ronda.

## Alcance: qué está verificado y qué no

| Parte                                                                                      | Estado en esta ronda                                                                                                                |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Módulo puro del correo (configuración, enlace, plantilla, proveedor, redacción de errores) | **Verificado localmente** con la puerta `node scripts/validate-invite-email.mjs` (35 comprobaciones, importa el `.ts` real)         |
| Edge Function (orden de llamadas, RPC, secretos y logs)                                    | Desplegada con JWT obligatorio; petición anónima rechazada (HTTP 401). Envío autenticado pendiente de proveedor                     |
| RPC `prepare_invitation_email` / `record_invitation_email_result`                          | Verificadas contra PostgreSQL real por la matriz RLS con `ROLLBACK`                                                                 |
| Estados del envío en `team_invitations.email_status`                                       | Aplicados en remoto y probados con la matriz RLS                                                                                    |
| Cliente (pantalla de miembros, textos en español, botón de reenvío)                        | **Ya escrito en paralelo** (`src/app/core/invite-email.ts`, `members.component.*`); solo se ha **leído** para comprobar el contrato |
| **Envío real de un correo, entrega, rebotes, spam**                                        | **PENDIENTE**: no hay proveedor, ni credenciales, ni dominio verificado. No se ha enviado ni un correo                              |

## 1. Qué se ha construido

Tres piezas, y ninguna más:

1. **`supabase/functions/_shared/invite-email.ts`** — módulo **puro**, sin una sola dependencia
   y solo con sintaxis TypeScript borrable. Contiene todo lo comprobable sin red: leer y
   validar la configuración, validar y componer el enlace, escapar HTML, renderizar el mensaje,
   construir la petición HTTP del proveedor, traducir su respuesta y redactar credenciales de
   cualquier texto de error. Al ser puro, la puerta de validación lo **importa tal cual** con
   Node (type-stripping, sin transpilar): se prueba el código que se despliega, no una copia.
2. **`supabase/functions/invite-team-member/index.ts`** — el punto de entrada en Deno. Es el
   único fichero que usa `Deno.serve` y el único que importa `@supabase/supabase-js`. Orquesta:
   validar la petición, delegar la autorización en Postgres, preparar el envío, enviar y
   registrar el resultado.
3. **`scripts/validate-invite-email.mjs`** — la puerta: 35 comprobaciones de comportamiento real
   del módulo puro más análisis estático de la función. Se ejecuta con
   `npm run validate:invite-email` (añadido a `package.json` al cerrar el encargo) y está
   enlazada también en el `README.md` de la función.

No se ha tocado ni el SQL, ni el cliente: los escribió la otra mitad del encargo
(la migración `20260922000000_team_creation_requests.sql` y los ficheros de `src/app/core/` y
`src/app/features/auth/`), y aquí solo se han **leído** para comprobar el contrato.

## 2. Cómo fluye una invitación (quién llama a qué)

```
Propietario (navegador)
   │  pulsa «enviar invitación» en la pantalla de miembros
   ▼
SupabaseService.sendInvitationEmail(invitationId)          ← src/app/core/supabase.service.ts
   │  functions.invoke('invite-team-member', { body: { invitationId } })
   │  (supabase-js añade la cabecera Authorization con el JWT del propietario)
   ▼
Edge Function invite-team-member (Deno)                    ← supabase/functions/invite-team-member/index.ts
   │  1. solo POST; cuerpo { invitationId } con forma de uuid
   │  2. exige Authorization (sin ella → unauthorized)
   │  3. lee las 6 variables de correo; si falta alguna → not_configured SIN tocar la base
   │  4. cliente Supabase con la clave anon + el JWT del llamante (nunca la clave de servicio)
   ▼
Postgres  public.prepare_invitation_email(p_invitation_id)  ← SECURITY DEFINER
   │  comprueba auth.uid(), que quien llama es el PROPIETARIO del equipo
   │  (private.is_team_owner), que la invitación está `pending` y no caducada;
   │  aplica el cooldown de 60 s y el tope de 5 intentos; incrementa `email_attempts`;
   │  marca `send_pending`; devuelve jsonb
   │  { invitation_id, team_id, team_name, email, link_path, attempt_id }
   ▼
Edge Function: buildInviteLink(config.linkBase, link_path) → renderInviteEmail(...)
   │  POST HTTPS al proveedor (Resend o Postmark) con la clave en la CABECERA
   ▼
mapProviderResponse(kind, httpStatus, body)
   │
   ├── aceptado (200/201 Resend, 200 Postmark) → record_invitation_email_result(attempt_id, 'provider_accepted', id)
   └── cualquier otro código o fallo de red  → record_invitation_email_result(attempt_id, 'send_error', motivo redactado)
   ▼
Respuesta { ok, status, message }  →  el cliente muestra el texto en español
```

**El registro del resultado lo hace el SERVIDOR con la credencial de servicio**
(`SUPABASE_SERVICE_ROLE_KEY`, que la plataforma inyecta en las Edge Functions alojadas y que
**nunca** llega al navegador). Es un cambio de contrato del 22/09/2026, tras la revisión del
dueño: antes `record_invitation_email_result` estaba concedida a `authenticated` y solo
comprobaba que quien llamaba fuera el propietario del equipo, así que **un propietario podía
falsificar un `provider_accepted`** (y el identificador del proveedor) con una llamada directa a
la RPC, sin enviar ningún correo. Ahora:

- `revoke execute … from public, anon, authenticated` + `grant execute … to service_role`: al
  navegador le responde `permission denied for function record_invitation_email_result`;
- el resultado va **vinculado al intento** (`p_attempt_id`): `prepare_invitation_email` abre un
  intento nuevo con `email_attempt_id = gen_random_uuid()` en cada envío y lo devuelve como
  `attempt_id`. Si llega el resultado de un intento anterior, la RPC responde
  `stale_email_attempt` y **no toca el estado del intento vigente**;
- el propietario sigue siendo quien **pide** el envío (la autorización de
  `prepare_invitation_email` no cambia) y el tope de 5 intentos sigue en el servidor.

Si falta la credencial de servicio, la función responde `server_misconfigured` **antes** de
preparar el intento o contactar al proveedor: no consume intentos ni envía un correo cuyo
resultado no podría registrar.

Detalles que importan del recorrido:

- **La invitación ya existía**: la crea la RPC `invite_team_member` (contrato intacto). Este
  flujo **no crea invitaciones**, solo envía el correo de una que ya está en `pending`.
- **El enlace no concede acceso.** Es `/invitations?invitation=<uuid>`; la aceptación
  (`accept_team_invitation`) vuelve a comprobar en el servidor que el correo confirmado de
  quien entra es el de la invitación. Conocer el identificador no sirve de nada por sí solo.
  (El ayudante `invitationIdFromSearch` del cliente lee ese parámetro y la pantalla destaca la
  invitación señalada, con aviso honesto si esa cuenta no puede usarla.)
- **El nombre de quien invita** se lee de `auth.getUser()` (`user_metadata`) y es **solo
  presentación**: se escapa como texto en el correo y **jamás** se usa para autorizar. Si no
  hay nombre, el correo usa una fórmula neutra («El propietario del equipo te ha invitado…»).
  Se descartó leer `public.profiles.display_name` para no añadir otra consulta a la base por un
  dato cosmético.
- **La fecha de caducidad no viaja en el correo**: la RPC del contrato congelado devuelve
  exactamente cinco claves y `expires_at` no está entre ellas, así que el mensaje no promete
  ninguna fecha. `renderInviteEmail` sí acepta `expiresAt` y la muestra si algún día se le pasa.

## 3. Estados distinguibles (y qué NO significan)

La columna `email_status` de `team_invitations` distingue cuatro estados:

| `email_status`      | Significa                                                                  | No significa                                                     |
| ------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `created`           | La invitación existe y **no se ha intentado enviar** el correo.            | —                                                                |
| `send_pending`      | Se abrió un intento y **aún no se registró la respuesta del proveedor**.   | Que el proveedor haya recibido el correo o vaya a llegar.        |
| `provider_accepted` | El proveedor **ACEPTÓ el envío** (respondió 200/201 con un identificador). | **Que se haya entregado.** El proveedor puede rebotarlo después. |
| `send_error`        | El envío **falló**; el motivo queda en `last_email_error`, redactado.      | Que el correo no pueda acabar llegando en un reintento.          |

**Esto es el estado del CORREO; el estado de la INVITACIÓN es otra cosa.** `status` ∈
`pending | accepted | revoked | expired`, y `accepted` significa que **la persona la aceptó**.
Una invitación `status = 'pending'` con `email_status = 'provider_accepted'` es lo normal y no
es una contradicción: el correo salió y la persona aún no ha dicho nada.

Y al revés: **«aceptado por el proveedor» no es «entregado»**. Sin webhooks del proveedor
(rebotes, quejas, entregas) no hay forma de saber más, así que nunca se muestra «correo
enviado con éxito» ni «entregado». Los textos del cliente dicen exactamente eso
(«Aceptado por el proveedor (entrega no confirmada)»).

Una fila que se quede en `send_pending` **es información, no un fallo oculto**: significa que la
función murió entre preparar y registrar (o que el registro falló, y entonces hay una línea
`invite-email: record_result_failed` en el log). El siguiente intento la corrige.

**Intento vigente y resultado tardío.** `prepare_invitation_email` abre un **intento** con
identificador propio (`email_attempt_id`, un uuid nuevo en cada envío) y lo devuelve como
`attempt_id`. El registro exige ese identificador:

- coincide con el intento vigente → se escribe el estado (`provider_accepted` / `send_error`);
- **no coincide** (la respuesta llegó tarde, después de un reintento) → la RPC responde
  `stale_email_attempt`, **no escribe nada** y la función lo anota como aviso
  (`invite-email: record_result_ignored reason=stale_email_attempt`), no como error.

Sin ese vínculo, la respuesta lenta de un envío anterior podía pisar el estado del intento nuevo
(por ejemplo, dejar en `provider_accepted` un envío que en realidad acababa de fallar).

### Puerta de configuración: no se envía nada si no se puede registrar nada

Si se pudiera enviar sin poder registrar el resultado, el correo saldría y la fila se quedaría en
`send_pending` —y el intento ya estaría gastado— sin que nadie pudiera saber qué contestó el
proveedor. Por eso, **antes** de abrir el intento y **antes** de llamar al proveedor, la función
comprueba con `resolveSendReadiness(env)` (módulo puro, probado de verdad) que tiene:

| Se exige                                                   | Por qué                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`                                | Sin ella no se puede ejecutar `record_invitation_email_result` (revocada al cliente). |
| `SUPABASE_URL`                                             | Sin URL no hay cliente contra el que autenticar al llamante.                          |
| `SUPABASE_ANON_KEY` (o la publicable)                      | Sin clave publicable no se puede autenticar al propietario.                           |
| La configuración de correo (`EMAIL_*`, `INVITE_LINK_BASE`) | Sin ella no hay proveedor ni enlace válido.                                           |

Si falta algo, la función responde `not_configured` con un mensaje que **no afirma nada que no
haya pasado**: «No se ha intentado ningún envío, no se ha consumido ningún intento y el estado del
envío NO ha cambiado». Es decir: **cero envíos y cero intentos consumidos**, con el estado de la
invitación intacto. El caso de «falta URL o clave publicable» se unificó con este estado (antes
respondía `server_misconfigured`): cualquier configuración incompleta se atiende **antes** de tocar
la base y de hablar con el proveedor.

## 4. Política de reintentos: por qué no se duplican invitaciones ni se envían correos ilimitados

Todo el control está **en la base**, que es donde no se puede saltar desde el navegador:

1. **Máximo 5 intentos por invitación.** `prepare_invitation_email` lanza
   `email_attempt_limit` cuando `email_attempts >= 5`. El contador se incrementa **al preparar**
   (no al enviar), así que un intento que muera a medias también cuenta: no hay forma de pedir
   envíos infinitos.
2. **Cooldown de 60 s entre envíos.** Si el último envío fue hace menos de un minuto, lanza
   `email_cooldown`. Matiz importante: un envío que **falló** (`send_error`) sí se puede
   reintentar de inmediato, porque el propietario acaba de ver el error y puede haber corregido
   la dirección. El tope de 5 sigue aplicándose.
3. **Sin invitaciones duplicadas.** Enviar no inserta nada: se reutiliza la misma fila. El
   correo lleva el enlace de **esa** invitación, y la aceptación comprueba el correo de quien
   entra. Reenviar tres veces el mismo correo no crea tres invitaciones ni tres enlaces válidos.
4. **Sin carreras.** `prepare_invitation_email` bloquea la fila (`for update`): dos pulsaciones
   simultáneas no pueden preparar dos envíos a la vez; la segunda espera y choca con el cooldown.
5. **Sin reintento automático en la función.** La Edge Function envía **una** vez y registra el
   resultado. No hay bucle de reintentos: multiplicaría los correos sin que nadie lo haya pedido
   y consumiría intentos del tope. Quien reintenta es el propietario; `isRetriableHttp(429 | 5xx)`
   solo decide **qué mensaje** recibe («el proveedor no está disponible, puedes reintentarlo» o
   «el proveedor rechazó la petición, revisa la dirección»).
6. **Coherencia con el cliente.** `canRetryInvitationEmail` replica las mismas reglas (60 s, 5
   intentos, `send_error` sin espera) para no ofrecer un botón que el servidor va a rechazar.

## 5. Configuración: proveedor, remitente, dominio y `INVITE_LINK_BASE`

Todo va por **variables de entorno de la función** (secretos de Supabase), nunca por el
navegador. La tabla completa, con los valores de ejemplo y los comandos de despliegue, está en
`supabase/functions/invite-team-member/README.md`. Resumen:

| Variable                    | Ejemplo (FICTICIO)                    | Regla                                                                                                                                                                                        |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EMAIL_PROVIDER`            | `resend`                              | `resend` (por defecto), `postmark` o **`brevo`**. Cualquier otro valor se señala como faltante.                                                                                              |
| `EMAIL_API_KEY`             | `CLAVE-DE-EJEMPLO-NO-REAL`            | Solo viaja en la cabecera de la petición HTTPS. Nunca en el cuerpo, en un log ni en un mensaje.                                                                                              |
| `EMAIL_FROM`                | `no-reply@EJEMPLO.com`                | **Solo la dirección.** Con `brevo` basta con que sea una dirección remitente **verificada** (no hace falta dominio propio).                                                                  |
| `EMAIL_FROM_NAME`           | `CDMPLab`                             | Por defecto `CDMPLab`. El encabezado se compone como `Nombre <dirección>`.                                                                                                                   |
| `EMAIL_REPLY_TO`            | `soporte@EJEMPLO.com`                 | Opcional. Si falta, la cabecera no se envía.                                                                                                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY` | (la inyecta la plataforma)            | **No se define a mano** en Edge Functions alojadas. Se usa solo para registrar el resultado; si falta, la función rechaza antes de abrir intento o enviar. Nunca se registra ni se devuelve. |
| `INVITE_LINK_BASE`          | `https://erdeivih.github.io/CDMPLab/` | Debe ser `https://`; admite subcarpeta (la build de Pages usa `/CDMPLab/`).                                                                                                                  |

**`INVITE_LINK_BASE` es la pieza que más fácil se equivoca.** Reglas, y todas se comprueban en
la puerta local:

- Solo **`https://`**. Se rechazan `http://`, esquemas raros, cadenas vacías y cadenas relativas.
- Se rechazan `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]` y `*.localhost`: el correo no puede
  mandar a nadie a la máquina de desarrollo (la app ya aplica el mismo criterio al construir el
  enlace con su `base href`).
- Se rechazan credenciales dentro de la URL (`https://usuario:clave@host`): serían un secreto
  viajando en un correo.
- Se rechazan `?query` y `#fragment` en la base, porque se perderían al añadir la ruta.
- **Sí** se admite una base con subcarpeta. El despliegue de GitHub Pages tiene
  `baseHref: "/CDMPLab/"` (`angular.json`), así que el valor real será
  `https://USUARIO.github.io/CDMPLab/` (o el dominio propio el día que exista) y el enlace final
  queda `https://USUARIO.github.io/CDMPLab/invitations?invitation=<uuid>`. No se duplican barras.

**El valor exacto de este proyecto**: el repositorio es `github.com/ErDeivih/CDMPLab` (remoto
`origin`), así que la app publicada está en `https://erdeivih.github.io/CDMPLab/` y el secreto es:

```bash
supabase secrets set INVITE_LINK_BASE=https://erdeivih.github.io/CDMPLab/
```

### 5.1 Sin dominio propio: qué se puede hacer hoy

Un dominio propio es lo ideal (buena reputación, DMARC, sin límites del proveedor), pero **no es
imprescindible para arrancar**. Tres caminos, de menos a más esfuerzo:

| Camino                                             | ¿Hace falta dominio? | Qué permite de verdad                                                                                                                                                                                   | Límites que hay que decir en voz alta                                                                                                          |
| -------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brevo con remitente verificado** (recomendado)   | **No**               | Brevo verifica una **dirección remitente suelta** (Single Sender Verification): se puede enviar desde un correo que ya tengas (por ejemplo tu Gmail). Plan gratuito con cientos de correos al día.      | El remitente es tu dirección personal (visible para los invitados) y los buzones grandes (Gmail/Outlook) pueden marcar como spam al principio. |
| **Resend con su dirección de pruebas**             | No                   | `onboarding@resend.dev` solo envía **a la dirección del dueño de la cuenta de Resend**. Sirve para comprobar que TODO el circuito funciona (función → proveedor → buzón), no para invitar a terceros.   | No sirve para producción: no llegará a los invitados.                                                                                          |
| **Dominio propio** (comprar o subdominio gratuito) | Sí                   | Remitente del club (`no-reply@tudominio`), SPF/DKIM/DMARC, mejor entrega y sin el límite de remitente personal. Los `*.js.org` (para proyectos de GitHub) son un subdominio gratuito, pero tardan días. | Cuesta dinero y tiempo; hay que publicar registros DNS.                                                                                        |

Con **Brevo** el cambio es solo de configuración (el código ya lo soporta):

```bash
supabase secrets set EMAIL_PROVIDER=brevo \
  EMAIL_API_KEY=TU-CLAVE-DE-BREVO \
  EMAIL_FROM=tu-correo-verificado@ejemplo.com \
  EMAIL_FROM_NAME=CDMPLab \
  INVITE_LINK_BASE=https://erdeivih.github.io/CDMPLab/
```

y en el panel de Brevo: _Senders, Domains & Dedicated IPs → Senders → Add a sender_ (verifica el
correo desde el enlace que te envían). La clave se crea en _SMTP & API → API Keys_.

> **Ninguna clave se escribe en el repositorio ni en el chat**: van con `supabase secrets set` (o
> en el panel de Supabase → Edge Functions → Secrets) y el navegador nunca las ve.

### 5.2 Correo de registro y recuperación (Supabase Auth): sin dominio también se puede

Es **otra cosa distinta** del correo de invitación (va por el SMTP de Supabase Auth, no por la
Edge Function). Sin dominio propio hay dos opciones razonables:

- **El servicio por defecto de Supabase** (sin configurar nada): acepta muy poco volumen
  (del orden de 2-4 correos por hora) y **solo** envía a direcciones de los miembros del equipo del
  proyecto. Suficiente para probar el registro, no para un club real.
- **El SMTP de Brevo** (mismo remitente verificado) en _Supabase → Authentication → SMTP_:
  `smtp-relay.brevo.com`, puerto `587`, usuario y clave SMTP de Brevo. Con eso ya se pueden
  mandar confirmaciones y recuperaciones a cualquier dirección. Pasos completos en
  `docs/smtp-supabase-auth.md`.

## 6. Dónde vive el secreto y qué se registra

- **La clave del proveedor no sale del servidor.** El navegador solo llama a
  `functions.invoke('invite-team-member', { body: { invitationId } })`; no conoce ni el
  proveedor. `EMAIL_API_KEY` se lee con `Deno.env.get` en la función y solo se usa en la
  cabecera de la petición HTTPS (`Authorization: Bearer …` en Resend,
  `X-Postmark-Server-Token` en Postmark). La puerta comprueba que **no** aparece en el cuerpo
  de la petición.
- **La clave de servicio no se usa.** El cliente de Supabase dentro de la función se crea con la
  clave **anon/publishable** más la cabecera `Authorization` del llamante: las RPC se ejecutan
  **como ese usuario** y quien decide es Postgres (RLS + `is_team_owner`). Usar
  `service_role` habría convertido la función en una puerta trasera. El análisis estático
  prohíbe incluso nombrarla.
- **Los logs no identifican a nadie.** Solo líneas estructurales
  (`invite-email: provider=resend status=provider_accepted`). Nunca el id de la invitación, el
  correo invitado, el enlace completo ni una clave; el análisis estático lo verifica (todo
  `console.*` pasa por un ayudante con prefijo fijo).
- **Los errores se redactan.** `redactError` convierte cualquier cosa en una línea de ≤ 300
  caracteres y sustituye por `[oculto]` lo que parezca una credencial (`Bearer …`, `key=…`,
  `token …`, prefijos conocidos, cadenas hexadecimales o base64 largas). Es lo que se guarda en
  `last_email_error` y lo que podría mostrarse.
- **El HTML del correo se escapa.** El nombre del equipo y el de quien invita pasan por
  `escapeHtml` antes de tocar el HTML; el asunto se aplana a una línea y también se escapa, de
  modo que **no puede contener marcado** ni arrastrar un salto de línea (inyección de
  cabeceras). **Coste conocido y asumido:** un equipo llamado «Racing & Amigos» verá
  «Racing &amp; Amigos» en la línea de asunto, porque ahí la entidad no se interpreta. Se acepta
  a cambio de que el asunto sea demostrablemente libre de HTML (la puerta exige que no haya ni
  `<` ni `>`); la alternativa —dejar el nombre en crudo en el asunto— es igual de segura para el
  buzón, pero incumple «el asunto no debe llevar HTML». El correo es un `div` con estilos en
  línea, sin imágenes remotas y sin píxeles de seguimiento, con alternativa en texto plano. En
  el texto plano **no** se escapa a propósito: escapar ahí mostraría `&lt;` literal a la
  persona; la inyección que se evita con `escapeHtml` solo existe en HTML. La puerta comprueba
  las dos cosas.
- **CORS.** La función responde a `OPTIONS` y permite cualquier origen, porque la autenticación
  viaja en la cabecera `Authorization` y no en cookies: `Access-Control-Allow-Origin: *` no da
  acceso a nadie que no traiga ya su propio token. `verify_jwt` (por defecto en Supabase) añade
  una capa más: la plataforma rechaza antes de ejecutar la función lo que no traiga JWT válido.

## 7. Cómo se comprueba hoy, sin proveedor

```bash
node scripts/validate-invite-email.mjs      # 35 comprobaciones, sale 0 o 1
```

Importa **de verdad** `supabase/functions/_shared/invite-email.ts` (Node 24 hace type-stripping
del `.ts`, sin compilar) y comprueba, entre otras cosas: que la configuración incompleta se
señala **por nombre y sin filtrar el valor**; que el enlace acepta la base con subcarpeta y
rechaza `http`, `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`, vacío y credenciales incrustadas;
que un nombre de equipo malicioso
(`<img src=x onerror=alert(1)>`) sale escapado y no como etiqueta; que la petición de los dos
proveedores lleva la URL correcta, la clave en su cabecera y un cuerpo con destinatario y
asunto; que la respuesta del proveedor se traduce bien y sus errores salen redactados; y, sobre
el texto de la Edge Function, que usa `Deno.env`, que llama a las dos RPC por su nombre exacto,
que **comprueba la configuración antes de consumir un intento** y que los únicos códigos HTTP
son 400/401/405 (protocolo) y 200 (todo lo demás).

Ese último punto es una decisión de contrato, no un descuido: el cliente usa
`supabase.functions.invoke`, que **solo rellena `data` con el cuerpo cuando la respuesta es
2xx**. Con un 429 en el cooldown, el mensaje en español se perdería justo cuando más falta hace.
El contrato congelado solo fija el código de tres casos, así que el resto viaja con 200 y es el
cuerpo (`ok`, `status`, `message`) el que distingue los estados.

## 8. Pasos manuales pendientes

1. **Contratar/abrir cuenta** en Resend o Postmark y obtener la clave.
2. **Verificar el dominio remitente**: publicar SPF, DKIM (y DMARC) y elegir `no-reply@…`.
3. **Alta de los secretos** con `supabase secrets set …` (valores de ejemplo y comandos exactos
   en el README de la función).
4. **Hacer un envío real de prueba** a un buzón propio (no a una persona ajena) y comprobar que
   llega, con qué remitente y a qué carpeta.
5. **Decidir si se añaden webhooks** del proveedor para pasar de «aceptado» a «entregado» o
   «rebotado». Sin ellos, el estado no puede mejorar nunca.

La función y las RPC ya están desplegadas; al guardar secretos nuevos en Supabase Edge Functions
quedan disponibles sin volver a desplegar el código. La migración de solicitudes y correo se aplicó
como `20260921193229_team_creation_requests` y se probó contra PostgreSQL real.

## 9. Qué NO está verificado

- **No se ha enviado ni un solo correo.** No hay proveedor, ni credenciales, ni dominio. Todo lo
  que depende de la red está sin probar: el POST real, la aceptación del proveedor, la entrega,
  los rebotes y el spam.
- **Las RPC sí se han ejecutado contra PostgreSQL.** La matriz real verificó permisos, estados,
  límites y rechazo de intentos antiguos con `ROLLBACK`. No se ha probado aún su integración
  con un proveedor de correo real.
- **La Edge Function está desplegada**, pero solo se ha probado desde fuera que rechaza una
  petición anónima con HTTP 401. Falta una petición autenticada que llegue al proveedor.
- **La respuesta del proveedor se prueba con dobles**, no contra Resend/Postmark. Que un 200
  con `{ id }` sea «aceptado» es lo que dice su documentación, no algo medido aquí.
- **Postmark no envía `MessageStream`** (el contrato congelado no lo incluye). Si el servidor de
  Postmark no usa el flujo por defecto, hará falta añadirlo.
- **El enlace con `?invitation=<uuid>` se lee en la pantalla de invitaciones**; sigue sin
  conceder acceso por sí solo, porque la aceptación valida identidad y correo en el servidor.
- **La pantalla pasó E2E local y build**, pero no una invitación real enviada por proveedor.
- **`method_not_allowed` y `server_misconfigured`** están contemplados en
  `src/app/core/invite-email.ts`; el segundo explica al propietario que el servidor está mal
  configurado, sin afirmar que se haya enviado nada.
