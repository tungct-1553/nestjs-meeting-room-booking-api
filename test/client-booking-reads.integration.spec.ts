import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { databaseOptions } from '../src/database/options';
import { BookingsService } from '../src/bookings/application/bookings.service';
import type { BookingStatus } from '../src/bookings/application/models/booking';
import { TypeormBookingReadRepository } from '../src/bookings/infrastructure/typeorm-booking-read.repository';
import { createIdentityFixture } from './helpers/identity-fixture';

jest.setTimeout(20000);
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL is required; use an isolated test database');
}
const schema = `booking_read_test_${randomUUID().replaceAll('-', '')}`;
let adminSource: DataSource;
let source: DataSource;
let app: INestApplication;
let fixture: Awaited<ReturnType<typeof createIdentityFixture>>;
let service: BookingsService;
let ownerToken: string;
let otherToken: string;
let adminToken: string;
let ownerId: string;
let otherId: string;
let adminId: string;
let roomId: string;

beforeAll(async () => {
  adminSource = await new DataSource({
    type: 'postgres',
    url,
    installExtensions: false,
  }).initialize();
  await adminSource.query(`CREATE SCHEMA "${schema}"`);
  source = await new DataSource({
    ...databaseOptions(url, 10),
    schema,
    extra: {
      max: 10,
      application_name: schema,
      options: `-c search_path=${schema},public -c statement_timeout=5000`,
    },
  }).initialize();
  await source.runMigrations();
  fixture = await createIdentityFixture();
  ownerToken = fixture.token({ sub: 'booking-reader-owner' });
  otherToken = fixture.token({ sub: 'booking-reader-other' });
  adminToken = fixture.token({
    sub: 'booking-reader-admin',
    resource_access: { 'meeting-room-api': { roles: ['admin'] } },
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(ConfigService)
    .useValue(fixture.config)
    .compile();
  app = module.createNestApplication({ logger: false, bodyParser: false });
  configureApp(app);
  await app.init();
  service = module.get(BookingsService);
});

beforeEach(async () => {
  await source.query('TRUNCATE bookings, rooms, users');
  const users = await source.query<Array<{ id: string }>>(
    `INSERT INTO users (keycloak_sub) VALUES
      ('booking-reader-owner'), ('booking-reader-other'), ('booking-reader-admin') RETURNING id`,
  );
  [ownerId, otherId, adminId] = users.map((user) => user.id);
  const [room] = await source.query<Array<{ id: string }>>(
    "INSERT INTO rooms (name,capacity) VALUES ('Read test',10) RETURNING id",
  );
  roomId = room.id;
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
  if (adminSource?.isInitialized) {
    await adminSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminSource.destroy();
  }
});

async function insertBooking(
  userId: string = ownerId,
  status: BookingStatus = 'confirmed',
  createdAt: string = '2098-12-01T10:00:00Z',
): Promise<string> {
  // Distinct fixture times avoid overlap; ordering tests control created_at independently.
  const [{ count }] = await source.query<Array<{ count: string }>>('SELECT count(*) FROM bookings');
  const startAt = new Date(Date.UTC(2099, 0, 1, Number(count) * 2));
  const endAt = new Date(startAt.getTime() + 3600000);
  const [booking] = await source.query<Array<{ id: string }>>(
    `INSERT INTO bookings (room_id,user_id,title,start_at,end_at,status,created_at)
      VALUES ($1,$2,'Read test',$3,$4,$5,$6) RETURNING id`,
    [roomId, userId, startAt, endAt, status, createdAt],
  );
  return booking.id;
}

const get = (path: string, token: string = ownerToken) =>
  request(app.getHttpServer())
    .get(`/api/v1/client/bookings${path}`)
    .set('Authorization', `Bearer ${token}`);

it('filters owner/status before total and offset, with created_at DESC/id DESC tie ordering', async () => {
  const first = await insertBooking();
  const second = await insertBooking();
  const older = await insertBooking(ownerId, 'confirmed', '2098-11-01T10:00:00Z');
  const cancelled = await insertBooking(ownerId, 'cancelled', '2098-12-02T10:00:00Z');
  await insertBooking(otherId, 'confirmed', '2098-12-03T10:00:00Z');
  await insertBooking(adminId, 'confirmed', '2098-12-04T10:00:00Z');
  const ties = [first, second].sort().reverse();
  const all = await get('').expect(200);
  expect(all.body.data.map((booking: { id: string }) => booking.id)).toEqual([
    cancelled,
    ...ties,
    older,
  ]);
  expect(all.body.meta).toEqual({ page: 1, limit: 20, total: 4 });
  for (const [index, id] of [...ties, older].entries()) {
    const page = await get(`?status=confirmed&limit=1&page=${index + 1}`).expect(200);
    expect(page.body.data.map((booking: { id: string }) => booking.id)).toEqual([id]);
    expect(page.body.meta).toEqual({ page: index + 1, limit: 1, total: 3 });
  }
  expect((await get('?status=confirmed&limit=1&page=6').expect(200)).body).toEqual({
    data: [],
    meta: { page: 6, limit: 1, total: 3 },
  });
  const filtered = await get('?status=cancelled').expect(200);
  expect(filtered.body.data.map((booking: { id: string }) => booking.id)).toEqual([cancelled]);
  expect(filtered.body.meta.total).toBe(1);
});

it('returns an empty filtered result without leaking another user count', async () => {
  await insertBooking(otherId);
  await insertBooking(adminId, 'cancelled');
  expect((await get('?status=confirmed').expect(200)).body).toEqual({
    data: [],
    meta: { page: 1, limit: 20, total: 0 },
  });
});

it('reads confirmed/cancelled history after room deactivation without mutating bookings', async () => {
  const confirmed = await insertBooking();
  const cancelled = await insertBooking(ownerId, 'cancelled');
  await source.query('UPDATE rooms SET is_active=false WHERE id=$1', [roomId]);
  const before = await source.query(
    'SELECT id,status,xmin::text AS version FROM bookings ORDER BY id',
  );
  for (const [id, status] of [
    [confirmed, 'confirmed'],
    [cancelled, 'cancelled'],
  ]) {
    const response = await get(`/${id}`).expect(200);
    expect(response.body.data).toMatchObject({ id, roomId, userId: ownerId, status });
    expect(Object.keys(response.body.data).sort()).toEqual([
      'createdAt',
      'endAt',
      'id',
      'roomId',
      'startAt',
      'status',
      'title',
      'userId',
    ]);
    expect(response.body.data.startAt).toMatch(/\.000Z$/);
  }
  expect((await get('').expect(200)).body.meta.total).toBe(2);
  expect(
    await source.query('SELECT id,status,xmin::text AS version FROM bookings ORDER BY id'),
  ).toEqual(before);
});

it('enforces detail ownership for Employee and Admin regardless of booking status', async () => {
  for (const status of ['confirmed', 'cancelled'] as const) {
    const id = await insertBooking(ownerId, status);
    for (const token of [otherToken, adminToken]) {
      expect((await get(`/${id}`, token).expect(403)).body.error.code).toBe(
        'BOOKING_OWNER_REQUIRED',
      );
    }
  }
  expect((await get(`/${randomUUID()}`).expect(404)).body.error.code).toBe('BOOKING_NOT_FOUND');
  const adminBooking = await insertBooking(adminId);
  expect((await get(`/${adminBooking}`, adminToken).expect(200)).body.data.id).toBe(adminBooking);
  const ownAdminList = await get('', adminToken).expect(200);
  expect(ownAdminList.body.data.map((booking: { id: string }) => booking.id)).toEqual([
    adminBooking,
  ]);
  expect(ownAdminList.body.meta.total).toBe(1);
});

it('returns 409 for unprovisioned readers without creating a profile', async () => {
  const token = fixture.token({ sub: 'unprovisioned-reader' });
  for (const path of ['', `/${randomUUID()}`]) {
    expect((await get(path, token).expect(409)).body.error.code).toBe('USER_NOT_PROVISIONED');
  }
  expect(
    await source.query("SELECT id FROM users WHERE keycloak_sub='unprovisioned-reader'"),
  ).toEqual([]);
});

it('reflects committed cancellation in subsequent filtered lists and detail', async () => {
  const id = await insertBooking();
  await request(app.getHttpServer())
    .delete(`/api/v1/client/bookings/${id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  expect((await get('?status=confirmed').expect(200)).body.meta.total).toBe(0);
  const cancelled = await get('?status=cancelled').expect(200);
  expect(cancelled.body.meta.total).toBe(1);
  expect(cancelled.body.data[0]).toMatchObject({ id, status: 'cancelled' });
  expect((await get(`/${id}`).expect(200)).body.data.status).toBe('cancelled');
});

it('keeps rows and total in one snapshot when cancellation commits between their SELECTs', async () => {
  const ids: string[] = [];
  for (let index = 0; index < 3; index++) {
    ids.push(await insertBooking());
  }
  const targetId = ids.sort().reverse()[0];
  const runner = source.createQueryRunner();
  const originalQuery = runner.query.bind(runner);
  const createRunner = jest.spyOn(source, 'createQueryRunner').mockReturnValueOnce(runner);
  let cancellationCommitted = false;
  const query = jest
    .spyOn(runner, 'query')
    .mockImplementation(async (statement: string, parameters?: unknown[], structured?: boolean) => {
      const result = structured
        ? await originalQuery(statement, parameters, true)
        : await originalQuery(statement, parameters);
      if (
        !cancellationCommitted &&
        statement.startsWith('SELECT ') &&
        statement.includes('"booking"."id"') &&
        !statement.includes('COUNT(')
      ) {
        cancellationCommitted = true;
        await service.cancel({ actorSub: 'booking-reader-owner', bookingId: targetId });
      }
      return result;
    });
  try {
    const result = await new TypeormBookingReadRepository(source).listByUser({
      userId: ownerId,
      page: 1,
      limit: 1,
      status: 'confirmed',
    });
    expect(cancellationCommitted).toBe(true);
    expect(result.items).toEqual([expect.objectContaining({ id: targetId, status: 'confirmed' })]);
    expect(result.total).toBe(3);
    expect(
      await source.query("SELECT count(*)::int AS total FROM bookings WHERE status='confirmed'"),
    ).toEqual([{ total: 2 }]);
  } finally {
    query.mockRestore();
    createRunner.mockRestore();
    if (!runner.isReleased) {
      await runner.release();
    }
  }
});

it('does not acquire row locks for reads while a booking write holds its lock', async () => {
  const id = await insertBooking();
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE', [id]);
    expect((await get(`/${id}`).expect(200)).body.data.id).toBe(id);
    expect((await get('').expect(200)).body.data[0].id).toBe(id);
  } finally {
    if (runner.isTransactionActive) {
      await runner.rollbackTransaction();
    }
    await runner.release();
  }
});
