// =============================================================
// EntrenoLab / CDMPLab — Edge Function: envío REAL del correo de invitación a un equipo.
//
// QUÉ HACE, EN ORDEN (el orden importa y está justificado):
//   1. Solo POST (y OPTIONS para CORS). Cuerpo `{ invitationId: "<uuid>" }`.
//   2. Exige la cabecera `Authorization`. NO comprueba permisos: los comprueba Postgres con
//      ese mismo JWT dentro de `prepare_invitation_email` (que exige ser propietario del
//      equipo). Aquí no hay nada que autorizar por nuestra cuenta.
//   3. Comprueba la configuración de correo ANTES de tocar la base: si falta, responde
//      `not_configured` sin llamar a la RPC, de modo que NO se consume ningún intento.
//   4. Llama a `prepare_invitation_email` (cooldown de 60 s, máximo 5 intentos, marca
//      `send_pending`) y construye el enlace con `buildInviteLink`. La RPC devuelve además el
//      `attempt_id` del INTENTO abierto.
//   5. Envía por HTTPS al proveedor y TRADUCE su respuesta.
//   6. Registra SIEMPRE el resultado con `record_invitation_email_result`, **con la credencial
//      de servicio** y **con el `attempt_id`**: esa RPC no es ejecutable por el navegador
//      (EXECUTE revocado a `authenticated`), así que un propietario no puede falsificar un
//      `provider_accepted`; y al ir vinculada al intento, la respuesta tardía de un envío
//      anterior no puede sobrescribir el intento vigente.
//
// QUÉ NO HACE A PROPÓSITO:
//   · No reintenta solo. El reintento lo pide el propietario y lo gobiernan la base (cooldown
//     y tope de intentos) y `isRetriableHttp`, que decide si el error invita a reintentar.
//     Un reintento automático aquí multiplicaría los correos sin que nadie lo haya pedido.
//   · No registra en consola el identificador de la invitación, el correo, el enlace ni
//     ninguna clave: solo líneas estructurales (`provider=… status=…`).
//   · No guarda el cuerpo de la respuesta del proveedor: solo el mensaje, redactado.
//   · No usa la credencial de servicio para autorizar nada: la autorización del propietario la
//     hace Postgres con el JWT del llamante. La credencial de servicio se usa EXCLUSIVAMENTE
//     para escribir el resultado del proveedor, que es un dato que solo el servidor conoce.
// =============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  EMAIL_ENV_VARS,
  PLATFORM_ENV_VARS,
  RECORDER_ENV_VAR,
  buildInviteLink,
  isRetriableHttp,
  mapProviderResponse,
  providerRequest,
  redactError,
  renderInviteEmail,
  resolveSendReadiness,
} from '../_shared/invite-email.ts';

/** CORS: el cliente web vive en otro origen (GitHub Pages). Se permite cualquier origen
 *  porque la autenticación viaja en la cabecera `Authorization` (nunca en cookies), así que
 *  `*` no da acceso a nadie que no traiga ya su propio token. */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Mensajes para el usuario, en español (la interfaz los muestra tal cual). */
const MESSAGES = {
  invalidRequest: 'La petición no es válida.',
  methodNotAllowed: 'Método no permitido.',
  unauthorized: 'Tu sesión no es válida o ha caducado. Vuelve a iniciar sesión.',
  forbidden: 'Solo el propietario del equipo puede enviar esta invitación.',
  invitationNotAvailable:
    'La invitación ya no está disponible (caducó, se aceptó, se rechazó o se revocó).',
  emailCooldown:
    'Acabas de enviar esta invitación. Espera un minuto antes de volver a enviarla para no llenar el buzón.',
  emailAttemptLimit:
    'Se ha alcanzado el máximo de 5 envíos para esta invitación. Crea una invitación nueva si necesitas intentarlo otra vez.',
  providerAccepted:
    'El proveedor de correo ha aceptado el envío. No es una confirmación de entrega: puede tardar unos minutos en llegar (revisa también la carpeta de correo no deseado).',
  sendError:
    'No se pudo enviar el correo: el proveedor rechazó la petición. Revisa la dirección y la configuración del remitente.',
  sendErrorRetriable:
    'No se pudo enviar el correo porque el proveedor no está disponible. Puedes volver a intentarlo dentro de un momento.',
  notConfigured:
    'El envío de correos todavía no está configurado en el servidor. No se ha intentado ningún envío, no se ha consumido ningún intento y el estado del envío NO ha cambiado. La invitación sigue creada: puedes compartir el enlace a mano.',
  serverMisconfigured: 'Falta configuración del servidor para enviar correos.',
  staleAttempt:
    'El resultado que ha llegado corresponde a un intento anterior y se ha ignorado: no cambia el estado del envío actual.',
};

