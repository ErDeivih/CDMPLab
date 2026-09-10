import { describe, expect, it } from 'vitest';
import { TOOLS, MATERIALS } from './board.component';
import { visibleMaterials } from '../../core/material-registry';

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
});
