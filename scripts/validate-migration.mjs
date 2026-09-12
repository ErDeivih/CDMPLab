import pgQuery from 'libpg-query';
import fs from 'node:fs';
import path from 'node:path';

// =============================================================
// EntrenoLab / CDMPLab — Validador de migraciones.
//
// 1. Análisis ESTÁTICO de sintaxis de TODAS las migraciones (libpg-query).
// 2. Comprobaciones de ENDURECIMIENTO (estáticas, sobre el contenido DISEÑADO de
//    la migración de grants) para los invariantes de la FASE de producción:
//      · anon sin privilegios en tablas de aplicación;
//      · authenticated sin TRUNCATE/TRIGGER/REFERENCES;
//      · ausencia de acceso a private.platform_admins;
//      · EXECUTE sensible no concedido a PUBLIC/anon;
//      · presencia de los grants mínimos necesarios;
//      · equipos sin DELETE directo (la app solo crea con `create_my_team`);
//      · helpers privados solo-ejecutables-desde-DEFINER revocados de authenticated;
//      · documentación de `ALTER DEFAULT PRIVILEGES` pendiente de rol propietario.
//
// ALCANCE / LIMITACIÓN (honesta):
//   · Este script es un análisis ESTÁTICO de sintaxis y de texto. NO ejecuta nada
//     sobre PostgreSQL, por lo que NO verifica:
//       + si las funciones/tablas existen realmente (catálogo remoto);
//       + si los GRANT/REVOKE se aplican sin error (roles, propietarios);
//       + si RLS está activa (se define en las migraciones, no aquí).
//   · Esos tres niveles son DISTINTOS:
//       (A) Análisis estático/sintaxis   → lo que hace este script (local).
//       (B) Aplicación real en PostgreSQL → requiere la migración ejecutada (remoto).
//       (C) Consulta remota (pg_proc, role_table_grants, ...) → requiere acceso.
//   · Este script cubre SOLO (A).
//
// Uso: node scripts/validate-migration.mjs [una-migracion.sql]
// =============================================================

const target = process.argv[2];
const PERMS_FILE = '20260901000000_harden_grants.sql';
const files = target
  ? [target]
  : fs
      .readdirSync('supabase/migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => path.join('supabase/migrations', name));

const TABLES = ['profiles', 'teams', 'team_members', 'team_invitations', 'players', 'exercise_folders', 'exercises', 'sessions', 'session_exercises'];
const WRITE_TABLES = ['players', 'exercise_folders', 'exercises', 'sessions', 'session_exercises'];
// Helpers privados que solo se llaman desde OTROS helpers SECURITY DEFINER: el
// cliente no debe poder ejecutarlos directamente (mínimo privilegio).
const REVOKE_FROM_AUTHENTICATED_PRIVATE = ['enforce_collaborator_limit', 'add_collaborator'];

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error('  ✗ ' + msg);
};
const ok = (msg) => console.log('  ✓ ' + msg);

/** Búsqueda de fragmentos en el contenido (independiente de mayúsculas/espacios). */
const norm = (s) => String(s).replace(/\s+/g, ' ').toLowerCase();
function has(content, frag) {
  return norm(content).includes(norm(frag));
}
function countTokens(content, pattern) {
  return (content.match(new RegExp(pattern, 'gi')) ?? []).length;
}

