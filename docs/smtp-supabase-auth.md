# SMTP propio en Supabase Auth — confirmación de registro y recuperación de contraseña

> **Alcance de este documento.** Trata **solo** del correo que envía **Supabase Auth**: la
> confirmación de registro y la recuperación de contraseña. **NO cubre ni sustituye el correo de
> invitación a un equipo**, que no lo manda Auth sino una Edge Function con la API del proveedor
> (ver `docs/correo-invitaciones.md`). Son **dos canales distintos** y se configuran en dos
> sitios distintos.

## Alcance: qué está verificado y qué no

| Parte                                                                      | Estado en esta ronda                                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Qué correos de Auth usa hoy la app                                         | **Verificado leyendo el código** (`src/app/core/supabase.service.ts`)                                 |
| Por qué el servicio por defecto no sirve para producción                   | **Verificado en la documentación oficial** de Supabase (enlaces en la sección 8)                      |
| Dónde y cómo se configura el SMTP propio (panel, API, plantillas, límites) | **Documentado desde la documentación oficial**; las etiquetas exactas del panel pueden cambiar        |
| La configuración en sí                                                     | **NO hecha**: no hay proveedor, ni credenciales, ni dominio. No se ha enviado ningún correo de prueba |

## 1. Por qué el servicio de correo por defecto de Supabase no sirve para producción

Supabase ofrece un servidor SMTP propio para que se pueda empezar sin contratar nada. Su
documentación es explícita sobre sus tres limitaciones:

1. **Solo entrega a direcciones preautorizadas.** Salvo que se configure un SMTP propio, Auth
   **rechaza** los mensajes a direcciones que no sean de los miembros del equipo de la
   organización en el panel. El resto falla con _«Email address not authorized.»_ Es decir: hoy
   un entrenador que se registre con su correo real **no recibirá** la confirmación.
2. **Límite de envío de 2 mensajes por hora** por proyecto, y ese valor _puede cambiar sin
   aviso_.
3. **Sin SLA**: no hay garantía de entrega ni de disponibilidad; está pensado para explorar,
   probar plantillas y proyectos de juguete, no para una aplicación en uso.

Para una app que ya se usa de verdad, esto no es una limitación de rendimiento: es un bloqueo
funcional. Cualquier persona que no esté en el equipo del proyecto en Supabase no puede
confirmar su cuenta.

## 2. Qué correos de la app dependen de esto (y cuál NO)

Dependen de **Supabase Auth** (leído en `src/app/core/supabase.service.ts`):

| Flujo                              | Llamada                                                                                    | Redirección que pide la app                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Confirmación de registro           | `signUp` con `options.emailRedirectTo`                                                     | el `base href` de la app (`/CDMPLab/` en Pages) |
| Reenvío de esa confirmación        | `resend({ type: 'signup', … })`, con cooldown de 45 s en el cliente (`RESEND_COOLDOWN_MS`) | igual                                           |
| Recuperación de contraseña         | `resetPasswordForEmail(email, { redirectTo })`                                             | `auth/update-password`                          |
| Cambio de contraseña ya con sesión | `updateUser({ password })` — **no** envía correo                                           | —                                               |

**NO depende de Auth:** el correo de invitación a un equipo. Va por la Edge Function
`invite-team-member` con la API HTTP del proveedor (Resend/Postmark), no por el SMTP de Auth.
La plantilla «Invite user» de Auth **no se usa**: la app no invita cuentas de Auth, invita
personas a un equipo (tabla `team_invitations`) y el alta de la cuenta la hace la propia
persona desde `/auth/register`. Se comprobó: no hay ninguna llamada a `inviteUserByEmail` ni al
API de administración de Auth en `src/`.

## 3. Cómo se configura el SMTP propio: pasos manuales

### 3.1 Elegir proveedor y obtener las credenciales

Auth funciona con cualquier servicio que hable SMTP. Hay que crear la cuenta y obtener **cuatro
datos** más una dirección de remitente:

| Dato             | Ejemplo (FICTICIO — lo da el proveedor) |
| ---------------- | --------------------------------------- |
| Host SMTP        | `smtp.PROVEEDOR-DE-EJEMPLO.com`         |
| Puerto           | `587` (STARTTLS; `465` es TLS directo)  |
| Usuario          | `USUARIO-SMTP-DE-EJEMPLO`               |
| Contraseña       | `CLAVE-SMTP-DE-EJEMPLO`                 |
| Dirección `From` | `no-reply@EJEMPLO.com`                  |

