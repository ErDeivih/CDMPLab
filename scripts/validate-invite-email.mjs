// =============================================================
// EntrenoLab / CDMPLab — Validador del correo de invitación.
//
// QUÉ COMPRUEBA (dos niveles distintos, y se dice cuál es cuál):
//   (A) COMPORTAMIENTO REAL del módulo puro `supabase/functions/_shared/invite-email.ts`:
//       se IMPORTA de verdad (Node 24 hace type-stripping del .ts, sin compilar ni transpilar)
//       y se ejercitan sus funciones con `node:assert/strict`. No es una copia del módulo: es
//       el módulo que se despliega.
//   (B) ANÁLISIS ESTÁTICO de `supabase/functions/invite-team-member/index.ts`: que use
//       `Deno.env`, que NO registre en consola datos personales, que no haya literales con
//       pinta de clave, que llame a las dos RPC con los nombres exactos y que revise la
//       configuración ANTES de consumir un intento.
//
// ALCANCE / LIMITACIÓN (honesta):
//   · NO se envía ningún correo: no hay proveedor, ni credenciales, ni dominio. Todo lo que
//     depende de la red (el POST real a Resend/Postmark, la entrega, los rebotes) NO está
//     verificado aquí ni en ninguna otra puerta.
//   · Las RPC `prepare_invitation_email` y `record_invitation_email_result` se comprueban por
//     su NOMBRE y sus PARÁMETROS en el código, no ejecutándolas contra PostgreSQL.
//   · El análisis estático quita comentarios y luego busca texto: un falso positivo es
//     posible si el código se retuerce mucho; un falso negativo, si alguien escribe el mismo
//     dato de otra forma (p. ej. `console['log']`). Es una red, no una demostración.
//   · Node avisa por stderr de que el .ts no cuelga de un package.json con `type: module` y lo
//     reanaliza como ESM. Es un aviso de rendimiento, no un error; `package.json` no se toca.
//
// Uso: node scripts/validate-invite-email.mjs
// =============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildInviteLink,
  escapeHtml,
  isAcceptableLinkBase,
  isRetriableHttp,
  mapProviderResponse,
  providerRequest,
  redactError,
  renderInviteEmail,
  resolveEmailConfig,
} from '../supabase/functions/_shared/invite-email.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHARED_FILE = 'supabase/functions/_shared/invite-email.ts';
const FN_FILE = 'supabase/functions/invite-team-member/index.ts';

// Datos de prueba: TODO claramente ficticio. Ningún valor de aquí es una credencial real.
const UUID = '3f1c5b7a-9d24-4e6f-8a1b-2c3d4e5f6a7b';
const LINK_BASE = 'https://usuario.github.io/CDMPLab/';
const FAKE_KEY = 'CLAVE-FICTICIA-DE-EJEMPLO';
const COMPLETE_ENV = {
  EMAIL_PROVIDER: 'resend',
  EMAIL_API_KEY: FAKE_KEY,
  EMAIL_FROM: 'no-reply@ejemplo.com',
  EMAIL_FROM_NAME: 'CDMPLab',
  EMAIL_REPLY_TO: 'soporte@ejemplo.com',
  INVITE_LINK_BASE: LINK_BASE,
};
const LINK_PATH = '/invitations?invitation=' + UUID;

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error('  ✗ ' + msg);
};
const ok = (msg) => console.log('  ✓ ' + msg);

/** Ejecuta una comprobación y publica una única línea ✓/✗. Si falla, se ve el motivo. */
function check(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name);
    const detail = (e && e.message ? e.message : String(e)).split('\n');
    for (const line of detail) console.error('      ' + line);
  }
}

// -------------------------------------------------------------
// Utilidades para el análisis estático
// -------------------------------------------------------------

function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * Quita comentarios conservando saltos de línea y el resto del texto.
 *
 * Por qué es necesario: los ficheros EXPLICAN en comentarios lo que NO hacen («nunca registra
 * el correo», «nada de enum»), así que buscar sobre el texto crudo da falsos positivos.
 * Limitación asumida: no reconoce literales de expresión regular, de modo que una regex con
 * comillas o `//` dentro podría confundir al analizador. En los ficheros comprobados no ocurre.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote !== null) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Argumentos de la llamada cuyo paréntesis de apertura está en `openIndex` (equilibrado). */
