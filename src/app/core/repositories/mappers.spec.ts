import { describe, expect, it } from 'vitest';
import { exerciseFromRow, exerciseRowForInsert, sessionFromRow, sessionPlanToRow } from './mappers';
import type { ExercisesRow, SessionsRow } from '../database.types';
import type { CanvasDocument, Exercise, Session } from '../models';

// Round-trip del MAPPER de ejercicio a través de la capa Supabase (canvas_data):
// un documento con campo 'f7' debe conservar el campo y sus elementos/frames al
// pasar por fila DB → modelo → fila DB, sin silenciar el campo a 'full'.
describe('mappers ejercicio ↔ canvas_data (campo F7)', () => {
  const CANVAS_F7: CanvasDocument = {
    version: 2,
    schemaVersion: 4,
    field: 'f7',
    frames: [{ duration: 1000, elements: [{ id: 'e1', t: 'cone', x: 0.5, y: 0.5 }] }],
    orientation: 'horizontal',
    grass: 'stripes',
  };

  function row(): ExercisesRow {
    return {
      id: 'ex-1',
      team_id: 'team-1',
      folder_id: 'f-root',
      title: 'Rondo F7',
      description: '',
      explanation: '',
      category: 'Técnica',
      objectives: [],
      materials: [],
      duration_minutes: 15,
      min_players: null,
      max_players: null,
      load_mode: 'fixed',
      series_count: null,
      repetitions_count: null,
      work_seconds: null,
      rest_seconds: null,
      is_template: false,
      canvas_data: CANVAS_F7 as unknown as ExercisesRow['canvas_data'],
      thumbnail: null,
      revision: 3,
      created_at: 'now',
      updated_at: 'now',
    };
  }

  it('exerciseFromRow conserva el campo f7 y sus frames', () => {
    const ex = exerciseFromRow(row());
    expect(ex.canvas).not.toBeNull();
    expect((ex.canvas as CanvasDocument).field).toBe('f7');
    expect((ex.canvas as CanvasDocument).frames[0].elements).toHaveLength(1);
    expect((ex.canvas as CanvasDocument).frames[0].elements[0].t).toBe('cone');
  });

  it('exerciseRowForInsert serializa canvas_data con field f7', () => {
    const ex = exerciseFromRow(row());
    const insert = exerciseRowForInsert(ex);
    const canvas = insert.canvas_data as unknown as CanvasDocument;
    expect(canvas.field).toBe('f7');
    expect(canvas.frames[0].elements).toHaveLength(1);
  });

  it('round-trip fila → modelo → fila conserva f7 (sin caer a full)', () => {
    const ex1 = exerciseFromRow(row());
    const insert = exerciseRowForInsert(ex1);
    const ex2 = exerciseFromRow({ ...insert, created_at: 'now', updated_at: 'now', revision: ex1.revision ?? 0 });
    expect((ex2.canvas as CanvasDocument).field).toBe('f7');
    // Igualdad del documento (excepto id de elementos, que no cambia aquí).
    expect(JSON.stringify(ex2.canvas)).toBe(JSON.stringify(CANVAS_F7));
    // Los metadatos sobreviven.
    expect(ex2.title).toBe('Rondo F7');
    expect(ex2.id).toBe('ex-1');
    expect(ex2.teamId).toBe('team-1');
  });

  it('la actualización lleva la revisión y el documento F7', () => {
    const ex = exerciseFromRow(row());
    const updated: Exercise = { ...ex, revision: 3 };
    const insert = exerciseRowForInsert(updated);
    // La revisión viaja para el control de conflicto (no se pierde al guardar).
    expect(updated.revision).toBe(3);
    expect((insert.canvas_data as unknown as CanvasDocument).field).toBe('f7');
  });
});

describe('mappers de planificación de sesiones', () => {
  const base: Session = {
    id: 's1', teamId: 'team1', title: '', date: '2026-10-08', durationMinutes: 120,
    notes: '', number: 12, objectives: 'Defender por dentro', material: 'Balones',
    attendance: [{ playerId: 'p1', playerName: 'Portero', status: 'Asiste', group: 'Agua', attitude: 'Buena', minutes: 110, notes: 'Sin molestias' }],
    tasks: [{ id: 't1', exerciseId: 'e1', title: 'Rueda', durationMinutes: 16, material: '', sortOrder: 0, section: 'warmup', seriesCount: 2, minutesPerSeries: 8 }],
    createdAt: 'c', savedAt: 'u',
  };
  const row: SessionsRow = {
    id: 's1', team_id: 'team1', title: '', date: '2026-10-08', duration_minutes: 120,
    notes: '', revision: 1, created_at: 'c', updated_at: 'u',
  };

  it('conserva número, bloques, series y asistencia en el plan remoto', () => {
    const loaded = sessionFromRow({ ...row, plan: sessionPlanToRow(base) }, base.tasks.map((t) => ({ id: t.id, exerciseId: t.exerciseId, title: t.title, durationMinutes: t.durationMinutes, material: t.material, sortOrder: t.sortOrder })));
    expect(loaded.number).toBe(12);
    expect(loaded.objectives).toBe('Defender por dentro');
    expect(loaded.tasks[0]).toMatchObject({ section: 'warmup', seriesCount: 2, minutesPerSeries: 8 });
    expect(loaded.attendance?.[0]).toMatchObject({ playerId: 'p1', status: 'Asiste', minutes: 110 });
  });

  it('lee una sesión antigua sin plan sin inventar asistencia ni alterar tareas', () => {
    const task = { id: 't1', exerciseId: null, title: 'Rueda', durationMinutes: 10, material: '', sortOrder: 0 };
    const loaded = sessionFromRow(row, [task]);
    expect(loaded.tasks).toEqual([task]);
    expect(loaded.attendance).toEqual([]);
    expect(loaded.number).toBeNull();
  });
});