Los valores concretos de host, usuario y contraseña **los publica cada proveedor** (los hay que
usan el propio token del API como usuario y como contraseña). No se escriben aquí porque no se
ha contratado ninguno: inventarlos sería peor que decir que faltan. Supabase documenta una
lista no exhaustiva de proveedores que funcionan (Resend, AWS SES, Postmark, SendGrid,
ZeptoMail, Brevo).

El remitente debe pertenecer a un **dominio verificado en el proveedor** (SPF y DKIM publicados;
DMARC, muy recomendable). Con un dominio sin verificar, muchos buzones rechazan o marcan como
spam.

### 3.2 Configurarlo en el panel

Ruta: **Authentication → SMTP** del proyecto
(`https://supabase.com/dashboard/project/_/auth/smtp`).

1. Activar **Enable Custom SMTP**.
2. Rellenar **Host**, **Port**, **Username**, **Password**.
3. Rellenar **Sender email** (la dirección `From`) y **Sender name** (el nombre visible;
   `CDMPLab` es coherente con el correo de invitación).
4. Guardar. A partir de ese momento Auth envía a **cualquier** dirección, con un límite bajo por
   defecto (ver sección 4).

Los cuatro datos sensibles (host, usuario, contraseña y remitente) se guardan como
**configuración del proyecto en el panel**: no van al repositorio, no van al navegador y **no se
gestionan con `supabase secrets set`** (eso es para las Edge Functions, que es otra cosa).

### 3.3 Alternativa por API (mismo efecto)

```bash
export SUPABASE_ACCESS_TOKEN="TOKEN-DE-EJEMPLO-DEL-PANEL"   # https://supabase.com/dashboard/account/tokens
export PROJECT_REF="REF-DE-EJEMPLO"

curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "external_email_enabled": true,
    "mailer_autoconfirm": false,
    "smtp_admin_email": "no-reply@EJEMPLO.com",
    "smtp_host": "smtp.PROVEEDOR-DE-EJEMPLO.com",
    "smtp_port": 587,
    "smtp_user": "USUARIO-SMTP-DE-EJEMPLO",
    "smtp_pass": "CLAVE-SMTP-DE-EJEMPLO",
    "smtp_sender_name": "CDMPLab"
  }'
```

`mailer_autoconfirm: false` es deliberado: la app **espera** que el correo se confirme (tiene
una pantalla `/verify-email` y la aceptación de invitaciones exige correo confirmado). No se
desactiva la confirmación para «quitar el problema»: eso abriría la puerta a cuentas con correos
ajenos.

### 3.4 Configurar las URL de redirección

Ruta: **Authentication → URL Configuration**
(`https://supabase.com/dashboard/project/_/auth/url-configuration`).

- **Site URL**: la URL publicada de la app (la build de Pages se sirve bajo `/CDMPLab/`).
- **Redirect URLs**: hay que incluir la URL publicada y la de desarrollo
  (`http://localhost:3000/**` o el puerto que se use), y las variantes con `/CDMPLab/auth/update-password`.

Si esto no está bien, el enlace del correo lleva a `localhost` o a una URL no permitida y el
flujo se rompe **aunque el SMTP funcione**. Es el fallo más habitual de este montaje.

### 3.5 Plantillas

Ruta: **Authentication → Email Templates** (`https://supabase.com/dashboard/project/_/auth/templates`).

Variables disponibles (entre otras): `{{ .ConfirmationURL }}`, `{{ .Token }}` (código de 6
dígitos), `{{ .TokenHash }}`, `{{ .SiteURL }}` y `{{ .RedirectTo }}`. Las plantillas que
importan aquí son la de **confirmación** y la de **recuperación**.

Dos avisos honestos:

- El constructor de plantillas del panel **no se aplica** al desarrollo local con la CLI ni a
  un Supabase autoalojado: allí las plantillas viven en `supabase/config.toml` y en ficheros
  HTML locales. Este repositorio **no tiene** `supabase/config.toml`, así que hoy solo importa
  el panel.
- Este documento **no cambia ninguna plantilla**. Las plantillas actuales siguen siendo las de
  Supabase. Dejarlas presentables (en español, con el tono de la app, con remitente que se
  reconozca) es un trabajo pendiente y separado.

## 4. Límites de envío

| Situación                             | Límite                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Servicio por defecto de Supabase      | **2 correos/hora** por proyecto, cambiable sin aviso, y solo a direcciones del equipo de la organización                                                       |
| Con SMTP propio                       | Al guardar la configuración se impone un límite bajo de **30 correos/hora**; se ajusta en **Authentication → Rate Limits** (`/auth/rate-limits`)               |
| Proveedor de correo (plan contratado) | El suyo propio: hay planes con cientos de correos al día y planes con decenas al mes. **Hay que consultarlo antes de elegir**, porque puede ser el límite real |
| Reenvíos desde la app                 | El cliente aplica su propio cooldown (`RESEND_COOLDOWN_MS = 45 s`) para no inundar Auth con reenvíos                                                           |