function callArguments(source, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

/** Todas las llamadas a `namePattern(...)` del fichero, con sus argumentos como texto. */
function findCalls(source, namePattern) {
  const calls = [];
  const re = new RegExp(namePattern + '\\s*\\(', 'g');
  let match;
  while ((match = re.exec(source)) !== null) {
    const open = match.index + match[0].length - 1;
    calls.push({ index: match.index, args: callArguments(source, open) ?? '' });
  }
  return calls;
}

// =============================================================
// (A) COMPORTAMIENTO REAL DEL MÓDULO PURO
// =============================================================

console.log('Módulo puro: ' + SHARED_FILE);

check('exporta todas las funciones del contrato', () => {
  const contract = {
    resolveEmailConfig,
    isAcceptableLinkBase,
    buildInviteLink,
    escapeHtml,
    renderInviteEmail,
    providerRequest,
    mapProviderResponse,
    redactError,
    isRetriableHttp,
  };
  for (const [name, value] of Object.entries(contract)) {
    assert.equal(typeof value, 'function', name + ' no es una función exportada');
  }
});

console.log('\nConfiguración (resolveEmailConfig):');

check(
  'entorno vacío → ok:false y faltan las obligatorias (EMAIL_PROVIDER tiene valor por defecto)',
  () => {
    const result = resolveEmailConfig({});
    assert.equal(result.ok, false);
    assert.ok(Array.isArray(result.missing), 'missing debe ser una lista de NOMBRES');
    assert.deepEqual(
      [...result.missing].sort(),
      ['EMAIL_API_KEY', 'EMAIL_FROM', 'INVITE_LINK_BASE'],
      'las que faltan no son las esperadas',
    );
    assert.ok(!result.missing.includes('EMAIL_PROVIDER'), 'EMAIL_PROVIDER tiene valor por defecto');
  },
);

check('señala la variable INVÁLIDA por su nombre y NO filtra su valor', () => {
  const result = resolveEmailConfig({ ...COMPLETE_ENV, EMAIL_PROVIDER: 'mailgun' });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('EMAIL_PROVIDER'), 'no señala el proveedor inválido');
  const serializado = JSON.stringify(result) + JSON.stringify(result.missing);
  assert.ok(!serializado.includes(FAKE_KEY), 'la respuesta filtra el valor de la clave');
  assert.ok(!serializado.includes('mailgun'), 'la respuesta filtra el valor inválido');
});

check('entorno completo → ok:true con los valores esperados', () => {
  const result = resolveEmailConfig(COMPLETE_ENV);
  assert.equal(result.ok, true, 'un entorno completo debería valer');
  assert.deepEqual(result.config, {
    provider: 'resend',
    apiKey: FAKE_KEY,
    from: 'no-reply@ejemplo.com',
    fromName: 'CDMPLab',
    replyTo: 'soporte@ejemplo.com',
    linkBase: LINK_BASE,
  });
});

check('valores por defecto: EMAIL_PROVIDER=resend y EMAIL_FROM_NAME=CDMPLab', () => {
  const env = { ...COMPLETE_ENV };
  delete env.EMAIL_PROVIDER;
  delete env.EMAIL_FROM_NAME;
  const result = resolveEmailConfig(env);
  assert.equal(result.ok, true);
  assert.equal(result.config.provider, 'resend');
  assert.equal(result.config.fromName, 'CDMPLab');
});

check('EMAIL_REPLY_TO es opcional → replyTo null sin marcarlo como faltante', () => {
  const env = { ...COMPLETE_ENV };
  delete env.EMAIL_REPLY_TO;
  const result = resolveEmailConfig(env);
  assert.equal(result.ok, true);
  assert.equal(result.config.replyTo, null);
  assert.ok(!result.missing, 'con ok:true no debe haber lista de faltantes');
});

check('señala EMAIL_FROM inválido (una dirección no puede traer ángulos ni espacios)', () => {
  for (const bad of [
    'CDMPLab <no-reply@ejemplo.com>',
    'sin-arroba',
    'con espacio@ejemplo.com',
    '',
  ]) {
    const result = resolveEmailConfig({ ...COMPLETE_ENV, EMAIL_FROM: bad });
    assert.equal(result.ok, false, 'aceptó un EMAIL_FROM inválido');
    assert.ok(result.missing.includes('EMAIL_FROM'), 'no señala EMAIL_FROM');
  }
});

check('señala EMAIL_REPLY_TO inválido y postmark como proveedor válido', () => {
  const bad = resolveEmailConfig({ ...COMPLETE_ENV, EMAIL_REPLY_TO: 'no es un correo' });
  assert.equal(bad.ok, false);
  assert.ok(bad.missing.includes('EMAIL_REPLY_TO'));
  const postmark = resolveEmailConfig({ ...COMPLETE_ENV, EMAIL_PROVIDER: 'postmark' });
  assert.equal(postmark.ok, true);
  assert.equal(postmark.config.provider, 'postmark');
});

console.log('\nEnlaces (isAcceptableLinkBase / buildInviteLink):');

