// =============================================================
// EntrenoLab — Correo de invitación: contrato del CLIENTE (lógica pura)
//
// El envío real lo hace una función de servidor (Supabase Edge Function
// `invite-team-member`), porque la clave del proveedor de correo es un SECRETO y no
// puede viajar al navegador. Aquí vive lo que el cliente necesita saber:
//   · los estados que la función puede devolver;
//   · el texto HONESTO de cada uno (nunca se presenta «correo entregado» cuando el
//     proveedor solo ha confirmado que ACEPTÓ el envío);
//   · el enlace de la invitación bajo el `base href` de la aplicación (en producción
//     queda bajo /CDMPLab/ y NUNCA con localhost);
//   · cuándo tiene sentido ofrecer un reintento.
//
// Es un módulo PURO (sin Angular, sin red) para poder probarlo con unitarias.
// =============================================================

/** Estado del CORREO que devuelve la función de servidor. */
export type InviteEmailOutcome =
  | 'provider_accepted'
  | 'send_error'
  | 'not_configured'
  | 'invalid_request'
  | 'unauthorized'
  | 'email_cooldown'
  | 'email_attempt_limit'
  | 'invitation_not_available'
  | 'forbidden'
  | 'method_not_allowed'
  | 'server_misconfigured'
  | 'unknown';

export interface InviteEmailResult {
  ok: boolean;
  status: InviteEmailOutcome;
  message: string;
  providerMessageId?: string;
}

/** Máximo de intentos por invitación (mismo tope que el servidor). */
export const EMAIL_ATTEMPT_LIMIT = 5;
/** Segundos de espera entre envíos correctos (mismo cooldown que el servidor). */
export const EMAIL_COOLDOWN_SECONDS = 60;

/** Estados del envío tal como los guarda la base (`team_invitations.email_status`). */
export type StoredEmailStatus = 'created' | 'send_pending' | 'provider_accepted' | 'send_error';

/** Etiqueta para el propietario. NUNCA promete entrega. */
export const STORED_EMAIL_LABEL: Record<StoredEmailStatus, string> = {
  created: 'Sin enviar',
  send_pending: 'Enviando…',
  provider_accepted: 'Aceptado por el proveedor (entrega no confirmada)',
  send_error: 'Error de envío',
};

/** Brevo puede bloquear una IP de salida desconocida aunque la clave API sea válida. */
function blockedProviderIp(error: string | null): boolean {
  return /(?:unrecognised|unrecognized|unauthorized) ip address/i.test(error ?? '');
}

function sendErrorMessage(error: string | null): string {
  if (blockedProviderIp(error)) {
    return 'Brevo ha bloqueado el envío por una IP no autorizada. La invitación sigue activa: puedes copiar el enlace. Hay que revisar la seguridad de Brevo antes de reenviar.';
  }
  return error
    ? `No se pudo enviar el correo: ${error}`
    : 'No se pudo enviar el correo. Puedes reintentarlo.';
}

/** ¿El estado guardado es uno de los conocidos? (defensa ante datos antiguos). */
export function isStoredEmailStatus(value: string | null | undefined): value is StoredEmailStatus {
  return (
    value === 'created' ||
    value === 'send_pending' ||
    value === 'provider_accepted' ||
    value === 'send_error'
  );
}

/** Mensaje en español para el propietario, a partir del estado guardado. */
export function storedEmailMessage(status: StoredEmailStatus, error: string | null): string {
  if (status === 'send_error') {
    return sendErrorMessage(error);
  }
  if (status === 'provider_accepted') {
    // Honestidad: el proveedor aceptó el envío; NO consta que se haya entregado.
    return 'El proveedor de correo aceptó el envío. No consta todavía la entrega.';
  }
  if (status === 'send_pending') return 'Envío en curso.';
  return 'Todavía no se ha intentado enviar el correo.';
}

/**
 * Enlace de la invitación RELATIVO. Es el mismo `link_path` que compone el servidor:
 * el identificador de la invitación NO concede acceso (la aceptación vuelve a comprobar
 * en el servidor el correo confirmado de quien entra).
 */
export function invitationLinkPath(invitationId: string): string {
  return `/invitations?invitation=${encodeURIComponent(invitationId)}`;
}

/**
 * Enlace ABSOLUTO a partir del `base href` real de la aplicación (en la build de Pages
 * es `/CDMPLab/`). Devuelve null si la base no es utilizable: mejor no mostrar enlace
 * que mostrar uno que apunte a localhost.
 */
