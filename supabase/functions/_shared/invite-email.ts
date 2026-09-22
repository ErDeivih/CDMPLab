// =============================================================
// EntrenoLab / CDMPLab — Módulo PURO del correo de invitación a un equipo.
//
// POR QUÉ ESTE FICHERO EXISTE:
//   El envío real vive en una Edge Function (Deno), pero todo lo que se puede probar sin red
//   ni base de datos está aquí: leer y validar la configuración, construir el enlace, escapar
//   el HTML, renderizar el mensaje, preparar la petición al proveedor y traducir su respuesta.
//   Así `scripts/validate-invite-email.mjs` importa ESTE fichero tal cual (Node 24 hace
//   type-stripping) y comprueba el comportamiento de verdad, no una copia paralela.
//
// REGLAS DE ESTE FICHERO (no negociables):
//   · Sin dependencias: ni un solo `import`. Solo globals estándar (URL, JSON, Date…).
//   · Solo sintaxis TypeScript BORRABLE: nada de `enum`, propiedades de parámetro, `namespace`
//     ni decoradores. Node lo importa sin compilar.
//   · NUNCA se registra ni se devuelve el VALOR de una variable de entorno: solo su NOMBRE.
//     Las claves del proveedor circulan por aquí, pero no se imprimen ni se incluyen en el
//     mensaje: únicamente viajan en la cabecera de autorización de la petición HTTP.
// =============================================================

/** Proveedores de correo soportados. Se elige con `EMAIL_PROVIDER`. */
export type EmailProvider = 'resend' | 'postmark' | 'brevo';

/** Configuración de correo ya validada y lista para usar. */
export interface EmailConfig {
  provider: EmailProvider;
  apiKey: string;
  from: string;
  fromName: string;
  replyTo: string | null;
  linkBase: string;
}

/** La configuración está completa: se puede enviar. */
export interface EmailConfigOk {
  ok: true;
  config: EmailConfig;
}

/** Falta (o es inválida) alguna variable: `missing` lleva los NOMBRES, nunca los valores. */
export interface EmailConfigMissing {
  ok: false;
  missing: string[];
}

/** Nombres de las variables que lee `resolveEmailConfig`. Se usan también para leerlas del
 *  entorno una a una (`Deno.env.get`) en vez de volcar TODO el entorno en un objeto: así el
 *  módulo no puede tocar por accidente una clave de servicio. */
export const EMAIL_ENV_VARS: string[] = [
  'EMAIL_PROVIDER',
  'EMAIL_API_KEY',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
  'EMAIL_REPLY_TO',
  'INVITE_LINK_BASE',
];

/** Nombre de remitente por defecto cuando `EMAIL_FROM_NAME` no está definida. */
export const DEFAULT_FROM_NAME = 'CDMPLab';

/** Longitud máxima del texto de error que se guarda y se muestra. */
const MAX_ERROR_LENGTH = 300;

/** Longitud máxima del asunto: un asunto corto se lee entero en cualquier cliente. */
const MAX_SUBJECT_LENGTH = 160;

/** Hosts que JAMÁS valen como base de un enlace de invitación real. */
const BLOCKED_HOSTS: string[] = [
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
];

// -------------------------------------------------------------
// Utilidades internas
// -------------------------------------------------------------

