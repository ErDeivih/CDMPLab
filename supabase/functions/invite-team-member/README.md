# Edge Function `invite-team-member` — envío REAL del correo de invitación

> Función de servidor (Deno) que envía el correo de invitación a un equipo. Existe porque la
> clave del proveedor de correo es un **secreto**: no puede viajar al navegador. El cliente
> llama a esta función con el JWT del propietario y **Postgres decide** si ese usuario puede
> enviar esa invitación.

## 1. Ficheros

| Fichero                                   | Qué es                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                | Punto de entrada. Único fichero que importa `npm:@supabase/supabase-js@2` y usa `Deno.serve`.                               |
| `../_shared/invite-email.ts`              | Módulo **puro** (sin dependencias): configuración, enlace, plantilla, petición al proveedor y traducción de errores.        |
| `../../scripts/validate-invite-email.mjs` | Puerta local: importa el módulo puro con Node y comprueba el comportamiento, además de propiedades estáticas de `index.ts`. |
| `../../docs/correo-invitaciones.md`       | Documento de conjunto (flujo, estados, pendientes, qué NO está verificado).                                                 |
| `../../docs/smtp-supabase-auth.md`        | Aparte: SMTP propio para el correo de **Auth** (confirmación y recuperación). Esto NO cubre la invitación.                  |

## 2. Contrato de la respuesta

El cuerpo **siempre** tiene la misma forma, sea cual sea el código HTTP:

```json
{ "ok": true, "status": "provider_accepted", "message": "…", "providerMessageId": "…" }
```

- `status` ∈ `provider_accepted`, `send_error`, `not_configured`, `invalid_request`,
  `unauthorized`, `forbidden`, `invitation_not_available`, `email_cooldown`,
  `email_attempt_limit`, `method_not_allowed`, `server_misconfigured`.
- `message` es el texto en **español** que la interfaz muestra tal cual.
- `providerMessageId` solo aparece cuando el proveedor devolvió un identificador.

**Códigos HTTP:** 400 (`invalid_request`), 401 (`unauthorized`) y 405 (`method_not_allowed`)
son errores de protocolo. **Todo lo demás se responde con 200** y el cuerpo es el que
distingue, incluidos `email_cooldown`, `email_attempt_limit` y `send_error`.

> ⚠️ Por qué: el cliente usa `supabase.functions.invoke`, que **solo rellena `data` con el
> cuerpo cuando la respuesta es 2xx**. Con un 429 o un 409, `data` llega `null` y el mensaje en
> español se perdería justo en los estados que más falta hacen al propietario. Si algún día el
> cliente lee el cuerpo de una respuesta no-2xx (`error.context.json()`), estos códigos se
> pueden volver semánticos sin tocar el cuerpo.

Con `verify_jwt` activado (valor por defecto en Supabase), la plataforma rechaza antes de
ejecutar la función cualquier petición sin JWT válido: una sesión caducada puede devolver un
401 **de la plataforma** (cuerpo distinto). La cabecera `Authorization` que se comprueba dentro
es una segunda capa, no la única.

## 3. Estados del envío (`team_invitations.email_status`)

| `email_status`      | Qué significa                                                                 | Quién lo escribe                                     |
| ------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| `created`           | Invitación creada, **sin ningún intento de envío**.                           | Valor por defecto de la columna.                     |
| `send_pending`      | Se abrió el intento; **no consta aún respuesta del proveedor**.               | `prepare_invitation_email`.                          |
| `provider_accepted` | El proveedor **ACEPTÓ el envío**. **NO es entrega confirmada.**               | `record_invitation_email_result` (solo el servidor). |
| `send_error`        | El envío falló. El motivo, redactado y truncado, queda en `last_email_error`. | `record_invitation_email_result` (solo el servidor). |

Esto es **el estado del correo**, no el de la invitación: `status` ∈
`pending | accepted | revoked | expired`, y `accepted` significa que **la persona la aceptó**.

Una fila que se quede en `send_pending` es exactamente lo que ese estado documenta: la función
murió entre la preparación y el registro (o el registro falló; queda en el log). No se
inventa un estado que no consta.

### Quién puede escribir el resultado (cambio de contrato del 22/09/2026)