check('acepta la base de GitHub Pages con subcarpeta', () => {
  assert.equal(isAcceptableLinkBase(LINK_BASE), true);
  assert.equal(isAcceptableLinkBase('https://usuario.github.io/CDMPLab'), true, 'sin barra final');
  assert.equal(isAcceptableLinkBase('https://app.ejemplo.com'), true);
});

check(
  'rechaza http, localhost, 127.0.0.1, 0.0.0.0, [::1], vacío, esquemas raros y credenciales en la URL',
  () => {
    const malas = [
      'http://usuario.github.io/CDMPLab/',
      'https://localhost/',
      'https://localhost:3000/',
      'https://127.0.0.1/',
      'https://127.1/',
      'https://0.0.0.0/',
      'https://[::1]/',
      'https://sub.localhost/',
      '',
      '   ',
      'ftp://ejemplo.com/',
      '//ejemplo.com/',
      'usuario.github.io/CDMPLab/',
      'https://usuario:clave@ejemplo.com/',
      'https://ejemplo.com/algo?x=1',
      'https://ejemplo.com/algo#frag',
    ];
    for (const base of malas) {
      assert.equal(isAcceptableLinkBase(base), false, 'aceptó una base no válida: ' + base);
      assert.throws(
        () => buildInviteLink(base, LINK_PATH),
        /invalid_link_base/,
        'no lanzó: ' + base,
      );
    }
  },
);

check('no duplica barras y el enlace termina en /invitations?invitation=<id>', () => {
  const esperado = 'https://usuario.github.io/CDMPLab/invitations?invitation=' + UUID;
  for (const base of [
    LINK_BASE,
    'https://usuario.github.io/CDMPLab',
    'https://usuario.github.io/CDMPLab///',
  ]) {
    const link = buildInviteLink(base, LINK_PATH);
    assert.equal(link, esperado, 'enlace inesperado para la base ' + base);
    assert.ok(
      link.endsWith('/invitations?invitation=' + UUID),
      'no termina en la ruta de invitación',
    );
    assert.ok(!link.replace(/^https:\/\//, '').includes('//'), 'duplica barras');
  }
});

check('acepta un identificador suelto y rechaza una ruta que sea una URL absoluta', () => {
  assert.equal(
    buildInviteLink(LINK_BASE, UUID),
    LINK_BASE + 'invitations?invitation=' + UUID,
    'un uuid suelto debe convertirse en la ruta de invitaciones',
  );
  for (const mala of ['https://otro-dominio.ejemplo/invitations', '//otro-dominio.ejemplo/x', '']) {
    assert.throws(() => buildInviteLink(LINK_BASE, mala), /invalid_link_path/, 'aceptó: ' + mala);
  }
});

console.log('\nPlantilla (escapeHtml / renderInviteEmail):');

check('escapeHtml neutraliza <script>, comillas y &', () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
  );
  assert.equal(escapeHtml("O'Neill & Ana"), 'O&#39;Neill &amp; Ana');
  assert.ok(!escapeHtml('<img src=x onerror=alert(1)>').includes('<'), 'deja pasar un <');
  assert.ok(!escapeHtml('"').includes('"'), 'deja pasar una comilla doble');
});

check('renderInviteEmail escapa el nombre malicioso, incluye el enlace y trae texto plano', () => {
  const malicioso = '<img src=x onerror=alert(1)>';
  const htmlMalicioso = '<b>Ana</b>';
  const link = buildInviteLink(LINK_BASE, LINK_PATH);
  const mail = renderInviteEmail({ teamName: malicioso, inviterName: htmlMalicioso, link });

  assert.ok(
    mail.html.includes('&lt;img src=x onerror=alert(1)&gt;'),
    'no aparece el nombre escapado',
  );
  assert.ok(!mail.html.includes('<img'), 'el HTML lleva la etiqueta cruda del nombre');
  assert.ok(!mail.html.includes('<b>'), 'el HTML lleva la etiqueta cruda del invitador');
  assert.ok(mail.html.includes('&lt;b&gt;Ana&lt;/b&gt;'), 'no aparece el invitador escapado');
  assert.ok(mail.html.includes('href="' + link + '"'), 'el enlace no va como href');
  assert.ok(mail.html.includes(link), 'el enlace no se ve como texto');
  assert.ok(mail.html.includes('<strong>'), 'el HTML debería destacar el nombre del equipo');
  assert.ok(!/<img|<script/i.test(mail.html), 'el HTML incluye imágenes o scripts');

  assert.equal(typeof mail.text, 'string');
  assert.ok(mail.text.length > 0, 'no hay alternativa en texto plano');
  assert.ok(mail.text.includes(link), 'el texto plano no lleva el enlace');
  // En `text/plain` NO se escapa a propósito: escapar aquí mostraría `&lt;img…` literal al
  // usuario. La inyección que se evita con `escapeHtml` solo existe en el HTML.
  assert.ok(mail.text.includes(malicioso), 'el texto plano no lleva el nombre del equipo');
  assert.ok(!mail.text.includes('&lt;img'), 'el texto plano viene escapado como si fuera HTML');
  assert.ok(!mail.text.includes('<div'), 'el texto plano lleva marcado HTML');
});

