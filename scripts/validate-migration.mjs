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

const TABLES = [
  'profiles',
  'teams',
  'team_members',
  'team_invitations',
  'players',
  'exercise_folders',
  'exercises',
  'sessions',
  'session_exercises',
];
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
    const revokeForEvery = TABLES.every(
      (t) =>
        has(sql, `public.${t}`) &&
        has(sql, 'revoke all on table') &&
        has(sql, 'from anon') &&
        has(sql, 'from public'),
    );
    revokeForEvery
      ? ok('anon/public: REVOKE ALL sobre las tablas de aplicación')
      : fail('falta REVOKE ALL de anon/public sobre tablas de aplicación');

    // (b) authenticated sin TRUNCATE/TRIGGER/REFERENCES.
    const dangerousGrants = ['truncate', 'trigger', 'references']
      .map((k) => countTokens(sql, `grant\\s+[^;]*\\b${k}\\b[^;]*\\bto\\s+authenticated`))
      .reduce((a, b) => a + b, 0);
    dangerousGrants === 0
      ? ok('authenticated: sin GRANT de TRUNCATE/TRIGGER/REFERENCES')
      : fail('authenticated recibe TRUNCATE/TRIGGER/REFERENCES');

    // (c) ausencia de acceso a private.platform_admins.
    const adminAccess = /grant[^;]*platform_admins[^;]*to\s+(anon|authenticated|public)/i.test(sql);
    adminAccess
      ? fail('se concede acceso de tabla a private.platform_admins')
      : ok('private.platform_admins: sin acceso de tabla a anon/authenticated');

    // (d) EXECUTE sensible no concedido a PUBLIC/anon.
    const publicExec = countTokens(sql, 'grant\\s+execute[^;]*\\bto\\s+public');
    const anonExec = countTokens(sql, 'grant\\s+execute[^;]*\\bto\\s+anon');
    publicExec + anonExec === 0
      ? ok('EXECUTE sensible: sin GRANT a PUBLIC/anon')
      : fail('se concede EXECUTE a PUBLIC/anon en funciones sensibles');

    // (e) grants mínimos: SELECT en todas las tablas + escritura en las directas.
    const selectAll =
      has(sql, 'grant select on table') && TABLES.every((t) => has(sql, `public.${t}`));
    selectAll
      ? ok('SELECT mínimo en todas las tablas de lectura')
      : fail('falta SELECT en alguna tabla');

    const writeAll = WRITE_TABLES.every((t) =>
      has(sql, `insert, update, delete on table public.${t}`),
    );
    writeAll
      ? ok('INSERT/UPDATE/DELETE mínimos en tablas de escritura directa')
      : fail('falta escritura directa mínima');

    // (f) revocación de EXECUTE sensible a public/anon está presente.
    const revokePublicExec = countTokens(sql, 'revoke\\s+execute[^;]*from\\s+public,\\s*anon');
    revokePublicExec > 0
      ? ok(`REVOKE EXECUTE a public/anon presente (${revokePublicExec})`)
      : fail('falta REVOKE EXECUTE a public/anon');

    // (g) idempotencia: un REVOKE ALL hacia el estado limpio antes de reconceder.
    has(sql, 'revoke all on table')
      ? ok('idempotente: REVOKE ALL antes de reconceder')
      : fail('la migración no revoca hacia el estado limpio');

    // (h) TEAMS: la app solo CREA equipos con `create_my_team` (INSERT, SECURITY INVOKER);
    // NUNCA borra equipos. No debe concederse DELETE directo en public.teams.
    const teamsDeleteGrant =
      /grant\s+[^;]*delete\s+on\s+table\s+public\.teams\s*to\s+authenticated/i.test(sql);
    teamsDeleteGrant
      ? fail(
          'public.teams: se concede DELETE directo a authenticated (la app no borra equipos; usar solo INSERT por create_my_team)',
        )
      : ok('public.teams: sin DELETE directo (solo INSERT por create_my_team)');

    const teamsInsertGrant =
      /grant\s+insert\s+on\s+table\s+public\.teams\s*to\s+authenticated/i.test(sql);
    teamsInsertGrant
      ? ok('public.teams: INSERT a authenticated (requerido por create_my_team INVOKER)')
      : fail('public.teams: falta INSERT a authenticated');

    // (i) helpers privados solo-DEFINER revocados de authenticated.
    const privateRevoked = REVOKE_FROM_AUTHENTICATED_PRIVATE.every(
      (name) =>
        has(sql, `revoke execute on function private.${name}(`) && has(sql, `from authenticated`),
    );
    privateRevoked
      ? ok('helpers privados solo-DEFINER revocados de authenticated')
      : fail(
          'falta revocar EXECUTE a authenticated de los helpers privados solo-DEFINER (enforce_collaborator_limit / add_collaborator)',
        );

    // (j) la revocación es explícita: no debe quedar ningún grant EXECUTE a
    // authenticated sobre esos dos helpers.
    const privateGranted = REVOKE_FROM_AUTHENTICATED_PRIVATE.some((name) =>
      /grant\s+execute[^;]*private\.(enforce_collaborator_limit|add_collaborator)\([^;]*to\s+authenticated/i.test(
        sql,
      ),
    );
    privateGranted
      ? fail('se sigue concediendo EXECUTE a authenticated de un helper solo-DEFINER')
      : ok('sin EXECUTE residual de helpers solo-DEFINER a authenticated');

    // (k) catálogo remoto: las migraciones de usuario crean objetos como postgres.
    // `postgres` no puede alterar los defaults del rol interno supabase_admin.
    const defaultRoles = ['postgres'];
    const defaultKinds = ['tables', 'sequences', 'functions'];
    const defaultsHardened = defaultRoles.every((role) =>
      defaultKinds.every((kind) =>
        has(
          sql,
          `alter default privileges for role ${role} in schema public revoke all on ${kind} from public, anon, authenticated`,
        ),
      ),
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
      has(
        sql,
        'create or replace function private.decline_team_invitation(p_invitation_id uuid)',
      ) &&
      has(sql, 'security definer') &&
      has(sql, "set search_path = ''");
    privDefiner
      ? ok('privada: SECURITY DEFINER con search_path vacío')
      : fail('la función privada no es DEFINER con search_path vacío');

    const pubInvoker =
      has(sql, 'create or replace function public.decline_team_invitation(p_invitation_id uuid)') &&
      has(sql, 'security invoker');
    pubInvoker
      ? ok('pública: SECURITY INVOKER (delega)')
      : fail('la función pública no es SECURITY INVOKER');

    const revokedPublic = has(
      sql,
      'revoke execute on function public.decline_team_invitation(uuid) from public, anon',
    );
    const revokedPrivate = has(
      sql,
      'revoke execute on function private.decline_team_invitation(uuid) from public, anon',
    );
    revokedPublic && revokedPrivate
      ? ok('EXECUTE revocado a public/anon en las dos funciones')
      : fail('falta revocar EXECUTE a public/anon (pública y/o privada)');

    const grantedPublic = has(
      sql,
      'grant execute on function public.decline_team_invitation(uuid) to authenticated',
    );
    const grantedPrivate = has(
      sql,
      'grant execute on function private.decline_team_invitation(uuid) to authenticated',
    );
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
    console.log(
      `\n[aviso] no existe ${DECLINE_FILE}: la app llama a decline_team_invitation y fallará en remoto.`,
    );
  }

  // ---- Fase 6: RPC de carpeta atómicas (borrado y duplicado de subárbol) ----
  // Contrato sobre el SQL versionado: sin base remota no se puede probar la transacción, pero sí
  // exigir que la función no sea una puerta trasera ni reciba privilegios de más.
  {
    const f6 = 'supabase/migrations/20260911000000_entrenolab_folders_atomic.sql';
    if (!fs.existsSync(f6)) {
      fail('falta la migración de operaciones de carpeta atómicas (Fase 6)');
    } else {
      const sqlBruto = fs.readFileSync(f6, 'utf8');
      // Los comentarios NO cuentan: el propio fichero explica en un comentario que no se usa
      // `user_metadata`, y comprobar el texto crudo daba un falso positivo (medido).
      const sql = sqlBruto.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
      const fn = ['public.delete_folder_tree(uuid)', 'public.duplicate_folder_tree(uuid)'];
      countTokens(sql, 'security definer') >= 3
        ? ok('carpetas: SECURITY DEFINER declarado en las funciones')
        : fail('carpetas: faltan declaraciones SECURITY DEFINER');
      countTokens(sql, "set search_path = ''") >= 3
        ? ok('carpetas: search_path vacío en todas las funciones')
        : fail('carpetas: alguna función sin search_path vacío');
      fn.every((f) => has(sql, `revoke execute on function ${f} from public, anon`))
        ? ok('carpetas: EXECUTE revocado a PUBLIC y anon')
        : fail('carpetas: EXECUTE no revocado a PUBLIC/anon');
      fn.every((f) => has(sql, `grant execute on function ${f} to authenticated`))
        ? ok('carpetas: EXECUTE concedido solo a authenticated')
        : fail('carpetas: falta el GRANT a authenticated');
      has(sql, 'private.team_role(')
        ? ok('carpetas: autoriza por pertenencia al equipo (private.team_role)')
        : fail('carpetas: no comprueba la pertenencia al equipo');
      has(sql, 'user_metadata')
        ? fail('carpetas: usa user_metadata para autorizar (prohibido)')
        : ok('carpetas: NO usa user_metadata');
      countTokens(sql, 'team_id = v_team') >= 3
        ? ok('carpetas: todas las consultas se limitan al equipo')
        : fail('carpetas: hay consultas sin filtrar por equipo');

      // ---- Contrato de DUPLICADO: el cliente local actual vs lo que afirma la RPC ----
      // El borrador de esta migración se desviaba en dos puntos del comportamiento local
      // (`StoreService.duplicateFolder`, que es lo que la app usa hoy): copiaba el `parent_id` del
      // original en la raíz duplicada (debía ser null) y copiaba los títulos de los ejercicios tal
      // cual (debían llevar el sufijo « (copia)»). Sin PostgreSQL remoto no se puede ejecutar la
      // RPC, así que aquí se comparan los DOS lados de forma estática: se deriva el contrato del
      // código TypeScript que hoy funciona y se exige que el SQL diga lo mismo. La mitad local de
      // comportamiento está medida con código real en
      // `src/app/core/folders-migration.contract.spec.ts` (puerta `npm run test:unit`).
      const storeTs = fs.readFileSync('src/app/core/store.service.ts', 'utf8');
      const clienteRaizNula = /copyRec\(id, null\)/.test(storeTs);
      const clienteSufijoRaiz = /\$\{root\.name\} \(copia\)/.test(storeTs);
      const clienteSufijoEjercicio = /\$\{ex\.title\} \(copia\)/.test(storeTs);
      clienteRaizNula && clienteSufijoRaiz && clienteSufijoEjercicio
        ? ok('carpetas: contrato local leído de store.service.ts (raíz null + sufijo « (copia)»)')
        : fail('carpetas: no se reconoce el contrato de duplicado en store.service.ts');

      /values \(v_team, r\.name \|\| ' \(copia\)', null\)/.test(sql)
        ? ok('carpetas: la raíz duplicada se inserta con parent_id null')
        : fail('carpetas: la raíz duplicada NO se inserta con parent_id null');
      /r\.name \|\| ' \(copia\)', r\.parent_id/.test(sql)
        ? fail('carpetas: la raíz duplicada vuelve a copiar el parent_id del original')
        : ok('carpetas: la raíz duplicada no arrastra el parent_id del original');
      /e\.title \|\| ' \(copia\)'/.test(sql)
        ? ok('carpetas: los ejercicios copiados llevan el sufijo « (copia)»')
        : fail('carpetas: los ejercicios copiados conservan el título literal');
      /e\.team_id, v_new, e\.title,/.test(sql)
        ? fail('carpetas: vuelve a copiar el título literal de los ejercicios')
        : ok('carpetas: el título de los ejercicios copiados no se copia literal');
      /values \(v_team, r\.name, \(v_map ->> r\.parent_id::text\)::uuid\)/.test(sql)
        ? ok('carpetas: las subcarpetas conservan su nombre y cuelgan de la copia')
        : fail('carpetas: las subcarpetas no se enlazan con la copia de su padre');
      // Pizarra, miniatura y propiedades: nada se pierde al duplicar.
      const columnasCopiadas = [
        'e.canvas_data',
        'e.thumbnail',
        'e.description',
        'e.explanation',
        'e.category',
        'e.objectives',
        'e.materials',
        'e.duration_minutes',
        'e.load_mode',
        'e.series_count',
        'e.work_seconds',
        'e.rest_seconds',
        'e.is_template',
      ];
      const faltan = columnasCopiadas.filter((c) => !sql.includes(c));
      faltan.length === 0
        ? ok('carpetas: se copian pizarra, miniatura y propiedades del ejercicio')
        : fail(`carpetas: la copia de ejercicios pierde columnas: ${faltan.join(', ')}`);
    }
  }

  // ---- FASE 9: contrato del LÍMITE DE COLABORADORES ----
  // El encargo pide documentar y PROBAR el funcionamiento actual de equipos e invitaciones sin tocar
  // la base remota. Lo verificable aquí es el contrato que vive en el SQL versionado: máximo cuatro
  // colaboradores, el propietario NO cuenta, solo el propietario puede invocar la comprobación y la
  // función no es una puerta trasera (EXECUTE revocado a authenticated por el endurecimiento).
  {
    const esquema = 'supabase/migrations/20260827000000_entrenolab_schema.sql';
    const hardening = 'supabase/migrations/20260827000001_entrenolab_hardening.sql';
    if (!fs.existsSync(esquema)) {
      fail('colaboradores: falta el esquema con el límite de colaboradores');
    } else {
      const sqlLimite = fs
        .readFileSync(esquema, 'utf8')
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ');
      has(sqlLimite, 'create or replace function private.enforce_collaborator_limit(t uuid)')
        ? ok('colaboradores: existe private.enforce_collaborator_limit')
        : fail('colaboradores: no se encuentra la función del límite');
      // Máximo 4: la comprobación es `used >= 4`.
      /\bused\s*>=\s*4\b/.test(sqlLimite)
        ? ok('colaboradores: el límite son 4 (used >= 4)')
        : fail('colaboradores: el límite de 4 no está declarado como used >= 4');
      // El propietario NO cuenta: se cuentan los miembros activos con rol distinto de owner.
      /status\s*=\s*'active'\s+and\s+role\s*<>\s*'owner'/.test(sqlLimite)
        ? ok('colaboradores: el propietario no consume plaza (role <> owner)')
        : fail('colaboradores: el conteo no excluye al propietario');
      // Solo el propietario puede invocar la comprobación.
      /if not private\.is_team_owner\(t\) then/.test(sqlLimite)
        ? ok('colaboradores: solo el propietario puede invocar la comprobación')
        : fail('colaboradores: no se comprueba que quien invoca sea el propietario');
      // Se bloquea la fila del equipo (evita carreras entre dos invitaciones simultáneas).
      /for update/.test(sqlLimite)
        ? ok('colaboradores: bloquea la fila del equipo (sin carreras)')
        : fail('colaboradores: no bloquea la fila del equipo');
      // Cuenta también las invitaciones PENDIENTES no caducadas (si no, se podrían enviar de más).
      /status\s*=\s*'pending'\s+and\s+expires_at\s*>\s*now\(\)/.test(sqlLimite)
        ? ok('colaboradores: cuenta las invitaciones pendientes no caducadas')
        : fail('colaboradores: no cuenta las invitaciones pendientes');
      // El endurecimiento la deja fuera del alcance de los clientes.
      if (fs.existsSync(hardening)) {
        const sqlEndurecido = fs.readFileSync(hardening, 'utf8').replace(/--[^\n]*/g, ' ');
        has(sqlEndurecido, 'revoke execute on function private.enforce_collaborator_limit(uuid)')
          ? ok('colaboradores: EXECUTE revocado a authenticated en el endurecimiento')
          : fail('colaboradores: la función sigue siendo invocable por authenticated');
      }
    }
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
