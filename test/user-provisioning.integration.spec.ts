import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { databaseOptions } from '../src/database/options';
import { TypeormUserRepository } from '../src/users/infrastructure/typeorm-user.repository';
import { UsersService } from '../src/users/application/users.service';
import { BookingsService } from '../src/bookings/application/bookings.service';
import { TypeormBookingUnitOfWork } from '../src/bookings/infrastructure/typeorm-booking-unit-of-work';
import { TypeormBookingReadRepository } from '../src/bookings/infrastructure/typeorm-booking-read.repository';
import { RoomsTransactionFactory } from '../src/rooms/infrastructure/public/rooms-transaction.factory';
import { UserNotProvisionedError } from '../src/users/application/errors/user.errors';
import { createIdentityFixture } from './helpers/identity-fixture';

jest.setTimeout(20000);
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL is required; use an isolated test database');
}
const schema = `provision_test_${randomUUID().replaceAll('-', '')}`;
let admin: DataSource;
let source: DataSource;
let app: INestApplication;
let fixture: Awaited<ReturnType<typeof createIdentityFixture>>;
let users: TypeormUserRepository;
const input = {
  sub: 'subject',
  email: 'initial@example.test',
  displayName: 'Initial',
  issuedAt: 100.5,
};
const snapshot = () =>
  source.query(
    'SELECT id, email, display_name, profile_token_iat, updated_at, xmin::text AS version FROM users WHERE keycloak_sub=$1',
    [input.sub],
  );
const sync = (token: string, body?: object) => {
  const call = request(app.getHttpServer())
    .post('/api/v1/client/users/sync')
    .set('Authorization', `Bearer ${token}`);
  return body === undefined ? call : call.send(body);
};
const me = (token: string, zone = 'client') =>
  request(app.getHttpServer())
    .get(`/api/v1/${zone}/users/me`)
    .set('Authorization', `Bearer ${token}`);