`record_invitation_email_result` **no es ejecutable por el navegador**: su `EXECUTE` está revocado
a `public`, `anon` y `authenticated`, y concedido solo a `service_role`. Antes estaba concedida a
`authenticated` con una comprobación de propiedad, y eso permitía a un propietario **falsificar un
`provider_accepted`** con una llamada directa desde el cliente. Por eso esta función usa un
segundo cliente con `SUPABASE_SERVICE_ROLE_KEY` (credencial del servidor, nunca en el navegador)
para registrar el resultado, y sigue usando el cliente con el **JWT del llamante** para todo lo
demás: la autorización del propietario la aplica Postgres.

Además, el registro va **vinculado al intento**: `prepare_invitation_email` abre un intento
(`email_attempt_id`) en cada envío y devuelve su `attempt_id`; la RPC del registro exige que
coincida y responde `stale_email_attempt` (sin escribir nada) si la respuesta corresponde a un
intento anterior. Así una respuesta lenta no pisa el estado del intento vigente.

## 4. Política de reintento (60 s y 5 intentos)

Vive **en la base**, no en esta función, que nunca reintenta sola:

- **Cooldown de 60 s** entre envíos: `prepare_invitation_email` lanza `email_cooldown` si el
  último envío fue hace menos de un minuto. Un intento que **falló** (`send_error`) sí se puede
  repetir de inmediato: el propietario acaba de ver el error y puede corregir la dirección.
- **Máximo 5 intentos por invitación** (`email_attempts >= 5` → `email_attempt_limit`).
- **Sin duplicados**: enviar NO crea una invitación nueva. Se reutiliza siempre la misma fila
  (`invitation_id`); el enlace del correo apunta a esa invitación y la aceptación vuelve a
  comprobar en el servidor el correo confirmado de quien entra.
- **Sin carreras**: `prepare_invitation_email` bloquea la fila (`for update`), así que dos
  pulsaciones simultáneas no envían dos correos.
- **Sin reintento automático** dentro de la función: multiplicaría los correos sin que nadie lo
  haya pedido. `isRetriableHttp(429 | 5xx)` solo decide **qué mensaje** se le da al propietario.

## 5. Despliegue y secretos

Valores de **EJEMPLO**: sustitúyelos por los reales en el panel del proveedor y en el
despliegue. Nunca los escribas en el repositorio (`.env` está en `.gitignore`).

```bash
# 1. Enlazar el proyecto (este repositorio NO tiene supabase/config.toml todavía:
#    `supabase init` o `supabase link --project-ref <REF-DE-EJEMPLO>` lo creará).
supabase link --project-ref REF-DE-EJEMPLO

# 2. Secretos de la función (bash / Linux / macOS)
supabase secrets set \
  EMAIL_PROVIDER=resend \
  EMAIL_API_KEY=CLAVE-DE-EJEMPLO-NO-REAL \
  EMAIL_FROM=no-reply@EJEMPLO.com \
  EMAIL_FROM_NAME=CDMPLab \
  EMAIL_REPLY_TO=soporte@EJEMPLO.com \
  INVITE_LINK_BASE=https://USUARIO.github.io/CDMPLab/
```

