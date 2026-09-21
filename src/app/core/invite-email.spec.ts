// =============================================================
// Correo de invitación — contrato del CLIENTE (lógica pura).
//
// El envío real vive en una función de servidor (la clave del proveedor es un secreto).
// Lo que se prueba aquí es la parte que decide QUÉ LEE el propietario y QUÉ ENLACE se
// genera, con dos reglas que no se pueden relajar:
//   · nunca se presenta un envío como hecho si el proveedor solo lo aceptó (ni entregado);
//   · desde una build publicada no se ofrece jamás un enlace a localhost.
// =============================================================

import { describe, expect, it } from 'vitest';
import {
  EMAIL_ATTEMPT_LIMIT,
  EMAIL_COOLDOWN_SECONDS,
  STORED_EMAIL_LABEL,
  canRetryInvitationEmail,
  invitationIdFromSearch,
  invitationLink,
  invitationLinkPath,
  inviteEmailMessage,
  isStoredEmailStatus,
  normalizeInvitationId,
  parseInviteEmailResponse,
  retryWaitSeconds,
  storedEmailMessage,
} from './invite-email';

const ID = '11111111-2222-4333-8444-555555555555';

describe('invite-email — enlace de la invitación', () => {
  it('el enlace relativo es /invitations?invitation=<id>', () => {
    expect(invitationLinkPath(ID)).toBe(`/invitations?invitation=${ID}`);
  });

  it('respeta el base href de la aplicación (en Pages queda bajo /CDMPLab/)', () => {
    const link = invitationLink('https://usuario.github.io/CDMPLab/', ID);
    expect(link).toBe(`https://usuario.github.io/CDMPLab/invitations?invitation=${ID}`);
    expect(link).toContain('/CDMPLab/');
  });

  it('NUNCA ofrece un enlace a la máquina de desarrollo', () => {
    expect(invitationLink('http://localhost:4301/', ID)).toBeNull();
    expect(invitationLink('http://127.0.0.1:4200/', ID)).toBeNull();
    expect(invitationLink('http://0.0.0.0:4301/', ID)).toBeNull();
  });

  it('devuelve null con una base no utilizable en vez de inventar una URL', () => {
    expect(invitationLink('', ID)).toBeNull();
    expect(invitationLink('no-es-una-url', ID)).toBeNull();
  });

  it('extrae el identificador del enlace del correo (?invitation=…)', () => {
    expect(invitationIdFromSearch(`?invitation=${ID}`)).toBe(ID);
    expect(invitationIdFromSearch('invitation=' + ID)).toBe(ID);
    expect(invitationIdFromSearch('?otra=1')).toBeNull();
    expect(invitationIdFromSearch('?invitation=')).toBeNull();
  });

  it('normaliza el valor que llega por separado (el `get()` de la ruta)', () => {
    expect(normalizeInvitationId(ID)).toBe(ID);
    expect(normalizeInvitationId(`  ${ID}  `)).toBe(ID);
    expect(normalizeInvitationId('')).toBeNull();
    expect(normalizeInvitationId('   ')).toBeNull();
    expect(normalizeInvitationId(null)).toBeNull();
    expect(normalizeInvitationId(undefined)).toBeNull();
    // Un `ParamMap` serializado con el `toString()` genérico NO debe colarse como id.
    expect(normalizeInvitationId('[object Object]')).toBe('[object Object]');
    expect(invitationIdFromSearch('[object Object]')).toBeNull();
  });
});

describe('invite-email — estados del envío (nunca «entregado»)', () => {
  it('el estado guardado se etiqueta sin prometer entrega', () => {
    expect(STORED_EMAIL_LABEL.created).toBe('Sin enviar');
    expect(STORED_EMAIL_LABEL.provider_accepted).toContain('entrega no confirmada');
    expect(STORED_EMAIL_LABEL.provider_accepted.toLowerCase()).not.toContain('entregado');
    expect(STORED_EMAIL_LABEL.send_error).toBe('Error de envío');
  });

  it('el mensaje de un envío aceptado NO afirma que se haya entregado', () => {
    const msg = storedEmailMessage('provider_accepted', null);
    expect(msg).toContain('aceptó el envío');
    expect(msg).toContain('No consta');
    // Ni la palabra «entregado» ni una promesa equivalente.
    expect(msg.toLowerCase()).not.toContain('entregado');
  });

  it('el error de envío muestra el motivo guardado si lo hay', () => {
    expect(storedEmailMessage('send_error', 'el dominio no está verificado')).toContain(
      'el dominio no está verificado',
    );
    expect(storedEmailMessage('send_error', null)).toContain('Puedes reintentarlo');
  });

  it('reconoce solo los cuatro estados reales', () => {
    expect(isStoredEmailStatus('created')).toBe(true);
    expect(isStoredEmailStatus('delivered')).toBe(false);
    expect(isStoredEmailStatus(null)).toBe(false);
  });
});

