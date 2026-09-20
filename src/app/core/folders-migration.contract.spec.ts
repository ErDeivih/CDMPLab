import { beforeEach, describe, expect, it } from 'vitest';
import { StoreService } from './store.service';
import type { Exercise } from './models';

/**
 * CONTRATO DE DUPLICADO DE CARPETAS (mitad LOCAL): mide el resultado REAL de
 * `StoreService.duplicateFolder`, que es lo que usa la app hoy y por tanto la referencia que la
 * RPC `public.duplicate_folder_tree` debe reproducir.
 *
 * Por qué existe: el borrador de la migración tenía DOS desviaciones reales —
 *   1. la copia de la raíz arrastraba el `parent_id` del original (debía ser `null`: la copia es
 *      una carpeta raíz), y
 *   2. los ejercicios copiados conservaban el título literal (debían llevar el sufijo « (copia)»).
 * Aquí se fija el lado local con comportamiento ejecutado. El lado SQL se comprueba, contra ESTE
 * mismo contrato, en `scripts/validate-migration.mjs` (puerta `npm run validate:migration`), que es
 * el sitio donde ya se lee el SQL de la migración: así los dos lados se comparan sin que una
 * prueba unitaria tenga que leer ficheros del repositorio.
 *
 * ESTADO DECLARADO: la migración está preparada localmente y **NO aplicada ni verificada contra
 * PostgreSQL remoto**; la comprobación del lado servidor es estática, no de ejecución.
 */
describe('contrato de duplicado de carpetas (local ↔ RPC NO aplicada)', () => {
  let store: StoreService;
  let teamId: string;
  let idRaiz: string;
  let idHija: string;

  const carpeta = (nombre: string) =>
    store.getFoldersForTeam(teamId).find((f) => f.name === nombre);

  const ejercicio = (id: string, folderId: string, title: string): Exercise => ({
    id,
    teamId,
    folderId,
    title,
    description: 'descripción original',
    explanation: 'explicación original',
    category: 'Técnica',
    objectives: ['objetivo'],
    materials: ['conos'],
    durationMinutes: 12,
    minPlayers: 4,
    maxPlayers: 8,
    loadMode: 'interval',
    seriesCount: 3,
    repetitionsCount: 5,
    workSeconds: 30,
    restSeconds: 45,
    isTemplate: false,
    canvas: {
      version: 2,
      field: 'full',
      frames: [
        {
          duration: 1000,
          elements: [{ id: 'el-1', t: 'cone', x: 0.5, y: 0.5, c: '#ffffff' }],
        },
      ],
    },
    thumbnail: 'data:image/png;base64,AAAA',
    savedAt: '2026-01-01T00:00:00.000Z',
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('entrenolab:seeded', '1');
    store = new StoreService();
    teamId = store.createTeam('Primer Equipo', '#3056d3').id;
    // Árbol de dos niveles, con un ejercicio dentro de cada carpeta.
    store.createFolder(teamId, 'Táctica');
    idRaiz = carpeta('Táctica')!.id;
    store.createFolder(teamId, 'Salida de balón', idRaiz);
    idHija = carpeta('Salida de balón')!.id;
    store.saveExercise(ejercicio('ex-raiz', idRaiz, 'Rondo 4x2'));
    store.saveExercise(ejercicio('ex-hija', idHija, 'Salida en 3 pases'));

    store.duplicateFolder(idRaiz);
  });

  it('la raíz copiada es una carpeta RAÍZ y se llama «Nombre (copia)»', () => {
    const copia = carpeta('Táctica (copia)');
    expect(copia, 'existe la copia con el sufijo « (copia)»').toBeTruthy();
    // Este es el punto donde el borrador de la migración se desviaba: copiaba `parent_id`.
    expect(copia!.parentId, 'la copia cuelga de la raíz, no del padre del original').toBeNull();
    expect(copia!.teamId).toBe(teamId);
  });

  it('las subcarpetas conservan su nombre y cuelgan de la copia, no del original', () => {
    const copiaRaiz = carpeta('Táctica (copia)')!;
    const copiasHijas = store.getFoldersForTeam(teamId).filter((f) => f.parentId === copiaRaiz.id);
    expect(copiasHijas).toHaveLength(1);
    expect(copiasHijas[0].name, 'el nombre de la hija NO lleva sufijo').toBe('Salida de balón');
    expect(copiasHijas[0].id, 'la hija copiada es otra fila').not.toBe(idHija);
  });

  it('los ejercicios copiados llevan «Título (copia)» y conservan pizarra, miniatura y propiedades', () => {
    const copiaRaiz = carpeta('Táctica (copia)')!;
    const copiaHija = store.getFoldersForTeam(teamId).find((f) => f.parentId === copiaRaiz.id)!;
    const deLaCopia = store
      .getExercisesForTeam(teamId)
      .filter((e) => e.folderId === copiaRaiz.id || e.folderId === copiaHija.id);

    expect(deLaCopia.map((e) => e.title).sort()).toEqual([
      'Rondo 4x2 (copia)',
      'Salida en 3 pases (copia)',
    ]);

    const original = store.getExercisesForTeam(teamId).find((e) => e.id === 'ex-raiz')!;
    const copiado = deLaCopia.find((e) => e.title === 'Rondo 4x2 (copia)')!;
    expect(copiado.id).not.toBe(original.id);
    expect(copiado.canvas, 'la pizarra se copia ENTERA (no se comparte la referencia)').toEqual(
      original.canvas,
    );
    expect(copiado.thumbnail).toBe(original.thumbnail);
    expect(copiado.description).toBe(original.description);
    expect(copiado.explanation).toBe(original.explanation);
    expect(copiado.category).toBe(original.category);
    expect(copiado.objectives).toEqual(original.objectives);
    expect(copiado.materials).toEqual(original.materials);
    expect(copiado.durationMinutes).toBe(original.durationMinutes);
    expect(copiado.seriesCount).toBe(original.seriesCount);
    expect(copiado.workSeconds).toBe(original.workSeconds);
    expect(copiado.restSeconds).toBe(original.restSeconds);
    expect(copiado.isTemplate).toBe(original.isTemplate);
  });

  it('el árbol original queda intacto y la copia se suma (no se sustituye)', () => {
    expect(store.getFoldersForTeam(teamId)).toHaveLength(4);
    expect(store.getExercisesForTeam(teamId)).toHaveLength(4);
    const original = carpeta('Táctica')!;
    expect(original.parentId).toBeNull();
    expect(carpeta('Salida de balón')!.parentId).toBe(idRaiz);
    const ejerciciosOriginales = store
      .getExercisesForTeam(teamId)
      .filter((e) => e.id === 'ex-raiz' || e.id === 'ex-hija');
    expect(ejerciciosOriginales.map((e) => e.title).sort()).toEqual([
      'Rondo 4x2',
      'Salida en 3 pases',
    ]);
  });
});
