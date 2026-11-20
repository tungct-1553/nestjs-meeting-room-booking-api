import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { BOOKING_UNIT_OF_WORK } from '../src/bookings/application/ports/booking-unit-of-work.port';
import type { BookingUnitOfWork } from '../src/bookings/application/ports/booking-unit-of-work.port';
import { BookingTimeConflictError } from '../src/bookings/application/errors/booking.errors';
import { USERS_QUERY_API } from '../src/users/public/users-query.api';
import { UserNotProvisionedError } from '../src/users/application/errors/user.errors';
import { createIdentityFixture } from './helpers/identity-fixture';

const roomId = randomUUID();
const userId = randomUUID();
const booking = {
  id: randomUUID(),
  roomId,
  userId,
  title: 'Meeting',
  startAt: new Date('2099-01-01T10:00:00Z'),
  endAt: new Date('2099-01-01T11:00:00Z'),
  status: 'confirmed' as const,
  createdAt: new Date('2098-12-01T10:00:00Z'),
};
const body = {
  roomId,
  title: 'Meeting',
  startAt: '2099-01-01T10:00:00Z',
  endAt: '2099-01-01T11:00:00Z',
};
const responseBooking = {
  ...booking,
  startAt: booking.startAt.toISOString(),
  endAt: booking.endAt.toISOString(),
  createdAt: booking.createdAt.toISOString(),
};