/** Lee una variable del entorno y la normaliza (sin espacios alrededor). */
function readEnv(env: Record<string, string | undefined>, name: string): string {
  const raw = env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** ¿Parece una dirección de correo usable como remitente o destinatario?
 *  Se rechaza a propósito cualquier cosa con espacios o `<>`: el encabezado `From` se compone
 *  como `Nombre <dirección>` y una dirección que ya traiga ángulos lo rompería. */
function isEmailLike(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  if (/[\s<>]/.test(value)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Sustituye los caracteres de control (saltos de línea, tabuladores, NUL…) por espacios.
 *  Se hace con código de carácter y no con una expresión regular a propósito: una clase de
 *  caracteres de control dentro de una regex es justo lo que `no-control-regex` prohíbe, y
 *  silenciar esa regla está fuera de discusión. */
function stripControlChars(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out;
}

/** Deja un texto en UNA línea y sin caracteres de control: lo que se inserta en un asunto de
 *  correo nunca puede arrastrar un salto de línea (inyección de cabeceras). */
function oneLine(value: string, maxLength: number): string {
  const collapsed = stripControlChars(String(value)).replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

/** Encabezado `From` del proveedor: `Nombre <dirección>`, o solo la dirección si no hay nombre. */
function fromHeader(config: EmailConfig): string {
  const name = oneLine(config.fromName, 120);
  return name === '' ? config.from : name + ' <' + config.from + '>';
}

/** ¿Es un objeto plano (no un array, no null)? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Busca el primer texto no vacío entre las claves dadas, mirando un nivel hacia dentro si el
 *  valor es un objeto anidado (`{ error: { message } }`). */
function pickText(body: unknown, keys: string[]): string {
  if (!isRecord(body)) return '';
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (isRecord(value)) {
      const nested = pickText(value, keys);
      if (nested !== '') return nested;
    }
  }
  return '';
}

// -------------------------------------------------------------
// Configuración
// -------------------------------------------------------------

/**
 * Resuelve la configuración de correo a partir del entorno.
 *
 * Devuelve `{ ok: false, missing }` con los NOMBRES de las variables que faltan o no son
 * válidas (jamás sus valores), o `{ ok: true, config }` si todo está en orden.
 */
export function resolveEmailConfig(
  env: Record<string, string | undefined>,
): EmailConfigOk | EmailConfigMissing {
  const missing: string[] = [];

  const requested = readEnv(env, 'EMAIL_PROVIDER').toLowerCase();
  if (
    requested !== '' &&
    requested !== 'resend' &&
    requested !== 'postmark' &&
    requested !== 'brevo'
  ) {
    missing.push('EMAIL_PROVIDER');
  }
  // Valor por defecto: `resend`. Aun con un valor inválido se rellena con `resend`, pero el
  // error ya está anotado arriba y la función no devolverá `ok: true`.
  const provider: EmailProvider =
    requested === 'postmark' ? 'postmark' : requested === 'brevo' ? 'brevo' : 'resend';

  const apiKey = readEnv(env, 'EMAIL_API_KEY');
  if (apiKey === '') missing.push('EMAIL_API_KEY');

  const from = readEnv(env, 'EMAIL_FROM');
  if (!isEmailLike(from)) missing.push('EMAIL_FROM');

  const fromNameRaw = readEnv(env, 'EMAIL_FROM_NAME');
  const fromName = fromNameRaw === '' ? DEFAULT_FROM_NAME : fromNameRaw;

  const replyToRaw = readEnv(env, 'EMAIL_REPLY_TO');
  const replyTo = replyToRaw === '' ? null : replyToRaw;
  if (replyTo !== null && !isEmailLike(replyTo)) missing.push('EMAIL_REPLY_TO');

  const linkBase = readEnv(env, 'INVITE_LINK_BASE');
  if (!isAcceptableLinkBase(linkBase)) missing.push('INVITE_LINK_BASE');

  if (missing.length > 0) return { ok: false, missing };

  return { ok: true, config: { provider, apiKey, from, fromName, replyTo, linkBase } };
}

// -------------------------------------------------------------
// ¿Se puede ENVIAR y REGISTRAR? (puerta previa a abrir un intento)
// -------------------------------------------------------------

/** Credencial del SERVIDOR con la que se registra el resultado del proveedor. La inyecta la
 *  plataforma en las Edge Functions alojadas; el navegador no la tiene (ni puede tenerla). */
export const RECORDER_ENV_VAR = 'SUPABASE_SERVICE_ROLE_KEY';

/** Variables de plataforma que la función necesita para hablar con la base de datos. */
export const PLATFORM_ENV_VARS: string[] = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
];

/**
 * ¿Está el servidor en condiciones de enviar el correo **y de registrar su resultado**?
 *
 * POR QUÉ EXISTE ESTA PUERTA (revisión del dueño, 22/09/2026): si se pudiera enviar sin poder
 * registrar, el correo saldría y la fila se quedaría en `send_pending` —y, peor, el intento ya
 * estaría consumido— mientras nadie podría saber qué contestó el proveedor. Por eso la
 * comprobación va **antes** de `prepare_invitation_email` (que es quien abre el intento y gasta
 * uno de los 5) y **antes** de la llamada al proveedor: si falta algo, no se envía NADA, no se
 * consume NINGÚN intento y el estado no cambia.
 *
 * Devuelve los NOMBRES de lo que falta (nunca los valores) o la configuración ya resuelta.
 */
export function resolveSendReadiness(
  env: Record<string, string | undefined>,
): { ok: true; config: EmailConfig } | { ok: false; missing: string[] } {
  const missing: string[] = [];

  // 1) Sin la credencial del servidor no se podría escribir el resultado del proveedor.
  if (readEnv(env, RECORDER_ENV_VAR) === '') missing.push(RECORDER_ENV_VAR);

  // 2) Sin URL ni clave publicable no hay con qué autenticar al llamante (y sin eso no hay
  //    autorización del propietario ni, por tanto, envío legítimo).
  if (readEnv(env, 'SUPABASE_URL') === '') missing.push('SUPABASE_URL');
  if (readEnv(env, 'SUPABASE_ANON_KEY') === '' && readEnv(env, 'SUPABASE_PUBLISHABLE_KEY') === '') {
    missing.push('SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY');
  }

  // 3) Y la configuración del proveedor y del enlace.
  const email = resolveEmailConfig(env);
  if (!email.ok) missing.push(...email.missing);

  if (missing.length > 0) return { ok: false, missing };
  return email;
}

// -------------------------------------------------------------
// Enlaces
// -------------------------------------------------------------

/**
 * ¿Vale esta base para construir un enlace de invitación de verdad?
 *
 * Reglas (deliberadamente estrictas): solo `https://`; nada de `http://`, `localhost`,
 * `127.0.0.1`, `0.0.0.0`, `[::1]` ni cadenas vacías; sin credenciales incrustadas
 * (`https://usuario:clave@host`), sin `?query` ni `#fragment` (que se perderían al añadir la
 * ruta). SÍ admite una base con subcarpeta, como el despliegue de GitHub Pages
 * (`https://usuario.github.io/CDMPLab/`). Nunca lanza: devuelve `false`.
 */
export function isAcceptableLinkBase(base: string): boolean {
  if (typeof base !== 'string') return false;
  const raw = base.trim();
  if (raw === '') return false;
  if (!/^https:\/\//i.test(raw)) return false;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  // Credenciales en la URL: serían un secreto viajando en un correo. Nunca.
  if (parsed.username !== '' || parsed.password !== '') return false;
  // Query/fragmento en la base: se perderían al concatenar la ruta, mejor rechazar que mentir.
  if (parsed.search !== '' || parsed.hash !== '') return false;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '') return false;
  if (BLOCKED_HOSTS.includes(host)) return false;
  if (host.endsWith('.localhost')) return false;
  // Todo `127.x.x.x` es loopback; `https://127.1/` también resuelve a 127.0.0.1.
  if (host.startsWith('127.')) return false;
  return true;
}

/**
 * Construye el enlace absoluto de la invitación sin duplicar barras.
 *
 * `linkPathOrId` acepta lo que devuelve la RPC (`/invitations?invitation=<uuid>`) o un
 * identificador suelto, que se convierte en esa misma ruta. Lanza si la base no es aceptable o
 * si la ruta no es una ruta: es preferible fallar en el servidor que enviar un enlace roto.
 */
export function buildInviteLink(base: string, linkPathOrId: string): string {
  if (!isAcceptableLinkBase(base)) throw new Error('invalid_link_base');

  const raw = typeof linkPathOrId === 'string' ? linkPathOrId.trim() : '';
  if (raw === '') throw new Error('invalid_link_path');
  // Una URL absoluta aquí sería un intento de dirigir el correo a otro dominio.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
    throw new Error('invalid_link_path');
  }

  let path = raw;
  if (!path.startsWith('/')) {
    // Identificador suelto → ruta canónica de invitaciones (se codifica por si trae caracteres
    // raros; un uuid no se ve afectado).
    path = '/invitations?invitation=' + encodeURIComponent(path);
  }
  // Un solo `/` de separación, ni en la base ni en la ruta.
  const root = base.trim().replace(/\/+$/, '');
  const suffix = '/' + path.replace(/^\/+/, '');
  return root + suffix;
}

// -------------------------------------------------------------
// Plantilla del correo
// -------------------------------------------------------------

/** Escapa un texto para insertarlo en HTML (texto o atributo entrecomillado). */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Fecha de caducidad en formato `YYYY-MM-DD` (UTC). Cadena vacía si no es una fecha. */
function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/**
 * Renderiza el correo de invitación: asunto, HTML y alternativa en texto plano.
 *
 * Todo lo que viene del usuario (nombre del equipo, nombre de quien invita) se escapa con
 * `escapeHtml` antes de tocar el HTML, y se aplana a una línea antes de tocar el asunto. El
 * HTML es sobrio: un `div` con estilos en línea, sin imágenes remotas y sin píxeles de
 * seguimiento. No se inserta ningún token ni clave: el enlace ya lleva el identificador de la
 * invitación y la autorización se comprueba otra vez en el servidor al aceptarla.
 */
export function renderInviteEmail(input: {
  teamName: string;
  inviterName: string;
  link: string;
  expiresAt?: string | null;
}): { subject: string; html: string; text: string } {
  const teamName = oneLine(input.teamName ?? '', 120);
  const inviterName = oneLine(input.inviterName ?? '', 120);
  const link = String(input.link ?? '').trim();
  const expiry =
    typeof input.expiresAt === 'string' && input.expiresAt.trim() !== ''
      ? formatExpiry(input.expiresAt)
      : '';

  // El asunto se aplana a UNA línea (nada de saltos de línea: eso sí sería inyección de
  // cabeceras) y el nombre del equipo se escapa con `escapeHtml`, tal y como manda el contrato:
  // así el asunto no puede contener marcado ni «parecer» HTML en ningún cliente.
  // COSTE CONOCIDO Y ASUMIDO: un equipo llamado «Racing & Amigos» verá «Racing &amp; Amigos» en
  // la línea de asunto, porque ahí la entidad no se interpreta. Se acepta a cambio de que el
  // asunto sea demostrablemente libre de HTML; la alternativa (dejar el nombre en crudo en el
  // asunto) es igual de segura para el buzón, pero incumple «el asunto no debe llevar HTML».
  const subject =
    teamName === ''
      ? 'Invitación a un equipo en CDMPLab'
      : oneLine('Invitación al equipo ' + escapeHtml(teamName) + ' en CDMPLab', MAX_SUBJECT_LENGTH);

  // Nombre visible (escapado) y versión plana, para no duplicar la lógica de los dos cuerpos.
  const teamHtml =
    teamName === '' ? 'tu nuevo equipo' : '<strong>' + escapeHtml(teamName) + '</strong>';
  const teamText = teamName === '' ? 'tu nuevo equipo' : teamName;
  const inviterHtml =
    inviterName === ''
      ? 'El propietario del equipo'
      : '<strong>' + escapeHtml(inviterName) + '</strong>';
  const inviterText = inviterName === '' ? 'El propietario del equipo' : inviterName;

  const linkHtml = '<a href="' + escapeHtml(link) + '">' + escapeHtml(link) + '</a>';

  const expiryHtml =
    expiry === ''
      ? ''
      : '<p style="margin:0 0 16px 0;font-size:14px;color:#4b5563;">Esta invitación caduca el ' +
        escapeHtml(expiry) +
        '.</p>';
  const expiryText = expiry === '' ? '' : 'Esta invitación caduca el ' + expiry + '.\n';

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111827;max-width:560px;">' +
    '<p style="margin:0 0 16px 0;">Hola:</p>' +
    '<p style="margin:0 0 16px 0;">' +
    inviterHtml +
    ' te ha invitado a formar parte del equipo ' +
    teamHtml +
    ' en CDMPLab.</p>' +
    '<p style="margin:0 0 16px 0;">Para aceptar la invitación, abre este enlace:</p>' +
    '<p style="margin:0 0 16px 0;word-break:break-all;">' +
    linkHtml +
    '</p>' +
    expiryHtml +
    '<p style="margin:0 0 16px 0;">Necesitas una cuenta en CDMPLab con este mismo correo para poder aceptarla.</p>' +
    '<p style="margin:0;font-size:14px;color:#4b5563;">Si no esperabas esta invitación, puedes ignorar este mensaje.</p>' +
    '</div>';

  const text = [
    'Hola:',
    '',
    inviterText + ' te ha invitado a formar parte del equipo ' + teamText + ' en CDMPLab.',
    '',
    'Acepta la invitación desde este enlace:',
    link,
    '',
  ]
    .concat(expiryText === '' ? [] : [expiryText.trimEnd(), ''])
    .concat([
      'Necesitas una cuenta en CDMPLab con este mismo correo para poder aceptarla.',
      '',
      'Si no esperabas esta invitación, puedes ignorar este mensaje.',
    ])
    .join('\n');

  return { subject, html, text };
}

// -------------------------------------------------------------
// Proveedores
// -------------------------------------------------------------

/**
 * Construye la petición HTTP para el proveedor elegido.
 *
 * Resend: `POST https://api.resend.com/emails` con `Authorization: Bearer <clave>`.
 * Postmark: `POST https://api.postmarkapp.com/email` con `X-Postmark-Server-Token: <clave>`.
 * Brevo: `POST https://api.brevo.com/v3/smtp/email` con `api-key: <clave>`. Es el que sirve
 * **sin dominio propio**: Brevo permite verificar una ÚNICA dirección remitente (Single Sender
 * Verification), así que se puede enviar desde un correo que ya se tenga.
 * La clave viaja SOLO en la cabecera: ni en el cuerpo, ni en un log, ni en el mensaje de error.
 */
export function providerRequest(
  kind: EmailProvider,
  config: EmailConfig,
  message: { to: string; subject: string; html: string; text: string },
): { url: string; headers: Record<string, string>; body: string } {
  const from = fromHeader(config);

  if (kind === 'brevo') {
    const payload: Record<string, unknown> = {
      sender: { email: config.from, name: config.fromName },
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    };
    if (config.replyTo !== null) payload.replyTo = { email: config.replyTo };
    return {
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: {
        'api-key': config.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    };
  }

  if (kind === 'postmark') {
    const payload: Record<string, unknown> = {
      From: from,
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
    };
    if (config.replyTo !== null) payload.ReplyTo = config.replyTo;
    return {
      url: 'https://api.postmarkapp.com/email',
      headers: {
        'X-Postmark-Server-Token': config.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    };
  }

  const payload: Record<string, unknown> = {
    from,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  if (config.replyTo !== null) payload.reply_to = config.replyTo;
  return {
    url: 'https://api.resend.com/emails',
    headers: {
      Authorization: 'Bearer ' + config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  };
}

/**
 * Traduce la respuesta del proveedor.
 *
 * Aceptar (200/201 en Resend, 201 en Brevo, 200 en Postmark) significa ACEPTADO PARA ENVÍO, no
 * entregado: el proveedor aún puede rebotar el mensaje después. Cualquier otro código es un
 * error, y su texto pasa por `redactError` antes de guardarse o mostrarse.
 */
export function mapProviderResponse(
  kind: EmailProvider,
  httpStatus: number,
  body: unknown,
): { ok: boolean; providerMessageId?: string; error?: string } {
  if (kind === 'brevo') {
    // Brevo responde 201 con `{ messageId: "<...>" }`; los errores traen `{ code, message }`.
    if (httpStatus === 201 || httpStatus === 200) {
      const messageId = pickText(body, ['messageId', 'message_id', 'MessageId']);
      return messageId === '' ? { ok: true } : { ok: true, providerMessageId: messageId };
    }
    const detail = pickText(body, ['message', 'Message', 'error', 'code']);
    return {
      ok: false,
      error: redactError(detail === '' ? 'brevo_http_' + httpStatus : detail),
    };
  }

  if (kind === 'postmark') {
    if (httpStatus === 200) {
      const messageId = pickText(body, ['MessageID', 'MessageId', 'messageId']);
      return messageId === '' ? { ok: true } : { ok: true, providerMessageId: messageId };
    }
    const detail = pickText(body, ['Message', 'message', 'error', 'ErrorCode', 'name']);
    return {
      ok: false,
      error: redactError(detail === '' ? 'postmark_http_' + httpStatus : detail),
    };
  }

  if (httpStatus === 200 || httpStatus === 201) {
    const messageId = pickText(body, ['id', 'Id', 'ID']);
    return messageId === '' ? { ok: true } : { ok: true, providerMessageId: messageId };
  }
  const detail = pickText(body, ['message', 'Message', 'error', 'name']);
  return { ok: false, error: redactError(detail === '' ? 'resend_http_' + httpStatus : detail) };
}

/**
 * Convierte cualquier cosa en un texto de error CORTO, de UNA línea y SIN credenciales.
 *
 * Se aplica a todo lo que se guarda en la base o se muestra al usuario: mensajes del
 * proveedor, excepciones de red y errores de PostgREST. Sustituye por `[oculto]` lo que
 * parezca una clave (`Bearer …`, `key=…`, `token …`, prefijos conocidos y cadenas largas
 * hexadecimales o base64) y trunca a 300 caracteres.
 */
/** Convierte cualquier valor en texto, sin lanzar nunca: es la entrada de `redactError`. */
function errorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

export function redactError(value: unknown): string {
  let out = stripControlChars(errorText(value)).replace(/\s+/g, ' ').trim();

  // 1) Credenciales con prefijo conocido.
  out = out.replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [oculto]');
  out = out.replace(/\b(?:sk|rk|pk)_[A-Za-z0-9_-]{8,}/g, '[oculto]');
  out = out.replace(/\bre_[A-Za-z0-9_-]{8,}/g, '[oculto]');
  out = out.replace(/\bSG\.[A-Za-z0-9._-]{8,}/g, '[oculto]');
  out = out.replace(/\bxkeysib-[A-Za-z0-9_-]{8,}/gi, '[oculto]');

  // 2) `clave=valor` y `token valor` para los nombres típicos de credencial.
  const keyNames =
    '(?:api[_-]?key|apikey|key|token|secret|password|passwd|pwd|authorization|auth|bearer)';
  out = out.replace(
    new RegExp('\\b(' + keyNames + ')(\\s*[:=]\\s*|\\s+)(["\']?)([^\\s,;"\']+)\\3', 'gi'),
    '$1$2[oculto]',
  );

  // 3) Cadenas largas que solo pueden ser un identificador opaco o una clave en bruto.
  out = out.replace(/\b[0-9a-f]{24,}\b/gi, '[oculto]');
  out = out.replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g, '[oculto]');

  out = out.trim();
  if (out.length > MAX_ERROR_LENGTH) {
    out = out.slice(0, MAX_ERROR_LENGTH - 3).trimEnd() + '...';
  }
  return out;
}

/**
 * ¿Merece la pena reintentar con este código HTTP?
 *
 * Sí: 429 (demasiadas peticiones) y cualquier 5xx (fallo del proveedor). No: el resto de 4xx,
 * que son peticiones mal formadas que se repetirían igual de mal.
 */
export function isRetriableHttp(status: number): boolean {
  if (status === 429) return true;
  return status >= 500 && status <= 599;
}
