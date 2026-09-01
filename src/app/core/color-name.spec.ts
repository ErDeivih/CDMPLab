import { describe, expect, it } from 'vitest';
import { colorName, colorNamePlural } from './color-name';

describe('colorName', () => {
  it('nombra los colores de la paleta de jugadores / herramientas', () => {
    expect(colorName('#1a73e8')).toBe('azul');
    expect(colorName('#c0392b')).toBe('rojo');
    expect(colorName('#1f7a4d')).toBe('verde');
    expect(colorName('#e67e22')).toBe('naranja');
    expect(colorName('#7d3c98')).toBe('morado');
    expect(colorName('#b8860b')).toBe('amarillo');
    expect(colorName('#111111')).toBe('negro');
    expect(colorName('#f4f4f4')).toBe('gris claro');
  });

  it('nombra los ejemplos del contrato', () => {
    expect(colorName('#c8102e')).toBe('rojo');
    expect(colorName('#ffffff')).toBe('blanco');
    expect(colorName('#2e7d45')).toBe('verde oscuro');
    expect(colorName('#3056d3')).toBe('azul');
  });

  it('nombra los colores de césped y de las líneas del campo con nombres DISTINTOS', () => {
    const grass = [colorName('#31834a'), colorName('#2e7d45'), colorName('#3a9156'), colorName('#2b6b3f')];
    expect(grass).toEqual(['verde medio', 'verde oscuro', 'verde claro', 'verde muy oscuro']);
    // Los cuatro tonos de césped deben ser distinguibles (sin duplicados).
    expect(new Set(grass).size).toBe(4);
    expect(colorName('#1f2933')).toBe('negro');
  });

  it('da el nombre en femenino plural para los swatches de "Líneas"', () => {
    expect(colorNamePlural('#ffffff')).toBe('blancas');
    expect(colorNamePlural('#1f2933')).toBe('negras');
    expect(colorNamePlural('#c0392b')).toBe('rojas');
    expect(colorNamePlural('#1a73e8')).toBe('azules');
  });

  it('nombra los colores de los materiales (variantes)', () => {
    expect(colorName('#e74c3c')).toBe('rojo');
    expect(colorName('#f6c945')).toBe('amarillo');
    expect(colorName('#2c7be5')).toBe('azul');
    expect(colorName('#e8c3c9')).toBe('rosa');
    expect(colorName('#c98ab0')).toBe('morado');
    expect(colorName('#e8edf2')).toBe('gris claro');
  });

  it('normaliza hex cortos y mayúsculas', () => {
    expect(colorName('#fff')).toBe('blanco');
    expect(colorName('#FFFFFF')).toBe('blanco');
    expect(colorName('fff')).toBe('blanco');
  });

  it('genera un nombre genérico para un hex no catalogado', () => {
    expect(colorName('#ff00aa')).toBe('rosa');
    expect(colorName('#0044ff')).toBe('azul');
  });

  it('devuelve el propio valor cuando no es un hex reconocible (último recurso)', () => {
    expect(colorName('#gggggg')).toBe('#gggggg');
    expect(colorName('no-es-un-color')).toBe('no-es-un-color');
    expect(colorName('')).toBe('');
    expect(colorName(undefined)).toBe('');
  });
});
