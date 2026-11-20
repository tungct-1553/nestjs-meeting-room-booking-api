import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { BOOKING_READ_REPOSITORY } from '../src/bookings/application/ports/booking-read-repository.port';
import { BOOKING_UNIT_OF_WORK } from '../src/bookings/application/ports/booking-unit-of-work.port';
import { USERS_QUERY_API } from '../src/users/public/users-query.api';
import { UserNotProvisionedError } from '../src/users/application/errors/user.errors';
import { createIdentityFixture } from './helpers/identity-fixture';

const userId = randomUUID();
const booking = {
  id: randomUUID(),
  roomId: randomUUID(),
  userId,
  title: 'Meeting',
  startAt: new Date('2099-01-01T10:00:00Z'),
  endAt: new Date('2099-01-01T11:00:00Z'),
  status: 'confirmed' as const,
  createdAt: new Date('2098-12-01T10:00:00Z'),
};
const responseBooking = {
  ...booking,
  startAt: booking.startAt.toISOString(),
  endAt: booking.endAt.toISOString(),
  createdAt: booking.createdAt.toISOString(),
};
let app: INestApplication;
let fixture: Awaited<ReturnType<typeof createIdentityFixture>>;
let employee: string;
let admin: string;
const users = { requireBySub: jest.fn() };
const reader = { listByUser: jest.fn(), findById: jest.fn() };
const uow = { run: jest.fn() };

beforeAll(async () => {
  fixture = await createIdentityFixture();
  employee = fixture.token();
  admin = fixture.token({ resource_access: { 'meeting-room-api': { roles: ['admin'] } } });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue({ isInitialized: false })
    .overrideProvider(ConfigService)
    .useValue(fixture.config)
    .overrideProvider(USERS_QUERY_API)
    .useValue(users)
    .overrideProvider(BOOKING_READ_REPOSITORY)
    .useValue(reader)
    .overrideProvider(BOOKING_UNIT_OF_WORK)
    .useValue(uow)
    .compile();
  app = module.createNestApplication({ logger: false, bodyParser: false });
  configureApp(app);
  await app.init();
});

beforeEach(() => {
  jest.resetAllMocks();
  users.requireBySub.mockResolvedValue({ id: userId });
  reader.findById.mockResolvedValue({ ...booking, privateField: 'hidden' });
  reader.listByUser.mockResolvedValue({
    items: [{ ...booking, privateField: 'hidden' }],
    page: 1,
    limit: 20,
    total: 1,
  });
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
  if (fixture) {
    await fixture.close();
  }
});

const get = (path: string, token: string | null = employee) => {
  const call = request(app.getHttpServer()).get(`/api/v1/client/bookings${path}`);
  if (token) {
    call.set('Authorization', `Bearer ${token}`);
  }
  return call;
};

it('requires JWT and Employee/Admin role before accessing the read use cases', async () => {
  const forbidden = fixture.token({ resource_access: {} });
  for (const token of [null, 'invalid-token', forbidden]) {
    const status = token === forbidden ? 403 : 401;
    await get('', token).expect(status);
    await get(`/${booking.id}`, token).expect(status);
  }
  expect(users.requireBySub).not.toHaveBeenCalled();
  expect(reader.listByUser).not.toHaveBeenCalled();
  expect(reader.findById).not.toHaveBeenCalled();
});

it.each(['employee', 'admin'])(
  'allows %s to read own list/detail with public UTC fields',
  async (role) => {
    const token = role === 'admin' ? admin : employee;
    expect((await get('', token).expect(200)).body).toEqual({
      data: [responseBooking],
      meta: { page: 1, limit: 20, total: 1 },
    });
    expect((await get(`/${booking.id}`, token).expect(200)).body).toEqual({
      data: responseBooking,
    });
    expect(users.requireBySub).toHaveBeenCalledWith('verified-user');
    expect(reader.listByUser).toHaveBeenCalledWith({
      userId,
      page: 1,
      limit: 20,
      status: undefined,
    });
    expect(reader.findById).toHaveBeenCalledWith(booking.id);
    expect(uow.run).not.toHaveBeenCalled();
  },
);

it.each(['confirmed', 'cancelled'])(
  'maps numeric pagination and %s status query',
  async (status) => {
    reader.listByUser.mockResolvedValueOnce({ items: [], page: 2, limit: 5, total: 8 });
    expect((await get(`?page=2&limit=5&status=${status}`).expect(200)).body).toEqual({
      data: [],
      meta: { page: 2, limit: 5, total: 8 },
    });
    expect(reader.listByUser).toHaveBeenCalledWith({ userId, page: 2, limit: 5, status });
  },
);

