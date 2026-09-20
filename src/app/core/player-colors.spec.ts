import { describe, expect, it } from 'vitest';
import {
  COLOR_JUGADOR_POR_DEFECTO,
  PALETA_JUGADOR,
  colorDeJugador,
  conColorDeJugador,
  fichasDeJugador,
  normalizarMapaColores,
  pintarFichasDeJugador,
} from './player-colors';
import type { CanvasFrame } from './models';

/**
 * FASE 2 del encargo — el color de la pizarra es DEL EJERCICIO, no de la plantilla.
 *
 * Estas pruebas fijan el contrato del módulo puro que usa la pizarra: mapa por ejercicio,
 * compatibilidad con documentos antiguos (sin mapa) y repintado de las fichas ya colocadas.
 */

const jugador = { id: 'p1', color: '#123456' };

const frames = (): CanvasFrame[] => [
  {
    duration: 1000,
    elements: [
      { id: 'e1', t: 'player', playerId: 'p1', c: '#123456', x: 0.2, y: 0.2 },
      { id: 'e2', t: 'player', playerId: 'p2', c: '#654321', x: 0.4, y: 0.4 },
      { id: 'e3', t: 'cone', c: '#e74c3c', x: 0.6, y: 0.6 },
    ],
  },
];

describe('player-colors (color por ejercicio)', () => {
  it('CONTRATO CORREGIDO: sin asignación en el ejercicio el color es el AZUL común, no el de la plantilla', () => {
    // La versión anterior de esta prueba afirmaba lo contrario: «sin mapa (documento antiguo) usa
    // el color de la plantilla». Ese contrato estaba EQUIVOCADO según el requisito del dueño: en la
    // pizarra todos los jugadores sin asignación propia del ejercicio salen con el mismo color por
    // defecto (azul), aunque en la plantilla tengan colores permanentes distintos. La prueba ahora
    // fija el contrato correcto y comprueba de paso que el color de plantilla NO se consulta.
    expect(colorDeJugador({}, jugador)).toBe(COLOR_JUGADOR_POR_DEFECTO);
    expect(colorDeJugador({}, { id: 'p1' })).toBe(COLOR_JUGADOR_POR_DEFECTO);
    // Dos jugadores con colores de plantilla MUY distintos salen iguales (azul) en un ejercicio sin
    // asignaciones: eso es exactamente lo que pide el encargo.
    const rojo = colorDeJugador({}, { id: 'p1', color: '#c0392b' });
    const morado = colorDeJugador({}, { id: 'p2', color: '#8e44ad' });
    expect(rojo).toBe(morado);
    expect(rojo).toBe(COLOR_JUGADOR_POR_DEFECTO);
  });

  it('con entrada en el mapa manda el color del EJERCICIO', () => {
    expect(colorDeJugador({ p1: '#c0392b' }, jugador)).toBe('#c0392b');
  });

  it('un color asignado vacío cae al azul por defecto, nunca pinta nada', () => {
    expect(colorDeJugador({ p1: '   ' }, { id: 'p1' })).toBe(COLOR_JUGADOR_POR_DEFECTO);
  });

  it('asignar color NO muta el mapa anterior (los signals dependen de esto)', () => {
    const antes = { p1: '#1a73e8' };
    const despues = conColorDeJugador(antes, 'p1', '#8e44ad');
    expect(despues).toEqual({ p1: '#8e44ad' });
    expect(antes).toEqual({ p1: '#1a73e8' });
  });

  it('dos ejercicios conservan mapas distintos para el MISMO jugador', () => {
    const ejercicioA = conColorDeJugador({}, 'p1', '#c0392b');
    const ejercicioB = conColorDeJugador({}, 'p1', '#8e44ad');
    expect(colorDeJugador(ejercicioA, jugador)).toBe('#c0392b');
    expect(colorDeJugador(ejercicioB, jugador)).toBe('#8e44ad');
    // Y la plantilla (el jugador) no se ha tocado en ningún momento.
    expect(jugador.color).toBe('#123456');
  });

  it('repinta SOLO las fichas de ese jugador (y ninguna otra cosa)', () => {
    const out = pintarFichasDeJugador(frames(), 'p1', '#f6c945');
    const els = out[0].elements;
    expect(els.find((e) => e.id === 'e1')?.c).toBe('#f6c945');
    expect(els.find((e) => e.id === 'e2')?.c, 'el otro jugador no cambia').toBe('#654321');
    expect(els.find((e) => e.id === 'e3')?.c, 'el material no cambia').toBe('#e74c3c');
    // Inmutable: los frames de entrada no se han modificado.
    expect(frames()[0].elements.find((e) => e.id === 'e1')?.c).toBe('#123456');
  });

  it('normaliza mapas corruptos sin romper (claves o valores no válidos)', () => {
    expect(normalizarMapaColores(null)).toEqual({});
    expect(normalizarMapaColores('texto')).toEqual({});
    expect(normalizarMapaColores([1, 2])).toEqual({});
    expect(normalizarMapaColores({ p1: '#fff', p2: '', p3: 7 })).toEqual({ p1: '#fff' });
  });

  it('cuenta las fichas colocadas de un jugador (para no repintar en balde)', () => {
    expect(fichasDeJugador(frames(), 'p1')).toBe(1);
    expect(fichasDeJugador(frames(), 'p2')).toBe(1);
    expect(fichasDeJugador(frames(), 'p9')).toBe(0);
  });

  it('la paleta del encargo tiene los cinco colores pedidos y sin repetir', () => {
    const nombres = PALETA_JUGADOR.map((c) => c.nombre);
    expect(nombres).toEqual(['Azul', 'Rojo', 'Amarillo', 'Naranja', 'Morado']);
    expect(new Set(PALETA_JUGADOR.map((c) => c.color)).size).toBe(5);
  });
});
