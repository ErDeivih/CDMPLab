/** Transferencia voluntaria de un PNG a la pestaña de Coach que abrió CDMPLab. */
const coachOrigin = 'https://coach.cdmpizarrales.es';
const transferKey = 'cdmplab:coach-transfer';
const noncePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function captureCoachTransfer(): void {
  const url = new URL(window.location.href);
  const nonce = url.searchParams.get('coachTransfer');
  if (!nonce) return;
  if (noncePattern.test(nonce) && window.opener) sessionStorage.setItem(transferKey, nonce);
  url.searchParams.delete('coachTransfer');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
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
