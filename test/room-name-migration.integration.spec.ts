import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/options';
import { InitialSchema1794700000000 } from '../src/database/migrations/1794700000000-InitialSchema';
import { UserProfileTokenIat1794800000000 } from '../src/database/migrations/1794800000000-UserProfileTokenIat';
import { RoomNameIdentity1794900000000 } from '../src/database/migrations/1794900000000-RoomNameIdentity';

jest.setTimeout(20000);
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL is required; use an isolated test database');
}
let admin: DataSource;
let source: DataSource;
let schema: string;

beforeAll(async () => {
  admin = await new DataSource({ type: 'postgres', url, installExtensions: false }).initialize();
});

beforeEach(async () => {
  schema = `room_name_migration_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  source = await new DataSource({
    ...databaseOptions(url, 5),
    schema,
    migrations: [
      InitialSchema1794700000000,
      UserProfileTokenIat1794800000000,
      RoomNameIdentity1794900000000,
    ],
    extra: { max: 5, application_name: schema, options: `-c search_path=${schema},public` },
  }).initialize();
  await source.runMigrations();
  // This suite freezes its migration list above; explicitly verify which version is being reverted.
  const [latest] = await source.query<Array<{ name: string }>>(
    'SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1',
  );
  expect(latest.name).toBe('RoomNameIdentity1794900000000');
  await source.undoLastMigration();
  expect(await nameConstraint()).toHaveLength(1);
});

afterEach(async () => {
  if (source?.isInitialized) {
    await source.destroy();
  }
  if (schema) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
});

afterAll(async () => {
  if (admin?.isInitialized) {
    await admin.destroy();
  }
});

const nameConstraint = () =>
  source.query(`SELECT conname,contype,pg_get_constraintdef(oid) AS definition
  FROM pg_constraint WHERE conrelid='rooms'::regclass AND conname='rooms_name_key'`);
const snapshot = async () => ({
  rows: await source.query('SELECT * FROM rooms ORDER BY id'),
  bookings: await source.query('SELECT * FROM bookings ORDER BY id'),
  constraints: await source.query(`SELECT conname,contype,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid IN ('rooms'::regclass,'bookings'::regclass) ORDER BY conname`),
  indexes: await source.query(
    'SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname',
    [schema],
  ),
  history: await source.query('SELECT * FROM migrations ORDER BY timestamp'),
});

async function legacyRoom(name: string) {
  const [room] = await source.query<Array<{ id: string }>>(
    `INSERT INTO rooms(name,capacity,description,is_active,created_at,updated_at)
    VALUES($1,10,'Legacy description',false,'2020-01-01T00:00:00Z','2020-02-01T00:00:00Z') RETURNING id`,
    [name],
  );
  return room;
}

async function addBooking(roomId: string): Promise<void> {
  const [user] = await source.query<Array<{ id: string }>>(
    "INSERT INTO users(keycloak_sub) VALUES('migration-legacy-user') RETURNING id",
  );
  await source.query(
    `INSERT INTO bookings(room_id,user_id,title,start_at,end_at)
    VALUES($1,$2,'Legacy booking','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z')`,
    [roomId, user.id],
  );
}

it('backfills trim/NFC without changing capitalization, UUID, state, timestamps or booking foreign keys', async () => {
  const name = 'Phòng Họp';
  const room = await legacyRoom(`\ufeff ${name.normalize('NFD')} \u00a0`);
  await addBooking(room.id);
  const before = await snapshot();
  await source.runMigrations();
  const after = await snapshot();
  expect(after.rows).toEqual([{ ...before.rows[0], name }]);
  expect(after.bookings).toEqual(before.bookings);
  expect(await nameConstraint()).toHaveLength(0);
  const [index] = await source.query<Array<{ indexdef: string }>>(
    "SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='rooms_name_key'",
    [schema],
  );
  expect(index.indexdef).toContain('UNIQUE INDEX');
  expect(index.indexdef).toMatch(/normalize\(/i);
  expect(index.indexdef).toContain('lower(');
  expect(index.indexdef).toContain('pg_c_utf8');
  await expect(
    source.query('INSERT INTO rooms(name,capacity) VALUES($1,1)', [
      name.toUpperCase().normalize('NFD'),
    ]),
  ).rejects.toMatchObject({ driverError: { code: '23505', constraint: 'rooms_name_key' } });
});

it('accepts legacy NFD names whose normalized length is within the 200-code-point limit', async () => {
  const name = 'Ắ'.repeat(200);
  await legacyRoom(name.normalize('NFD'));
  await source.runMigrations();
  const [row] = await source.query<Array<{ name: string }>>('SELECT name FROM rooms');
  expect(row.name).toBe(name);
});

it.each([
  ['canonical', 'Phòng Họp', 'Phòng Họp'.normalize('NFD')],
  ['case', 'Phòng Họp', 'PHÒNG HỌP'],
  ['ASCII trim', 'Phòng Họp', ' Phòng Họp '],
  ['Unicode trim', 'Phòng Họp', '\ufeffPhòng Họp\u00a0'],
])(
  'rejects legacy %s collisions without mutating any rows, constraints or migration history',
  async (_kind, first, second) => {
    const room = await legacyRoom(first);
    await legacyRoom(second);
    await addBooking(room.id);
    const before = await snapshot();
    await expect(source.runMigrations()).rejects.toThrow('legacy names collide');
    expect(await snapshot()).toEqual(before);
    expect(await nameConstraint()).toHaveLength(1);
  },
);

it.each([' \t\ufeff\u00a0', 'A'.repeat(201)])(
  'rejects an invalid normalized legacy name without a partial backfill',
  async (invalid) => {
    const room = await legacyRoom('  Keep Capitalization  ');
    await legacyRoom(invalid);
    await addBooking(room.id);
    const before = await snapshot();
    await expect(source.runMigrations()).rejects.toThrow('legacy names must contain 1..200');
    expect(await snapshot()).toEqual(before);
    expect(await nameConstraint()).toHaveLength(1);
  },
);

it('restores the old constraint on down and supports a subsequent up without pretending to undo normalization', async () => {
  const name = 'Phòng Họp';
  await legacyRoom(` ${name.normalize('NFD')} `);
  await source.runMigrations();
  await source.undoLastMigration();
  expect(await nameConstraint()).toHaveLength(1);
  const [row] = await source.query<Array<{ name: string }>>('SELECT name FROM rooms');
  expect(row.name).toBe(name);
  const [variant] = await source.query<Array<{ id: string }>>(
    'INSERT INTO rooms(name,capacity) VALUES($1,1) RETURNING id',
    [name.toUpperCase()],
  );
  await source.query('DELETE FROM rooms WHERE id=$1', [variant.id]);
  await source.runMigrations();
  expect(await nameConstraint()).toHaveLength(0);
  await expect(
    source.query('INSERT INTO rooms(name,capacity) VALUES($1,1)', [name.toUpperCase()]),
  ).rejects.toMatchObject({ driverError: { code: '23505', constraint: 'rooms_name_key' } });
});

it('requires an active transaction before any preflight or schema mutation', async () => {
  const runner = source.createQueryRunner();
  const before = await snapshot();
  try {
    await expect(new RoomNameIdentity1794900000000().up(runner)).rejects.toThrow(
      'requires an active transaction',
    );
    await expect(new RoomNameIdentity1794900000000().down(runner)).rejects.toThrow(
      'requires an active transaction',
    );
  } finally {
    await runner.release();
  }
  expect(await snapshot()).toEqual(before);
});

it('takes the table lock before inspecting legacy names and observes a writer committed while waiting', async () => {
  const name = 'Phòng Họp';
  const room = await legacyRoom(name);
  const owner = source.createQueryRunner();
  await owner.connect();
  await owner.startTransaction();
  let pending: Promise<Error | null> | undefined;
  try {
    await owner.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [room.id]);
    pending = source.runMigrations().then(
      () => null,
      (error: Error) => error,
    );
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      const waiting = await source.query(
        `SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND application_name=$1
        AND wait_event_type='Lock' AND query LIKE 'LOCK TABLE rooms%'`,
        [schema],
      );
      if (waiting.length > 0) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(blocked).toBe(true);
    await owner.query('INSERT INTO rooms(name,capacity) VALUES($1,1)', [name.toUpperCase()]);
    await owner.commitTransaction();
    const failure = await pending;
    expect(failure?.message).toContain('legacy names collide');
    const names = await source.query<Array<{ name: string }>>('SELECT name FROM rooms');
    expect(names.map((row) => row.name).sort()).toEqual([name, name.toUpperCase()].sort());
    expect(await nameConstraint()).toHaveLength(1);
  } finally {
    if (owner.isTransactionActive) {
      await owner.rollbackTransaction();
    }
    await owner.release();
    if (pending) {
      await pending;
    }
  }
});