check('el asunto lleva el nombre del equipo, va en UNA línea y no contiene HTML', () => {
  const mail = renderInviteEmail({
    teamName: 'Cadete A\r\nBcc: alguien@ejemplo.com',
    inviterName: 'Ana',
    link: LINK_BASE + 'invitations?invitation=' + UUID,
  });
  assert.ok(mail.subject.includes('Cadete A'), 'el asunto no lleva el nombre del equipo');
  assert.ok(
    !/[\r\n]/.test(mail.subject),
    'el asunto trae un salto de línea (inyección de cabeceras)',
  );
  assert.ok(!/<|>/.test(mail.subject), 'el asunto lleva HTML o algo que lo parece');
  assert.ok(mail.subject.length <= 200, 'asunto demasiado largo');

  const conEtiquetas = renderInviteEmail({
    teamName: '<script>alert(1)</script>',
    inviterName: 'Ana',
    link: LINK_BASE,
  });
  assert.ok(!conEtiquetas.subject.includes('<script>'), 'el asunto lleva HTML crudo');
});

check('sin nombre de quien invita usa una fórmula neutra y admite caducidad', () => {
  const sinNombre = renderInviteEmail({
    teamName: 'Primer Equipo',
    inviterName: '',
    link: LINK_BASE,
  });
  assert.ok(sinNombre.html.includes('El propietario del equipo'), 'no hay fórmula neutra');
  assert.ok(!sinNombre.html.includes('<strong></strong>'), 'deja un hueco vacío en el HTML');
  assert.ok(sinNombre.subject.includes('Primer Equipo'));

  const conCaducidad = renderInviteEmail({
    teamName: 'Primer Equipo',
    inviterName: 'Ana',
    link: LINK_BASE,
    expiresAt: '2026-10-01T09:30:00.000Z',
  });
  assert.ok(conCaducidad.html.includes('2026-10-01'), 'no muestra la caducidad');
  assert.ok(conCaducidad.text.includes('2026-10-01'), 'el texto plano no muestra la caducidad');

  const sinCaducidad = renderInviteEmail({
    teamName: 'Primer Equipo',
    inviterName: 'Ana',
    link: LINK_BASE,
  });
  assert.ok(!sinCaducidad.html.includes('caduca'), 'inventa una caducidad que no le han dado');
});

console.log('\nProveedores (providerRequest / mapProviderResponse):');

const MESSAGE = {
  to: 'invitado@ejemplo.com',
  subject: 'Invitación al equipo Primer Equipo en CDMPLab',
  html: '<div>hola</div>',
  text: 'hola',
};

check(
  'providerRequest (resend): URL, cabecera de autorización y cuerpo JSON con destinatario y asunto',
  () => {
    const config = resolveEmailConfig(COMPLETE_ENV).config;
    const request = providerRequest('resend', config, MESSAGE);
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.equal(
      request.headers.Authorization,
      'Bearer ' + FAKE_KEY,
      'la cabecera no lleva la clave',
    );
    assert.equal(request.headers['Content-Type'], 'application/json');
    const body = JSON.parse(request.body);
    assert.deepEqual(body.to, [MESSAGE.to], 'el destinatario no es el esperado');
    assert.equal(body.subject, MESSAGE.subject, 'el asunto no es el esperado');
    assert.equal(
      body.from,
      'CDMPLab <no-reply@ejemplo.com>',
      'el remitente no lleva Nombre <correo>',
    );
    assert.equal(body.reply_to, 'soporte@ejemplo.com', 'falta reply_to');
    assert.equal(body.html, MESSAGE.html);
    assert.equal(body.text, MESSAGE.text);
    assert.ok(!request.body.includes(FAKE_KEY), 'la clave se cuela en el CUERPO de la petición');
  },
);

check(
  'providerRequest (postmark): URL, X-Postmark-Server-Token y cuerpo con las claves en mayúscula',
  () => {
    const config = resolveEmailConfig({ ...COMPLETE_ENV, EMAIL_PROVIDER: 'postmark' }).config;
    const request = providerRequest('postmark', config, MESSAGE);
    assert.equal(request.url, 'https://api.postmarkapp.com/email');
    assert.equal(
      request.headers['X-Postmark-Server-Token'],
      FAKE_KEY,
      'falta la cabecera del token',
    );
    assert.equal(request.headers.Accept, 'application/json');
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.ok(!('Authorization' in request.headers), 'Postmark no usa Authorization');
    const body = JSON.parse(request.body);
    assert.equal(body.From, 'CDMPLab <no-reply@ejemplo.com>');
    assert.equal(body.To, MESSAGE.to, 'el destinatario no es el esperado');
    assert.equal(body.Subject, MESSAGE.subject, 'el asunto no es el esperado');
    assert.equal(body.HtmlBody, MESSAGE.html);
    assert.equal(body.TextBody, MESSAGE.text);
    assert.equal(body.ReplyTo, 'soporte@ejemplo.com');
    assert.ok(!request.body.includes(FAKE_KEY), 'la clave se cuela en el CUERPO de la petición');
  },
);