PowerShell no admite la continuación con `\`: los seis `NOMBRE=valor` van en **una sola línea**.

```powershell
supabase secrets set EMAIL_PROVIDER=resend EMAIL_API_KEY=CLAVE-DE-EJEMPLO-NO-REAL EMAIL_FROM=no-reply@EJEMPLO.com EMAIL_FROM_NAME=CDMPLab EMAIL_REPLY_TO=soporte@EJEMPLO.com INVITE_LINK_BASE=https://USUARIO.github.io/CDMPLab/
```

```bash
supabase secrets list          # solo nombres y huellas: NUNCA imprime los valores
supabase functions deploy invite-team-member
```

| Variable           | ¿Obligatoria? | Qué es                                                                                                   |
| ------------------ | ------------- | -------------------------------------------------------------------------------------------------------- |
| `EMAIL_PROVIDER`   | No            | `resend` (por defecto) o `postmark`.                                                                     |
| `EMAIL_API_KEY`    | Sí            | Clave del proveedor. Solo viaja en la cabecera de la petición HTTPS.                                     |
| `EMAIL_FROM`       | Sí            | Dirección del remitente, **solo la dirección** (el nombre va aparte). Debe ser de un dominio verificado. |
| `EMAIL_FROM_NAME`  | No            | Nombre visible del remitente. Por defecto `CDMPLab`.                                                     |
| `EMAIL_REPLY_TO`   | No            | Dirección de respuesta. Si falta, no se envía la cabecera.                                               |
| `INVITE_LINK_BASE` | Sí            | Base **https** del enlace. Debe terminar sin barra duplicada; se admite subcarpeta (`/CDMPLab/`).        |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta la plataforma:
**no se configuran a mano**. La función usa **dos** clientes a propósito:

- el del **llamante** (URL + clave publicable + cabecera `Authorization` con su JWT): es el que
  autoriza en Postgres, porque ejecuta `prepare_invitation_email` **como ese usuario**;
- el del **servidor** (clave de servicio): se usa **solo** para escribir el resultado del
  proveedor en `record_invitation_email_result`, que está revocada para `authenticated` para que
  un propietario no pueda falsificar un `provider_accepted`. La credencial nunca se registra, ni
  se devuelve, ni autoriza a nadie.

`INVITE_LINK_BASE` debe pasar `isAcceptableLinkBase`: solo `https://`, y se rechazan
`http://`, `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`, cadenas vacías, credenciales dentro de
la URL y `?query`/`#fragment`. Con Resend, el remitente debe pertenecer a un **dominio
verificado** (DNS con DKIM/SPF) o Resend rechaza el envío con 4xx.

## 6. Logs

Solo se registran líneas estructurales, sin datos personales ni claves:

```
invite-email: provider=resend status=provider_accepted
invite-email: provider=resend status=send_error retriable=true
invite-email: not_configured missing=EMAIL_API_KEY,INVITE_LINK_BASE
invite-email: record_result_ignored reason=stale_email_attempt
invite-email: record_result_failed status=provider_accepted
invite-email: record_result_skipped missing=SUPABASE_SERVICE_ROLE_KEY status=provider_accepted
invite-email: inviter_name_unavailable error=...
```

Nunca se registra el identificador de la invitación, el correo invitado, el enlace completo ni
la clave. `scripts/validate-invite-email.mjs` lo comprueba de forma estática: cada `console.*`
debe escribir una línea con el prefijo `invite-email: `, y ningún dato prohibido puede llegar a
esos ayudantes.

## 7. Lo que queda PENDIENTE (nada de esto está hecho)

1. **Cuenta y clave en un proveedor real** (Resend o Postmark) y su alta como secretos.
2. **Dominio remitente verificado**: DKIM/SPF/DMARC publicados. Sin dominio propio, hay que
   usar el dominio de pruebas del proveedor y la entrega queda muy limitada.
3. **`INVITE_LINK_BASE` real** (la URL publicada de la app, bajo `/CDMPLab/`, o el dominio
   propio si algún día lo hay).
4. **Función desplegada** en el proyecto EntrenoLab con JWT obligatorio. Petición anónima
   verificada: HTTP 401. Falta probarla con un propietario y proveedor reales.
5. **Migraciones aplicadas**: `20260922000000_team_creation_requests.sql` y
   `20260923000000_clear_stale_invitation_email_result.sql`. La matriz RLS pasó con
   `ROLLBACK`; no dejó cuentas de prueba.
6. **Un envío real de principio a fin**: no se ha hecho ni una vez. No hay prueba de entrega.
7. **Webhooks del proveedor** (rebotes, quejas, entregas): sin ellos
   `provider_accepted` **nunca** pasará a «entregado», porque no se recibe esa información.
   Hoy no se distinguen «aceptado» y «entregado» salvo por lo que diga el buzón.
8. **Postmark**: no se envía `MessageStream`. Si el servidor de Postmark no usa el flujo por
   defecto, habrá que añadirlo (hoy el contrato congelado no lo incluye).
9. **Verificación en Deno**: no se ha ejecutado `deno check` ni la función en el runtime de
   Supabase. Aquí se comprueba su TEXTO, no su arranque.
10. **El registro con la credencial de servicio, contra PostgreSQL real**: las pruebas unitarias
    usan un backend simulado (rol `authenticated` → «permission denied»; rol `service_role` →
    escribe) y la matriz `supabase/tests/entrenolab_rls.sql` está escrita para el proyecto real,
    pero **no se ha ejecutado** contra él.