it.each([
  '?page=0',
  '?page=-1',
  '?page=1.5',
  '?page=NaN',
  '?page=Infinity',
  '?page=',
  '?page=9007199254740992',
  '?page=1&page=2',
  '?limit=0',
  '?limit=101',
  '?limit=1.5',
  '?limit=',
  '?limit=abc',
  '?limit=1&limit=2',
  '?status=',
  '?status=CONFIRMED',
  '?status=pending',
  '?status=confirmed&status=cancelled',
  '?userId=attacker',
  '?actorSub=attacker',
  '?roomId=attacker',
])('rejects malformed or unsupported query %s before user lookup', async (query) => {
  const response = await get(query).expect(400);
  expect(response.body.error.code).toBe('HTTP_400');
  expect(response.body.error.details.length).toBeGreaterThan(0);
  expect(users.requireBySub).not.toHaveBeenCalled();
  expect(reader.listByUser).not.toHaveBeenCalled();
});

it('rejects an unsafe offset before querying users or bookings', async () => {
  const response = await get('?page=9007199254740991&limit=100').expect(400);
  expect(response.body.error.code).toBe('INVALID_BOOKING_QUERY');
  expect(users.requireBySub).not.toHaveBeenCalled();
  expect(reader.listByUser).not.toHaveBeenCalled();
});

it('validates the detail UUID before user lookup', async () => {
  await get('/invalid').expect(400);
  expect(users.requireBySub).not.toHaveBeenCalled();
  expect(reader.findById).not.toHaveBeenCalled();
});

it('requires an existing application profile for both read endpoints', async () => {
  users.requireBySub.mockRejectedValue(new UserNotProvisionedError());
  for (const path of ['', `/${booking.id}`]) {
    expect((await get(path).expect(409)).body.error.code).toBe('USER_NOT_PROVISIONED');
  }
  expect(reader.listByUser).not.toHaveBeenCalled();
  expect(reader.findById).not.toHaveBeenCalled();
});

it('returns 404 for missing booking and 403 for other owners including Admin', async () => {
  reader.findById.mockResolvedValueOnce(null);
  expect((await get(`/${booking.id}`).expect(404)).body.error.code).toBe('BOOKING_NOT_FOUND');
  for (const status of ['confirmed', 'cancelled']) {
    reader.findById.mockResolvedValue({ ...booking, userId: randomUUID(), status });
    for (const token of [employee, admin]) {
      const response = await get(`/${booking.id}`, token).expect(403);
      expect(response.body.error.code).toBe('BOOKING_OWNER_REQUIRED');
    }
  }
  expect(uow.run).not.toHaveBeenCalled();
});

it('returns safe 500 responses for unexpected read failures', async () => {
  const error = new Error('private SQL password=secret');
  reader.listByUser.mockRejectedValueOnce(error);
  reader.findById.mockRejectedValueOnce(error);
  for (const path of ['', `/${booking.id}`]) {
    const response = await get(path).expect(500);
    expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  }
});

it('publishes pagination/status schemas, owner errors and security in Client Swagger only', async () => {
  const client = (await request(app.getHttpServer()).get('/api/v1/docs/client/openapi.json')).body;
  const list = client.paths['/api/v1/client/bookings'].get;
  const detail = client.paths['/api/v1/client/bookings/{id}'].get;
  expect(list.parameters.map((value: { name: string }) => value.name).sort()).toEqual([
    'limit',
    'page',
    'status',
  ]);
  const schema = (name: string) =>
    list.parameters.find((value: { name: string }) => value.name === name).schema;
  expect(schema('page')).toMatchObject({ type: 'integer', minimum: 1, default: 1 });
  expect(schema('limit')).toMatchObject({ type: 'integer', minimum: 1, maximum: 100, default: 20 });
  expect(schema('status').enum).toEqual(['confirmed', 'cancelled']);
  expect(list.responses['200'].content['application/json'].schema.$ref).toContain(
    'BookingPageResponseDto',
  );
  expect(client.components.schemas.BookingPageResponseDto.properties.data.items.$ref).toContain(
    'ClientBookingResponseDto',
  );
  expect(detail.responses['200'].content['application/json'].schema.properties.data.$ref).toContain(
    'ClientBookingResponseDto',
  );
  expect(
    detail.parameters.find((value: { name: string }) => value.name === 'id').schema.format,
  ).toBe('uuid');
  for (const operation of [list, detail]) {
    expect(operation.security).toEqual(
      expect.arrayContaining([expect.objectContaining({ bearer: [] })]),
    );
    for (const status of ['400', '401', '403', '409']) {
      expect(operation.responses[status]).toBeDefined();
    }
    expect(operation.responses['409'].description).toBe('User profile is not provisioned');
  }
  expect(detail.responses['404']).toBeDefined();
  const adminDoc = (await request(app.getHttpServer()).get('/api/v1/docs/admin/openapi.json')).body;
  expect(adminDoc.paths['/api/v1/client/bookings']).toBeUndefined();
  expect(adminDoc.paths['/api/v1/client/bookings/{id}']).toBeUndefined();
});