export function invitationLink(baseHref: string, invitationId: string): string | null {
  try {
    const url = new URL(invitationLinkPath(invitationId).replace(/^\//, ''), baseHref);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // La build publicada NUNCA puede ofrecer un enlace a la máquina de desarrollo.
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Identificador de invitación que llega en la URL (`?invitation=…`), o null. */
export function invitationIdFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('invitation');
  return normalizeInvitationId(raw);
}

/**
 * Normaliza el valor de `?invitation=…` venga de donde venga (una cadena de búsqueda o el
 * `get('invitation')` de la ruta). Cadena vacía o solo espacios → null.
 *
 * Se usa esta función en la pantalla a propósito: serializar el `ParamMap` de Angular con
 * `toString()` devuelve el `toString` genérico de `Object` en Angular 22, así que el
 * identificador se perdía sin error (lo detectó la prueba E2E del enlace).
 */
export function normalizeInvitationId(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v === '' ? null : v;
}

/**
 * Traduce la respuesta de la función de servidor a un resultado tipado. Cualquier cosa
 * que no reconozcamos se convierte en `unknown` con un mensaje genérico: NUNCA se
 * presenta un éxito inventado.
 */
export function parseInviteEmailResponse(payload: unknown): InviteEmailResult {
  const p = (payload ?? {}) as Record<string, unknown>;
  const status = typeof p['status'] === 'string' ? (p['status'] as InviteEmailOutcome) : 'unknown';
  const message = typeof p['message'] === 'string' ? p['message'] : '';
  const providerMessageId =
    typeof p['providerMessageId'] === 'string' ? p['providerMessageId'] : undefined;
  const ok = p['ok'] === true;
  const conocidos: InviteEmailOutcome[] = [
    'provider_accepted',
    'send_error',
    'not_configured',
    'invalid_request',
    'unauthorized',
    'email_cooldown',
    'email_attempt_limit',
    'invitation_not_available',
    'forbidden',
    'method_not_allowed',
    'server_misconfigured',
  ];
  const estado: InviteEmailOutcome = conocidos.includes(status) ? status : 'unknown';
  return {
    ok,
    status: estado,
    message: message || inviteEmailMessage({ ok, status: estado, message: '' }),
    ...(providerMessageId ? { providerMessageId } : {}),
  };
}

/** Texto en español para el propietario cuando la función responde. */
export function inviteEmailMessage(result: InviteEmailResult): string {
  switch (result.status) {
    case 'provider_accepted':
      return 'El proveedor de correo ha aceptado el envío. Eso no confirma todavía la entrega.';
    case 'send_error':
      return sendErrorMessage(result.message);
    case 'not_configured':
      return 'El envío de correo todavía no está configurado en el servidor. La invitación sigue creada y podrás enviarla cuando se configure.';
    case 'invalid_request':
      return 'No se pudo enviar: la petición no era válida.';
    case 'unauthorized':
      return 'Tu sesión ha caducado. Vuelve a iniciar sesión y reinténtalo.';
    case 'email_cooldown':
      return `Ya se ha enviado hace menos de ${EMAIL_COOLDOWN_SECONDS} segundos. Espera un momento antes de reintentar.`;
    case 'email_attempt_limit':
      return `Se alcanzó el máximo de ${EMAIL_ATTEMPT_LIMIT} intentos para esta invitación. Cancélala y crea una nueva si necesitas volver a enviarla.`;
    case 'invitation_not_available':
      return 'La invitación ya no está disponible (aceptada, cancelada o caducada).';
    case 'forbidden':
      return 'Solo el propietario del equipo puede enviar esta invitación.';
    case 'method_not_allowed':
      return 'No se pudo enviar: la petición no era válida.';
    case 'server_misconfigured':
      return 'El envío de correo está mal configurado en el servidor. Avisa a quien administra la plataforma.';
    default:
      return 'No se pudo enviar el correo. Puedes reintentarlo.';
  }
}

/** Segundos que faltan para poder reintentar según el cooldown (0 si ya se puede). */
export function retryWaitSeconds(
  invitation: { emailStatus: string; lastEmailAt: string | null },
  now: number = Date.now(),
): number {
  // Un envío FALLIDO se puede reintentar de inmediato (así lo permite el servidor).
  if (invitation.emailStatus === 'send_error') return 0;
  if (!invitation.lastEmailAt) return 0;
  const transcurrido = Math.floor((now - new Date(invitation.lastEmailAt).getTime()) / 1000);
  if (!Number.isFinite(transcurrido) || transcurrido < 0) return 0;
  return Math.max(0, EMAIL_COOLDOWN_SECONDS - transcurrido);
}

/**
 * ¿Tiene sentido ofrecer «reenviar» para esta invitación? Solo si sigue pendiente, no se
 * agotaron los intentos y no hay que esperar el cooldown.
 */
export function canRetryInvitationEmail(
  invitation: {
    status: string;
    emailStatus: string;
    emailAttempts: number;
    lastEmailAt: string | null;
  },
  now: number = Date.now(),
): boolean {
  if (invitation.status !== 'pending') return false;
  if (invitation.emailAttempts >= EMAIL_ATTEMPT_LIMIT) return false;
  return retryWaitSeconds(invitation, now) === 0;
}
