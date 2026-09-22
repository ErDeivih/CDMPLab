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
// 3. Comprobaciones del CIERRE DEL ENCARGO (22/09/2026) en
//    `20260922000000_team_creation_requests.sql`: la creación de equipos deja de ser un
//    derecho del usuario aprobado (solicitud + aprobación del administrador), la tabla
//    `team_requests` solo se LEE, `create_my_team` cierra la vía antigua, se retira el
//    INSERT directo sobre `teams` y el correo de invitación registra estados
//    distinguibles con tope de intentos y errores truncados.
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

    // (h) TEAMS: la app NUNCA borra equipos, y desde el cierre del encargo de creación de
    // equipos TAMPOCO inserta directamente: el equipo lo crea el servidor al aprobar una
    // solicitud (`admin_decide_team_request`) o un administrador por `create_my_team`.
    // CAMBIO DE CONTRATO (22/09/2026): este fichero concedía `INSERT` a `authenticated`
    // porque `create_my_team` era SECURITY INVOKER y necesitaba DML REST. Ese contrato era
    // el agujero: con el GRANT y la política `teams_insert_owner`, cualquier perfil aprobado
    // podía crear su equipo saltándose el flujo. El estado FINAL (el que deja la última
    // migración que toque el tema) debe ser: SIN INSERT y SIN DELETE para authenticated.
    const teamsDeleteGrant =
      /grant\s+[^;]*delete\s+on\s+table\s+public\.teams\s*to\s+authenticated/i.test(sql);
    teamsDeleteGrant
      ? fail('public.teams: se concede DELETE directo a authenticated (la app no borra equipos)')
      : ok('public.teams: sin DELETE directo');

    console.log(`\nEstado FINAL de public.teams (recorriendo TODAS las migraciones en orden):`);
    const teamsDml =
      /(grant|revoke)\s+[^;]*\b(insert|delete)\b[^;]*on\s+table\s+public\.teams\s+(?:to|from)\s+authenticated/gi;
    let ultimaDml = null;
    let ultimaDmlFichero = '';
    for (const file of files) {
      const contenido = fs.readFileSync(file, 'utf8');
      for (const m of contenido.matchAll(teamsDml)) {
        ultimaDml = m[0].replace(/\s+/g, ' ').trim();
        ultimaDmlFichero = file;
      }
    }
    if (!ultimaDml) {
      fail('public.teams: ninguna migración declara el DML de authenticated sobre teams');
    } else if (/^revoke/i.test(ultimaDml)) {
      ok(
        `public.teams: la última palabra es REVOKE (${path.basename(ultimaDmlFichero)}): ${ultimaDml}`,
      );
    } else {
      fail(
        `public.teams: la ÚLTIMA palabra sobre DML es un GRANT (${path.basename(ultimaDmlFichero)}): ${ultimaDml}`,
      );
    }

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
  // Se comprueba la última redefinición, sin alterar el esquema histórico: seis colaboradores
  // más el propietario. La aplicación remota se verifica por separado contra pg_proc.
  {
    const esquema = 'supabase/migrations/20260921085803_increase_team_capacity_to_seven.sql';
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
      // Máximo 6 colaboradores: la séptima cuenta es el propietario.
      /\bused\s*>=\s*6\b/.test(sqlLimite)
        ? ok('colaboradores: el límite son 6 (used >= 6)')
        : fail('colaboradores: el límite de 6 no está declarado como used >= 6');
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
      has(sqlLimite, 'revoke execute on function private.enforce_collaborator_limit(uuid)') &&
      /from\s+public,\s*anon,\s*authenticated/i.test(sqlLimite)
        ? ok('colaboradores: EXECUTE revocado a PUBLIC, anon y authenticated')
        : fail('colaboradores: la función privada no revoca EXECUTE a los clientes');
    }
  }
  // ---- CIERRE DEL ENCARGO (22/09/2026): SOLICITUD de equipo + correo de invitación ----
  // Contrato estático del SQL versionado. Igual que en las fases anteriores, esto NO
  // demuestra que RLS o los GRANT estén aplicados en remoto: exige que las propiedades de
  // seguridad estén ESCRITAS (definer con search_path vacío, permiso de administrador
  // comprobado en servidor, bloqueo de fila, idempotencia y permisos mínimos).
  {
    const f10 = 'supabase/migrations/20260922000000_team_creation_requests.sql';
    if (!fs.existsSync(f10)) {
      fail('falta la migración de solicitud de equipo (creación cerrada al administrador)');
    } else {
      const sqlBruto = fs.readFileSync(f10, 'utf8');
      // Los comentarios NO cuentan: este fichero EXPLICA en comentarios el agujero y los
      // nombres de los estados, y comprobar el texto crudo daba falsos positivos.
      const sql = sqlBruto.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
      console.log(`\nSolicitud de equipo (${path.basename(f10)}):`);

      has(sql, 'create table if not exists public.team_requests')
        ? ok('existe la tabla public.team_requests')
        : fail('no se crea public.team_requests');
      has(sql, 'alter table public.team_requests enable row level security')
        ? ok('team_requests: RLS activada')
        : fail('team_requests: falta activar RLS');
      has(sql, 'for select to authenticated') &&
      has(sql, 'user_id = (select auth.uid()) or private.is_platform_admin()')
        ? ok('team_requests: solo se LEE (la propia o todas si es administrador)')
        : fail('team_requests: la política de lectura no distingue solicitante/administrador');
      // Ninguna política de escritura: el DML directo del cliente queda cerrado.
      /for\s+(insert|update|delete)\s+to\s+authenticated/i.test(sql)
        ? fail('team_requests: hay política de ESCRITURA directa (debe ir todo por RPC)')
        : ok('team_requests: sin políticas de escritura directa');
      // Una única solicitud pendiente por usuario, garantizada por índice parcial.
      /create unique index if not exists team_requests_one_pending_per_user[\s\S]*?where status = 'pending'/i.test(
        sql,
      )
        ? ok('team_requests: índice único parcial de UNA pendiente por usuario')
        : fail('team_requests: falta el índice único de una pendiente por usuario');

      // Permiso de administrador SIEMPRE por private.platform_admins (nunca por correo
      // ni por metadata del usuario) y en las dos RPC de administración.
      countTokens(sql, 'private\\.is_platform_admin\\(\\)') >= 3
        ? ok('permiso de plataforma comprobado en servidor (listar y decidir)')
        : fail('las RPC de administración no comprueban private.is_platform_admin()');
      has(sql, 'user_metadata')
        ? fail('usa user_metadata para autorizar (prohibido)')
        : ok('NO usa user_metadata');
      has(sql, 'team_request_not_found')
        ? ok('decidir: la solicitud debe existir')
        : fail('decidir: no comprueba que la solicitud exista');
      // Bloqueo de fila: dos aprobaciones simultáneas se serializan.
      /from public\.team_requests where id = p_request_id for update/.test(sql)
        ? ok('decidir: bloquea la solicitud (for update)')
        : fail('decidir: no bloquea la fila de la solicitud');
      // Idempotencia: repetir la aprobación devuelve el MISMO equipo.
      /if v_req\.status = 'approved' then[\s\S]{0,200}return v_req\.created_team_id/.test(sql)
        ? ok('decidir: idempotente (repetir devuelve el mismo equipo)')
        : fail('decidir: no es idempotente al repetir la aprobación');
      // El equipo se crea EN LA MISMA transacción, reutilizando el existente.
      /insert into public\.teams \(owner_user_id, name, accent_color\)[\s\S]{0,120}values \(v_req\.user_id/.test(
        sql,
      )
        ? ok('aprobar: crea el equipo del solicitante en la misma transacción')
        : fail('aprobar: no crea el equipo del solicitante');
      has(sql, 'when unique_violation then')
        ? ok('aprobar: carrera de unicidad resuelta reutilizando el equipo')
        : fail('aprobar: no contempla la carrera de unicidad (teams_owner_unique)');
      has(sql, 'requester_not_approved')
        ? ok('aprobar: exige que el solicitante siga aprobado')
        : fail('aprobar: no comprueba que el solicitante siga aprobado');
      // Rechazo con motivo y posibilidad de volver a solicitar.
      has(sql, "set status = 'rejected'") &&
      has(sql, "on conflict (user_id) where status = 'pending' do update")
        ? ok('rechazar: deja motivo y permite volver a solicitar (una pendiente)')
        : fail('rechazar: no deja estado/motivo o bloquea una nueva solicitud');

      // CIERRE de la vía antigua.
      has(sql, 'team_creation_requires_approval')
        ? ok('create_my_team: cierra la creación a quien no es administrador')
        : fail('create_my_team: no cierra la creación al usuario aprobado');
      has(sql, 'drop policy if exists teams_insert_owner on public.teams')
        ? ok('teams: se retira la política de INSERT del cliente')
        : fail('teams: no se retira la política teams_insert_owner');
      has(sql, 'revoke insert on table public.teams from authenticated')
        ? ok('teams: INSERT revocado a authenticated (sin vía alternativa)')
        : fail('teams: sigue concedido el INSERT directo a authenticated');

      // Correo de invitación: estados distinguibles, tope de intentos y errores truncados.
      has(
        sql,
        "check (email_status in ('created','send_pending','provider_accepted','send_error'))",
      )
        ? ok('correo: cuatro estados distinguibles en email_status')
        : fail('correo: los estados del envío no están declarados');
      /email_attempts >= 5/.test(sql)
        ? ok('correo: tope de intentos por invitación (5)')
        : fail('correo: no hay tope de intentos de envío');
      /interval '60 seconds'/.test(sql)
        ? ok('correo: cooldown entre envíos correctos')
        : fail('correo: no hay cooldown entre envíos');
      has(sql, 'left(regexp_replace(coalesce(p_error') && has(sql, '300')
        ? ok('correo: el motivo del fallo se redacta y trunca (nunca un token)')
        : fail('correo: el error del proveedor no se trunca');
      has(sql, 'invitation_not_available') && has(sql, 'forbidden: not team owner')
        ? ok('correo: autoriza por propiedad del equipo y exige invitación viva')
        : fail('correo: no comprueba propiedad de la invitación');

      // Permisos mínimos.
      has(sql, 'revoke all on table public.team_requests from public, anon, authenticated') &&
      has(sql, 'grant select on table public.team_requests to authenticated')
        ? ok('team_requests: solo SELECT a authenticated (cero DML directo)')
        : fail('team_requests: los permisos de tabla no son mínimos');

      // RPC que el CLIENTE puede invocar (autorizan dentro: propiedad del equipo o
      // administrador de plataforma).
      const rpcCliente = [
        'public.request_team_creation(text, text)',
        'public.admin_list_team_requests(text)',
        'public.admin_decide_team_request(uuid, boolean, text)',
        'public.prepare_invitation_email(uuid)',
      ];
      rpcCliente.every((f) => has(sql, `revoke execute on function ${f} from public, anon`))
        ? ok('RPC del cliente: EXECUTE revocado a PUBLIC y anon')
        : fail('RPC del cliente: falta revocar EXECUTE a PUBLIC/anon');
      rpcCliente.every((f) => has(sql, `grant execute on function ${f} to authenticated`))
        ? ok('RPC del cliente: EXECUTE concedido a authenticated')
        : fail('RPC del cliente: falta el GRANT a authenticated');

      // CAMBIO DE CONTRATO (revisión del dueño, 22/09/2026): el REGISTRO del resultado del
      // correo NO puede estar en manos del navegador. Antes se concedía a `authenticated` y solo
      // comprobaba que quien llamaba fuera el propietario: con eso, un propietario podía
      // falsificar `provider_accepted` (y el identificador del proveedor) sin enviar correo.
      // Ahora solo lo ejecuta la función de servidor con la credencial de servicio.
      const RPC_REGISTRO = 'public.record_invitation_email_result(uuid, uuid, text, text, text)';
      has(sql, `revoke execute on function ${RPC_REGISTRO}`) &&
      /revoke execute on function public\.record_invitation_email_result\(uuid, uuid, text, text, text\)[\s\S]{0,120}?from public, anon, authenticated/.test(
        sql,
      )
        ? ok('registro del correo: EXECUTE revocado a PUBLIC, anon y AUTHENTICATED')
        : fail('registro del correo: sigue pudiendo ejecutarlo el cliente');
      has(sql, `grant execute on function ${RPC_REGISTRO} to service_role`)
        ? ok('registro del correo: EXECUTE solo a service_role (credencial del servidor)')
        : fail('registro del correo: falta el GRANT a service_role');
      /grant execute on function public\.record_invitation_email_result[\s\S]{0,120}?to authenticated/.test(
        sql,
      )
        ? fail('registro del correo: se concede EXECUTE a authenticated (agujero de falsificación)')
        : ok('registro del correo: sin EXECUTE para authenticated en ninguna forma');
      // La firma antigua (sin identificador de intento) debe retirarse: si quedara, el cliente
      // podría seguir usándola.
      has(
        sql,
        'drop function if exists public.record_invitation_email_result(uuid, text, text, text)',
      )
        ? ok('registro del correo: retirada la firma antigua sin identificador de intento')
        : fail('registro del correo: no se retira la firma antigua');
      // Vinculación al intento: un resultado tardío no puede sobrescribir el intento vigente.
      has(sql, 'stale_email_attempt') && /email_attempt_id is distinct from p_attempt_id/.test(sql)
        ? ok('registro del correo: vinculado al INTENTO (un intento antiguo no sobrescribe)')
        : fail('registro del correo: no comprueba el identificador del intento');
      has(sql, 'email_attempt_required')
        ? ok('registro del correo: exige identificador de intento')
        : fail('registro del correo: acepta resultados sin identificador de intento');
      // El intento lo abre `prepare_invitation_email` y viaja en su respuesta.
      /email_attempt_id = gen_random_uuid\(\)/.test(sql) && has(sql, "'attempt_id', v_attempt")
        ? ok('preparar envío: abre intento nuevo y lo devuelve (attempt_id)')
        : fail('preparar envío: no abre ni devuelve el identificador del intento');
      // La autorización del propietario y el tope de intentos siguen donde estaban.
      /email_attempts >= 5/.test(sql) && /private\.is_team_owner\(v_inv\.team_id\)/.test(sql)
        ? ok('preparar envío: sigue autorizando al propietario y aplicando el tope de intentos')
        : fail('preparar envío: se ha perdido la autorización del propietario o el tope');

      countTokens(sql, 'security definer') >= 6
        ? ok('solicitud y correo: funciones SECURITY DEFINER (el cliente no tiene DML)')
        : fail('solicitud y correo: falta declarar SECURITY DEFINER');
      countTokens(sql, "set search_path = ''") >= 6
        ? ok('solicitud y correo: search_path vacío en todas las funciones')
        : fail('solicitud y correo: alguna función sin search_path vacío');

      // El comentario debe reflejar el estado real de la revisión del catálogo.
      has(sqlBruto, 'CATÁLOGO REMOTO VERIFICADO ANTES DE APLICAR')
        ? ok('documenta la revisión del catálogo remoto previa a la aplicación')
        : fail('falta documentar la revisión del catálogo remoto');
    }
  }

  // ---- GESTIÓN de CUENTAS y PERTENENCIA (borrar cuenta, salir, traspasar) ----
  {
    // OJO con el nombre: `20260923000000` ya lo ocupa la migración del resultado de correo
    // obsoleto. Dos ficheros con la MISMA marca de versión son la misma migración para el CLI.
    const f11 = 'supabase/migrations/20260924000000_account_and_membership_management.sql';
    if (!fs.existsSync(f11)) {
      fail('falta la migración de gestión de cuentas y pertenencia');
    } else {
      const sqlBruto = fs.readFileSync(f11, 'utf8');
      const sql = sqlBruto.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
      console.log(`\nGestión de cuentas y pertenencia (${path.basename(f11)}):`);

      // Auditoría que sobrevive al borrado.
      has(sql, 'create table if not exists public.account_deletions')
        ? ok('existe el registro de bajas de cuenta')
        : fail('no se crea public.account_deletions');
      /deleted_user_id uuid not null,\s*email_normalized/.test(sql)
        ? ok('la auditoría NO tiene clave foránea al perfil (sobrevive a la cascada)')
        : fail('la auditoría referencia el perfil: se borraría con él');
      has(sql, 'alter table public.account_deletions enable row level security') &&
      has(sql, 'using (private.is_platform_admin())')
        ? ok('la auditoría solo la lee el administrador de plataforma')
        : fail('la auditoría no está restringida al administrador');
      /for\s+(insert|update|delete)\s+to\s+authenticated/i.test(sql)
        ? fail('hay una política de ESCRITURA directa sobre la auditoría')
        : ok('la auditoría no se escribe desde el cliente');
      has(sql, 'revoke all on table public.account_deletions from public, anon, authenticated') &&
      has(sql, 'grant select on table public.account_deletions to authenticated')
        ? ok('auditoría: solo SELECT a authenticated')
        : fail('los permisos de la auditoría no son mínimos');

      // Borrado de cuenta: permiso de administrador y las tres guardas.
      const guardas = [
        ['cannot_delete_self', 'no se puede borrar a sí mismo'],
        ['cannot_delete_platform_admin', 'no se puede borrar a otro administrador'],
        ['target_owns_team', 'no se puede borrar a quien posee un equipo'],
      ];
      for (const [codigo, texto] of guardas) {
        has(sql, codigo) ? ok(`borrado de cuenta: ${texto}`) : fail(`falta la guarda ${codigo}`);
      }
      const auditoriaPos = sql.indexOf('insert into public.account_deletions');
      const borradoPos = sql.indexOf('delete from auth.users');
      auditoriaPos > 0 && borradoPos > 0 && auditoriaPos < borradoPos
        ? ok('borrado de cuenta: la auditoría se escribe ANTES del borrado (misma transacción)')
        : fail('la auditoría se escribe después del borrado o no se escribe');
      has(sql, 'from public.profiles where user_id = p_user_id for update')
        ? ok('borrado de cuenta: bloquea el perfil (sin carreras)')
        : fail('borrado de cuenta: no bloquea el perfil que va a borrar');
      has(sqlBruto, 'has_table_privilege(current_user') &&
      has(sqlBruto, 'CATÁLOGO REMOTO VERIFICADO') &&
      has(sqlBruto, 'el rol `postgres` tiene DELETE')
        ? ok('documenta el catálogo remoto y el privilegio de borrado verificados')
        : fail('no documenta la comprobación del privilegio sobre auth.users');

      // Vista previa: permite explicar antes de decidir.
      has(sql, 'create or replace function public.admin_deletion_preview(p_user_id uuid)') &&
      has(sql, "'deletable'") &&
      has(sql, "'blockers'")
        ? ok('vista previa: dice qué se borraría y qué lo bloquea')
        : fail('la vista previa no informa de bloqueos');

      // Salir del equipo.
      has(sql, 'create or replace function public.leave_team(p_team_id uuid)') &&
      has(sql, 'owner_cannot_leave') &&
      has(sql, 'not_a_member')
        ? ok('salir del equipo: el propietario no puede irse y hay que ser miembro activo')
        : fail('salir del equipo: faltan las comprobaciones de rol');
      /set status = 'revoked', accepted_at = null/.test(sql)
        ? ok('salir del equipo: la membresía se marca revoked (no se borra el histórico)')
        : fail('salir del equipo: no marca la membresía como revoked');
      const leaveBody =
        sql
          .split('create or replace function public.leave_team(p_team_id uuid)')[1]
          ?.split('create or replace function public.transfer_team_ownership(')[0] ?? '';
      const leaveLock = leaveBody.indexOf('from public.teams where id = p_team_id for update');
      const leaveOwnerCheck = leaveBody.indexOf('owner_cannot_leave');
      leaveLock >= 0 && leaveOwnerCheck > leaveLock
        ? ok('salir del equipo: revalida al propietario tras bloquear el equipo')
        : fail('salir del equipo: comprueba el propietario antes del bloqueo');

      // Traspaso de propiedad.
      has(sql, 'create or replace function public.transfer_team_ownership(') &&
      has(sql, 'new_owner_must_be_active_member') &&
      has(sql, 'new_owner_not_approved') &&
      has(sql, 'new_owner_already_has_team')
        ? ok('traspaso: exige miembro activo, aprobado y sin equipo propio')
        : fail('traspaso: faltan requisitos del nuevo propietario');
      /from public.teams where id = p_team_id for update/.test(sql)
        ? ok('traspaso: bloquea el equipo (sin traspasos simultáneos)')
        : fail('traspaso: no bloquea la fila del equipo');
      const transferBody =
        sql
          .split('create or replace function public.transfer_team_ownership(')[1]
          ?.split('-- 6)')[0] ?? '';
      const transferLock = transferBody.indexOf(
        'from public.teams where id = p_team_id for update',
      );
      const transferOwnerCheck = transferBody.indexOf('private.is_team_owner(p_team_id)');
      transferLock >= 0 && transferOwnerCheck > transferLock
        ? ok('traspaso: revalida la autorización después del bloqueo')
        : fail('traspaso: valida la autorización antes del bloqueo');
      /update public\.teams set owner_user_id = p_new_owner_user_id/.test(sql) &&
      (sql.match(/update public\.team_members\s+set role = '/g) ?? []).length >= 2
        ? ok('traspaso: cambia el propietario y los DOS roles en la misma función')
        : fail('traspaso: no intercambia los dos roles');

      // Permisos de las cuatro RPC nuevas.
      const rpcGestion = [
        'public.admin_deletion_preview(uuid)',
        'public.admin_delete_account(uuid, text)',
        'public.leave_team(uuid)',
        'public.transfer_team_ownership(uuid, uuid)',
      ];
      rpcGestion.every((f) => has(sql, `revoke execute on function ${f} from public, anon`))
        ? ok('RPC de gestión: EXECUTE revocado a PUBLIC y anon')
        : fail('RPC de gestión: falta revocar EXECUTE a PUBLIC/anon');
      rpcGestion.every((f) => has(sql, `grant execute on function ${f} to authenticated`))
        ? ok('RPC de gestión: EXECUTE concedido a authenticated (autorizan dentro)')
        : fail('RPC de gestión: falta el GRANT a authenticated');
      has(sql, 'user_metadata')
        ? fail('usa user_metadata para autorizar (prohibido)')
        : ok('NO usa user_metadata');
      countTokens(sql, 'security definer') >= 4
        ? ok('gestión: funciones SECURITY DEFINER')
        : fail('gestión: falta declarar SECURITY DEFINER');
      countTokens(sql, "set search_path = ''") >= 4
        ? ok('gestión: search_path vacío en todas las funciones')
        : fail('gestión: alguna función sin search_path vacío');
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
