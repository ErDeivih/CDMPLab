import pgQuery from 'libpg-query';
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
const files = target
  ? [target]
  : fs
      .readdirSync('supabase/migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => path.join('supabase/migrations', name));

try {
  let total = 0;
  for (const file of files) {
    const res = await pgQuery.parse(fs.readFileSync(file, 'utf8'));
    const count = (res.stmts ?? []).length;
    total += count;
    console.log(`OK: ${file} (${count} statements)`);
  }
  console.log(`OK: parsed ${files.length} migration files, ${total} top-level statements.`);
  process.exit(0);
} catch (e) {
  console.error('PARSE ERROR:', e.message || e);
  process.exit(1);
}
