// Pruebas unitarias del contrato AiExerciseDraftV1, su validador estricto y el
// compilador determinista (AiExerciseDraftV1 -> CanvasDocument + meta).
import { describe, expect, it } from 'vitest';
import { AiExerciseDraftV1 } from './ai-draft';
import { validateAiDraft, AI_DRAFT_JSON_SCHEMA } from './ai-validator';
import { compileAiDraft } from './ai-compiler';

function base(over: Partial<AiExerciseDraftV1>): AiExerciseDraftV1 {
  return {
    schemaVersion: 1,
    title: 'Salida de balón',
    field: 'full',
    orientation: 'horizontal',
    ...over,
  };
}

describe('AiExerciseDraftV1 — validador ESTRICTO', () => {
  it('acepta un borrador mínimo válido', () => {
    expect(validateAiDraft(base({}))).toEqual({ ok: true });
  });

  it('rechaza versión de esquema incompatible', () => {
    const r = validateAiDraft({ ...base({}), schemaVersion: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Versión de esquema incompatible');
  });

  it('rechaza un objeto no-objeto', () => {
    expect(validateAiDraft(null).ok).toBe(false);
    expect(validateAiDraft('hola').ok).toBe(false);
    expect(validateAiDraft([]).ok).toBe(false);
  });

  it('rechaza título vacío', () => {
    expect(validateAiDraft(base({ title: '' })).ok).toBe(false);
  });

  it('rechaza tipo de campo desconocido', () => {
    const r = validateAiDraft(base({ field: 'cancha' as unknown as 'full' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Tipo de campo desconocido');
  });

  it('rechaza orientación desconocida', () => {
    const r = validateAiDraft(base({ orientation: 'diagonal' as unknown as 'horizontal' }));
    expect(r.ok).toBe(false);
  });

  it('rechaza una propiedad desconocida a nivel de borrador', () => {
    const r = validateAiDraft({ ...base({}), extraCampo: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('propiedad desconocida');
  });

  it('rechaza un objeto en lugar de un array de jugadores', () => {
    const r = validateAiDraft(base({ players: { 0: { id: 'x', team: 'own', position: { x: 0.3, y: 0.3 } } } as never }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('players debe ser un array');
  });

  it('rechaza un objeto en lugar de un array de materiales', () => {
    const r = validateAiDraft(base({ materials: {} as never }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('materials debe ser un array');
  });

  it('rechaza un objeto en lugar de un array de shapes', () => {
    const r = validateAiDraft(base({ shapes: {} as never }));
    expect(r.ok).toBe(false);
  });

  it('rechaza un objeto en lugar de un array de textos', () => {
    const r = validateAiDraft(base({ texts: {} as never }));
    expect(r.ok).toBe(false);
  });

  it('rechaza coordenadas fuera de rango', () => {
    const r = validateAiDraft(base({ players: [{ id: 'own-1', team: 'own', position: { x: 1.4, y: 0.5 } }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('fuera de rango');
  });

  it('rechaza coordenadas no finitas', () => {
    const r = validateAiDraft(base({ players: [{ id: 'own-1', team: 'own', position: { x: Number.NaN, y: 0.5 } }] }));
    expect(r.ok).toBe(false);
  });

  it('rechaza un jugador de plantilla real duplicado', () => {
    const r = validateAiDraft(base({
      players: [
        { id: 'a', team: 'own', position: { x: 0.3, y: 0.3 }, playerId: 'pl-1' },
        { id: 'b', team: 'own', position: { x: 0.6, y: 0.6 }, playerId: 'pl-1' },
      ],
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('duplicado');
  });

  it('rechaza un material inexistente', () => {
    const r = validateAiDraft(base({ materials: [{ kind: 'no-existe', position: { x: 0.5, y: 0.5 } }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Material inexistente');
  });

  it('rechaza una formación inexistente', () => {
    const r = validateAiDraft(base({ ownFormation: '9-9-9' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Formación inexistente');
  });

  it('rechaza un tipo de forma desconocido', () => {
    const r = validateAiDraft(base({ shapes: [{ kind: 'circulo' as never, from: { x: 0.2, y: 0.2 }, to: { x: 0.8, y: 0.8 } }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Tipo de forma desconocido');
  });

  it('rechaza durationMinutes no positivo o demasiado alto', () => {
    expect(validateAiDraft(base({ durationMinutes: -5 })).ok).toBe(false);
    expect(validateAiDraft(base({ durationMinutes: 5000 })).ok).toBe(false);
  });

  it('rechaza playerCount no entero o fuera de límite', () => {
    expect(validateAiDraft(base({ playerCount: 1.5 })).ok).toBe(false);
    expect(validateAiDraft(base({ playerCount: 999 })).ok).toBe(false);
  });

  it('rechaza un number de jugador no entero o absurdamente alto', () => {
    const r = validateAiDraft(base({ players: [{ id: 'a', team: 'own', position: { x: 0.3, y: 0.3 }, number: 200 }] }));
    expect(r.ok).toBe(false);
  });

  it('rechaza shape.fill no booleano', () => {
    const r = validateAiDraft(base({ shapes: [{ kind: 'rect', from: { x: 0.2, y: 0.2 }, to: { x: 0.6, y: 0.6 }, fill: 'si' as never }] }));
    expect(r.ok).toBe(false);
  });

  it('rechaza shapes.points fuera de mano alzada (freehand)', () => {
    const r = validateAiDraft(base({ shapes: [{ kind: 'line', from: { x: 0.2, y: 0.2 }, to: { x: 0.6, y: 0.6 }, points: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }] }] }));
    expect(r.ok).toBe(false);
  });

  it('rechaza una forma degenerada (ancho o largo cero)', () => {
    const r = validateAiDraft(base({ shapes: [{ kind: 'rect', from: { x: 0.2, y: 0.2 }, to: { x: 0.2, y: 0.6 } }] }));
    expect(r.ok).toBe(false);
  });

  it('rechaza un texto demasiado largo', () => {
    const r = validateAiDraft(base({ texts: [{ position: { x: 0.5, y: 0.5 }, value: 'x'.repeat(500) }] }));
    expect(r.ok).toBe(false);
  });

  it('rechaza una propiedad desconocida en un jugador', () => {
    const r = validateAiDraft(base({ players: [{ id: 'a', team: 'own', position: { x: 0.3, y: 0.3 }, apodo: 'x' } as never] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('propiedad desconocida');
  });

  it('acepta un material con assetKind del catálogo', () => {
    const r = validateAiDraft(base({ materials: [{ kind: 'cone_red', position: { x: 0.5, y: 0.5 } }] }));
    expect(r.ok).toBe(true);
  });

  it('rechaza cantidades excesivas de materiales', () => {
    const tooMany = Array.from({ length: 90 }, (_, i) => ({ kind: 'cone', position: { x: 0.1, y: 0.1 } }));
    const r = validateAiDraft(base({ materials: tooMany }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Demasiados materiales');
  });

  it('el JSON Schema equivalente usa additionalProperties=false', () => {
    expect(AI_DRAFT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(AI_DRAFT_JSON_SCHEMA.properties?.schemaVersion).toMatchObject({ const: 1 });
  });
});

describe('compileAiDraft — compilador determinista', () => {
  it('compila una formación 4-3-3 propia (portero + 10)', () => {
    const r = compileAiDraft(base({ ownFormation: '4-3-3' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const players = r.doc.frames[0].elements.filter((e) => e.t === 'player');
    expect(players).toHaveLength(11);
    expect(players.slice(0, 1)[0].type).toBe('goalkeeper');
    expect(r.meta.minPlayers).toBe(11);
    expect(r.meta.maxPlayers).toBe(11);
  });

  it('la formación RIVAL se refleja al sentido contrario (porteros en extremos opuestos)', () => {
    const r = compileAiDraft(base({ ownFormation: '4-3-3', rivalFormation: '4-3-3' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const own = r.doc.frames[0].elements.filter((e) => e.t === 'player' && e.side === 'own');
    const rival = r.doc.frames[0].elements.filter((e) => e.t === 'player' && e.side === 'rival');
    expect(own.length).toBe(11);
    expect(rival.length).toBe(11);
    // El portero (índice isGoalkeeper) de cada equipo debe estar en extremos opuestos (espejo 1-x).
    const ownGK = own.find((e) => e.type === 'goalkeeper')!;
    const rivalGK = rival.find((e) => e.type === 'goalkeeper')!;
    expect(Math.abs(ownGK.x! - rivalGK.x!)).toBeGreaterThan(0.7);
    // La media X del rival debe diferir de la propia (sentido de ataque opuesto).
    const ownAvgX = own.reduce((a, e) => a + (e.x ?? 0), 0) / own.length;
    const rivalAvgX = rival.reduce((a, e) => a + (e.x ?? 0), 0) / rival.length;
    expect(Math.abs(rivalAvgX - ownAvgX)).toBeGreaterThan(0.05);
  });

  it('rivalColor se respeta (no el rojo por defecto)', () => {
    const r = compileAiDraft(base({ rivalFormation: '4-4-2', rivalColor: '#25a5d9' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rival = r.doc.frames[0].elements.filter((e) => e.t === 'player' && e.side === 'rival');
    expect(rival.length).toBe(11);
    for (const p of rival) expect(p.c).toBe('#25a5d9');
  });

  it('rechaza una formación desconocida', () => {
    const r = compileAiDraft(base({ ownFormation: '9-0-1' }));
    expect(r.ok).toBe(false);
  });

  it('compila en horizontal y vertical con la orientación pedida', () => {
    const h = compileAiDraft(base({ field: 'half', orientation: 'horizontal', ownFormation: '4-3-3' }));
    const v = compileAiDraft(base({ field: 'half', orientation: 'vertical', ownFormation: '4-3-3' }));
    expect(h.ok && v.ok).toBe(true);
    if (!h.ok || !v.ok) return;
    expect(h.doc.orientation).toBe('horizontal');
    expect(v.doc.orientation).toBe('vertical');
    expect(h.doc.schemaVersion).toBeGreaterThanOrEqual(4);
  });

  it('compila F7 transversal con jugadores y materiales', () => {
    const r = compileAiDraft(base({
      field: 'f7', ownFormation: '4-3-3',
      materials: [{ kind: 'cone_red', position: { x: 0.3, y: 0.5 } }, { kind: 'pole', position: { x: 0.6, y: 0.5 } }],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.field).toBe('f7');
    expect(r.doc.frames[0].elements.some((e) => e.t === 'cone')).toBe(true);
  });

  it('compila materiales y flechas', () => {
    const r = compileAiDraft(base({
      materials: [{ kind: 'cone_red', position: { x: 0.3, y: 0.3 } }, { kind: 'ball', position: { x: 0.5, y: 0.5 } }],
      shapes: [{ kind: 'arrow', from: { x: 0.2, y: 0.4 }, to: { x: 0.7, y: 0.6 } }],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const els = r.doc.frames[0].elements;
    expect(els.some((e) => e.t === 'cone')).toBe(true);
    expect(els.some((e) => e.t === 'ball')).toBe(true);
    expect(els.some((e) => e.t === 'arrow')).toBe(true);
  });

  it('la conversión del MISMO plan es DETERMINISTA (documento idéntico, sin ids aleatorios)', () => {
    const draft = base({
      ownFormation: '4-3-3',
      materials: [{ kind: 'cone_red', position: { x: 0.3, y: 0.5 } }],
      shapes: [{ kind: 'line', from: { x: 0.2, y: 0.2 }, to: { x: 0.7, y: 0.7 } }],
    });
    const a = compileAiDraft(draft);
    const b = compileAiDraft(draft);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.doc).toEqual(b.doc); // documento COMPLETO igual (mismos ids deterministas)
  });

  it('el documento exporta los metadatos del borrador (título/objetivo/duración/material/min-max)', () => {
    const r = compileAiDraft({
      schemaVersion: 1,
      title: 'Presión tras pérdida',
      description: 'Rondo 6v2',
      objective: 'Recuperar en 5 segundos',
      durationMinutes: 15,
      material: '6 conos',
      playerCount: 8,
      field: 'half',
      orientation: 'vertical',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.title).toBe('Presión tras pérdida');
    expect(r.meta.description).toBe('Rondo 6v2');
    expect(r.meta.explanation).toBe('Recuperar en 5 segundos');
    expect(r.meta.durationMinutes).toBe(15);
    expect(r.meta.materials).toBe('6 conos');
    expect(r.meta.minPlayers).toBe(8);
    expect(r.meta.maxPlayers).toBe(8);
    expect(r.meta.field).toBe('half');
    expect(r.meta.orientation).toBe('vertical');
  });
});