describe('invite-email — respuesta de la función de servidor', () => {
  it('traduce los estados que la función devuelve', () => {
    const ok = parseInviteEmailResponse({
      ok: true,
      status: 'provider_accepted',
      message: 'aceptado',
      providerMessageId: 'abc',
    });
    expect(ok).toMatchObject({ ok: true, status: 'provider_accepted', providerMessageId: 'abc' });

    const error = parseInviteEmailResponse({ ok: false, status: 'send_error', message: 'boom' });
    expect(error).toMatchObject({ ok: false, status: 'send_error' });
    expect(inviteEmailMessage(error)).toContain('boom');
  });

  it('un estado desconocido NO se convierte en éxito', () => {
    const r = parseInviteEmailResponse({ ok: true, status: 'delivered' });
    expect(r.status).toBe('unknown');
    expect(r.ok).toBe(true); // el campo viene tal cual, pero el estado no se reconoce…
    // …y el mensaje no promete nada concreto.
    expect(inviteEmailMessage(r)).toContain('reintentarlo');
  });

  it('sin cuerpo devuelve un resultado neutro', () => {
    const r = parseInviteEmailResponse(undefined);
    expect(r.status).toBe('unknown');
    expect(r.ok).toBe(false);
  });

  it('cada estado tiene su mensaje en español', () => {
    expect(inviteEmailMessage({ ok: false, status: 'not_configured', message: '' })).toContain(
      'no está configurado',
    );
    expect(inviteEmailMessage({ ok: false, status: 'unauthorized', message: '' })).toContain(
      'sesión',
    );
    expect(inviteEmailMessage({ ok: false, status: 'email_cooldown', message: '' })).toContain(
      '60',
    );
    expect(inviteEmailMessage({ ok: false, status: 'email_attempt_limit', message: '' })).toContain(
      String(EMAIL_ATTEMPT_LIMIT),
    );
    expect(
      inviteEmailMessage({ ok: false, status: 'invitation_not_available', message: '' }),
    ).toContain('ya no está disponible');
    expect(inviteEmailMessage({ ok: false, status: 'forbidden', message: '' })).toContain(
      'propietario',
    );
  });
});

describe('invite-email — política de reintento', () => {
  const base = {
    status: 'pending',
    emailStatus: 'provider_accepted',
    emailAttempts: 1,
    lastEmailAt: null as string | null,
  };

  it('sin envío previo se puede enviar', () => {
    expect(canRetryInvitationEmail(base)).toBe(true);
    expect(retryWaitSeconds(base)).toBe(0);
  });

  it('tras un envío correcto hay que esperar el cooldown', () => {
    const ahora = Date.parse('2026-09-22T12:00:30.000Z');
    const inv = { ...base, lastEmailAt: '2026-09-22T12:00:00.000Z' };
    expect(retryWaitSeconds(inv, ahora)).toBe(EMAIL_COOLDOWN_SECONDS - 30);
    expect(canRetryInvitationEmail(inv, ahora)).toBe(false);
    // Pasado el minuto, vuelve a poder reintentarse.
    expect(canRetryInvitationEmail(inv, ahora + 31_000)).toBe(true);
  });

  it('un envío FALLIDO se puede reintentar de inmediato (igual que en el servidor)', () => {
    const inv = {
      ...base,
      emailStatus: 'send_error',
      lastEmailAt: new Date().toISOString(),
    };
    expect(canRetryInvitationEmail(inv)).toBe(true);
  });

  it('agotados los intentos no se ofrece reintento', () => {
    const inv = { ...base, emailStatus: 'send_error', emailAttempts: EMAIL_ATTEMPT_LIMIT };
    expect(canRetryInvitationEmail(inv)).toBe(false);
  });

  it('una invitación que ya no está pendiente no se reenvía', () => {
    expect(canRetryInvitationEmail({ ...base, status: 'accepted' })).toBe(false);
    expect(canRetryInvitationEmail({ ...base, status: 'expired' })).toBe(false);
  });

  it('una fecha de envío en el futuro no bloquea para siempre', () => {
    const ahora = Date.parse('2026-09-22T12:00:00.000Z');
    const inv = { ...base, lastEmailAt: '2026-09-22T13:00:00.000Z' };
    expect(retryWaitSeconds(inv, ahora)).toBe(0);
  });
});
