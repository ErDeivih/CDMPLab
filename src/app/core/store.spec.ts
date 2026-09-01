import { beforeEach, describe, expect, it } from 'vitest';
import { StoreService } from './store.service';
import { CanvasElement, ElementType } from './models';

describe('StoreService', () => {
  let store: StoreService;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('entrenolab:seeded', '1');
    store = new StoreService();
  });

  it('creates a team and sets it active', () => {
    const team = store.createTeam('Primer Equipo', '#3056d3');
    expect(store.teams().length).toBe(1);
    expect(store.activeTeam()?.id).toBe(team.id);
  });

  it('manages players on the active team', () => {
    store.createTeam('Primer Equipo', '#3056d3');
    store.addPlayer({ name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8' });
    store.addPlayer({ name: 'Pau', number: 10, position: 'MF', color: '#1a73e8' });
    expect(store.activeTeamPlayers().length).toBe(2);
    const id = store.activeTeamPlayers()[0].id;
    store.removePlayer(id);
    expect(store.activeTeamPlayers().length).toBe(1);
  });

  it('persists exercises and can duplicate/delete', () => {
    const team = store.createTeam('Primer Equipo', '#3056d3');
    const ex = {
      id: 'ex1',
      teamId: team.id,
      folderId: null,
      title: 'Rondos',
      description: '',
      explanation: '',
      category: 'Técnica' as const,
      objectives: [],
      materials: [],
      durationMinutes: 15,
      minPlayers: null,
      maxPlayers: null,
      loadMode: 'fixed' as const,
      seriesCount: null,
      repetitionsCount: null,
      workSeconds: null,
      restSeconds: null,
      isTemplate: false,
      canvas: null,
      thumbnail: null,
      savedAt: new Date().toISOString(),
    };
    store.saveExercise(ex);
    expect(store.getExercisesForTeam(team.id).length).toBe(1);
    store.duplicateExercise('ex1');
    expect(store.getExercisesForTeam(team.id).length).toBe(2);
    store.deleteExercise('ex1');
    expect(store.getExercisesForTeam(team.id).length).toBe(1);
  });

  it('round-trips a draft (autosave/resume)', () => {
    const team = store.createTeam('Primer Equipo', '#3056d3');
    expect(store.loadDraft(team.id, null)).toBeNull();
    store.saveDraft(team.id, null, { title: 'Rondos', category: 'Técnica', durationMinutes: 15, description: 'd', explanation: 'e' });
    const d = store.loadDraft(team.id, null);
    expect(d?.title).toBe('Rondos');
    expect(d?.savedAt).toBeTruthy();
    store.clearDraft(team.id, null);
    expect(store.loadDraft(team.id, null)).toBeNull();
  });

  it('persiste una sesión con la instantánea (snapshot) de sus tareas', () => {
    const team = store.createTeam('Primer Equipo', '#3056d3');
    const ex = {
      id: 'ex1',
      teamId: team.id,
      folderId: null,
      title: 'Rondos',
      description: '',
      explanation: '',
      category: 'Técnica' as const,
      objectives: [],
      materials: [],
      durationMinutes: 15,
      minPlayers: null,
      maxPlayers: null,
      loadMode: 'fixed' as const,
      seriesCount: null,
      repetitionsCount: null,
      workSeconds: null,
      restSeconds: null,
      isTemplate: false,
      canvas: null,
      thumbnail: null,
      savedAt: new Date().toISOString(),
    };
    const session = {
      id: 's1',
      teamId: team.id,
      title: 'Mi sesión',
      date: '2026-08-25',
      durationMinutes: 15,
      notes: '',
      tasks: [{ id: 't1', exerciseId: 'ex1', title: 'Rondos', durationMinutes: 15, material: '', sortOrder: 0, snapshot: { ...ex } }],
      createdAt: new Date().toISOString(),
      savedAt: new Date().toISOString(),
    };
    store.saveSession(session);
    const loaded = store.getSessionsForTeam(team.id)[0];
    expect(loaded.tasks[0].snapshot?.title).toBe('Rondos');
  });

  it('duplica un ejercicio con documento independiente (copias profundas de frames)', () => {
    const team = store.createTeam('Primer Equipo', '#3056d3');
    const ex = {
      id: 'e1',
      teamId: team.id,
      folderId: null,
      title: 'Rondos',
      description: '',
      explanation: '',
      category: 'Técnica' as const,
      objectives: [],
      materials: [],
      durationMinutes: null,
      minPlayers: null,
      maxPlayers: null,
      loadMode: 'fixed' as const,
      seriesCount: null,
      repetitionsCount: null,
      workSeconds: null,
      restSeconds: null,
      isTemplate: false,
      canvas: {
        version: 2 as const,
        schemaVersion: 3,
        field: 'full' as const,
        frames: [{ duration: 1000, elements: [{ id: 'a', t: 'player' as const, x: 0.2, y: 0.2 }] }],
      },
      thumbnail: null,
      savedAt: new Date().toISOString(),
    };
    store.saveExercise(ex as never);
    store.duplicateExercise('e1');
    const exercises = store.exercises();
    expect(exercises).toHaveLength(2);
    const orig = exercises.find((e) => e.id === 'e1')!;
    const copy = exercises.find((e) => e.id !== 'e1')!;
    expect(orig.canvas).not.toBe(copy.canvas);
    expect(orig.canvas?.frames).not.toBe(copy.canvas?.frames);
    // Editar la copia no cambia el original.
    if (copy.canvas && orig.canvas) copy.canvas.frames[0].elements[0].x = 0.9;
    expect(orig.canvas?.frames[0].elements[0].x).toBe(0.2);
  });

  it('limita la profundidad del árbol de carpetas a 4 niveles', () => {
    const team = store.createTeam('Primer Equipo', '#3056d3');
    let parent: string | null = null;
    for (let i = 0; i < 4; i++) {
      store.createFolder(team.id, `Nivel ${i}`, parent);
      parent = store.folders()[store.folders().length - 1].id;
    }
    // Ahora el nivel 5 se rechaza (no puede superar 4).
    const before = store.folders().length;
    store.createFolder(team.id, 'Demasiado profundo', parent);
    expect(store.folders().length).toBe(before);
  });

  it('creates folders, moves exercises and deletes folders', () => {
    const team = store.createTeam('Primer Equipo', '#3056d3');
    store.createFolder(team.id, 'Posesión');
    const folder = store.folders()[0];
    expect(folder.name).toBe('Posesión');
    const ex = {
      id: 'ex1',
      teamId: team.id,
      folderId: null,
      title: 'Rondos',
      description: '',
      explanation: '',
      category: 'Técnica' as const,
      objectives: [],
      materials: [],
      durationMinutes: 15,
      minPlayers: null,
      maxPlayers: null,
      loadMode: 'fixed' as const,
      seriesCount: null,
      repetitionsCount: null,
      workSeconds: null,
      restSeconds: null,
      isTemplate: false,
      canvas: null,
      thumbnail: null,
      savedAt: new Date().toISOString(),
    };
    store.saveExercise(ex);
    store.moveExerciseToFolder('ex1', folder.id);
    expect(store.exercises().find((e) => e.id === 'ex1')?.folderId).toBe(folder.id);
    store.deleteFolder(folder.id);
    expect(store.exercises().find((e) => e.id === 'ex1')?.folderId).toBeNull();
  });

  it('respaldo: exportar e importar (reemplazar) hace round-trip sin pérdidas', () => {
    const team = store.createTeam('Primer Equipo', '#3056d3');
    store.addPlayer({ name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8' });
    store.createFolder(team.id, 'Posesión');
    const ex = {
      id: 'ex1', teamId: team.id, folderId: null, title: 'Rondos', description: '', explanation: '',
      category: 'Técnica' as const, objectives: [], materials: [],
      durationMinutes: 15, minPlayers: null, maxPlayers: null, loadMode: 'fixed' as const,
      seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null,
      isTemplate: false, canvas: null, thumbnail: null, savedAt: new Date().toISOString(),
    };
    store.saveExercise(ex);
    store.saveSession({
      id: 's1', teamId: team.id, title: 'Mi sesión', date: '2026-08-27', durationMinutes: 60,
      notes: '', tasks: [{ id: 't1', exerciseId: 'ex1', title: 'Rondos', durationMinutes: 15, material: '', sortOrder: 0 }],
      createdAt: new Date().toISOString(), savedAt: new Date().toISOString(),
    });
    const json = store.exportBackup();

    // Otro "dispositivo": localStorage limpio.
    localStorage.clear();
    localStorage.setItem('entrenolab:seeded', '1');
    const fresh = new StoreService();
    const res = fresh.importBackup(json, 'replace');
    expect(res.ok).toBe(true);
    expect(fresh.teams().length).toBe(1);
    expect(fresh.players().length).toBe(1);
    expect(fresh.folders().length).toBe(1);
    expect(fresh.exercises().length).toBe(1);
    expect(fresh.sessions().length).toBe(1);
    expect(fresh.sessions()[0].tasks.length).toBe(1);
  });

  it('respaldo: un archivo inválido se rechaza sin tocar los datos actuales', () => {
    const team = store.createTeam('Primer Equipo', '#3056d3');
    expect(store.importBackup('esto no es json', 'replace').ok).toBe(false);
    expect(store.importBackup('{"version":99,"teams":[]}', 'replace').ok).toBe(false);
    expect(store.importBackup('{"version":1,"teams":"no-array"}', 'replace').ok).toBe(false);
    expect(store.teams().length).toBe(1); // nada se ha tocado
  });

  it('respaldo: fusionar conserva lo existente y añade lo nuevo por id', () => {
    const a = store.createTeam('Equipo A', '#3056d3');
    // Respaldo que contiene al equipo A (mismo id) y un equipo B nuevo.
    const json = JSON.stringify({
      version: 1, exportedAt: new Date().toISOString(),
      teams: [{ id: a.id, name: 'Equipo A', accentColor: '#3056d3', createdAt: a.createdAt } as never, { id: 'b', name: 'Equipo B', accentColor: '#111', createdAt: new Date().toISOString() }],
      players: [], folders: [], exercises: [], sessions: [],
    });
    const res = store.importBackup(json, 'merge');
    expect(res.ok).toBe(true);
    expect(store.teams().length).toBe(2);
    expect(store.teams().some((t) => t.id === a.id)).toBe(true);
    expect(store.teams().some((t) => t.id === 'b')).toBe(true);
  });

  it('respaldo: hay una copia automática recuperable tras importar y se puede restaurar', () => {
    store.createTeam('Equipo A', '#3056d3');
    const before = store.teams().length;
    store.importBackup('{"version":1,"teams":[],"players":[],"folders":[],"exercises":[],"sessions":[]}', 'replace');
    expect(store.teams().length).toBe(0); // se reemplazó por vacío
    expect(store.hasAutoBackup()).toBe(true);
    expect(store.restoreAutoBackup()).toBe(true);
    expect(store.teams().length).toBe(before); // restaurado
  });

  it('respaldo: rechaza una versión no exacta', () => {
    expect(store.validateBackup('{"version":2,"teams":[],"players":[],"folders":[],"exercises":[],"sessions":[]}').ok).toBe(false);
  });

  it('respaldo: rechaza entidades incompletas y referencias rotas', () => {
    // Equipo incompleto (sin nombre).
    expect(store.validateBackup(JSON.stringify({ version: 1, teams: [{ id: 't1', accentColor: '#111', createdAt: '2026-01-01' }], players: [], folders: [], exercises: [], sessions: [] })).ok).toBe(false);
    // Jugador con referencia de equipo inexistente.
    expect(store.validateBackup(JSON.stringify({ version: 1, teams: [{ id: 't1', name: 'A', accentColor: '#111', createdAt: '2026-01-01' }], players: [{ id: 'p1', teamId: 'nope', name: 'Pau', number: 10 }], folders: [], exercises: [], sessions: [] })).ok).toBe(false);
    // Ejercicio con carpeta inexistente.
    expect(store.validateBackup(JSON.stringify({ version: 1, teams: [{ id: 't1', name: 'A', accentColor: '#111', createdAt: '2026-01-01' }], players: [], folders: [], exercises: [{ id: 'x1', teamId: 't1', folderId: 'f-no', title: 'X', objectives: [], materials: [], canvas: null }], sessions: [] })).ok).toBe(false);
  });

  it('respaldo: rechaza ciclos en la jerarquía de carpetas', () => {
    const j = JSON.stringify({
      version: 1,
      teams: [{ id: 't1', name: 'A', accentColor: '#111', createdAt: '2026-01-01' }],
      players: [],
      folders: [
        { id: 'a', teamId: 't1', parentId: 'b', name: 'A' },
        { id: 'b', teamId: 't1', parentId: 'a', name: 'B' },
      ],
      exercises: [],
      sessions: [],
    });
    expect(store.validateBackup(j).ok).toBe(false);
  });

  it('respaldo: rechaza un elemento de tipo desconocido en el canvas', () => {
    const j = JSON.stringify({
      version: 1,
      teams: [{ id: 't1', name: 'A', accentColor: '#111', createdAt: '2026-01-01' }],
      players: [],
      folders: [],
      exercises: [
        { id: 'x1', teamId: 't1', folderId: null, title: 'X', objectives: [], materials: [], canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [{ id: 'e1', t: 'alien' }] }], orientation: 'horizontal' } },
      ],
      sessions: [],
    });
    expect(store.validateBackup(j).ok).toBe(false);
  });

  it('respaldo: ACEPTA un ejercicio con campo F7 (transversal sobre medio campo F11)', () => {
    const j = JSON.stringify({
      version: 1,
      teams: [{ id: 't1', name: 'A', accentColor: '#111', createdAt: '2026-01-01' }],
      players: [],
      folders: [],
      exercises: [
        { id: 'x1', teamId: 't1', folderId: null, title: 'X', objectives: [], materials: [], canvas: { version: 2, schemaVersion: 3, field: 'f7', frames: [{ duration: 1000, elements: [{ id: 'e1', t: 'cone', x: 0.5, y: 0.5 }] }], orientation: 'horizontal' } },
      ],
      sessions: [],
    });
    expect(store.validateBackup(j).ok, 'respaldo con campo F7 debe ser válido').toBe(true);
  });

  it('respaldo: rechaza un valor de campo REALMENTE desconocido (no f7, no legacy)', () => {
    const j = JSON.stringify({
      version: 1,
      teams: [{ id: 't1', name: 'A', accentColor: '#111', createdAt: '2026-01-01' }],
      players: [],
      folders: [],
      exercises: [
        { id: 'x1', teamId: 't1', folderId: null, title: 'X', objectives: [], materials: [], canvas: { version: 2, schemaVersion: 3, field: 'baloncesto', frames: [{ duration: 1000, elements: [{ id: 'e1', t: 'cone', x: 0.5, y: 0.5 }] }], orientation: 'horizontal' } },
      ],
      sessions: [],
    });
    expect(store.validateBackup(j).ok, 'campo inexistente debe rechazarse').toBe(false);
  });

  it('respaldo: rechaza un archivo enorme (límite de tamaño)', () => {
    const big = 'x'.repeat(10 * 1024 * 1024 + 1);
    expect(store.validateBackup(big).ok).toBe(false);
  });

  it('respaldo: round-trip con TODAS las familias de elemento (antes se auto-rechazaba)', () => {
    const team = store.createTeam('Primer Equipo', '#3056d3');
    const types: ElementType[] = ['player', 'ball', 'cone', 'text', 'zone', 'rect', 'ellipse', 'arrow', 'doubleArrow', 'measure', 'curve', 'line', 'dribble', 'freehand', 'mannequin', 'minigoal', 'pole', 'marker', 'hurdle', 'ring', 'ladder', 'flag', 'trampoline', 'target', 'net', 'vball', 'coachC', 'peto', 'chaleco', 'bosu', 'fitball', 'pica'];
    const elements: CanvasElement[] = types.map((t, i) => ({ id: `el${i}`, t, x: 0.1 + i * 0.01, y: 0.5 }));
    const ex = {
      id: 'ex1', teamId: team.id, folderId: null, title: 'Todo', description: '', explanation: '',
      category: 'Técnica' as const, objectives: [], materials: [], durationMinutes: 15, minPlayers: null, maxPlayers: null,
      loadMode: 'fixed' as const, seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null,
      isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements }], orientation: 'horizontal' }, thumbnail: null, savedAt: new Date().toISOString(),
    };
    store.saveExercise(ex as any);
    const json = store.exportBackup();
    localStorage.clear();
    localStorage.setItem('entrenolab:seeded', '1');
    const fresh = new StoreService();
    const res = fresh.importBackup(json, 'replace');
    expect(res.ok).toBe(true);
    const el2 = fresh.exercises()[0].canvas!.frames[0].elements.map((e) => e.t);
    expect(el2).toEqual(types);
  });

  it('respaldo: valida carpetas de forma independiente del orden y del mismo equipo', () => {
    // Un hijo aparece ANTES que su padre: debe aceptarse si es válido.
    expect(store.validateBackup(JSON.stringify({
      version: 1, teams: [{ id: 't1', name: 'A', accentColor: '#111', createdAt: '2026-01-01' }],
      players: [], folders: [{ id: 'child', teamId: 't1', parentId: 'parent', name: 'C' }, { id: 'parent', teamId: 't1', parentId: null, name: 'P' }],
      exercises: [], sessions: [],
    })).ok).toBe(true);
    // Un hijo con padre de OTRO equipo se rechaza.
    expect(store.validateBackup(JSON.stringify({
      version: 1, teams: [{ id: 't1', name: 'A', accentColor: '#111', createdAt: '2026-01-01' }, { id: 't2', name: 'B', accentColor: '#222', createdAt: '2026-01-01' }],
      players: [], folders: [{ id: 'child', teamId: 't1', parentId: 'parent', name: 'C' }, { id: 'parent', teamId: 't2', parentId: null, name: 'P' }],
      exercises: [], sessions: [],
    })).ok).toBe(false);
  });

  it('respaldo: rechaza sesión con ejercicio inexistente o de otro equipo', () => {
    const base = { version: 1, teams: [{ id: 't1', name: 'A', accentColor: '#111', createdAt: '2026-01-01' }, { id: 't2', name: 'B', accentColor: '#222', createdAt: '2026-01-01' }] };
    // Ejercicio inexistente en la tarea.
    expect(store.validateBackup(JSON.stringify({ ...base, players: [], folders: [], exercises: [], sessions: [{ id: 's1', teamId: 't1', title: 'S', date: '2026-01-01', durationMinutes: 30, notes: '', tasks: [{ id: 'tk1', exerciseId: 'nope', title: 'X', material: '', sortOrder: 0 }], createdAt: '2026-01-01', savedAt: '2026-01-01' }] })).ok).toBe(false);
    // Ejercicio de otro equipo en la tarea.
    expect(store.validateBackup(JSON.stringify({ ...base, players: [], folders: [], exercises: [{ id: 'x1', teamId: 't2', folderId: null, title: 'X', objectives: [], materials: [], canvas: null }], sessions: [{ id: 's1', teamId: 't1', title: 'S', date: '2026-01-01', durationMinutes: 30, notes: '', tasks: [{ id: 'tk1', exerciseId: 'x1', title: 'X', material: '', sortOrder: 0 }], createdAt: '2026-01-01', savedAt: '2026-01-01' }] })).ok).toBe(false);
  });
});
