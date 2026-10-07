import { signal } from '@angular/core';

/** Transferencia voluntaria de un PNG a la pestaña de Coach que abrió CDMPLab. */
const coachOrigin = 'https://coach.cdmpizarrales.es';
const transferKey = 'cdmplab:coach-transfer';
const noncePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CoachDraft {
  title: string;
  development: string;
  aspects: string;
  progression: string;
  players: number | null;
  durationMinutes: number | null;
}

const incomingDraft = signal<CoachDraft | null>(null);
export const coachDraft = incomingDraft.asReadonly();
let draftListenerInstalled = false;

function boundedText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function boundedNumber(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
    ? value
    : null;
}

export function captureCoachTransfer(): void {
  const url = new URL(window.location.href);
  const nonce = url.searchParams.get('coachTransfer');
  if (nonce) {
    if (noncePattern.test(nonce) && window.opener) {
      sessionStorage.setItem(transferKey, nonce);
      incomingDraft.set(null);
    }
    url.searchParams.delete('coachTransfer');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  if (!hasCoachTransfer()) return;
  if (!draftListenerInstalled) {
    draftListenerInstalled = true;
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.origin !== coachOrigin || event.source !== window.opener) return;
      if (event.data?.kind !== 'CDMPLAB_COACH_DRAFT') return;
      if (event.data.nonce !== sessionStorage.getItem(transferKey)) return;
      const data = event.data.draft;
      if (!data || typeof data !== 'object') return;
      incomingDraft.set({
        title: boundedText(data.title, 160),
        development: boundedText(data.development, 4000),
        aspects: boundedText(data.aspects, 4000),
        progression: boundedText(data.progression, 4000),
        players: boundedNumber(data.players, 99),
        durationMinutes: boundedNumber(data.durationMinutes, 240),
      });
    });
  }
  window.opener!.postMessage(
    { kind: 'CDMPLAB_COACH_READY', nonce: sessionStorage.getItem(transferKey) },
    coachOrigin,
  );
}

export function hasCoachTransfer(): boolean {
  return Boolean(window.opener && noncePattern.test(sessionStorage.getItem(transferKey) ?? ''));
}

export function deliverPngToCoach(dataUrl: string, fileName: string): Promise<void> {
  if (!hasCoachTransfer()) return Promise.reject(new Error('No se encontró la pestaña de Coach.'));
  if (!/^data:image\/png;base64,/.test(dataUrl)) {
    return Promise.reject(new Error('La exportación no produjo un PNG válido.'));
  }
  const nonce = sessionStorage.getItem(transferKey)!;
  const opener = window.opener!;
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (error) reject(error);
      else {
        sessionStorage.removeItem(transferKey);
        resolve();
      }
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== coachOrigin || event.source !== opener) return;
      if (event.data?.kind !== 'CDMPLAB_COACH_ACK' || event.data?.nonce !== nonce) return;
      finish(event.data.success ? undefined : new Error('Coach no pudo adjuntar la imagen.'));
    };
    const timeout = window.setTimeout(
      () => finish(new Error('Coach no confirmó la imagen.')),
      10_000,
    );
    window.addEventListener('message', onMessage);
    opener.postMessage({ kind: 'CDMPLAB_COACH_PNG', nonce, dataUrl, fileName }, coachOrigin);
  });
}
