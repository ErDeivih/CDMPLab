import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Base efímera sin puertos publicados. Nunca usa credenciales ni datos remotos.
const container = 'entrenolab-coownership-test';
function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0)
    throw new Error(`${binary} failed: ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}
function sql(file) {
  command(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    {
      input: fs.readFileSync(file, 'utf8'),
    },
  );
  console.log(`PASS ${file}`);
}
if (
  spawnSync('docker', ['inspect', container], { windowsHide: true, stdio: 'ignore' }).status === 0
) {
  throw new Error(`Ya existe ${container}; no se modifica ni se elimina. Usa otro entorno limpio.`);
}
command('docker', [
  'run',
  '--rm',
  '-d',
  '--name',
  container,
  '-e',
  'POSTGRES_HOST_AUTH_METHOD=trust',
  'postgres:16-alpine',
]);
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    ready =
      spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], {
        windowsHide: true,
        stdio: 'ignore',
      }).status === 0;
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('PostgreSQL no arrancó a tiempo');
  sql('supabase/tests/local-auth-bootstrap.sql');
  for (const file of fs
    .readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    sql(`supabase/migrations/${file}`);
  }
  sql('supabase/tests/entrenolab_rls.sql');
  sql('supabase/tests/coownership.sql');
  console.log(command(process.execPath, ['scripts/test-coownership-concurrency.mjs']));
} finally {
  command('docker', ['stop', container]);
}