beforeAll(async () => {
  admin = await new DataSource({ type: 'postgres', url, installExtensions: false }).initialize();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  source = await new DataSource({
    ...databaseOptions(url!, 10),
    schema,
    extra: { max: 10, options: `-c search_path=${schema},public` },
  }).initialize();
  await source.runMigrations();
  users = new TypeormUserRepository(source);
  fixture = await createIdentityFixture();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(ConfigService)
    .useValue(fixture.config)
    .compile();
  app = module.createNestApplication({ logger: false, bodyParser: false });
  configureApp(app);
  await app.init();
});
beforeEach(async () => {
  await source.query('TRUNCATE bookings, rooms, users');
});
afterAll(async () => {
  if (app) {
    await app.close();
  }
  if (fixture) {
    await fixture.close();
  }
  if (source?.isInitialized) {
    await source.destroy();
  }
  if (admin?.isInitialized) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.destroy();
  }
});
it('does not provision identities through either GET me or booking', async () => {
  const token = fixture.token({ resource_access: { 'meeting-room-api': { roles: ['admin'] } } });
  for (const zone of ['client', 'admin']) {
    const response = await me(token, zone).expect(409);
    expect(response.body.error.code).toBe('USER_NOT_PROVISIONED');
  }
  const service = new BookingsService(
    new UsersService(users, users),
    new TypeormBookingUnitOfWork(source, new RoomsTransactionFactory()),
    new TypeormBookingReadRepository(source),
  );
  await expect(
    service.create({
      actorSub: input.sub,
      roomId: randomUUID(),
      title: 'No profile',
      startAt: new Date('2099-01-01T10:00:00Z'),
      endAt: new Date('2099-01-01T11:00:00Z'),
    }),
  ).rejects.toBeInstanceOf(UserNotProvisionedError);
  expect(await source.query('SELECT id FROM users')).toHaveLength(0);
  expect(await source.query('SELECT id FROM bookings')).toHaveLength(0);
});
it('requires issued-at only for sync and rejects spoofed identity fields before creating users', async () => {
  const token = fixture.token({}, { noTimestamp: true });
  await sync(token).expect(401);
  await me(token).expect(409);
  for (const body of [{ sub: 'attacker' }, { email: 'attacker' }, { roles: ['admin'] }, []]) {
    await sync(fixture.token(), body).expect(400);
  }
  await sync(fixture.token({ resource_access: {} })).expect(403);
  expect(await source.query('SELECT id FROM users')).toHaveLength(0);
});
it('returns one UUID under concurrent first syncs and only reads on later GETs', async () => {
  const token = fixture.token({
    sub: input.sub,
    iat: 100.5,
    resource_access: { 'meeting-room-api': { roles: ['admin'] } },
  });
  const responses = await Promise.all(Array.from({ length: 8 }, () => sync(token).expect(200)));
  expect(new Set(responses.map((response) => response.body.data.id)).size).toBe(1);
  expect(await source.query('SELECT id FROM users')).toHaveLength(1);
  const before = await snapshot();
  await me(fixture.token({ sub: input.sub, name: 'Do not apply', iat: 300 }), 'client').expect(200);
  await me(token, 'admin').expect(200);
  await sync(token, {}).expect(200);
  expect(await snapshot()).toEqual(before);
});
it('keeps the newest fractional watermark under racing and repeated stale tokens', async () => {
  const first = await users.upsertIfNewer(input);
  await Promise.all(
    [102.5, 100.5, 101.5, 99.5, 103.5].map((issuedAt) =>
      users.upsertIfNewer({ ...input, issuedAt, displayName: `Version ${issuedAt}` }),
    ),
  );
  const newest = await snapshot();
  expect(newest[0]).toMatchObject({
    id: first.id,
    display_name: 'Version 103.5',
    profile_token_iat: 103.5,
  });
  const stale = await users.upsertIfNewer({
    ...input,
    issuedAt: 103.5,
    displayName: 'Do not overwrite',
  });
  expect(stale.displayName).toBe('Version 103.5');
  await users.upsertIfNewer({ ...input, issuedAt: 1, displayName: 'Old' });
  expect(await snapshot()).toEqual(newest);
});
it('applies a waiting stale request after a newer sync without overwriting the snapshot', async () => {
  await users.upsertIfNewer(input);
  const owner = source.createQueryRunner();
  await owner.connect();
  await owner.startTransaction();
  let pending: Promise<unknown> | undefined;
  try {
    await owner.query(
      'UPDATE users SET profile_token_iat=200, display_name=$1 WHERE keycloak_sub=$2',
      ['Newest', input.sub],
    );
    pending = users.upsertIfNewer({ ...input, issuedAt: 150, displayName: 'Stale' });
    // Confirm the request has reached the row lock before releasing the newer transaction.
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      const rows = await source.query(
        "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO users%'",
      );
      if (rows.length) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(blocked).toBe(true);
    await owner.commitTransaction();
    expect(await pending).toMatchObject({ displayName: 'Newest' });
    expect((await snapshot())[0].profile_token_iat).toBe(200);
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
it('rolls back a failed sync, exposes only availability as 503, then allows retry', async () => {
  const token = fixture.token({ sub: input.sub });
  await source.query(`CREATE FUNCTION fail_profile_sync() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'private SQL detail' USING ERRCODE = '08006'; END $$`);
  await source.query(
    'CREATE TRIGGER fail_profile_sync BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION fail_profile_sync()',
  );
  try {
    const failed = await sync(token).expect(503);
    expect(failed.body.error).toEqual({
      code: 'PROFILE_SYNC_UNAVAILABLE',
      message: 'User profile synchronization is unavailable',
      details: [],
    });
    expect(await source.query('SELECT id FROM users')).toHaveLength(0);
    await source.query(`CREATE OR REPLACE FUNCTION fail_profile_sync() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'private SQL detail' USING ERRCODE = 'XX000'; END $$`);
    const defect = await sync(token).expect(500);
    expect(defect.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(defect.body)).not.toContain('private SQL detail');
    expect(await source.query('SELECT id FROM users')).toHaveLength(0);
  } finally {
    await source.query('DROP TRIGGER fail_profile_sync ON users');
    await source.query('DROP FUNCTION fail_profile_sync()');
  }
  await sync(token).expect(200);
  expect(await source.query('SELECT id FROM users')).toHaveLength(1);
});
it('adds the nullable watermark without changing legacy user UUIDs or booking foreign keys', async () => {
  // Revert through newer migrations as well: the target is the schema before the watermark, not just HEAD - 1.
  const applied = await source.query<Array<{ timestamp: string }>>(
    'SELECT timestamp FROM migrations ORDER BY timestamp DESC',
  );
  for (const migration of applied) {
    if (Number(migration.timestamp) >= 1794800000000) {
      await source.undoLastMigration();
    }
  }
  expect(
    await source.query(
      `SELECT column_name FROM information_schema.columns
    WHERE table_schema=$1 AND table_name='users' AND column_name='profile_token_iat'`,
      [schema],
    ),
  ).toHaveLength(0);
  const [legacy] = await source.query(
    'INSERT INTO users (keycloak_sub,email) VALUES ($1,$2) RETURNING id',
    [input.sub, 'legacy@example.test'],
  );
  const [room] = await source.query(
    "INSERT INTO rooms(name,capacity) VALUES ('Legacy',2) RETURNING id",
  );
  const [booking] = await source.query(
    "INSERT INTO bookings(user_id,room_id,title,start_at,end_at) VALUES ($1,$2,'Legacy','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z') RETURNING id",
    [legacy.id, room.id],
  );
  await source.runMigrations();
  expect((await snapshot())[0]).toMatchObject({ id: legacy.id, profile_token_iat: null });
  expect(await users.upsertIfNewer(input)).toMatchObject({ id: legacy.id, email: input.email });
  expect(await source.query('SELECT id,user_id FROM bookings')).toEqual([
    { id: booking.id, user_id: legacy.id },
  ]);
});