check('providerRequest sin replyTo no inventa la clave', () => {
  const env = { ...COMPLETE_ENV };
  delete env.EMAIL_REPLY_TO;
  const config = resolveEmailConfig(env).config;
  const resend = JSON.parse(providerRequest('resend', config, MESSAGE).body);
  const postmark = JSON.parse(providerRequest('postmark', config, MESSAGE).body);
  assert.ok(!('reply_to' in resend), 'resend añade reply_to sin configurarlo');
  assert.ok(!('ReplyTo' in postmark), 'postmark añade ReplyTo sin configurarlo');
});

check('mapProviderResponse acepta 200 y 201 (resend) y 200 (postmark) con identificador', () => {
  assert.deepEqual(mapProviderResponse('resend', 200, { id: 'resend-id-1' }), {
    ok: true,
    providerMessageId: 'resend-id-1',
  });
  assert.deepEqual(mapProviderResponse('resend', 201, { id: 'resend-id-2' }), {
    ok: true,
    providerMessageId: 'resend-id-2',
  });
  assert.deepEqual(mapProviderResponse('postmark', 200, { MessageID: 'postmark-id-1' }), {
    ok: true,
    providerMessageId: 'postmark-id-1',
  });
  assert.equal(mapProviderResponse('resend', 200, { id: 'ok' }).ok, true);
});

check('mapProviderResponse rechaza 401, 422 y 500 con el error REDACTADO', () => {
  const unauthorized = mapProviderResponse('resend', 401, {
    message: 'API key is invalid: key=' + FAKE_KEY,
  });
  assert.equal(unauthorized.ok, false, 'aceptó un 401');
  assert.ok(unauthorized.error.includes('[oculto]'), 'el error no viene redactado');
  assert.ok(!unauthorized.error.includes(FAKE_KEY), 'el error filtra la clave');

  const invalido = mapProviderResponse('resend', 422, { message: 'domain is not verified' });
  assert.equal(invalido.ok, false, 'aceptó un 422');
  assert.equal(invalido.error, 'domain is not verified');

  const caido = mapProviderResponse('postmark', 500, { Message: 'Bearer ' + FAKE_KEY });
  assert.equal(caido.ok, false, 'aceptó un 500');
  assert.ok(!caido.error.includes(FAKE_KEY), 'el 500 filtra la clave');

  const vacio = mapProviderResponse('resend', 503, null);
  assert.equal(vacio.ok, false, 'aceptó un 503');
  assert.ok(vacio.error.length > 0, 'un 503 sin cuerpo debe dejar un motivo, aunque sea genérico');
  assert.ok(!vacio.error.includes('null'), 'el motivo genérico menciona el cuerpo nulo');
});

console.log('\nErrores (redactError / isRetriableHttp):');

check('redactError oculta Bearer, key=, token, prefijos conocidos y cadenas largas', () => {
  const casos = [
    'fallo: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
    'fallo: key=' + FAKE_KEY,
    'fallo: token ' + FAKE_KEY,
    'fallo: api_key=' + FAKE_KEY,
    'fallo: sk_ficticia-de-ejemplo',
    'fallo: re_ficticia-de-ejemplo',
    'fallo: xkeysib-FICTICIA-DE-EJEMPLO',
    'fallo: SG.FICTICIA-DE-EJEMPLO',
    'fallo: 9f8e7d6c5b4a39281706f5e4d3c2b1a09988776655443322',
  ];
  for (const caso of casos) {
    const limpio = redactError(caso);
    assert.ok(limpio.includes('[oculto]'), 'no redactó nada en: ' + caso);
    for (const trozo of [
      'abcdefghijklmnopqrstuvwxyz0123456789',
      FAKE_KEY,
      'sk_ficticia-de-ejemplo',
      're_ficticia-de-ejemplo',
      'xkeysib-FICTICIA-DE-EJEMPLO',
      'SG.FICTICIA-DE-EJEMPLO',
      '9f8e7d6c5b4a39281706f5e4d3c2b1a09988776655443322',
    ]) {
      assert.ok(!limpio.includes(trozo), 'dejó pasar: ' + trozo);
    }
  }
});

