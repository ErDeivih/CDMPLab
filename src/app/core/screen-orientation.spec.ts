import { describe, expect, it } from 'vitest';
import {
  AVISO_SIN_BLOQUEO,
  convieneOfrecerAdaptar,
  debeAdaptarAutomaticamente,
  esVertical,
  orientacionDeseada,
  puedeIntentarBloqueo,
} from './screen-orientation';

/**
 * FASE 4 del encargo — orientación y pantalla completa.
 *
 * Estas pruebas fijan la parte que NO depende del navegador: qué orientación toca según la
 * pantalla, cuándo se puede intentar el bloqueo y —lo más importante— cuándo se adapta el campo
 * solo y cuándo hay que preguntar al usuario.
 */
describe('orientación de la pizarra (FASE 4)', () => {
  it('móvil vertical (390×844) → campo VERTICAL; móvil horizontal (844×390) → campo HORIZONTAL', () => {
    expect(orientacionDeseada(390, 844)).toBe('vertical');
    expect(orientacionDeseada(844, 390)).toBe('horizontal');
    expect(esVertical(390, 844)).toBe(true);
    expect(esVertical(844, 390)).toBe(false);
  });

  it('escritorio ancho → horizontal; tablet en vertical → vertical', () => {
    expect(orientacionDeseada(1366, 900)).toBe('horizontal');
    expect(orientacionDeseada(768, 1024)).toBe('vertical');
  });

  it('solo se intenta el bloqueo si el navegador ofrece AMBAS cosas', () => {
    expect(
      puedeIntentarBloqueo({ pantallaCompletaSoportada: true, bloqueoOrientacion: true }),
    ).toBe(true);
    // iOS/Safari: no hay `screen.orientation.lock`.
    expect(
      puedeIntentarBloqueo({ pantallaCompletaSoportada: true, bloqueoOrientacion: false }),
    ).toBe(false);
    // Sin pantalla completa el bloqueo no tiene sentido (y el navegador lo rechazaría).
    expect(
      puedeIntentarBloqueo({ pantallaCompletaSoportada: false, bloqueoOrientacion: true }),
    ).toBe(false);
    expect(puedeIntentarBloqueo({})).toBe(false);
  });

  it('un ejercicio NUEVO se adapta solo; uno GUARDADO nunca se reescribe en silencio', () => {
    expect(debeAdaptarAutomaticamente(false), 'borrador nuevo: sí').toBe(true);
    expect(
      debeAdaptarAutomaticamente(true),
      'ejercicio guardado: se pregunta con «Adaptar a la pantalla»',
    ).toBe(false);
  });

  it('«Adaptar a la pantalla» solo se ofrece cuando el campo no cuadra con la pantalla', () => {
    expect(
      convieneOfrecerAdaptar('horizontal', 390, 844),
      'guardado horizontal en móvil vertical',
    ).toBe(true);
    expect(convieneOfrecerAdaptar('vertical', 390, 844)).toBe(false);
    expect(convieneOfrecerAdaptar('horizontal', 844, 390)).toBe(false);
  });

  it('el aviso de que no se puede girar es corto, en español y explica qué hacer', () => {
    expect(AVISO_SIN_BLOQUEO).toContain('no permite girar');
    expect(AVISO_SIN_BLOQUEO.length).toBeLessThan(120);
  });
});
