import { describe, expect, it } from 'vitest';
import { TOOLS, MATERIALS, PALETTE, toolHintFor } from './board.component';
import { visibleMaterials } from '../../core/material-registry';
import { DEFAULT_ELEMENT_COLOR, COLORABLE_ELEMENT_TYPES } from '../../core/render';
import { CANONICAL_MATERIALS } from '../../core/material-registry';

// Ligaduras que la fuente autoalojada "Material Symbols Outlined" NO contiene:
// si se usan, el navegador las pinta como texto literal (no como glifo).
const KNOWN_BAD_LIGATURES = new Set(['circle_outlined', 'circle_outline', 'crop_circle']);

const ICON_RE = /^[a-z0-9_]+$/;

describe('Board icons — ligaduras válidas en la fuente autoalojada', () => {
  const all = [...TOOLS, ...MATERIALS];

  it('ninguna herramienta usa una ligadura rota (p. ej. circle_outlined)', () => {
    const bad = all.filter((t) => KNOWN_BAD_LIGATURES.has(t.icon));
    expect(bad.map((t) => `${t.id}:${t.icon}`)).toEqual([]);
  });

  it('todas las ligaduras tienen una forma de nombre válida (minúsculas, dígitos, guión bajo)', () => {
    const invalid = all.filter((t) => !ICON_RE.test(t.icon));
    expect(invalid.map((t) => `${t.id}:${t.icon}`)).toEqual([]);
  });

  it('la herramienta de elipse/círculo usa un glifo que sí existe', () => {
    const ellipse = TOOLS.find((t) => t.id === 'ellipse');
    expect(ellipse).toBeTruthy();
    expect(ellipse!.icon).toBe('circle');
    expect(KNOWN_BAD_LIGATURES.has(ellipse!.icon)).toBe(false);
  });

  it('cada herramienta define un icono no vacío', () => {
    const empty = all.filter((t) => !t.icon);
    expect(empty).toEqual([]);
  });

  it('FASE F: TOOLS NO duplica los materiales (fuente única = registro canónico)', () => {
    const materialIds = new Set(visibleMaterials().map((m) => m.id));
    // No existe una segunda lista de materiales dentro de TOOLS (las propias de la app).
    const dupInTools = TOOLS.map((t) => t.id).filter((id) => materialIds.has(id as string));
    expect(dupInTools, 'TOOLS no debe enumerar materiales').toEqual([]);
    // El panel (MATERIALS) deriva EXACTAMENTE de visibleMaterials(): mismos ids, cada uno UNA vez.
    const matIds = MATERIALS.map((m) => m.id as string);
    expect(new Set(matIds).size, 'ids de material únicos en MATERIALS').toBe(matIds.length);
    expect([...matIds].sort(), 'MATERIALS == visibleMaterials (ids)').toEqual(
      [...visibleMaterials().map((m) => m.id)].sort()
    );
  });

  it('el color por defecto del dibujo es una muestra de la paleta (el inspector marca la activa)', () => {
    // Antes el default era `#1f2933`, que NO estaba en PALETTE: el control de color no
    // marcaba ninguna muestra como activa y el usuario no podía "volver" al default.
    expect(PALETTE, 'el default debe ser seleccionable en la paleta').toContain(DEFAULT_ELEMENT_COLOR);
    expect(new Set(PALETTE).size, 'sin colores repetidos en la paleta').toBe(PALETTE.length);
    // El blanco se añadió AL FINAL a propósito: hay pruebas E2E que eligen muestra por
    // ÍNDICE, así que reordenar la paleta cambiaría el color elegido por esas pruebas.
    expect(PALETTE[PALETTE.length - 1], 'el blanco (default) va al final').toBe(DEFAULT_ELEMENT_COLOR);
  });

  it('todo material que el registro declara coloreable ofrece color en el inspector', () => {
    // El Aro (`ring`) se quedaba fuera de la lista del inspector aunque el registro
    // canónico lo declara `colorable` y el render pinta su trazo con `el.c`.
    const declared = CANONICAL_MATERIALS.filter((m) => m.colorable).map((m) => m.id);
    expect(declared.length, 'el registro debe declarar materiales coloreables').toBeGreaterThan(0);
    const missing = declared.filter((id) => !COLORABLE_ELEMENT_TYPES.has(id));
    expect(missing, 'materiales coloreables sin control de color en el inspector').toEqual([]);
  });

  it('toda herramienta del panel tiene texto de ayuda (los materiales, desde el registro)', () => {
    // Antes la ayuda era un mapa con los 22 materiales escritos a mano: un material
    // nuevo en el registro se quedaba SIN ayuda y el texto podía divergir del registrado.
    const ids = [...TOOLS.map((t) => t.id), ...MATERIALS.map((m) => m.id)];
    const missing = ids.filter((id) => !toolHintFor(id));
    expect(missing, 'herramientas sin ayuda en la barra').toEqual([]);
    // La ayuda del material sale literalmente del registro canónico.
    for (const m of visibleMaterials()) {
      expect(toolHintFor(m.id as never), `ayuda de ${m.id}`).toContain(m.help);
    }
  });
});