El ajuste por API de ese límite es `rate_limit_email_sent`. Conviene subirlo a un valor
razonable una vez que el envío funcione: con 30/hora, un puñado de registros simultáneos agota el
cupo y los siguientes usuarios no reciben nada (y ven un error confuso).

## 5. Reputación y abuso (lo que evita que los correos acaben en spam)

Resumen de las recomendaciones de Supabase, que aplican igual a este montaje:

- **Publicar SPF, DKIM y DMARC** para el dominio de envío.
- **No mezclar** correo de autenticación con correo comercial: dominios separados
  (`auth.…` frente a `marketing.…`) y remitentes separados. Si cae la reputación de uno, no se
  lleva por delante al otro.
- **No desactivar la confirmación de correo** bajo presión (por ejemplo, si alguien está
  atacando el proyecto con registros masivos): es justo lo que el atacante busca.
- **Protegerse de bots** con CAPTCHA en el registro si aparecen altas masivas.
- Valorar un **dominio propio** para Auth: los enlaces de Auth apuntan al dominio de Supabase y
  un dominio propio reduce el riesgo de que los filtros lo asocien a la reputación de otro
  proyecto.

## 6. Qué NO cubre este documento

- **El correo de invitación a un equipo.** Va por la Edge Function `invite-team-member` con la
  API HTTP del proveedor, con su propia clave (`EMAIL_API_KEY`) y su propio remitente
  (`EMAIL_FROM`). Configurar el SMTP de Auth **no hace que las invitaciones se envíen**, y
  desplegar la Edge Function **no hace que llegue la confirmación de registro**. Son dos
  configuraciones independientes y las dos hacen falta.
- **Nada del lado del cliente.** No se ha tocado ni una pantalla de registro, ni de
  verificación, ni de recuperación.
- **La decisión de proveedor.** Este documento no elige: si el mismo proveedor sirve para Auth
  (SMTP) y para las invitaciones (API), se ahorra un contrato y se unifica la reputación del
  dominio; es la opción recomendable, pero es una decisión de negocio, no técnica.

## 7. Pasos manuales pendientes (y lo que falta de credenciales)

1. **Contratar** un proveedor de correo transaccional y obtener: host, puerto, usuario,
   contraseña y cuota del plan. **Pendiente de credenciales.**
2. **Verificar el dominio** de envío (DNS: SPF, DKIM, DMARC) y decidir la dirección `From`.
   **Pendiente: no hay dominio.**
3. **Rellenar Authentication → SMTP** con los cuatro datos y el remitente. **No hecho.**
4. **Revisar Authentication → URL Configuration**: Site URL y Redirect URLs con la URL publicada
   (`/CDMPLab/`) y la de desarrollo. **No hecho en esta ronda; hay que comprobar cómo está.**
5. **Subir el límite** de correos por hora al valor que pida el uso real. **No hecho.**
6. **Enviar un correo de prueba** a un buzón propio: registro nuevo + recuperación de
   contraseña, y comprobar remitente, carpeta (spam o no) y que el enlace vuelve a la app.
   **No hecho: sin credenciales no se puede.**
7. **Decidir si se activa CAPTCHA** en el registro. **Pendiente de decisión.**
8. Opcional: valorar un **dominio propio** para Auth. **Pendiente de decisión.**

## 8. Qué NO está verificado

- **No se ha configurado ningún SMTP** ni se ha enviado ningún correo de Auth. Todo lo de este
  documento es **procedimiento documentado, no un cambio aplicado**.
- **No se ha consultado el panel** de este proyecto: no se sabe si el SMTP propio ya estaba
  configurado de antes, ni qué valores tienen Site URL y Redirect URLs hoy.
- **Las etiquetas y rutas del panel** se han tomado de la documentación oficial de Supabase
  ([SMTP propio](https://supabase.com/docs/guides/auth/auth-smtp),
  [plantillas](https://supabase.com/docs/guides/auth/auth-email-templates),
  [límites](https://supabase.com/docs/guides/auth/rate-limits),
  [URL de redirección](https://supabase.com/docs/guides/auth/redirect-urls)) leída en esta
  ronda; el panel de Supabase cambia con el tiempo, así que una etiqueta puede haberse movido.
- **Los límites numéricos** (2/hora del servicio por defecto, 30/hora con SMTP propio) son los
  publicados **hoy**: Supabase avisa de que pueden cambiar sin aviso, y la cuota del proveedor
  depende del plan contratado.
- **La cuota real de un proveedor concreto** no se ha comprobado: no hay cuenta.