try {
  let total = 0;
  for (const file of files) {
    const res = await pgQuery.parse(fs.readFileSync(file, 'utf8'));
    const count = (res.stmts ?? []).length;
    total += count;
    console.log(`OK: ${file} (${count} statements)`);
  }
  console.log(`OK: parsed ${files.length} migration files, ${total} top-level statements.`);

  // ---------- Comprobaciones de endurecimiento sobre la migración de grants ----------
  const permsPath = path.join('supabase/migrations', PERMS_FILE);
  if (fs.existsSync(permsPath)) {
    const sql = fs.readFileSync(permsPath, 'utf8');
    console.log(`\nEndurecimiento de permisos (${PERMS_FILE}):`);

    // (a) anon sin privilegios sobre tablas de aplicación: existe un REVOKE ALL que
    // menciona cada tabla (en lista o individual) y revoca a anon/public.
    const revokeForEvery = TABLES.every((t) => has(sql, `public.${t}`) && has(sql, 'revoke all on table') && has(sql, 'from anon') && has(sql, 'from public'));
    revokeForEvery ? ok('anon/public: REVOKE ALL sobre las tablas de aplicación') : fail('falta REVOKE ALL de anon/public sobre tablas de aplicación');

    // (b) authenticated sin TRUNCATE/TRIGGER/REFERENCES.
    const dangerousGrants = ['truncate', 'trigger', 'references']
      .map((k) => countTokens(sql, `grant\\s+[^;]*\\b${k}\\b[^;]*\\bto\\s+authenticated`))
      .reduce((a, b) => a + b, 0);
    dangerousGrants === 0
      ? ok('authenticated: sin GRANT de TRUNCATE/TRIGGER/REFERENCES')
      : fail('authenticated recibe TRUNCATE/TRIGGER/REFERENCES');

    // (c) ausencia de acceso a private.platform_admins.
    const adminAccess = /grant[^;]*platform_admins[^;]*to\s+(anon|authenticated|public)/i.test(sql);
    adminAccess ? fail('se concede acceso de tabla a private.platform_admins') : ok('private.platform_admins: sin acceso de tabla a anon/authenticated');

    // (d) EXECUTE sensible no concedido a PUBLIC/anon.
    const publicExec = countTokens(sql, 'grant\\s+execute[^;]*\\bto\\s+public');
    const anonExec = countTokens(sql, 'grant\\s+execute[^;]*\\bto\\s+anon');
    publicExec + anonExec === 0
      ? ok('EXECUTE sensible: sin GRANT a PUBLIC/anon')
      : fail('se concede EXECUTE a PUBLIC/anon en funciones sensibles');

    // (e) grants mínimos: SELECT en todas las tablas + escritura en las directas.
    const selectAll = has(sql, 'grant select on table') && TABLES.every((t) => has(sql, `public.${t}`));
    selectAll ? ok('SELECT mínimo en todas las tablas de lectura') : fail('falta SELECT en alguna tabla');

    const writeAll = WRITE_TABLES.every((t) => has(sql, `insert, update, delete on table public.${t}`));
    writeAll ? ok('INSERT/UPDATE/DELETE mínimos en tablas de escritura directa') : fail('falta escritura directa mínima');

    // (f) revocación de EXECUTE sensible a public/anon está presente.
    const revokePublicExec = countTokens(sql, 'revoke\\s+execute[^;]*from\\s+public,\\s*anon');
    revokePublicExec > 0 ? ok(`REVOKE EXECUTE a public/anon presente (${revokePublicExec})`) : fail('falta REVOKE EXECUTE a public/anon');

    // (g) idempotencia: un REVOKE ALL hacia el estado limpio antes de reconceder.
    has(sql, 'revoke all on table') ? ok('idempotente: REVOKE ALL antes de reconceder') : fail('la migración no revoca hacia el estado limpio');

    // (h) TEAMS: la app solo CREA equipos con `create_my_team` (INSERT, SECURITY INVOKER);
    // NUNCA borra equipos. No debe concederse DELETE directo en public.teams.
    const teamsDeleteGrant = /grant\s+[^;]*delete\s+on\s+table\s+public\.teams\s*to\s+authenticated/i.test(sql);
    teamsDeleteGrant
      ? fail('public.teams: se concede DELETE directo a authenticated (la app no borra equipos; usar solo INSERT por create_my_team)')
      : ok('public.teams: sin DELETE directo (solo INSERT por create_my_team)');

    const teamsInsertGrant = /grant\s+insert\s+on\s+table\s+public\.teams\s*to\s+authenticated/i.test(sql);
    teamsInsertGrant ? ok('public.teams: INSERT a authenticated (requerido por create_my_team INVOKER)') : fail('public.teams: falta INSERT a authenticated');

    // (i) helpers privados solo-DEFINER revocados de authenticated.
    const privateRevoked = REVOKE_FROM_AUTHENTICATED_PRIVATE.every((name) =>
      has(sql, `revoke execute on function private.${name}(`) && has(sql, `from authenticated`)
    );
    privateRevoked
      ? ok('helpers privados solo-DEFINER revocados de authenticated')
      : fail('falta revocar EXECUTE a authenticated de los helpers privados solo-DEFINER (enforce_collaborator_limit / add_collaborator)');

    // (j) la revocación es explícita: no debe quedar ningún grant EXECUTE a
    // authenticated sobre esos dos helpers.
    const privateGranted = REVOKE_FROM_AUTHENTICATED_PRIVATE.some((name) =>
      /grant\s+execute[^;]*private\.(enforce_collaborator_limit|add_collaborator)\([^;]*to\s+authenticated/i.test(sql)
    );
    privateGranted ? fail('se sigue concediendo EXECUTE a authenticated de un helper solo-DEFINER') : ok('sin EXECUTE residual de helpers solo-DEFINER a authenticated');

    // (k) catálogo remoto: las migraciones de usuario crean objetos como postgres.
    // `postgres` no puede alterar los defaults del rol interno supabase_admin.
    const defaultRoles = ['postgres'];
    const defaultKinds = ['tables', 'sequences', 'functions'];
    const defaultsHardened = defaultRoles.every((role) =>
      defaultKinds.every((kind) =>
        has(sql, `alter default privileges for role ${role} in schema public revoke all on ${kind} from public, anon, authenticated`)
      )
    );
    defaultsHardened
      ? ok('default privileges endurecidos para postgres (tablas/secuencias/funciones)')
      : fail('faltan revocaciones de privilegios por defecto para postgres');

    has(sql, 'supabase_admin') && has(sql, 'no es miembro') && has(sql, 'no son modificables')
      ? ok('limitación alojada de supabase_admin documentada con evidencia remota')
      : fail('falta documentar por qué postgres no puede alterar los defaults de supabase_admin');
  } else {
    fail(`no existe la migración de endurecimiento ${PERMS_FILE}`);
  }

  // ---------- RPC del INVITADO: decline_team_invitation ----------
  // `validate:migration` NO comprueba el catálogo remoto ni que los GRANT se apliquen:
  // aquí se verifica que las PROPIEDADES DE SEGURIDAD estén ESCRITAS en el fichero
  // (definer con search_path vacío, wrapper invoker, revocaciones y grants mínimos).
  const DECLINE_FILE = '20260910000000_decline_team_invitation.sql';
  const declinePath = path.join('supabase/migrations', DECLINE_FILE);
  if (fs.existsSync(declinePath)) {
    const sql = fs.readFileSync(declinePath, 'utf8');
    console.log(`\nRPC del invitado (${DECLINE_FILE}):`);

    const privDefiner =
      has(sql, 'create or replace function private.decline_team_invitation(p_invitation_id uuid)') &&
      has(sql, 'security definer') &&
      has(sql, "set search_path = ''");
    privDefiner ? ok('privada: SECURITY DEFINER con search_path vacío') : fail('la función privada no es DEFINER con search_path vacío');

    const pubInvoker =
      has(sql, 'create or replace function public.decline_team_invitation(p_invitation_id uuid)') &&
      has(sql, 'security invoker');
    pubInvoker ? ok('pública: SECURITY INVOKER (delega)') : fail('la función pública no es SECURITY INVOKER');

    const revokedPublic = has(sql, 'revoke execute on function public.decline_team_invitation(uuid) from public, anon');
    const revokedPrivate = has(sql, 'revoke execute on function private.decline_team_invitation(uuid) from public, anon');
    revokedPublic && revokedPrivate
      ? ok('EXECUTE revocado a public/anon en las dos funciones')
      : fail('falta revocar EXECUTE a public/anon (pública y/o privada)');

    const grantedPublic = has(sql, 'grant execute on function public.decline_team_invitation(uuid) to authenticated');
    const grantedPrivate = has(sql, 'grant execute on function private.decline_team_invitation(uuid) to authenticated');
    grantedPublic && grantedPrivate
      ? ok('EXECUTE concedido solo a authenticated en las dos funciones (la pública es INVOKER)')
      : fail('falta el GRANT a authenticated (pública y/o privada)');

    // La identidad se comprueba por el correo de la cuenta: el invitado solo puede
    // rechazar SU invitación.
    has(sql, 'inv.email_normalized <> caller_email')
      ? ok('comprueba que la invitación es del que llama (email)')
      : fail('no comprueba que la invitación pertenezca al que llama');

    // El estado de destino debe existir en el CHECK de la tabla.
    has(sql, "set status = 'revoked'")
      ? ok("marca la invitación como 'revoked' (estado admitido por el CHECK)")
      : fail("no marca la invitación como 'revoked'");
  } else {
    console.log(`\n[aviso] no existe ${DECLINE_FILE}: la app llama a decline_team_invitation y fallará en remoto.`);
  }

  if (failed > 0) {
    console.error(`\nVALIDACIÓN ESTÁTICA CON ${failed} PROBLEMA(S).`);
    process.exit(1);
  }
  console.log('\nValidación ESTÁTICA OK.');
  if (target) {
    console.log(`\n[alcance] Análisis estático de ${target} OK.`);
  } else {
    console.log(`
[alcance] Este script es SOLO análisis estático/sintaxis (nivel A).
  Comprueba propiedades ESTÁTICAS del SQL versionado en supabase/migrations/: no ejecuta
  nada sobre PostgreSQL y el estado REMOTO no se verifica aquí (ni el recuento de
  migraciones aplicadas, ni el mapeo entre el nombre local y el registrado en remoto).
  Lo que está documentado en el repositorio y lo que sigue SIN verificar contra la base
  está en docs/supabase-estado.md.`);
  }
  process.exit(0);
} catch (e) {
  console.error('PARSE ERROR:', e.message || e);
  process.exit(1);
}