/** Respuesta de la función: el cuerpo SIEMPRE tiene esta forma, sea cual sea el código HTTP. */
interface InviteEmailReply {
  ok: boolean;
  status: string;
  message: string;
  providerMessageId?: string;
}

/** Lo que devuelve `prepare_invitation_email` (contrato congelado, exactamente estas claves). */
interface PreparedInvitation {
  invitation_id: string;
  team_id: string;
  team_name: string;
  email: string;
  link_path: string;
  /** Identificador del INTENTO abierto por la RPC. Se devuelve al registrar el resultado. */
  attempt_id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Código HTTP de cada `status`.
 *
 * POR QUÉ CASI TODO ES 200: el contrato congelado solo fija el código de tres casos
 * (`not_configured` → 200, `invalid_request` → 400, `unauthorized` → 401) y el cliente de la
 * aplicación usa `supabase.functions.invoke`, que **solo rellena `data` con el cuerpo cuando
 * la respuesta es 2xx**: con un 429 o un 409 `data` llega `null` y el mensaje en español se
 * pierde, justo en los estados que más falta hacen al propietario (cooldown, tope de intentos,
 * no propietario). Así que:
 *   · 400 / 401 / 405 → la petición no llegó a ser una petición de negocio válida;
 *   · 200 → la función atendió la petición; el CUERPO (`ok`, `status`, `message`) es la
 *     fuente de verdad y distingue todos los estados.
 * Si algún día el cliente lee el cuerpo de una respuesta no-2xx, estos códigos se pueden
 * volver semánticos (429, 409, 403…) sin tocar el cuerpo.
 */
function httpStatusFor(status: string): number {
  switch (status) {
    case 'invalid_request':
      return 400;
    case 'unauthorized':
      return 401;
    case 'method_not_allowed':
      return 405;
    default:
      return 200;
  }
}

function respond(reply: InviteEmailReply): Response {
  return new Response(JSON.stringify(reply), {
    status: httpStatusFor(reply.status),
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Log estructural: SOLO lo que no identifica a nadie. Nunca el id, el correo, el enlace ni
 *  una clave. Existe para poder diagnosticar sin abrir la base de datos. */
function logEvent(fields: string): void {
  console.log('invite-email: ' + fields);
}

function logProblem(fields: string): void {
  console.error('invite-email: ' + fields);
}

/** Traduce el error de PostgREST (`error.message`) al `status` que entiende la interfaz. */
function translateRpcError(message: string): { status: string; message: string } {
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  if (text.includes('stale_email_attempt')) {
    // Respuesta de un intento ya superado: se ignora a propósito (no es un fallo del envío).
    return { status: 'stale_email_attempt', message: MESSAGES.staleAttempt };
  }
  if (text.includes('email_attempt_required')) {
    return { status: 'stale_email_attempt', message: MESSAGES.staleAttempt };
  }
  if (text.includes('not_authenticated')) {
    return { status: 'unauthorized', message: MESSAGES.unauthorized };
  }
  if (text.includes('forbidden')) {
    return { status: 'forbidden', message: MESSAGES.forbidden };
  }
  if (text.includes('invitation_not_available')) {
    return { status: 'invitation_not_available', message: MESSAGES.invitationNotAvailable };
  }
  if (text.includes('email_cooldown')) {
    return { status: 'email_cooldown', message: MESSAGES.emailCooldown };
  }
  if (text.includes('email_attempt_limit')) {
    return { status: 'email_attempt_limit', message: MESSAGES.emailAttemptLimit };
  }
  // Cualquier otro error (red, RLS, un fallo inesperado del servidor) se trata como fallo de
  // envío: es lo único honesto que se puede afirmar.
  return { status: 'send_error', message: MESSAGES.sendError };
}

/** `invitationId` del cuerpo, o cadena vacía si el cuerpo no trae un texto usable. */
function readInvitationId(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const value = (payload as Record<string, unknown>).invitationId;
  return typeof value === 'string' ? value.trim() : '';
}

/** Cuerpo de la petición como JSON, o `null` si no es JSON válido (ni una cosa ni la otra
 *  puede tumbar la función: un cuerpo ilegible es una petición inválida, no un error 500). */
async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Valida la forma del jsonb que devuelve la RPC antes de usarlo. */
function readPrepared(value: unknown): PreparedInvitation | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const invitationId = readText(record.invitation_id);
  const email = readText(record.email);
  const linkPath = readText(record.link_path);
  const attemptId = readText(record.attempt_id);
  if (!UUID_RE.test(invitationId) || email === '' || !email.includes('@') || linkPath === '') {
    return null;
  }
  // Sin el identificador del intento NO se puede registrar el resultado (la RPC lo exige), así
  // que un payload que no lo traiga se trata como no utilizable en vez de enviar a ciegas.
  if (!UUID_RE.test(attemptId)) return null;
  return {
    invitation_id: invitationId,
    team_id: readText(record.team_id),
    team_name: readText(record.team_name),
    email,
    link_path: linkPath,
    attempt_id: attemptId,
  };
}

/**
 * Nombre visible de quien invita, SOLO para presentación.
 *
 * Se lee de `user_metadata`, que el propio usuario puede editar: por eso se usa únicamente
 * como texto (escapado) dentro del correo y JAMÁS para autorizar nada — la autorización la
 * hace Postgres con el JWT. Si no hay nombre, el correo usa una fórmula neutra sin nombre.
 */
function displayNameOf(user: unknown): string {
  if (typeof user !== 'object' || user === null) return '';
  const metadata = (user as Record<string, unknown>).user_metadata;
  if (typeof metadata !== 'object' || metadata === null) return '';
  const record = metadata as Record<string, unknown>;
  for (const key of ['full_name', 'fullName', 'name', 'display_name']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim().slice(0, 120);
  }
  return '';
}

/** Cuerpo del proveedor como objeto JSON, o `null` si no es JSON (el texto crudo NO se guarda). */
function parseJsonBody(raw: string): unknown {
  if (raw.trim() === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ---------- CORS ----------
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return respond({ ok: false, status: 'method_not_allowed', message: MESSAGES.methodNotAllowed });
  }

  // ---------- Cuerpo ----------
  const invitationId = readInvitationId(await readJsonBody(req));
  if (!UUID_RE.test(invitationId)) {
    return respond({ ok: false, status: 'invalid_request', message: MESSAGES.invalidRequest });
  }

  // ---------- Sesión del llamante (la autorización real la aplica Postgres) ----------
  const authorization = (req.headers.get('Authorization') ?? '').trim();
  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (bearer === null) {
    return respond({ ok: false, status: 'unauthorized', message: MESSAGES.unauthorized });
  }
  const callerJwt = bearer[1] ?? '';

  // ---------- PUERTA DE CONFIGURACIÓN: antes de abrir un intento y antes de enviar ----------
  // Se comprueba TODO lo necesario para (a) autenticar al llamante, (b) enviar por el proveedor
  // y (c) REGISTRAR el resultado con la credencial del servidor. Si falta algo, se responde un
  // error de configuración SIN tocar nada: no se llama a `prepare_invitation_email` (no se abre
  // intento ni se gasta uno de los 5), no se llama al proveedor (cero envíos) y el estado de la
  // invitación NO cambia. Antes esta comprobación estaba repartida y una credencial ausente podía
  // descubrirse DESPUÉS de enviar, dejando un correo en camino que nadie podía registrar.
  const env: Record<string, string | undefined> = {};
  for (const name of [...EMAIL_ENV_VARS, ...PLATFORM_ENV_VARS, RECORDER_ENV_VAR]) {
    env[name] = Deno.env.get(name);
  }
  const readiness = resolveSendReadiness(env);
  if (!readiness.ok) {
    // Los NOMBRES de lo que falta son información de operación, no un secreto.
    logProblem('not_configured missing=' + readiness.missing.join(','));
    return respond({ ok: false, status: 'not_configured', message: MESSAGES.notConfigured });
  }
  const config = readiness.config;

  const supabaseUrl = readText(env['SUPABASE_URL']);
  const anonKey = readText(env['SUPABASE_ANON_KEY']) || readText(env['SUPABASE_PUBLISHABLE_KEY']);
  const serviceKey = readText(env[RECORDER_ENV_VAR]);

  // El cliente va con el JWT del llamante: `anon` como clave pública y la sesión del usuario en
  // la cabecera, de modo que las RPC se ejecutan COMO ESE USUARIO. Es el que autoriza al
  // propietario en `prepare_invitation_email`.
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------- Cliente del SERVIDOR, solo para registrar el resultado del proveedor ----------
  // `record_invitation_email_result` NO es ejecutable por `authenticated` (EXECUTE revocado):
  // es la garantía de que un propietario no puede falsificar un `provider_accepted` con una
  // llamada directa. Esta clave vive SOLO en el servidor (la inyecta la plataforma en las Edge
  // Functions) y nunca se devuelve, ni se registra, ni se usa para autorizar al usuario.
  const recorderClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /** Registra el resultado REAL del envío con la credencial de servicio y contra el intento
   *  preparado. Si el registro falla, la fila queda en `send_pending` y se deja constancia
   *  en el log; la credencial ausente se rechazó ANTES de abrir el intento. */
  const recordResult = async (
    attemptId: string,
    status: 'provider_accepted' | 'send_error',
    providerMessageId: string | null,
    errorText: string | null,
  ): Promise<void> => {
    const { error } = await recorderClient.rpc('record_invitation_email_result', {
      p_invitation_id: invitationId,
      p_attempt_id: attemptId,
      p_status: status,
      p_provider_message_id: providerMessageId,
      p_error: errorText === null ? null : redactError(errorText),
    });
    if (error !== null && error !== undefined) {
      // `stale_email_attempt` es ESPERADO (una respuesta tardía de un intento anterior): se
      // registra como aviso, no como problema, y el estado del intento vigente no se toca.
      const texto = String(error.message ?? '');
      if (texto.includes('stale_email_attempt')) {
        logEvent('record_result_ignored reason=stale_email_attempt');
      } else {
        logProblem('record_result_failed status=' + status);
      }
    }
  };

  // ---------- Nombre de quien invita (presentación, nunca autorización) ----------
  // Es `let` porque el `catch` también tiene que dejarlo utilizable: si la consulta falla, el
  // correo sale con una fórmula neutra en vez de con un hueco.
  let inviterName: string;
  try {
    const { data: caller } = await client.auth.getUser(callerJwt);
    inviterName = displayNameOf(caller?.user);
  } catch (cause) {
    inviterName = '';
    logProblem('inviter_name_unavailable error=' + redactError(cause));
  }

  // ---------- Preparar el envío (autoriza, cooldown, tope de 5, marca send_pending) ----------
  const { data: prepared, error: prepareError } = await client.rpc('prepare_invitation_email', {
    p_invitation_id: invitationId,
  });
  if (prepareError !== null && prepareError !== undefined) {
    const translated = translateRpcError(readText(prepareError.message));
    logEvent('provider=' + config.provider + ' status=' + translated.status);
    return respond({ ok: false, status: translated.status, message: translated.message });
  }

  const invitation = readPrepared(prepared);
  if (invitation === null) {
    // Sin payload utilizable (o sin `attempt_id`) no se puede registrar nada: la RPC exige el
    // intento, así que aquí solo se avisa. No se envía a ciegas.
    logProblem('prepare_payload_unexpected status=send_error');
    logEvent('provider=' + config.provider + ' status=send_error');
    return respond({ ok: false, status: 'send_error', message: MESSAGES.sendError });
  }

  // ---------- Enviar ----------
  // El envío se aisla en una función que SIEMPRE devuelve un resultado: así no hay ninguna
  // variable a medio asignar si `fetch` lanza, y no hay camino que se salte el registro.
  const send = async (): Promise<{
    outcome: { ok: boolean; providerMessageId?: string; error?: string };
    retriable: boolean;
    providerHttpStatus: number;
  }> => {
    try {
      const link = buildInviteLink(config.linkBase, invitation.link_path);
      const message = renderInviteEmail({
        teamName: invitation.team_name,
        inviterName,
        link,
      });
      const request = providerRequest(config.provider, config, {
        to: invitation.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      });
      const rawBody = await response.text();
      const outcome = mapProviderResponse(config.provider, response.status, parseJsonBody(rawBody));
      return {
        outcome,
        retriable: outcome.ok ? false : isRetriableHttp(response.status),
        providerHttpStatus: response.status,
      };
    } catch (cause) {
      // Fallo de red o del enlace: se registra igual que un rechazo del proveedor, con el
      // mensaje redactado. Un fallo de red sí invita a reintentar.
      return {
        outcome: { ok: false, error: redactError(cause) },
        retriable: true,
        providerHttpStatus: 0,
      };
    }
  };

  const sent = await send();

  // ---------- Registrar y responder ----------
  if (sent.outcome.ok) {
    await recordResult(
      invitation.attempt_id,
      'provider_accepted',
      sent.outcome.providerMessageId ?? null,
      null,
    );
    logEvent('provider=' + config.provider + ' status=provider_accepted');
    return respond({
      ok: true,
      status: 'provider_accepted',
      message: MESSAGES.providerAccepted,
      providerMessageId: sent.outcome.providerMessageId,
    });
  }

  const errorText =
    typeof sent.outcome.error === 'string' && sent.outcome.error !== ''
      ? sent.outcome.error
      : 'provider_http_' + sent.providerHttpStatus;
  await recordResult(invitation.attempt_id, 'send_error', null, errorText);
  logEvent(
    'provider=' + config.provider + ' status=send_error retriable=' + String(sent.retriable),
  );
  return respond({
    ok: false,
    status: 'send_error',
    message: sent.retriable ? MESSAGES.sendErrorRetriable : MESSAGES.sendError,
  });
});
