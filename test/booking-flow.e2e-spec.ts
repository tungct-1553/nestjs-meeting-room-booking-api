import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Test as HttpTest } from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { databaseOptions } from '../src/database/options';
import { UsersService } from '../src/users/application/users.service';
import { createIdentityFixture } from './helpers/identity-fixture';

jest.setTimeout(30000);

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error('TEST_DATABASE_URL is required; use an isolated test database');
}

const schema = `booking_flow_e2e_${randomUUID().replaceAll('-', '')}`;
let database: DataSource;
let source: DataSource;
let app: INestApplication;
let identity: Awaited<ReturnType<typeof createIdentityFixture>>;
let ownerToken: string;
let otherToken: string;
let adminToken: string;

beforeAll(async () => {
  database = new DataSource({ type: 'postgres', url: testUrl, installExtensions: false });
  await database.initialize();
  await database.query(`CREATE SCHEMA "${schema}"`);
  source = new DataSource({
    ...databaseOptions(testUrl, 10),
    schema,
    extra: { max: 10, application_name: schema, options: `-c search_path=${schema},public` },
  });
  await source.initialize();
  await source.runMigrations();
  identity = await createIdentityFixture();
  ownerToken = identity.token({ sub: 'booking-owner' });
  otherToken = identity.token({ sub: 'another-employee' });
  adminToken = identity.token({
    sub: 'booking-admin',
    resource_access: { 'meeting-room-api': { roles: ['admin'] } },
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(ConfigService)
    .useValue(identity.config)
    .compile();
  app = module.createNestApplication({ logger: false, bodyParser: false });
  configureApp(app);
  await app.init();
});

beforeEach(async () => {
  await source.query('TRUNCATE bookings, rooms, users');
  // Admin profiles are provisioned outside Client HTTP; use the real application service.
  await app.get(UsersService).sync({
    sub: 'booking-admin',
    email: 'admin@example.test',
    displayName: 'Booking Admin',
    issuedAt: Math.floor(Date.now() / 1000),
  });
});

afterAll(async () => {
  try {
    if (app) {
      await app.close();
    }
  } finally {
    try {
      if (identity) {
        await identity.close();
      }
    } finally {
      try {
        if (source?.isInitialized) {
          await source.destroy();
        }
      } finally {
        if (database?.isInitialized) {
          try {
            await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
          } finally {
            await database.destroy();
          }
        }
      }
    }
  }
});

function api(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  token: string | null = ownerToken,
): HttpTest {
  const call = request(app.getHttpServer())[method](`/api/v1${path}`);
  if (token !== null) {
    call.set('Authorization', `Bearer ${token}`);
  }
  return call;
}

function futureSlot(offsetHours = 0): { startAt: string; endAt: string } {
  const start = Date.now() + (24 + offsetHours) * 60 * 60 * 1000;
  return { startAt: new Date(start).toISOString(), endAt: new Date(start + 3600000).toISOString() };
}

async function createRoom(name = 'Meeting Room', capacity = 10): Promise<string> {
  const result = await api('post', '/admin/rooms', adminToken).send({ name, capacity }).expect(201);
  expect(result.body.data).toEqual({
    id: expect.any(String),
    name,
    capacity,
    description: null,
    isActive: true,
  });
  return result.body.data.id;
}

async function syncEmployee(token: string = ownerToken): Promise<string> {
  const result = await api('post', '/client/users/sync', token).expect(200);
  expect(result.body.data).toEqual({
    id: expect.any(String),
    email: 'verified@example.test',
    displayName: 'Verified User',
  });
  return result.body.data.id;
}

function slot(start: number, end: number): { startAt: string; endAt: string } {
  const at = (hour: number) => new Date(Date.UTC(2099, 0, 1, hour)).toISOString();
  return { startAt: at(start), endAt: at(end) };
}

async function bookRoom(roomId: string, range: ReturnType<typeof slot>) {
  return (
    await api('post', '/client/bookings')
      .send({ roomId, title: 'Planning', ...range })
      .expect(201)
  ).body.data;
}

it('finds active rooms free for the whole range and paginates the filtered results', async () => {
  const adjacent = await createRoom('Meeting A');
  const cancelled = await createRoom('Meeting B');
  const occupied = await createRoom('Meeting C');
  const inactive = await createRoom('Meeting D');
  await createRoom('Meeting Small', 4);
  await createRoom('Training');
  await syncEmployee();
  await bookRoom(adjacent, slot(9, 10));
  await bookRoom(adjacent, slot(11, 12));
  const booking = await bookRoom(cancelled, slot(10, 11));
  await api('delete', `/client/bookings/${booking.id}`).expect(200);
  await bookRoom(occupied, slot(10, 12));
  await api('delete', `/admin/rooms/${inactive}`, adminToken).expect(204);

  const list = (page: number) =>
    api('get', '/client/rooms/available', adminToken)
      .query({ ...slot(10, 11), page, limit: 1, capacity: 10, search: 'meeting' })
      .expect(200);
  const first = (await list(1)).body;
  const second = (await list(2)).body;
  expect(first).toMatchObject({ data: [{ id: adjacent }], meta: { page: 1, limit: 1, total: 2 } });
  expect(second).toMatchObject({
    data: [{ id: cancelled }],
    meta: { page: 2, limit: 1, total: 2 },
  });
  expect((await list(3)).body).toEqual({ data: [], meta: { page: 3, limit: 1, total: 2 } });
});

it('returns only free intervals inside the requested room window', async () => {
  const roomId = await createRoom();
  await syncEmployee();
  const availability = (range: ReturnType<typeof slot>) =>
    api('get', `/client/rooms/${roomId}/availability`, otherToken).query(range);

  expect((await availability(slot(10, 16)).expect(200)).body).toEqual({
    data: { roomId, availableIntervals: [slot(10, 16)] },
  });
  await bookRoom(roomId, slot(9, 11));
  await bookRoom(roomId, slot(12, 13));
  await bookRoom(roomId, slot(13, 14));
  await bookRoom(roomId, slot(15, 17));
  const cancelled = await bookRoom(roomId, slot(11, 12));
  await api('delete', `/client/bookings/${cancelled.id}`).expect(200);

  expect((await availability(slot(10, 16)).expect(200)).body).toEqual({
    data: { roomId, availableIntervals: [slot(11, 12), slot(14, 15)] },
  });
  expect((await availability(slot(12, 14)).expect(200)).body).toEqual({
    data: { roomId, availableIntervals: [] },
  });
  await api('delete', `/admin/rooms/${roomId}`, adminToken).expect(204);
  expect((await availability(slot(10, 16)).expect(404)).body.error.code).toBe('ROOM_NOT_FOUND');
  await api('get', `/client/rooms/${randomUUID()}/availability`).query(slot(10, 16)).expect(404);
});

it('finds a room, picks a free interval, and moves the booking to that interval', async () => {
  const roomId = await createRoom();
  const candidates = () => api('get', '/client/rooms/available').query(slot(10, 11)).expect(200);
  expect((await candidates()).body.meta).toEqual({ page: 1, limit: 20, total: 1 });
  await syncEmployee();
  const original = await bookRoom(roomId, slot(10, 11));
  expect((await candidates()).body.meta.total).toBe(0);

  const availability = async () =>
    (await api('get', `/client/rooms/${roomId}/availability`).query(slot(10, 12)).expect(200)).body
      .data;
  expect(await availability()).toEqual({ roomId, availableIntervals: [slot(11, 12)] });
  const reschedule = () =>
    api('patch', `/client/bookings/${original.id}/schedule`).send(slot(11, 12)).expect(200);
  const rescheduled = { ...original, ...slot(11, 12) };
  expect((await reschedule()).body).toEqual({ data: rescheduled });
  expect((await reschedule()).body).toEqual({ data: rescheduled });
  expect((await candidates()).body.meta.total).toBe(1);
  expect(await availability()).toEqual({ roomId, availableIntervals: [slot(10, 11)] });
});

it('keeps availability and rescheduling consistent with stored sub-millisecond timestamps', async () => {
  const roomId = await createRoom();
  await syncEmployee();
  const booking = await bookRoom(roomId, slot(10, 11));
  await source.query(
    "UPDATE bookings SET start_at = start_at + interval '500 microseconds', end_at = end_at + interval '500 microseconds' WHERE id = $1",
    [booking.id],
  );

  const availability = async () =>
    (await api('get', `/client/rooms/${roomId}/availability`).query(slot(9, 12)).expect(200)).body
      .data.availableIntervals;
  const availableRooms = (startAt = slot(11, 12).startAt) =>
    api('get', '/client/rooms/available')
      .query({ ...slot(11, 12), startAt })
      .expect(200);

  expect(await availability()).toEqual([
    slot(9, 10),
    { ...slot(11, 12), startAt: '2099-01-01T11:00:00.001Z' },
  ]);
  expect((await availableRooms('2099-01-01T11:00:00.000500Z')).body.meta.total).toBe(0);

  const reschedule = () =>
    api('patch', `/client/bookings/${booking.id}/schedule`)
      .send({ ...slot(10, 11), endAt: '2099-01-01T11:00:00.000500Z' })
      .expect(200);
  expect((await reschedule()).body.data).toEqual(booking);
  expect(await availability()).toEqual([slot(9, 10), slot(11, 12)]);
  expect((await availableRooms()).body.meta.total).toBe(1);

  const storedUpdateTime = async () =>
    (
      await source.query<{ updated_at: string }[]>(
        'SELECT updated_at::text FROM bookings WHERE id = $1',
        [booking.id],
      )
    )[0].updated_at;
  const updatedAt = await storedUpdateTime();
  expect((await reschedule()).body.data).toEqual(booking);
  expect(await storedUpdateTime()).toBe(updatedAt);
});

it('validates the three new operations, enforces ownership and rejects unavailable bookings', async () => {
  const roomId = await createRoom();
  const search = '/client/rooms/available';
  const availability = `/client/rooms/${roomId}/availability`;
  await api('get', search, null).query(slot(10, 11)).expect(401);
  await api('get', search).expect(400);
  await api('get', search).query(slot(11, 11)).expect(400);
  await api('get', search)
    .query({ ...slot(10, 11), page: 0 })
    .expect(400);
  await api('get', availability)
    .query({ ...slot(10, 11), startAt: '2099-01-01T10:00:00' })
    .expect(400);
  await api('get', '/client/rooms/not-a-uuid/availability').query(slot(10, 11)).expect(400);
  await api('get', availability)
    .query({
      startAt: '2000-01-01T10:00:00Z',
      endAt: '2000-01-01T11:00:00Z',
    })
    .expect(400);

  await syncEmployee();
  const original = await bookRoom(roomId, slot(10, 11));
  const schedule = `/client/bookings/${original.id}/schedule`;
  await api('patch', schedule, null).send(slot(11, 12)).expect(401);
  expect(
    (await api('patch', schedule, otherToken).send(slot(11, 12)).expect(409)).body.error.code,
  ).toBe('USER_NOT_PROVISIONED');
  expect(
    (await api('patch', schedule, adminToken).send(slot(11, 12)).expect(403)).body.error.code,
  ).toBe('BOOKING_OWNER_REQUIRED');
  expect(
    (await api('patch', `/client/bookings/${randomUUID()}/schedule`).send(slot(11, 12)).expect(404))
      .body.error.code,
  ).toBe('BOOKING_NOT_FOUND');
  await api('patch', schedule)
    .send({ ...slot(11, 12), roomId })
    .expect(400);
  expect((await api('patch', schedule).send(slot(12, 11)).expect(400)).body.error.code).toBe(
    'INVALID_BOOKING_TIME',
  );

  const cancelled = await bookRoom(roomId, slot(13, 14));
  await api('delete', `/client/bookings/${cancelled.id}`).expect(200);
  expect(
    (await api('patch', `/client/bookings/${cancelled.id}/schedule`).send(slot(11, 12)).expect(409))
      .body.error.code,
  ).toBe('BOOKING_NOT_RESCHEDULABLE');
  const started = await bookRoom(roomId, slot(14, 15));
  await source.query(
    "UPDATE bookings SET start_at = now() - interval '1 hour', end_at = now() + interval '1 hour' WHERE id = $1",
    [started.id],
  );
  expect(
    (await api('patch', `/client/bookings/${started.id}/schedule`).send(slot(11, 12)).expect(409))
      .body.error.code,
  ).toBe('BOOKING_NOT_RESCHEDULABLE');
  await api('delete', `/admin/rooms/${roomId}`, adminToken).expect(204);
  expect((await api('patch', schedule).send(slot(11, 12)).expect(404)).body.error.code).toBe(
    'ROOM_UNAVAILABLE',
  );
});

it('keeps the old window on conflict and serializes creation and rescheduling for the same slot', async () => {
  const roomId = await createRoom();
  await syncEmployee();
  const original = await bookRoom(roomId, slot(10, 11));
  await bookRoom(roomId, slot(11, 12));
  const schedule = `/client/bookings/${original.id}/schedule`;
  const detail = () => api('get', `/client/bookings/${original.id}`).expect(200);
  const conflict = await api('patch', schedule).send(slot(11, 12)).expect(409);
  expect(conflict.body.error.code).toBe('BOOKING_TIME_CONFLICT');
  expect((await detail()).body.data).toEqual(original);

  const target = slot(12, 13);
  const [created, moved] = await Promise.all([
    api('post', '/client/bookings').send({ roomId, title: 'Concurrent', ...target }),
    api('patch', schedule).send(target),
  ]);
  if (created.status === 201) {
    expect(moved.status).toBe(409);
    expect(moved.body.error.code).toBe('BOOKING_TIME_CONFLICT');
    expect((await detail()).body.data).toEqual(original);
  } else {
    expect(created.status).toBe(409);
    expect(created.body.error.code).toBe('BOOKING_TIME_CONFLICT');
    expect(moved.status).toBe(200);
    expect((await detail()).body.data).toEqual({ ...original, ...target });
  }
});

it('publishes all three operations with their required time inputs in Client Swagger', async () => {
  const { body } = await api('get', '/docs/client/openapi.json', null).expect(200);
  const expected = ['startAt', 'endAt'].map((name) => ({ name, in: 'query', required: true }));
  for (const path of ['/api/v1/client/rooms/available', '/api/v1/client/rooms/{id}/availability']) {
    expect(body.paths[path].get.parameters).toEqual(
      expect.arrayContaining(expected.map((parameter) => expect.objectContaining(parameter))),
    );
  }
  const patch = body.paths['/api/v1/client/bookings/{id}/schedule'].patch;
  expect(patch.responses['409']).toBeDefined();
  expect(patch.requestBody.content['application/json'].schema.$ref).toBe(
    '#/components/schemas/TimeRangeRequestDto',
  );
  expect(body.components.schemas.TimeRangeRequestDto.required).toEqual(['startAt', 'endAt']);
});

it('discovers a room, books, reads, cancels and rebooks the released slot while retaining history', async () => {
  const roomId = await createRoom();
  const userId = await syncEmployee();
  const room = (await api('get', `/client/rooms/${roomId}`).expect(200)).body.data;
  expect((await api('get', '/client/rooms?capacity=10&search=Meeting').expect(200)).body).toEqual({
    data: [room],
    meta: { page: 1, limit: 20, total: 1 },
  });

  const input = { roomId, title: 'Planning', ...futureSlot() };
  const booking = (await api('post', '/client/bookings').send(input).expect(201)).body.data;
  expect(booking).toEqual({
    id: expect.any(String),
    roomId,
    userId,
    title: input.title,
    startAt: input.startAt,
    endAt: input.endAt,
    status: 'confirmed',
    createdAt: expect.any(String),
  });
  expect((await api('get', '/client/bookings').expect(200)).body).toEqual({
    data: [booking],
    meta: { page: 1, limit: 20, total: 1 },
  });
  expect((await api('get', `/client/bookings/${booking.id}`).expect(200)).body).toEqual({
    data: booking,
  });
  expect((await api('post', '/client/bookings').send(input).expect(409)).body.error.code).toBe(
    'BOOKING_TIME_CONFLICT',
  );

  const cancelled = { ...booking, status: 'cancelled' };
  expect((await api('delete', `/client/bookings/${booking.id}`).expect(200)).body).toEqual({
    data: cancelled,
  });
  expect((await api('delete', `/client/bookings/${booking.id}`).expect(200)).body).toEqual({
    data: cancelled,
  });
  expect((await api('get', '/client/bookings?status=cancelled').expect(200)).body).toEqual({
    data: [cancelled],
    meta: { page: 1, limit: 20, total: 1 },
  });
  expect((await api('get', '/client/bookings?status=confirmed').expect(200)).body).toEqual({
    data: [],
    meta: { page: 1, limit: 20, total: 0 },
  });

  const replacement = (await api('post', '/client/bookings').send(input).expect(201)).body.data;
  expect(replacement.id).not.toBe(booking.id);
  expect(replacement).toEqual({ ...booking, id: replacement.id, createdAt: replacement.createdAt });
  expect((await api('get', `/client/bookings/${booking.id}`).expect(200)).body.data).toEqual(
    cancelled,
  );
  expect((await api('get', '/client/bookings?status=confirmed').expect(200)).body).toEqual({
    data: [replacement],
    meta: { page: 1, limit: 20, total: 1 },
  });
  expect((await api('get', '/client/bookings').expect(200)).body.meta.total).toBe(2);
  expect(identity.requests()).toBeGreaterThan(0);
});

it('enforces JWT, role and provisioning checks through the real HTTP pipeline', async () => {
  const noRole = identity.token({ resource_access: {} });
  for (const token of [null, 'invalid-token', noRole]) {
    const status = token === noRole ? 403 : 401;
    await api('get', '/client/bookings', token).expect(status);
    await api('get', `/client/bookings/${randomUUID()}`, token).expect(status);
    await api('delete', `/client/bookings/${randomUUID()}`, token).expect(status);
    await api('post', '/client/bookings', token).send({}).expect(status);
  }
  const missing = await api('get', '/client/bookings').expect(409);
  expect(missing.body.error.code).toBe('USER_NOT_PROVISIONED');
  await syncEmployee();
  await api('get', '/client/bookings').expect(200);
  await api('post', '/admin/rooms').send({ name: 'Forbidden', capacity: 10 }).expect(403);
});

it('restricts booking lists and detail/cancel to each owner, including Admin', async () => {
  const roomId = await createRoom();
  await syncEmployee();
  const otherId = await syncEmployee(otherToken);
  const booking = (
    await api('post', '/client/bookings')
      .send({ roomId, title: 'Owner meeting', ...futureSlot() })
      .expect(201)
  ).body.data;
  const otherBooking = (
    await api('post', '/client/bookings', otherToken)
      .send({ roomId, title: 'Another meeting', ...futureSlot(2) })
      .expect(201)
  ).body.data;
  const adminBooking = (
    await api('post', '/client/bookings', adminToken)
      .send({ roomId, title: 'Admin meeting', ...futureSlot(4) })
      .expect(201)
  ).body.data;

  for (const [token, own] of [
    [otherToken, otherBooking],
    [adminToken, adminBooking],
  ] as const) {
    expect((await api('get', '/client/bookings?limit=1', token).expect(200)).body).toEqual({
      data: [own],
      meta: { page: 1, limit: 1, total: 1 },
    });
    expect(
      (await api('get', `/client/bookings/${booking.id}`, token).expect(403)).body.error.code,
    ).toBe('BOOKING_OWNER_REQUIRED');
    expect(
      (await api('delete', `/client/bookings/${booking.id}`, token).expect(403)).body.error.code,
    ).toBe('BOOKING_OWNER_REQUIRED');
  }
  await api('get', `/client/bookings?userId=${otherId}`).expect(400);
  await api('get', '/client/bookings?actorSub=another-employee').expect(400);
  expect((await api('get', '/client/bookings').expect(200)).body).toEqual({
    data: [booking],
    meta: { page: 1, limit: 20, total: 1 },
  });
  await api('get', `/client/bookings/${adminBooking.id}`).expect(403);
  await api('get', `/client/bookings/${randomUUID()}`).expect(404);
  await api('delete', `/client/bookings/${booking.id}`).expect(200);
  for (const token of [otherToken, adminToken]) {
    await api('get', `/client/bookings/${booking.id}`, token).expect(403);
    await api('delete', `/client/bookings/${booking.id}`, token).expect(403);
  }
});

it('hides inactive rooms while preserving booking reads and allowing owner cancellation', async () => {
  const roomId = await createRoom();
  await syncEmployee();
  const input = { roomId, title: 'Existing meeting', ...futureSlot() };
  const booking = (await api('post', '/client/bookings').send(input).expect(201)).body.data;
  const deactivated = await api('delete', `/admin/rooms/${roomId}`, adminToken).expect(204);
  expect(deactivated.text).toBe('');
  await api('get', `/client/rooms/${roomId}`).expect(404);
  expect((await api('get', '/client/rooms').expect(200)).body).toEqual({
    data: [],
    meta: { page: 1, limit: 20, total: 0 },
  });
  expect((await api('get', `/client/bookings/${booking.id}`).expect(200)).body.data).toEqual(
    booking,
  );
  expect((await api('get', '/client/bookings').expect(200)).body).toEqual({
    data: [booking],
    meta: { page: 1, limit: 20, total: 1 },
  });
  const cancelled = { ...booking, status: 'cancelled' };
  expect((await api('delete', `/client/bookings/${booking.id}`).expect(200)).body.data).toEqual(
    cancelled,
  );
  expect((await api('post', '/client/bookings').send(input).expect(404)).body.error.code).toBe(
    'ROOM_UNAVAILABLE',
  );
  expect((await api('get', '/client/bookings?status=cancelled').expect(200)).body).toEqual({
    data: [cancelled],
    meta: { page: 1, limit: 20, total: 1 },
  });
});

it('accepts only one concurrent booking for the same slot and allows an adjacent slot', async () => {
  const roomId = await createRoom();
  await syncEmployee();
  const input = { roomId, title: 'Concurrent meeting', ...futureSlot() };
  const attempts = await Promise.all([
    api('post', '/client/bookings').send(input),
    api('post', '/client/bookings').send(input),
  ]);
  expect(attempts.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(attempts.find((result) => result.status === 409)?.body.error.code).toBe(
    'BOOKING_TIME_CONFLICT',
  );
  await api('post', '/client/bookings')
    .send({
      ...input,
      title: 'Adjacent meeting',
      startAt: input.endAt,
      endAt: new Date(Date.parse(input.endAt) + 3600000).toISOString(),
    })
    .expect(201);
  const result = await api('get', '/client/bookings?status=confirmed').expect(200);
  expect(result.body.meta.total).toBe(2);
  expect(result.body.data).toHaveLength(2);
});
