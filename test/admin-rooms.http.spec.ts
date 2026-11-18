import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { ROOM_CREATION_REPOSITORY } from '../src/rooms/application/ports/room-creation-repository.port';
import { ROOMS_UNIT_OF_WORK } from '../src/rooms/application/ports/rooms-unit-of-work.port';
import type { RoomsUnitOfWork } from '../src/rooms/application/ports/rooms-unit-of-work.port';
import { RoomNameConflictError } from '../src/rooms/application/errors/room.errors';
import { createIdentityFixture } from './helpers/identity-fixture';

describe('Admin rooms HTTP', () => {
  let app: INestApplication;
  let fixture: Awaited<ReturnType<typeof createIdentityFixture>>;
  let adminToken: string;
  const room = { id: randomUUID(), name: 'A', capacity: 10, description: null, isActive: true };
  const creator = { create: jest.fn() };
  const transaction = { lockById: jest.fn(), setActive: jest.fn(), updateDetails: jest.fn() };
  const uow: RoomsUnitOfWork = { run: (work) => work({ rooms: transaction }) };

  beforeAll(async () => {
    fixture = await createIdentityFixture();
    adminToken = fixture.token({ resource_access: { 'meeting-room-api': { roles: ['admin'] } } });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false })
      .overrideProvider(ConfigService)
      .useValue(fixture.config)
      .overrideProvider(ROOM_CREATION_REPOSITORY)
      .useValue(creator)
      .overrideProvider(ROOMS_UNIT_OF_WORK)
      .useValue(uow)
      .compile();
    app = module.createNestApplication({ logger: false, bodyParser: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    creator.create.mockResolvedValue(room);
    transaction.lockById.mockResolvedValue({ id: room.id, isActive: true });
    transaction.updateDetails.mockImplementation(async (_id, patch) => ({ ...room, ...patch }));
  });
  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (fixture) {
      await fixture.close();
    }
  });

  const create = (body: unknown, token: string | null = adminToken) => {
    const call = request(app.getHttpServer()).post('/api/v1/admin/rooms');
    if (token) {
      call.set('Authorization', `Bearer ${token}`);
    }
    return call.send(body as object);
  };

  it('requires an authenticated Admin before invoking the use case', async () => {
    await create({ name: 'A', capacity: 10 }, null).expect(401);
    await create({ name: 'A', capacity: 10 }, fixture.token()).expect(403);
    expect(creator.create).not.toHaveBeenCalled();
  });

  it('creates a room with 201 and a single response envelope', async () => {
    const response = await create({ name: 'A', capacity: 10 }).expect(201);
    expect(response.body).toEqual({ data: room });
    expect(creator.create).toHaveBeenCalledWith({
      name: 'A',
      capacity: 10,
      description: null,
      isActive: true,
    });
  });

  it.each([
    {},
    { name: '   ', capacity: 10 },
    { name: null, capacity: 10 },
    { name: 1, capacity: 10 },
    { name: 'A', capacity: null },
    { name: 'A', capacity: '10' },
    { name: 'A', capacity: 0 },
    { name: 'A', capacity: 1.5 },
    { name: 'A', capacity: 2147483648 },
    { name: 'A', capacity: 10, description: 5 },
    { name: 'A'.repeat(201), capacity: 10 },
    { name: 'A\0B', capacity: 10 },
    { name: 'A', capacity: 10, description: 'A\0B' },
    { name: 'A', capacity: 10, isActive: false },
    { name: 'A', capacity: 10, id: randomUUID() },
  ])('rejects invalid create input %j before use case', async (body) => {
    await create(body).expect(400);
    expect(creator.create).not.toHaveBeenCalled();
  });

  it.each([null, ''])(
    'accepts description %j and maximum PostgreSQL integer',
    async (description) => {
      await create({ name: 'A', capacity: 2147483647, description }).expect(201);
      expect(creator.create).toHaveBeenCalledWith({
        name: 'A',
        capacity: 2147483647,
        description,
        isActive: true,
      });
    },
  );

  it('uses the application error kind for a duplicate room name', async () => {
    creator.create.mockRejectedValue(new RoomNameConflictError());
    const response = await create({ name: 'A', capacity: 10 }).expect(409);
    expect(response.body.error.code).toBe('ROOM_NAME_CONFLICT');
  });

  const update = (body: unknown, id: string = room.id, token: string | null = adminToken) => {
    const call = request(app.getHttpServer()).patch(`/api/v1/admin/rooms/${id}`);
    if (token) {
      call.set('Authorization', `Bearer ${token}`);
    }
    return call.send(body as object);
  };

  it('requires an Admin for PATCH and validates its UUID', async () => {
    await update({ name: 'B' }, room.id, null).expect(401);
    await update({ name: 'B' }, room.id, fixture.token()).expect(403);
    await update({ name: 'B' }, 'not-a-uuid').expect(400);
    expect(transaction.lockById).not.toHaveBeenCalled();
  });

  it('updates only supplied fields and returns a single 200 envelope', async () => {
    const response = await update({ name: ' B ' }).expect(200);
    expect(transaction.updateDetails).toHaveBeenCalledWith(room.id, { name: 'B' });
    expect(response.body).toEqual({ data: { ...room, name: 'B' } });
  });

  it.each([null, ''])(
    'allows description %j without clearing other details',
    async (description) => {
      await update({ description }).expect(200);
      expect(transaction.updateDetails).toHaveBeenCalledWith(room.id, { description });
    },
  );

  it.each([
    {},
    { name: null },
    { capacity: null },
    { name: '  ' },
    { name: 4 },
    { name: 'A'.repeat(201) },
    { name: 'A\0B' },
    { description: 'A\0B' },
    { capacity: '10' },
    { capacity: 0 },
    { capacity: -1 },
    { capacity: 1.2 },
    { capacity: 2147483648 },
    { description: 2 },
    { isActive: true },
    { id: randomUUID() },
  ])('rejects invalid patch %j before accessing room persistence', async (body) => {
    await update(body).expect(400);
    expect(transaction.lockById).not.toHaveBeenCalled();
    expect(transaction.updateDetails).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing room and 409 for a known duplicate name', async () => {
    transaction.lockById.mockResolvedValueOnce(null);
    const missing = await update({ name: 'B' }).expect(404);
    expect(missing.body.error.code).toBe('ROOM_NOT_FOUND');
    transaction.updateDetails.mockRejectedValueOnce(new RoomNameConflictError());
    const duplicate = await update({ name: 'B' }).expect(409);
    expect(duplicate.body.error.code).toBe('ROOM_NAME_CONFLICT');
  });

  it.each(['A'.repeat(200), '😀'.repeat(200)])(
    'accepts a trimmed 200-character Unicode name',
    async (name) => {
      await create({ name: ` ${name} `, capacity: 1 }).expect(201);
      expect(creator.create).toHaveBeenCalledWith(expect.objectContaining({ name }));
      await update({ name: ` ${name} ` }).expect(200);
      expect(transaction.updateDetails).toHaveBeenCalledWith(room.id, { name });
    },
  );

  it('publishes 201 create and 200 patch only in Admin Swagger', async () => {
    const admin = await request(app.getHttpServer())
      .get('/api/v1/docs/admin/openapi.json')
      .expect(200);
    expect(admin.body.paths['/api/v1/admin/rooms'].post.responses['201']).toBeDefined();
    expect(admin.body.paths['/api/v1/admin/rooms'].post.responses['200']).toBeUndefined();
    expect(admin.body.paths['/api/v1/admin/rooms/{id}'].patch.responses['200']).toBeDefined();
    const patch = admin.body.paths['/api/v1/admin/rooms/{id}'].patch;
    expect(
      patch.parameters.find((parameter: { name: string }) => parameter.name === 'id').schema.format,
    ).toBe('uuid');
    expect(patch.requestBody.description).toContain('at least one');
    expect(patch.requestBody.description).toContain('description: null');
    const createSchema = admin.body.components.schemas.CreateRoomRequestDto;
    expect(createSchema.required).toEqual(['name', 'capacity']);
    expect(createSchema.properties.capacity.maximum).toBe(2147483647);
    for (const schema of [createSchema, admin.body.components.schemas.UpdateRoomRequestDto]) {
      expect(schema.properties.name.maxLength).toBeUndefined();
      expect(schema.properties.name.description).toContain('NFC');
      expect(schema.properties.name.description).toContain('normalized name');
      expect(schema.properties.name.description).toContain('1..200');
    }
    expect(admin.body.components.schemas.UpdateRoomRequestDto.required).toBeUndefined();
    const client = await request(app.getHttpServer())
      .get('/api/v1/docs/client/openapi.json')
      .expect(200);
    expect(client.body.paths['/api/v1/admin/rooms']).toBeUndefined();
    expect(client.body.paths['/api/v1/admin/rooms/{id}']).toBeUndefined();
  });

  it.each([[], [1], null, 1, false, 'text'])(
    'rejects non-object JSON body %j for both APIs',
    async (value) => {
      for (const method of ['post', 'patch'] as const) {
        const path = method === 'post' ? '/api/v1/admin/rooms' : `/api/v1/admin/rooms/${room.id}`;
        await request(app.getHttpServer())
          [method](path)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(value))
          .expect(400);
      }
      expect(creator.create).not.toHaveBeenCalled();
      expect(transaction.lockById).not.toHaveBeenCalled();
    },
  );

  it('rejects 201 Unicode code points consistently at both HTTP boundaries', async () => {
    const name = '😀'.repeat(201);
    await create({ name, capacity: 1 }).expect(400);
    await update({ name }).expect(400);
    expect(creator.create).not.toHaveBeenCalled();
    expect(transaction.lockById).not.toHaveBeenCalled();
  });

  it('applies NFC before DTO length validation and keeps display case on both routes', async () => {
    const name = 'Ắ'.repeat(200);
    creator.create.mockImplementationOnce(async (input) => ({ ...room, ...input }));
    const created = await create({ name: ` ${name.normalize('NFD')} `, capacity: 1 }).expect(201);
    expect(created.body.data.name).toBe(name);
    expect(creator.create).toHaveBeenCalledWith(expect.objectContaining({ name }));
    const patchName = 'Phòng Họp';
    const updated = await update({ name: patchName.normalize('NFD') }).expect(200);
    expect(updated.body.data.name).toBe(patchName);
    const longestPatch = await update({ name: name.normalize('NFD') }).expect(200);
    expect(longestPatch.body.data.name).toBe(name);
    expect(transaction.updateDetails).toHaveBeenCalledWith(room.id, { name });
  });

  it('rejects 201 NFC code points even when the raw input is decomposed', async () => {
    const name = 'Ắ'.repeat(201).normalize('NFD');
    await create({ name, capacity: 1 }).expect(400);
    await update({ name }).expect(400);
    expect(creator.create).not.toHaveBeenCalled();
    expect(transaction.lockById).not.toHaveBeenCalled();
  });
});
