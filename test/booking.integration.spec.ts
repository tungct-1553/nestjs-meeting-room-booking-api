import { TypeormRoomReadRepository } from '../src/rooms/infrastructure/typeorm-room-read.repository';
import type { RoomsTransaction } from '../src/rooms/application/ports/rooms-unit-of-work.port';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/options';
import { TypeormBookingUnitOfWork } from '../src/bookings/infrastructure/typeorm-booking-unit-of-work';
import { RoomsTransactionFactory } from '../src/rooms/infrastructure/public/rooms-transaction.factory';
import { RoomsService } from '../src/rooms/application/rooms.service';
import { TypeormRoomCreationRepository } from '../src/rooms/infrastructure/typeorm-room-creation.repository';
import { TypeormRoomsUnitOfWork } from '../src/rooms/infrastructure/typeorm-rooms-unit-of-work';
import { TypeormUserRepository } from '../src/users/infrastructure/typeorm-user.repository';
import { UsersService } from '../src/users/application/users.service';
import { BookingsService } from '../src/bookings/application/bookings.service';
import {
  BookingTimeConflictError,
  RoomUnavailableError,
} from '../src/bookings/application/errors/booking.errors';
import type { BookingTransaction } from '../src/bookings/application/ports/booking-unit-of-work.port';

