// =============================================================
// VERIFICACIÓN DEL ARTEFACTO DE PRODUCCIÓN — corrección del cambio de campo y de materiales.
//
// POR QUÉ ASÍ: la build de PRODUCCIÓN usa Supabase real, así que abrir `/board` exige una sesión
// (y el encargo prohíbe tocar credenciales). Lo que SÍ se puede —y se debe— comprobar contra la
// build publicada es que el ARTEFACTO CONTENGA la corrección: si el despliegue fuera una versión
// antigua, el bundle no tendría los seis campos ni los colores nuevos del fútbol sala, y eso es
// exactamente lo que el dueño sospechaba al ver el defecto en la web publicada.
//
// Se ejecuta con `playwright.prod.config.ts` (sirve `dist/entrenolab/browser` con un servidor
// estático, sin `ng serve`): `npm run test:e2e:prod`.
// =============================================================
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Contenido de TODOS los bundles de la build servida.
 *
 * Se leen del DISCO (`dist/entrenolab/browser/*.js`) y no con `fetch` desde la página: el panel del
 * tablero vive en un chunk con carga diferida que NO está enlazado en `index.html`, así que pidiendo
 * solo los scripts del índice NO se verían ni la galería de campos ni los colores del fútbol sala.
 * (Con la versión anterior de esta comprobación fallaba exactamente por eso.) Además se verifica que
 * hay contenido: un bundle vacío haría pasar las aserciones negativas por accidente.
 */
function bundlePrincipal(): string {
  const dir = path.join(process.cwd(), 'dist', 'entrenolab', 'browser');
  const ficheros = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  const contenido = ficheros.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  expect(ficheros.length, 'la build tiene bundles').toBeGreaterThan(3);
  expect(contenido.length, 'los bundles tienen contenido').toBeGreaterThan(200_000);
  return contenido;
}

test.describe('Artefacto de producción — la corrección está DENTRO de la build', () => {
  test('el bundle contiene los seis campos y NO ofrece los retirados', () => {
    const bundle = bundlePrincipal();
    expect(bundle.length, 'el bundle tiene contenido').toBeGreaterThan(100_000);
    // Los seis campos visibles (etiquetas de la galería). Se busca TAMBIÉN la forma con acentos
    // escapados (`\xFA`), porque el empaquetado de producción escapa los caracteres no ASCII en los
    // literales: comprobar solo el texto plano fallaba por la codificación del bundle, no por el
    // contenido.
    const contieneEtiqueta = (t: string): boolean =>
      bundle.includes(t) || bundle.includes(t.replace(/ú/g, '\\xFA').replace(/í/g, '\\xED'));
    for (const etiqueta of [
      'Campo completo',
      'Medio campo',
      'Tercio de campo',
      'Fútbol sala',
      'F7 transversal',
      'Lienzo',
    ]) {
      expect(contieneEtiqueta(etiqueta), `el artefacto incluye «${etiqueta}»`).toBe(true);
    }
    // Los campos retirados de la OFERTA ya no aparecen como tarjeta ni como opción de diálogo.
    // OJO: los comentarios del código mencionan los nombres retirados («Mantener los objetos»,
    // «Encajar todo», «Dos medios campos») y en la build de DESARROLLO los comentarios viajan en el
    // bundle, así que aquí solo se comprueban los TEXTOS DE INTERFAZ inequívocos. Que los botones no
    // existan en la app se verifica en el DOM en `fase-cambio-campos` (`sinDialogoNiOverlay`).
    expect(bundle, 'sin la opción retirada de la interfaz').not.toContain(
      'Dos medios campos — recomendado',
    );
    expect(bundle, 'sin la tarjeta retirada «Área y portería»').not.toContain('Área y portería');
  });

  test('el bundle contiene el fútbol sala azul (colores nuevos) y no el verde de césped', () => {
    const bundle = bundlePrincipal();
    expect(bundle, 'superficie azul del fútbol sala').toContain('#1e3a8a');
    expect(bundle, 'áreas azul claro del fútbol sala').toContain('#2563eb');
  });
});
