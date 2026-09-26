// PostgreSQL LOCAL aislado; nunca recibe URLs, claves ni nombres de producción.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const container = 'entrenolab-coownership-test';
const team = '33000000-0000-4000-8000-000000000001';
const uid = (n) => `32000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
      { windowsHide: true },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
    child.stdin.end(query);
  });
}
function actor(n, command) {
  return sql(`begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${uid(n)}',true);
    ${command}; commit;`);
}
const setup = await sql(`begin;
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
    select ('32000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      'concurrency-'||n||'@test.local',now(),'{}' from generate_series(1,6) n;
  update public.profiles set status='approved' where user_id in (${[1, 2, 3, 4, 5, 6].map((n) => `'${uid(n)}'`).join(',')});
  insert into public.teams(id,owner_user_id,name) values('${team}','${uid(1)}','Concurrency fixture');
  insert into public.team_members(team_id,user_id,role,status)
    select '${team}',('32000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      case when n=2 then 'owner' else 'editor' end,'active' from generate_series(2,6) n;
  commit;`);
assert.equal(setup.code, 0, setup.output);
try {
  const seats = await Promise.all([
    actor(1, `select public.invite_team_member('${team}','race-a@test.local')`),
    actor(2, `select public.invite_team_member('${team}','race-b@test.local')`),
  ]);
  assert.equal(seats.filter((r) => r.code === 0).length, 1, JSON.stringify(seats));
  assert.ok(seats.some((r) => r.output.includes('collaborator_limit_exceeded')));
  const leaving = await Promise.all([
    actor(1, `select public.leave_team('${team}')`),
    actor(2, `select public.leave_team('${team}')`),
  ]);
  assert.equal(leaving.filter((r) => r.code === 0).length, 1, JSON.stringify(leaving));
  assert.ok(leaving.some((r) => r.output.includes('last_team_owner')));
  const result = await sql(
    `select count(*) from public.team_members where team_id='${team}' and role='owner' and status='active';`,
  );
  assert.equal(result.output.trim(), '1');
  console.log(
    'PASS: dos conexiones compiten por la última plaza y por salir; queda exactamente un propietario.',
  );
} finally {
  const cleanup = await sql(`begin; delete from public.teams where id='${team}';
    delete from auth.users where id in (${[1, 2, 3, 4, 5, 6].map((n) => `'${uid(n)}'`).join(',')}); commit;`);
  assert.equal(cleanup.code, 0, cleanup.output);
}