check('redactError deja UNA línea, sin caracteres de control, y trunca a 300 caracteres', () => {
  const largo = redactError(('mensaje de error ' + '\n').repeat(40));
  assert.ok(largo.length <= 300, 'no truncó: ' + largo.length + ' caracteres');
  assert.ok(!/[\r\n\t]/.test(largo), 'dejó saltos de línea');
  assert.ok(largo.endsWith('...'), 'no señala el truncado');
  assert.equal(redactError(null), '');
  assert.equal(redactError(undefined), '');
  assert.equal(redactError(new Error('boom')), 'boom');
  assert.ok(redactError({ detalle: 'x' }).includes('x'), 'no sabe convertir un objeto a texto');
});

check('isRetriableHttp: 429 y 5xx sí; el resto de 4xx no', () => {
  for (const status of [429, 500, 502, 503, 504, 599]) {
    assert.equal(isRetriableHttp(status), true, status + ' debería ser reintentable');
  }
  for (const status of [200, 201, 400, 401, 403, 404, 409, 413, 422]) {
    assert.equal(isRetriableHttp(status), false, status + ' NO debería ser reintentable');
  }
});

// =============================================================
// (B) ANÁLISIS ESTÁTICO DE LA EDGE FUNCTION
// =============================================================

console.log('\nEdge Function: ' + FN_FILE);

const fnRaw = readSource(FN_FILE);
const fn = stripComments(fnRaw);

