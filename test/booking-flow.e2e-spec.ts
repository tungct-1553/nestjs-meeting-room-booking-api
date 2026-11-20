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
  method: 'get' | 'post' | 'delete',
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

async function createRoom(): Promise<string> {
  const result = await api('post', '/admin/rooms', adminToken)
    .send({ name: 'Meeting Room', capacity: 10 })
    .expect(201);
  expect(result.body.data).toEqual({
    id: expect.any(String),
    name: 'Meeting Room',
    capacity: 10,
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