describe('Client Booking HTTP', () => {
  let app: INestApplication;
  let fixture: Awaited<ReturnType<typeof createIdentityFixture>>;
  let employeeToken: string;
  let adminToken: string;
  const users = { requireBySub: jest.fn() };
  const rooms = { lockForBooking: jest.fn() };
  const bookings = { insert: jest.fn(), lockById: jest.fn(), updateStatus: jest.fn() };
  const uow: BookingUnitOfWork = { run: (work) => work({ rooms, bookings }) };

  beforeAll(async () => {
    fixture = await createIdentityFixture();
    employeeToken = fixture.token();
    adminToken = fixture.token({ resource_access: { 'meeting-room-api': { roles: ['admin'] } } });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false })
      .overrideProvider(ConfigService)
      .useValue(fixture.config)
      .overrideProvider(USERS_QUERY_API)
      .useValue(users)
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
    rooms.lockForBooking.mockResolvedValue({ id: roomId, isActive: true });
    bookings.insert.mockImplementation(async (value) => ({
      ...booking,
      ...value,
      privateField: 'hidden',
    }));
    bookings.lockById.mockResolvedValue(booking);
    bookings.updateStatus.mockImplementation(async (_id, status) => ({
      ...booking,
      status,
      privateField: 'hidden',
    }));
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (fixture) {
      await fixture.close();
    }
  });

  const create = (value: unknown = body, token: string | null = employeeToken) => {
    const call = request(app.getHttpServer()).post('/api/v1/client/bookings');
    if (token) {
      call.set('Authorization', `Bearer ${token}`);
    }
    return call.send(value as object);
  };
  const cancel = (id: string = booking.id, token: string | null = employeeToken) => {
    const call = request(app.getHttpServer()).delete(`/api/v1/client/bookings/${id}`);
    if (token) {
      call.set('Authorization', `Bearer ${token}`);
    }
    return call;
  };

  it('requires JWT and Employee/Admin role for both operations', async () => {
    const forbidden = fixture.token({ resource_access: {} });
    for (const token of [null, 'invalid-token', forbidden]) {
      const status = token === forbidden ? 403 : 401;
      await create(body, token).expect(status);
      await cancel(booking.id, token).expect(status);
    }
    expect(users.requireBySub).not.toHaveBeenCalled();
    expect(bookings.insert).not.toHaveBeenCalled();
  });

  it.each(['employee', 'admin'])(
    'allows %s to create using JWT identity and returns 201 UTC envelope',
    async (role) => {
      const token = role === 'admin' ? adminToken : employeeToken;
      const result = await create(
        {
          ...body,
          title: '  Meeting  ',
          startAt: '2099-01-01T17:00:00+07:00',
          endAt: '2099-01-01T18:00:00+07:00',
        },
        token,
      ).expect(201);
      expect(result.body).toEqual({ data: responseBooking });
      expect(users.requireBySub).toHaveBeenCalledWith('verified-user');
      expect(bookings.insert).toHaveBeenCalledWith({
        roomId,
        userId,
        title: 'Meeting',
        startAt: booking.startAt,
        endAt: booking.endAt,
        status: 'confirmed',
      });
    },
  );

  it.each([
    {},
    { ...body, roomId: 'invalid' },
    { ...body, roomId: null },
    { ...body, title: null },
    { ...body, title: 3 },
    { ...body, title: '' },
    { ...body, title: '  ' },
    { ...body, title: 'x'.repeat(201) },
    { ...body, title: '😀'.repeat(201) },
    { ...body, title: 'A\0B' },
    { ...body, userId: randomUUID() },
    { ...body, actorSub: 'attacker' },
    { ...body, status: 'cancelled' },
    { ...body, startAt: '2099-01-01T10:00:00' },
    { ...body, startAt: '2099-01-01' },
    { ...body, startAt: '2099-02-29T10:00:00Z' },
    { ...body, startAt: '2099-01-01T10:00:00+24:00' },
    { ...body, startAt: '2099-01-01T10:00:00+07:60' },
    { ...body, startAt: null },
    { ...body, endAt: '2099-01-01T11:00:00' },
    { ...body, endAt: 3 },
  ])('rejects malformed create payload %j before application lookup', async (value) => {
    await create(value).expect(400);
    expect(users.requireBySub).not.toHaveBeenCalled();
    expect(bookings.insert).not.toHaveBeenCalled();
  });

  it.each([[], [1], null, 1, false, 'text'])('rejects non-object JSON %j', async (value) => {
    await request(app.getHttpServer())
      .post('/api/v1/client/bookings')
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(value))
      .expect(400);
    expect(bookings.insert).not.toHaveBeenCalled();
  });

  it('accepts 200 Unicode code points after trimming', async () => {
    const title = '😀'.repeat(200);
    const result = await create({ ...body, title: ` ${title} ` }).expect(201);
    expect(result.body.data.title).toBe(title);
  });

  it.each([
    { startAt: '2000-01-01T10:00:00Z', endAt: '2000-01-01T11:00:00Z' },
    { startAt: body.startAt, endAt: body.startAt },
    { startAt: body.endAt, endAt: body.startAt },
  ])('rejects invalid time invariant %j without insert', async (time) => {
    const result = await create({ ...body, ...time }).expect(400);
    expect(result.body.error.code).toBe('INVALID_BOOKING_TIME');
    expect(bookings.insert).not.toHaveBeenCalled();
  });

  it('rejects a missing create body before application lookup', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/client/bookings')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(400);
    expect(users.requireBySub).not.toHaveBeenCalled();
  });

  it('requires a provisioned user before cancellation', async () => {
    users.requireBySub.mockRejectedValueOnce(new UserNotProvisionedError());
    expect((await cancel().expect(409)).body.error.code).toBe('USER_NOT_PROVISIONED');
    expect(bookings.lockById).not.toHaveBeenCalled();
  });

  it('returns 409 for missing profile or overlap and 404 for unavailable room', async () => {
    users.requireBySub.mockRejectedValueOnce(new UserNotProvisionedError());
    expect((await create().expect(409)).body.error.code).toBe('USER_NOT_PROVISIONED');
    rooms.lockForBooking
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: roomId, isActive: false });
    expect((await create().expect(404)).body.error.code).toBe('ROOM_UNAVAILABLE');
    await create().expect(404);
    bookings.insert.mockRejectedValueOnce(new BookingTimeConflictError());
    expect((await create().expect(409)).body.error.code).toBe('BOOKING_TIME_CONFLICT');
  });

  it.each(['employee', 'admin'])(
    'allows %s owner to cancel and returns 200 booking envelope',
    async (role) => {
      const result = await cancel(booking.id, role === 'admin' ? adminToken : employeeToken).expect(
        200,
      );
      expect(result.body).toEqual({ data: { ...responseBooking, status: 'cancelled' } });
      expect(bookings.lockById).toHaveBeenCalledWith(booking.id);
      expect(bookings.updateStatus).toHaveBeenCalledWith(booking.id, 'cancelled');
      expect(rooms.lockForBooking).not.toHaveBeenCalled();
    },
  );

  it('validates cancellation UUID before accessing application', async () => {
    await cancel('invalid').expect(400);
    expect(users.requireBySub).not.toHaveBeenCalled();
  });

  it('returns 404 for missing booking and 403 for another owner including Admin', async () => {
    bookings.lockById.mockResolvedValueOnce(null);
    expect((await cancel().expect(404)).body.error.code).toBe('BOOKING_NOT_FOUND');
    bookings.lockById.mockResolvedValue({ ...booking, userId: randomUUID(), status: 'cancelled' });
    for (const token of [employeeToken, adminToken]) {
      expect((await cancel(booking.id, token).expect(403)).body.error.code).toBe(
        'BOOKING_OWNER_REQUIRED',
      );
    }
    expect(bookings.updateStatus).not.toHaveBeenCalled();
  });

  it('returns the original cancelled booking without another write', async () => {
    bookings.lockById.mockResolvedValue({ ...booking, status: 'cancelled' });
    const result = await cancel().expect(200);
    expect(result.body).toEqual({ data: { ...responseBooking, status: 'cancelled' } });
    expect(bookings.updateStatus).not.toHaveBeenCalled();
  });

  it('returns a safe 500 on an unexpected repository failure', async () => {
    bookings.updateStatus.mockRejectedValueOnce(new Error('SQL password=hidden-secret'));
    const result = await cancel().expect(500);
    expect(result.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(result.body)).not.toContain('hidden-secret');
  });

  it('publishes request/response/security only in Client Swagger', async () => {
    const client = (
      await request(app.getHttpServer()).get('/api/v1/docs/client/openapi.json').expect(200)
    ).body;
    expect(
      Object.keys(client.paths).filter((path) => path.startsWith('/api/v1/client/bookings')),
    ).toEqual(['/api/v1/client/bookings', '/api/v1/client/bookings/{id}']);
    expect(Object.keys(client.paths['/api/v1/client/bookings']).sort()).toEqual(['get', 'post']);
    expect(Object.keys(client.paths['/api/v1/client/bookings/{id}']).sort()).toEqual([
      'delete',
      'get',
    ]);
    const post = client.paths['/api/v1/client/bookings'].post;
    const del = client.paths['/api/v1/client/bookings/{id}'].delete;
    expect(post.responses['201'].content['application/json'].schema.properties.data.$ref).toContain(
      'ClientBookingResponseDto',
    );
    expect(post.responses['200']).toBeUndefined();
    expect(del.responses['200']).toBeDefined();
    expect(del.responses['204']).toBeUndefined();
    expect(
      del.parameters.find((value: { name: string }) => value.name === 'id').schema.format,
    ).toBe('uuid');
    expect(post.security).toEqual(
      expect.arrayContaining([expect.objectContaining({ bearer: [] })]),
    );
    expect(del.security).toEqual(expect.arrayContaining([expect.objectContaining({ bearer: [] })]));
    expect(client.components.schemas.CreateBookingRequestDto.required).toEqual([
      'roomId',
      'title',
      'startAt',
      'endAt',
    ]);
    expect(
      client.components.schemas.CreateBookingRequestDto.properties.title.maxLength,
    ).toBeUndefined();
    expect(
      client.components.schemas.CreateBookingRequestDto.properties.title.description,
    ).toContain('Trimmed');
    expect(client.components.schemas.ClientBookingResponseDto.properties.status.enum).toEqual([
      'confirmed',
      'cancelled',
    ]);
    const admin = (
      await request(app.getHttpServer()).get('/api/v1/docs/admin/openapi.json').expect(200)
    ).body;
    expect(admin.paths['/api/v1/client/bookings']).toBeUndefined();
    expect(admin.paths['/api/v1/client/bookings/{id}']).toBeUndefined();
  });
});
