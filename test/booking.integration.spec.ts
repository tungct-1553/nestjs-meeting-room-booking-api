import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { createIdentityFixture } from './helpers/identity-fixture';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/options';
import { TypeormBookingUnitOfWork } from '../src/bookings/infrastructure/typeorm-booking-unit-of-work';
import { RoomsTransactionFactory } from '../src/rooms/infrastructure/public/rooms-transaction.factory';
import { TypeormRoomRepository } from '../src/rooms/infrastructure/typeorm-room.repository';
import { TypeormUserRepository } from '../src/users/infrastructure/typeorm-user.repository';
import { UsersService } from '../src/users/users.service';
import { BookingsService } from '../src/bookings/bookings.service';
import { BookingTimeConflictError, RoomUnavailableError } from '../src/bookings/errors/booking.errors';
import type { BookingTransaction } from '../src/bookings/ports/booking-unit-of-work.port';

jest.setTimeout(20000);
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required; use an isolated test database');
const schema = `booking_test_${randomUUID().replaceAll('-', '')}`;
let admin: DataSource;
let source: DataSource;
let userId: string;
let roomId: string;
let uow: TypeormBookingUnitOfWork;
let service: BookingsService;
const principal = { sub: 'integration-sub', email: null, displayName: null, roles: ['employee' as const] };
const dates = { startAt: new Date('2099-01-01T10:00:00Z'), endAt: new Date('2099-01-01T11:00:00Z') };
const dto = () => ({ roomId, title: 'Meeting', startAt: dates.startAt.toISOString(), endAt: dates.endAt.toISOString() });
const input = () => ({ roomId, userId, title: 'Meeting', ...dates });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function waitForBlockedTransaction(): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await source.query(`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND application_name = $1 AND query LIKE '%FOR UPDATE%'`, [schema]);
    if (rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected a transaction waiting for the room row lock');
}
beforeAll(async () => {
  admin = await new DataSource({ type: 'postgres', url: testUrl, installExtensions: false }).initialize();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  source = new DataSource({ ...databaseOptions(testUrl!, 10), schema, extra: { max: 10, application_name: schema, options: `-c search_path=${schema},public` } });
  await source.initialize();
  await source.runMigrations();
  uow = new TypeormBookingUnitOfWork(source, new RoomsTransactionFactory());
  service = new BookingsService(new UsersService(new TypeormUserRepository(source)), uow);
});
beforeEach(async () => {
  await source.query('TRUNCATE bookings, rooms, users');
  const user = await new TypeormUserRepository(source).getOrSync(principal);
  userId = user.id;
  const rows = await source.query("INSERT INTO rooms(name, capacity) VALUES ('Review room', 10) RETURNING id");
  roomId = rows[0].id;
});
afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  if (admin?.isInitialized) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.destroy();
  }
});
it('keeps a stable user ID while refreshing profile snapshots', async () => {
  const updated = await new TypeormUserRepository(source).getOrSync({ ...principal, email: 'new@example.test', displayName: 'New name' });
  expect(updated).toEqual({ id: userId, email: 'new@example.test', displayName: 'New name' });
});
it('serializes same-room booking requests and maps an overlapping insert to conflict', async () => {
  const results = await Promise.allSettled([service.create(principal, dto()), service.create(principal, dto())]);
  expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((item) => item.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(BookingTimeConflictError);
});
it('allows adjacent slots and releases cancelled slots', async () => {
  await service.create(principal, dto());
  await service.create(principal, { ...dto(), startAt: '2099-01-01T11:00:00Z', endAt: '2099-01-01T12:00:00Z' });
  await source.query("UPDATE bookings SET status = 'cancelled'");
  await service.create(principal, dto());
  expect((await source.query("SELECT id FROM bookings WHERE status='confirmed'")).length).toBe(1);
});
it('rolls back writes on callback failure and rejects escaped transaction ports', async () => {
  let escaped!: BookingTransaction;
  await expect(uow.run(async (tx) => {
    escaped = tx;
    await tx.rooms.lockForBooking(roomId);
    await tx.bookings.insert(input());
    throw new Error('rollback requested');
  })).rejects.toThrow('rollback requested');
  expect(await source.query('SELECT id FROM bookings')).toHaveLength(0);
  await expect(escaped.rooms.lockForBooking(roomId)).rejects.toThrow('active transaction');
  await expect(escaped.bookings.insert(input())).rejects.toThrow('active transaction');
  await service.create(principal, dto());
});
it('rejects a booking after deactivate commits first while it waits for the room lock', async () => {
  const owner = source.createQueryRunner();
  await owner.connect(); await owner.startTransaction();
  let waiting: Promise<unknown> | undefined;
  try {
    await owner.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
    await owner.query('UPDATE rooms SET is_active=false WHERE id=$1', [roomId]);
    waiting = service.create(principal, dto()).then(() => 'unexpected success', (error: unknown) => error);
    await waitForBlockedTransaction();
    await owner.commitTransaction();
    expect(await waiting).toBeInstanceOf(RoomUnavailableError);
    expect(await source.query('SELECT id FROM bookings')).toHaveLength(0);
  } finally {
    if (owner.isTransactionActive) await owner.rollbackTransaction();
    await owner.release();
    if (waiting) await waiting;
  }
});
it('preserves an existing booking when deactivate waits for its transaction', async () => {
  const locked = deferred(); const release = deferred();
  const booking = uow.run(async (tx) => {
    await tx.rooms.lockForBooking(roomId);
    const row = await tx.bookings.insert(input());
    locked.resolve(); await release.promise;
    return row;
  });
  await locked.promise;
  const deactivate = new TypeormRoomRepository(source).deactivate(roomId);
  try { await waitForBlockedTransaction(); }
  finally { release.resolve(); }
  await booking; await deactivate;
  expect(await source.query('SELECT id FROM bookings')).toHaveLength(1);
  expect((await source.query('SELECT is_active FROM rooms'))[0].is_active).toBe(false);
});
it('enforces the exclusion constraint even when callers bypass the room-lock service', async () => {
  const first = source.createQueryRunner(); const second = source.createQueryRunner();
  await first.connect(); await second.connect();
  await first.startTransaction(); await second.startTransaction();
  const sql = "INSERT INTO bookings(room_id,user_id,title,start_at,end_at) VALUES ($1,$2,'Direct',$3,$4)";
  const values = [roomId, userId, dates.startAt, dates.endAt];
  try {
    await first.query(sql, values);
    const blocked = second.query(sql, values).then(() => null, (error: unknown) => error);
    await first.commitTransaction();
    const error = await blocked as { driverError: { code: string; constraint: string } };
    expect(error.driverError).toMatchObject({ code: '23P01', constraint: 'bookings_no_overlap' });
  } finally {
    if (first.isTransactionActive) await first.rollbackTransaction();
    if (second.isTransactionActive) await second.rollbackTransaction();
    await first.release(); await second.release();
  }
});

it('syncs both authenticated me controllers concurrently into the same PostgreSQL user', async () => {
  const fixture = await createIdentityFixture();
  let app: import('@nestjs/common').INestApplication | undefined;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource).useValue(source)
      .overrideProvider(ConfigService).useValue(fixture.config).compile();
    app = module.createNestApplication({ logger: false }); configureApp(app); await app.init();
    const token = fixture.token({ sub: 'concurrent-profile', resource_access: { 'meeting-room-api': { roles: ['admin'] } } });
    const responses = await Promise.all(['client', 'admin'].map(zone => request(app!.getHttpServer()).get(`/api/v1/${zone}/users/me`).set('Authorization', `Bearer ${token}`).expect(200)));
    expect(responses[0].body).toEqual(responses[1].body);
    const id = responses[0].body.data.id;
    expect(responses[0].body.data).toEqual({ id, email: 'verified@example.test', displayName: 'Verified User' });
    expect(await source.query('SELECT id FROM users WHERE keycloak_sub=$1', ['concurrent-profile'])).toEqual([{ id }]);
    const changed = fixture.token({ sub: 'concurrent-profile', name: undefined, email: undefined, resource_access: { 'meeting-room-api': { roles: ['employee'] } } });
    const response = await request(app.getHttpServer()).get('/api/v1/client/users/me').set('Authorization', `Bearer ${changed}`).expect(200);
    expect(response.body.data).toEqual({ id, email: null, displayName: null });
  } finally {
    // App shutdown owns this DataSource; restore it for suite teardown if needed.
    if (app) await app.close();
    await fixture.close();
  }
});