jest.setTimeout(20000);
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error('TEST_DATABASE_URL is required; use an isolated test database');
}
const schema = `booking_test_${randomUUID().replaceAll('-', '')}`;
let admin: DataSource;
let source: DataSource;
let userId: string;
let roomId: string;
let uow: TypeormBookingUnitOfWork;
let service: BookingsService;
const principal = {
  sub: 'integration-sub',
  email: null,
  displayName: null,
  roles: ['employee' as const],
  issuedAt: 100,
};
const dates = {
  startAt: new Date('2099-01-01T10:00:00Z'),
  endAt: new Date('2099-01-01T11:00:00Z'),
};
const createInput = () => ({ actorSub: principal.sub, roomId, title: 'Meeting', ...dates });
const input = () => ({ roomId, userId, title: 'Meeting', ...dates, status: 'confirmed' as const });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waitForBlockedTransaction(): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await source.query(
      `SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND application_name = $1 AND query LIKE '%FOR UPDATE%'`,
      [schema],
    );
    if (rows.length) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const activity = await source.query(
    'SELECT pid, state, wait_event_type, wait_event, application_name, length(query) AS query_length, query, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1',
    [schema],
  );
  const connections = await source.query(
    'SELECT pid, state, wait_event_type, wait_event, application_name, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database()',
  );
  throw new Error(
    `Expected a transaction waiting for the room row lock: ${JSON.stringify({ activity, connections })}`,
  );
}
beforeAll(async () => {
  admin = await new DataSource({
    type: 'postgres',
    url: testUrl,
    installExtensions: false,
  }).initialize();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  source = new DataSource({
    ...databaseOptions(testUrl!, 10),
    schema,
    extra: { max: 10, application_name: schema, options: `-c search_path=${schema},public` },
  });
  await source.initialize();
  await source.runMigrations();
  uow = new TypeormBookingUnitOfWork(source, new RoomsTransactionFactory());
  service = new BookingsService(
    new UsersService(new TypeormUserRepository(source), new TypeormUserRepository(source)),
    uow,
  );
});
beforeEach(async () => {
  await source.query('TRUNCATE bookings, rooms, users');
  const user = await new TypeormUserRepository(source).upsertIfNewer(principal);
  userId = user.id;
  const rows = await source.query(
    "INSERT INTO rooms(name, capacity) VALUES ('Review room', 10) RETURNING id",
  );
  roomId = rows[0].id;
});
afterAll(async () => {
  if (source?.isInitialized) {
    await source.destroy();
  }
  if (admin?.isInitialized) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.destroy();
  }
});
it('keeps a stable user ID while refreshing profile snapshots', async () => {
  const updated = await new TypeormUserRepository(source).upsertIfNewer({
    ...principal,
    issuedAt: 101,
    email: 'new@example.test',
    displayName: 'New name',
  });
  expect(updated).toEqual({ id: userId, email: 'new@example.test', displayName: 'New name' });
});
it('creates a booking using the existing UUID without refreshing its user profile', async () => {
  const sql =
    'SELECT id,email,display_name,profile_token_iat,updated_at,xmin::text AS version FROM users WHERE id=$1';
  const before = await source.query(sql, [userId]);
  const booking = await service.create(createInput());
  expect(booking.userId).toBe(userId);
  expect(await source.query(sql, [userId])).toEqual(before);
});
it('serializes same-room booking requests and maps an overlapping insert to conflict', async () => {
  const results = await Promise.allSettled([
    service.create(createInput()),
    service.create(createInput()),
  ]);
  expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((item) => item.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(BookingTimeConflictError);
});
it('allows adjacent slots and releases cancelled slots', async () => {
  await service.create(createInput());
  await service.create({
    ...createInput(),
    startAt: new Date('2099-01-01T11:00:00Z'),
    endAt: new Date('2099-01-01T12:00:00Z'),
  });
  await source.query("UPDATE bookings SET status = 'cancelled'");
  await service.create(createInput());
  expect((await source.query("SELECT id FROM bookings WHERE status='confirmed'")).length).toBe(1);
});
it('rolls back writes on callback failure and rejects escaped transaction ports', async () => {
  let escaped!: BookingTransaction;
  await expect(
    uow.run(async (tx) => {
      escaped = tx;
      await tx.rooms.lockForBooking(roomId);
      await tx.bookings.insert(input());
      throw new Error('rollback requested');
    }),
  ).rejects.toThrow('rollback requested');
  expect(await source.query('SELECT id FROM bookings')).toHaveLength(0);
  await expect(escaped.rooms.lockForBooking(roomId)).rejects.toThrow('active transaction');
  await expect(escaped.bookings.insert(input())).rejects.toThrow('active transaction');
  await service.create(createInput());
});
it('rejects a booking after deactivate commits first while it waits for the room lock', async () => {
  const owner = source.createQueryRunner();
  await owner.connect();
  await owner.startTransaction();
  let waiting: Promise<unknown> | undefined;
  try {
    await owner.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
    await owner.query('UPDATE rooms SET is_active=false WHERE id=$1', [roomId]);
    waiting = service.create(createInput()).then(
      () => 'unexpected success',
      (error: unknown) => error,
    );
    await waitForBlockedTransaction();
    await owner.commitTransaction();
    expect(await waiting).toBeInstanceOf(RoomUnavailableError);
    expect(await source.query('SELECT id FROM bookings')).toHaveLength(0);
  } finally {
    if (owner.isTransactionActive) {
      await owner.rollbackTransaction();
    }
    await owner.release();
    if (waiting) {
      await waiting;
    }
  }
});
it('preserves an existing booking when deactivate waits for its transaction', async () => {
  const locked = deferred();
  const release = deferred();
  const booking = uow.run(async (tx) => {
    await tx.rooms.lockForBooking(roomId);
    const row = await tx.bookings.insert(input());
    locked.resolve();
    await release.promise;
    return row;
  });
  await locked.promise;
  const deactivate = new RoomsService(
    new TypeormRoomsUnitOfWork(source),
    new TypeormRoomCreationRepository(source),
    new TypeormRoomReadRepository(source),
  ).deactivate(roomId);
  try {
    await waitForBlockedTransaction();
  } finally {
    release.resolve();
  }
  await booking;
  await deactivate;
  expect(await source.query('SELECT id FROM bookings')).toHaveLength(1);
  expect((await source.query('SELECT is_active FROM rooms'))[0].is_active).toBe(false);
});
it('enforces the exclusion constraint even when callers bypass the room-lock service', async () => {
  const first = source.createQueryRunner();
  const second = source.createQueryRunner();
  await first.connect();
  await second.connect();
  await first.startTransaction();
  await second.startTransaction();
  const sql =
    "INSERT INTO bookings(room_id,user_id,title,start_at,end_at) VALUES ($1,$2,'Direct',$3,$4)";
  const values = [roomId, userId, dates.startAt, dates.endAt];
  try {
    await first.query(sql, values);
    const blocked = second.query(sql, values).then(
      () => null,
      (error: unknown) => error,
    );
    await first.commitTransaction();
    const error = (await blocked) as { driverError: { code: string; constraint: string } };
    expect(error.driverError).toMatchObject({ code: '23P01', constraint: 'bookings_no_overlap' });
  } finally {
    if (first.isTransactionActive) {
      await first.rollbackTransaction();
    }
    if (second.isTransactionActive) {
      await second.rollbackTransaction();
    }
    await first.release();
    await second.release();
  }
});

it('rolls back a Rooms workflow failure and rejects escaped transaction access', async () => {
  const roomsUow = new TypeormRoomsUnitOfWork(source);
  let escaped: RoomsTransaction | undefined;
  await expect(
    roomsUow.run(async (tx) => {
      escaped = tx;
      await tx.rooms.lockById(roomId);
      await tx.rooms.setActive(roomId, false);
      throw new Error('rollback room change');
    }),
  ).rejects.toThrow('rollback room change');
  expect(
    (await source.query('SELECT is_active FROM rooms WHERE id=$1', [roomId]))[0].is_active,
  ).toBe(true);
  expect(escaped).toBeDefined();
  await expect(escaped!.rooms.lockById(roomId)).rejects.toThrow('active transaction');
  await expect(escaped!.rooms.setActive(roomId, false)).rejects.toThrow('active transaction');
});

it('keeps deactivate idempotent and reports missing rooms from application', async () => {
  const rooms = new RoomsService(
    new TypeormRoomsUnitOfWork(source),
    new TypeormRoomCreationRepository(source),
    new TypeormRoomReadRepository(source),
  );
  await expect(rooms.deactivate(randomUUID())).rejects.toThrow('Room was not found');
  await rooms.deactivate(roomId);
  await rooms.deactivate(roomId);
  expect(
    (await source.query('SELECT is_active FROM rooms WHERE id=$1', [roomId]))[0].is_active,
  ).toBe(false);
});
