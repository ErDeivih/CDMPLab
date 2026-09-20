// =============================================================
// EntrenoLab — ORIENTACIÓN y PANTALLA COMPLETA (FASE 4 del encargo).
//
// La pizarra intenta abrirse a pantalla completa y bloquear la orientación horizontal en móvil,
// pero NINGUNA de las dos cosas está garantizada: `screen.orientation.lock` solo funciona en
// pantalla completa, varios navegadores no la implementan y el usuario puede denegarla. Este
// módulo concentra la lógica en funciones PURAS (probables sin navegador) y deja las llamadas al
// navegador en un envoltorio pequeño con `try/catch`: si algo falla, la app sigue funcionando y
// solo se muestra un aviso descartable.
// =============================================================

export type OrientacionCampo = 'horizontal' | 'vertical';

/** Orientación que le corresponde a un campo para el tamaño de pantalla dado.
 *  - Vertical (más alto que ancho) → campo VERTICAL, que es el que aprovecha la pantalla.
 *  - Horizontal (más ancho que alto) → campo HORIZONTAL.
 *  Es la degradación cuando el navegador NO permite bloquear la orientación (FASE 4.7). */
export function orientacionDeseada(ancho: number, alto: number): OrientacionCampo {
  return alto > ancho ? 'vertical' : 'horizontal';
}

/** ¿El documento está en vertical? (mismo criterio que `orientacionDeseada`). */
export function esVertical(ancho: number, alto: number): boolean {
  return orientacionDeseada(ancho, alto) === 'vertical';
}

/** Lo mínimo que necesitamos del navegador, para poder probarlo con dobles. */
export interface CapacidadesPantalla {
  /** `document.fullscreenEnabled` (algunos navegadores no la exponen). */
  pantallaCompletaSoportada?: boolean;
  /** `screen.orientation.lock` (no existe en iOS/Safari, por ejemplo). */
  bloqueoOrientacion?: boolean;
}

/** ¿Se puede INTENTAR el bloqueo de orientación? No dice que vaya a funcionar: `lock()` puede
 *  rechazar la promesa aunque exista (por eso todo va envuelto en `try/catch`). */
export function puedeIntentarBloqueo(cap: CapacidadesPantalla): boolean {
  return Boolean(cap.pantallaCompletaSoportada) && Boolean(cap.bloqueoOrientacion);
}

/**
 * ¿Hay que adaptar el campo SOLO, sin preguntar?
 *
 * CONTRATO (FASE 4.8/4.9): un ejercicio NUEVO (borrador, sin documento guardado) se adapta
 * automáticamente al girar el móvil. Un ejercicio YA GUARDADO **no** se reescribe nunca en
 * silencio: su orientación es parte de su contenido y el usuario decide con «Adaptar a la
 * pantalla».
 */
export function debeAdaptarAutomaticamente(esEjercicioGuardado: boolean): boolean {
  return !esEjercicioGuardado;
}

/** ¿El campo del documento coincide con la orientación de la pantalla? (para ofrecer «Adaptar»). */
export function convieneOfrecerAdaptar(
  campo: OrientacionCampo,
  ancho: number,
  alto: number,
): boolean {
  return campo !== orientacionDeseada(ancho, alto);
}

/** Mensaje corto y descartable que se muestra cuando el navegador no permite girar la pantalla. */
export const AVISO_SIN_BLOQUEO =
  'Tu navegador no permite girar la pantalla. Gira el móvil a mano: la pizarra se adapta.';
