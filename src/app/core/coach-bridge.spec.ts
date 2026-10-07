import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureCoachTransfer, deliverPngToCoach, hasCoachTransfer } from './coach-bridge';

const nonce = '12345678-1234-4123-8123-123456789abc';

afterEach(() => {
  sessionStorage.removeItem('cdmplab:coach-transfer');
  history.replaceState(null, '', location.pathname);
  Object.defineProperty(window, 'opener', { configurable: true, value: null });
  vi.restoreAllMocks();
});

describe('transferencia PNG a Coach', () => {
  it('solo acepta una apertura con nonce válido y elimina el parámetro de la URL', () => {
    Object.defineProperty(window, 'opener', { configurable: true, value: window });
    history.replaceState(null, '', '?coachTransfer=' + nonce);
    captureCoachTransfer();
    expect(hasCoachTransfer()).toBe(true);
    expect(location.search).toBe('');
  });

  it('ignora un nonce arbitrario', () => {
    Object.defineProperty(window, 'opener', { configurable: true, value: window });
    history.replaceState(null, '', '?coachTransfer=not-a-token');
    captureCoachTransfer();
    expect(hasCoachTransfer()).toBe(false);
  });

  it('espera la confirmación de Coach y rechaza respuestas de otro origen', async () => {
    Object.defineProperty(window, 'opener', { configurable: true, value: window });
    history.replaceState(null, '', '?coachTransfer=' + nonce);
    captureCoachTransfer();
    const send = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const transfer = deliverPngToCoach('data:image/png;base64,aGVsbG8=', 'prueba.png');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CDMPLAB_COACH_PNG', nonce }),
      'https://coach.cdmpizarrales.es',
    );
    let confirmed = false;
    void transfer.then(() => (confirmed = true));
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://otro.example',
        source: window,
        data: { kind: 'CDMPLAB_COACH_ACK', nonce, success: true },
      }),
    );
    await Promise.resolve();
    expect(confirmed).toBe(false);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://coach.cdmpizarrales.es',
        source: window,
        data: { kind: 'CDMPLAB_COACH_ACK', nonce, success: true },
      }),
    );
    await transfer;
    expect(hasCoachTransfer()).toBe(false);
  });
});
