// Verificación de la identidad CDM Pizarrales + autoalojamiento de fuentes.
// Requiere el dev server en http://127.0.0.1:4200.
// Genera capturas en e2e/shots/fase-identidad/.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:4200';
const OUT = 'e2e/shots/fase-identidad';
fs.mkdirSync(OUT, { recursive: true });

const RESULTS = [];
const add = (label, ok, detail = '') => RESULTS.push({ label, ok, detail });

const browser = await chromium.launch({ headless: true });

// Útil para confirmar la activación de la fuente (liga) y la carga del escudo.
async function inspect(page) {
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      msi: document.fonts.check('22px "Material Symbols Outlined"'),
      inter: document.fonts.check('14px "Inter"'),
    };
  });
  const w = await page
    .locator('.msi')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width)
    .catch(() => null);
  return { fonts, sampleMsiWidth: w };
}

async function checkDesktop(name, viewport) {
  const ctx = await browser.newContext({ viewport, baseURL: BASE, locale: 'es-ES' });
  const page = await ctx.newPage();
  const google = [];
  const fontStatus = {}; // url -> status
  const errors = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')) google.push(u);
  });
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('/assets/fonts/')) fontStatus[u] = res.status();
    if (u.includes('cdm-pizarrales-original.jpg') && res.status() !== 200)
      errors.push(`escudo ${res.status()} ${u}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/auth/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const { fonts, sampleMsiWidth } = await inspect(page);

  add(
    `${name} escudo (auth-card) visible`,
    await page
      .locator('.auth-brand')
      .isVisible()
      .catch(() => false),
  );
  add(`${name} font Material Symbols activa`, fonts.msi, `check=${fonts.msi}`);
  add(`${name} font Inter activa`, fonts.inter, `check=${fonts.inter}`);
  add(
    `${name} escudo sidebar visible`,
    await page
      .locator('.brand-shield')
      .isVisible()
      .catch(() => false),
  );

  const btnBg = await page
    .locator('.btn.btn-primary')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
    .catch(() => null);
  add(`${name} botón primario rojo #c8102e`, btnBg === 'rgb(200, 16, 46)', `got=${btnBg}`);

  add(
    `${name} 0 peticiones Google Fonts`,
    google.length === 0,
    `requests=${JSON.stringify(google)}`,
  );

  const badFont = Object.entries(fontStatus).filter(([, s]) => s !== 200);
  add(`${name} fuentes servidas 200`, badFont.length === 0, `status=${JSON.stringify(fontStatus)}`);

  const fontErrs = errors.filter((e) => /font|woff|escudo|gstatic|googleapis|failed|404/i.test(e));
  add(
    `${name} sin errores fuente/escudo`,
    fontErrs.length === 0,
    `errors=${JSON.stringify(fontErrs)}`,
  );

  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await ctx.close();
  return { google, fonts, fontStatus, sampleMsiWidth };
}

const desktop = await checkDesktop('login-desktop', { width: 1360, height: 900 });
await browser.close();

// Captura específica del sidebar en escritorio (vista autenticada parcial: nav visible en modo local).
const b2 = await chromium.launch({ headless: true });
{
  const ctx = await b2.newContext({
    viewport: { width: 1360, height: 900 },
    baseURL: BASE,
    locale: 'es-ES',
  });
  const page = await ctx.newPage();
  await page.goto('/auth/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/sidebar-desktop.png`, fullPage: true });
  await ctx.close();
}
await b2.close();

// Móvil
const b3 = await chromium.launch({ headless: true });
{
  const ctx = await b3.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: BASE,
    locale: 'es-ES',
  });
  const page = await ctx.newPage();
  const google = [];
  const errors = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')) google.push(u);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/auth/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const { fonts } = await inspect(page);
  add(
    'login-mobile topbar escudo visible',
    await page
      .locator('.topbar-shield')
      .isVisible()
      .catch(() => false),
  );
  add('login-mobile font Material Symbols activa', fonts.msi, `check=${fonts.msi}`);
  add(
    'login-mobile 0 peticiones Google Fonts',
    google.length === 0,
    `requests=${JSON.stringify(google)}`,
  );
  await page.screenshot({ path: `${OUT}/login-mobile.png`, fullPage: true });
  await ctx.close();
}
await b3.close();

console.log('==================== RESULTADOS ====================');
let allOk = true;
for (const r of RESULTS) {
  if (!r.ok) allOk = false;
  console.log(`${r.ok ? 'OK ' : 'FAIL'}  ${r.label}  ${r.detail}`.trim());
}
console.log(`\nCapturas en: ${OUT}`);
console.log(`Google Fonts (desktop): ${desktop.google.length} peticiones`);
console.log(`Font status (desktop): ${JSON.stringify(desktop.fontStatus)}`);
console.log(`Muestra .msi width (desktop): ${desktop.sampleMsiWidth}`);
console.log(allOk ? '\nTODAS LAS COMPROBACIONES OK' : '\nHAY COMPROBACIONES FALLIDAS');
// Código de salida: sin esto la puerta no podía fallar (imprimía «HAY COMPROBACIONES FALLIDAS» y
// terminaba con 0, así que en un `&&` o en CI se daba por buena).
if (!allOk) process.exit(1);