check('usa Deno.env (una variable a la vez) y no lleva ninguna clave literal', () => {
  assert.ok(/Deno\.env\.get\(/.test(fn), 'no lee el entorno con Deno.env.get');
  const patrones = [
    /\bsk_[A-Za-z0-9_-]{8,}/,
    /\bre_[A-Za-z0-9_-]{8,}/,
    /\bxkeysib-[A-Za-z0-9_-]{8,}/i,
    /\bSG\.[A-Za-z0-9._-]{8,}/,
    /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{6,}/,
    /\bsbp_[A-Za-z0-9_-]{10,}/,
    /\beyJ[A-Za-z0-9._-]{10,}/,
    /\bBearer\s+[A-Za-z0-9._-]{20,}/,
  ];
  for (const patron of patrones) {
    assert.ok(!patron.test(fn), 'hay un literal con pinta de clave: ' + patron);
  }
});

// CAMBIO DE CONTRATO (revisión del dueño, 22/09/2026). Antes esta puerta exigía que la función
// no nombrara siquiera la clave de servicio (mínimo privilegio: todo se hacía con el JWT del
// propietario). El dueño encontró el agujero que eso dejaba: `record_invitation_email_result`
// estaba concedida a `authenticated`, así que un propietario podía FALSIFICAR un
// `provider_accepted` con una llamada directa, sin enviar correo. Ahora el registro del
// resultado solo lo puede hacer el servidor, y para eso la función SÍ necesita la credencial de
// servicio. Lo que se sigue exigiendo es que:
//   · la credencial se lea SOLO de `Deno.env` (nunca un literal),
//   · NO se use para autorizar al usuario (la autorización sigue siendo el JWT del llamante),
//   · y NUNCA se registre ni se devuelva.
check(
  'usa la credencial de servicio solo para registrar el resultado (nunca para autorizar)',
  () => {
    assert.ok(
      /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/.test(fn),
      'no lee SUPABASE_SERVICE_ROLE_KEY: sin ella no se puede registrar el resultado del proveedor',
    );
    // El cliente del LLAMANTE (el que autoriza en Postgres, el único que puede preparar el envío)
    // se construye con la clave publicable, nunca con la credencial de servicio.
    assert.ok(
      /createClient\(\s*supabaseUrl,\s*anonKey/.test(fn),
      'el cliente del llamante no se construye con la clave publicable',
    );
    // Y la credencial de servicio se usa para UN cliente: el que registra (recorderClient).
    assert.ok(
      /recorderClient\s*=[\s\S]{0,200}?createClient\(\s*supabaseUrl,\s*serviceKey/.test(fn),
      'la credencial de servicio no se usa para construir el cliente del registro',
    );
    assert.ok(
      !/Authorization[^\n]*serviceKey/.test(fn),
      'la credencial de servicio viaja en una cabecera Authorization',
    );
    // El registro va contra el cliente del servidor y vinculado al intento preparado.
    assert.ok(
      /recorderClient\.rpc\('record_invitation_email_result'/.test(fn),
      'el resultado no se registra con el cliente del servidor',
    );
    assert.ok(
      /p_attempt_id:\s*attemptId/.test(fn),
      'el registro no va vinculado al identificador del intento preparado',
    );
    for (const parametro of ['p_attempt_id', 'p_status', 'p_provider_message_id', 'p_error']) {
      assert.ok(fn.includes(parametro), 'falta el parámetro ' + parametro);
    }
  },
);

check('sin credencial de registro no abre intento ni llama al proveedor', () => {
  const guard = fn.match(/if \(serviceKey === ''\) \{([\s\S]*?)\n  \}/);
  assert.ok(guard, 'falta el rechazo temprano de SUPABASE_SERVICE_ROLE_KEY ausente');
  assert.ok(
    guard[1].includes("status: 'server_misconfigured'"),
    'no devuelve error de configuración',
  );
  assert.ok(/return respond\(\{[\s\S]*?\}\);/.test(guard[1]), 'no termina la petición');
  const guardPosition = fn.indexOf("if (serviceKey === '')");
  const preparePosition = fn.indexOf("rpc('prepare_invitation_email'");
  const providerPosition = fn.indexOf('await fetch(request.url');
  assert.ok(guardPosition < preparePosition, 'el guard llega después de consumir un intento');
  assert.ok(guardPosition < providerPosition, 'el guard llega después de enviar un correo');
});

check('la credencial de servicio no se registra en consola ni se devuelve', () => {
  const consolas = findCalls(fn, 'console\\.[a-z]+');
  for (const llamada of consolas) {
    assert.ok(!/serviceKey/i.test(llamada.args), 'la credencial va a un log');
  }
  const propios = findCalls(fn, '(?:logEvent|logProblem)');
  for (const llamada of propios) {
    assert.ok(!/serviceKey/i.test(llamada.args), 'la credencial va a un log estructural');
  }
  // Nunca se devuelve al cliente (ni en el `status`, ni en el mensaje, ni en el id del proveedor).
  assert.ok(!/return\s+respond\([^;]{0,400}?serviceKey/is.test(fn), 'la credencial se devuelve');
  assert.ok(!/sb_secret_/.test(fn), 'menciona una clave secreta de otro tipo');
});

check('no registra en consola el id de la invitación ni el correo', () => {
  const consolas = findCalls(fn, 'console\\.[a-z]+');
  assert.ok(consolas.length > 0, 'no hay ningún log: no se podría diagnosticar nada');
  for (const llamada of consolas) {
    assert.ok(
      llamada.args.includes("'invite-email: '"),
      'hay un console.* que no escribe una línea estructural: ' + llamada.args.trim(),
    );
  }
  const propios = findCalls(fn, '(?:logEvent|logProblem)');
  assert.ok(propios.length > 0, 'no se usan los ayudantes de log estructural');
  const prohibido =
    /invitationId|invitation_id|invitation\.|\.email|emailEnv|\bemail\b|apiKey|api_key|anonKey|authHeader|authorization|\bjwt\b|linkBase|link_path|\blink\b|provider_message_id|\bbody\b|\brequest\b|\bdata\b/i;
  for (const llamada of propios) {
    assert.ok(
      !prohibido.test(llamada.args),
      'un log estructural lleva un dato que identifica a alguien: ' + llamada.args.trim(),
    );
  }
});

check('llama a las dos RPC por su nombre exacto y con sus parámetros', () => {
  assert.ok(fn.includes("rpc('prepare_invitation_email'"), 'no llama a prepare_invitation_email');
  assert.ok(
    fn.includes("rpc('record_invitation_email_result'"),
    'no llama a record_invitation_email_result',
  );
  for (const parametro of ['p_invitation_id', 'p_status', 'p_provider_message_id', 'p_error']) {
    assert.ok(fn.includes(parametro), 'falta el parámetro ' + parametro);
  }
  assert.ok(
    fn.includes("'provider_accepted'") && fn.includes("'send_error'"),
    'no usa los dos estados admitidos por record_invitation_email_result',
  );
});

check(
  'comprueba la configuración de correo ANTES de preparar el envío (no consume intento)',
  () => {
    const configuracion = fn.indexOf('resolveEmailConfig(');
    const preparar = fn.indexOf("rpc('prepare_invitation_email'");
    assert.ok(configuracion > -1, 'no resuelve la configuración de correo');
    assert.ok(preparar > -1, 'no llama a prepare_invitation_email');
    assert.ok(
      configuracion < preparar,
      'resuelve la configuración DESPUÉS de preparar: un entorno sin configurar gastaría un intento',
    );
    assert.ok(
      fn.includes("'not_configured'"),
      'no devuelve el estado not_configured cuando falta configuración',
    );
  },
);

check('exige POST, exige Authorization y responde 200/400/401 como manda el contrato', () => {
  assert.ok(/Deno\.serve\(/.test(fn), 'no usa Deno.serve');
  assert.ok(fn.includes("req.method === 'OPTIONS'"), 'no atiende la petición previa de CORS');
  assert.ok(fn.includes("req.method !== 'POST'"), 'no rechaza otros métodos');
  assert.ok(fn.includes("headers.get('Authorization')"), 'no lee la cabecera Authorization');
  assert.ok(/Bearer/.test(fn), 'no exige un token Bearer');
  const autorizacion = fn.indexOf("headers.get('Authorization')");
  const preparar = fn.indexOf("rpc('prepare_invitation_email'");
  assert.ok(autorizacion < preparar, 'prepara el envío antes de comprobar la sesión');
  assert.ok(/case 'invalid_request':\s*return 400;/.test(fn), 'invalid_request no responde 400');
  assert.ok(/case 'unauthorized':\s*return 401;/.test(fn), 'unauthorized no responde 401');
  assert.ok(fn.includes('Access-Control-Allow-Origin'), 'no responde con cabeceras CORS');
});

check('los códigos HTTP se limitan a 400/401/405 (protocolo) y 200 (todo lo de negocio)', () => {
  // El cliente usa `supabase.functions.invoke`, que solo rellena `data` con el cuerpo cuando la
  // respuesta es 2xx: un 429 en el cooldown dejaría al propietario sin el mensaje escrito para
  // él. El contrato solo fija 200/400/401, así que el resto de estados viaja con 200 y el
  // cuerpo (`ok`, `status`, `message`) es el que distingue.
  const codigos = [...new Set([...fn.matchAll(/return (\d{3});/g)].map((m) => Number(m[1])))].sort(
    (a, b) => a - b,
  );
  assert.deepEqual(
    codigos,
    [200, 400, 401, 405],
    'hay códigos HTTP fuera de la política declarada: ' + codigos.join(', '),
  );
  assert.ok(
    !fn.includes("case 'not_configured':"),
    'not_configured no debe tener código propio: el contrato le manda un 200',
  );
});

check('responde siempre con el cuerpo { ok, status, message }', () => {
  // Se buscan los `return respond(` (las llamadas), no la definición de la función.
  const respuestas = findCalls(fn, '(?:return )respond');
  assert.ok(respuestas.length >= 6, 'hay menos respuestas de las esperadas');
  const obligatorios = ['ok:', 'status:', 'message:'];
  for (const respuesta of respuestas) {
    for (const campo of obligatorios) {
      assert.ok(
        respuesta.args.includes(campo),
        'una respuesta sin ' + campo + ': ' + respuesta.args,
      );
    }
  }
});

console.log('\nMódulo puro: pureza y sintaxis borrable');

const sharedRaw = readSource(SHARED_FILE);
const shared = stripComments(sharedRaw);

check('sin dependencias: ni un import ni un require', () => {
  assert.ok(!/^\s*import\b/m.test(shared), 'el módulo importa algo');
  assert.ok(!/\brequire\s*\(/.test(shared), 'el módulo usa require()');
});

check(
  'solo sintaxis TypeScript BORRABLE (nada de enum, namespace, declare ni propiedades de parámetro)',
  () => {
    assert.ok(!/\benum\s+[A-Za-z_]/.test(shared), 'usa enum');
    assert.ok(!/\bnamespace\s+[A-Za-z_]/.test(shared), 'usa namespace');
    assert.ok(!/\bdeclare\s/.test(shared), 'usa declare');
    assert.ok(
      !/constructor\s*\([^)]*\b(?:private|public|protected|readonly)\b/.test(shared),
      'usa propiedades de parámetro',
    );
    assert.ok(!/^\s*@[A-Za-z_$]/m.test(shared), 'usa decoradores');
  },
);

check('no lleva literales con pinta de clave', () => {
  for (const patron of [
    /\bsk_[A-Za-z0-9_-]{8,}/,
    /\bre_[A-Za-z0-9_-]{8,}/,
    /\bxkeysib-/i,
    /\bsb_secret_/,
  ]) {
    assert.ok(!patron.test(shared), 'literal sospechoso: ' + patron);
  }
});

// -------------------------------------------------------------
if (failed > 0) {
  console.error(`\nVALIDACIÓN DEL CORREO DE INVITACIÓN CON ${failed} PROBLEMA(S).`);
  process.exit(1);
}
console.log('\nValidación OK.');
console.log(`
[alcance] Lo que ESTE script comprueba de verdad: el comportamiento del módulo puro (importado,
  sin transpilar) y propiedades ESTÁTICAS del texto de la Edge Function.
  Lo que NO puede comprobar y sigue SIN verificar:
   · el envío real a Resend/Postmark (no hay proveedor, ni credenciales, ni dominio);
   · la entrega, los rebotes y el spam (solo el proveedor y el buzón lo dicen);
   · las RPC prepare_invitation_email / record_invitation_email_result contra PostgreSQL;
   · que la Edge Function arranque en Deno (aquí se lee su código, no se ejecuta).`);
process.exit(0);
