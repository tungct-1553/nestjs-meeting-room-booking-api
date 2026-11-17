import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const container = `booking-bootstrap-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
let started = false;
function docker(args, allowFailure = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr.trim() ?? 'Docker command failed');
  }
  return result;
}
function sql(statement, allowFailure = false) {
  return docker(
    [
      'exec',
      container,
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'meeting_room_booking',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      statement,
    ],
    allowFailure,
  );
}
function bootstrap(allowFailure = false) {
  return docker(
    [
      'exec',
      container,
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'meeting_room_booking',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      `booking_password=${password}`,
      '-v',
      `keycloak_password=${password}`,
      '-v',
      'adopt=false',
      '-f',
      '/opt/booking/bootstrap.sql',
    ],
    allowFailure,
  );
}
function expectDenied(result) {
  if (result.status === 0 || !result.stderr.includes('permission denied')) {
    throw new Error('Expected object access to be denied');
  }
}

try {
  docker([
    'run',
    '--rm',
    '-d',
    '--name',
    container,
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_DB=meeting_room_booking',
    'postgres:17-alpine',
  ]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (
      docker(
        [
          'exec',
          container,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'postgres',
          '-d',
          'meeting_room_booking',
        ],
        true,
      ).status === 0
    ) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) {
    throw new Error('Test PostgreSQL did not become ready');
  }
  docker(['exec', container, 'mkdir', '-p', '/opt/booking']);
  docker([
    'cp',
    resolve(root, 'infra/postgres/bootstrap.sql'),
    `${container}:/opt/booking/bootstrap.sql`,
  ]);
  bootstrap();
  bootstrap();
  console.log('PASS fresh and repeated bootstrap');
  let cases = 0;
  for (const [owner, schema, opposite] of [
    ['booking_user', 'public', 'keycloak_user'],
    ['keycloak_user', 'keycloak', 'booking_user'],
  ]) {
    for (const scope of ['', ` IN SCHEMA ${schema}`]) {
      for (const grantee of ['PUBLIC', opposite]) {
        for (const [kind, privilege] of [
          ['TABLES', 'SELECT'],
          ['SEQUENCES', 'USAGE'],
        ]) {
          const command = `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner}${scope}`;
          sql(`${command} GRANT ${privilege} ON ${kind} TO ${grantee}`);
          const before = sql('SELECT oid, defaclacl FROM pg_default_acl ORDER BY oid').stdout;
          try {
            const result = bootstrap(true);
            if (result.status === 0 || !result.stderr.includes('Unsafe default privileges')) {
              throw new Error(`Unsafe default grant accepted: ${owner}${scope} ${kind} ${grantee}`);
            }
            if (sql('SELECT oid, defaclacl FROM pg_default_acl ORDER BY oid').stdout !== before) {
              throw new Error('Rejected bootstrap changed default privileges');
            }
            // OID lookup demonstrates why schema ACL alone cannot protect sequences.
            if (kind === 'SEQUENCES') {
              sql(`SET ROLE ${owner}; CREATE SEQUENCE ${schema}.legacy_probe`);
              const oid = sql(`SELECT '${schema}.legacy_probe'::regclass::oid`).stdout.trim();
              sql(`SET ROLE ${opposite}; SELECT nextval(${oid}::regclass)`);
              sql(`DROP SEQUENCE ${schema}.legacy_probe`);
            }
          } finally {
            sql(`${command} REVOKE ${privilege} ON ${kind} FROM ${grantee}`);
          }
          bootstrap();
          sql(
            `SET ROLE ${owner}; CREATE SEQUENCE ${schema}.safe_probe; CREATE TABLE ${schema}.safe_table(id integer)`,
          );
          try {
            const oid = sql(`SELECT '${schema}.safe_probe'::regclass::oid`).stdout.trim();
            expectDenied(sql(`SET ROLE ${opposite}; SELECT nextval(${oid}::regclass)`, true));
            expectDenied(sql(`SET ROLE ${opposite}; SELECT * FROM ${schema}.safe_table`, true));
          } finally {
            sql(`DROP SEQUENCE ${schema}.safe_probe; DROP TABLE ${schema}.safe_table`);
          }
          cases++;
        }
      }
    }
  }
  // Defaults unrelated to either service's schema are outside this bootstrap's scope.
  sql(
    'CREATE SCHEMA unrelated; ALTER DEFAULT PRIVILEGES FOR ROLE booking_user IN SCHEMA unrelated GRANT USAGE ON SEQUENCES TO keycloak_user',
  );
  const unrelated = sql(
    "SELECT defaclacl FROM pg_default_acl WHERE defaclnamespace='unrelated'::regnamespace",
  ).stdout;
  bootstrap();
  if (
    sql("SELECT defaclacl FROM pg_default_acl WHERE defaclnamespace='unrelated'::regnamespace")
      .stdout !== unrelated
  ) {
    throw new Error('Unrelated defaults changed');
  }
  console.log(
    `PASS ${cases} legacy default-grant cases: both roles, global/schema, PUBLIC/opposite, tables/sequences`,
  );
  console.log('PASS repaired defaults deny new-object access; unrelated defaults preserved');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) {
    const cleanup = docker(['rm', '-f', '-v', container], true);
    if (cleanup.status !== 0) {
      console.error('Failed to remove temporary test container');
      process.exitCode = 1;
    }
  }
}
