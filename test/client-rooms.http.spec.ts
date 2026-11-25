import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { ROOM_READ_REPOSITORY } from '../src/rooms/application/ports/room-read-repository.port';
import { ROOMS_UNIT_OF_WORK } from '../src/rooms/application/ports/rooms-unit-of-work.port';
import type { RoomsUnitOfWork } from '../src/rooms/application/ports/rooms-unit-of-work.port';
import { createIdentityFixture } from './helpers/identity-fixture';

const room = { id: randomUUID(), name: 'A', capacity: 10, description: null, isActive: true };
const reader = { listActive: jest.fn(), findActiveById: jest.fn() };
const transaction = { lockById: jest.fn(), setActive: jest.fn(), updateDetails: jest.fn() };
const uow: RoomsUnitOfWork = { run: (work) => work({ rooms: transaction }) };
let app: INestApplication;
let fixture: Awaited<ReturnType<typeof createIdentityFixture>>;
let employee: string;
let admin: string;
beforeAll(async () => {
  fixture = await createIdentityFixture();
  employee = fixture.token();
  admin = fixture.token({ resource_access: { 'meeting-room-api': { roles: ['admin'] } } });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue({ isInitialized: false })
    .overrideProvider(ConfigService)
    .useValue(fixture.config)
    .overrideProvider(ROOM_READ_REPOSITORY)
    .useValue(reader)
    .overrideProvider(ROOMS_UNIT_OF_WORK)
    .useValue(uow)
    .compile();
  app = module.createNestApplication({ logger: false, bodyParser: false });
  configureApp(app);
  await app.init();
});
beforeEach(() => {
  jest.resetAllMocks();
  reader.listActive.mockImplementation(async (input) => ({
    items: [{ ...room, internal: 'hidden' }],
    page: input.page,
    limit: input.limit,
    total: 1,
  }));
  reader.findActiveById.mockResolvedValue({ ...room, internal: 'hidden' });
  transaction.lockById.mockResolvedValue({ id: room.id, isActive: true });
});
afterAll(async () => {
  if (app) {
    await app.close();
  }
  if (fixture) {
    await fixture.close();
  }
});
const list = (query: string = '', token: string | null = employee) => {
  const call = request(app.getHttpServer()).get(`/api/v1/client/rooms${query}`);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
};
const detail = (id: string = room.id, token: string | null = employee) => {
  const call = request(app.getHttpServer()).get(`/api/v1/client/rooms/${id}`);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
};
const deactivate = (id: string = room.id, token: string | null = admin) => {
  const call = request(app.getHttpServer()).delete(`/api/v1/admin/rooms/${id}`);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
};

it('requires JWT and Client role on both read endpoints', async () => {
  await list('', null).expect(401);
  await detail(room.id, null).expect(401);
  const noRole = fixture.token({ resource_access: { 'meeting-room-api': { roles: [] } } });
  await list('', noRole).expect(403);
  await detail(room.id, noRole).expect(403);
  expect(reader.listActive).not.toHaveBeenCalled();
  expect(reader.findActiveById).not.toHaveBeenCalled();
});
it.each(['employee', 'admin'])(
  'permits %s and returns a single pagination envelope',
  async (role) => {
    const response = await list('', role === 'admin' ? admin : employee).expect(200);
    expect(response.body).toEqual({ data: [room], meta: { page: 1, limit: 20, total: 1 } });
    expect(reader.listActive).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      capacity: undefined,
      search: undefined,
    });
  },
);
it('transforms numeric query and NFC search before calling the application', async () => {
  await list(
    `?page=2&limit=5&capacity=2147483647&search=${encodeURIComponent(' PHÒNG '.normalize('NFD'))}`,
  ).expect(200);
  expect(reader.listActive).toHaveBeenCalledWith({
    page: 2,
    limit: 5,
    capacity: 2147483647,
    search: 'PHÒNG',
  });
});
it.each([
  'page=0',
  'page=1.2',
  'page=x',
  'page=9007199254740992',
  'page=9007199254740991&limit=100',
  'limit=0',
  'limit=101',
  'limit=x',
  'capacity=0',
  'capacity=1.5',
  'capacity=2147483648',
  'capacity=',
  'search=a&search=b',
  'search%5Bx%5D=a',
  'capacity=1&capacity=2',
  'isActive=false',
  `search=${encodeURIComponent('A\0B')}`,
  `search=${'a'.repeat(201)}`,
])('rejects invalid query %s before persistence', async (query) => {
  await list(`?${query}`).expect(400);
  expect(reader.listActive).not.toHaveBeenCalled();
});
it.each(['0', '-2', '1.2', '9007199254740992'])(
  'rejects page=%s in the request validation pipe',
  async (page) => {
    const response = await list(`?page=${page}`).expect(400);
    expect(response.body.error.code).toBe('HTTP_400');
    expect(response.body.error.details.length).toBeGreaterThan(0);
    expect(reader.listActive).not.toHaveBeenCalled();
  },
);
it('allows 200 normalized characters and treats whitespace-only search as no filter', async () => {
  await list(`?search=${encodeURIComponent('Ắ'.repeat(200).normalize('NFD'))}`).expect(200);
  expect(reader.listActive).toHaveBeenLastCalledWith(
    expect.objectContaining({ search: 'Ắ'.repeat(200) }),
  );
  await list('?search=%20%20').expect(200);
  expect(reader.listActive).toHaveBeenLastCalledWith(
    expect.objectContaining({ search: undefined }),
  );
});
it('returns mapped detail and 404 on unavailable room', async () => {
  expect((await detail().expect(200)).body).toEqual({ data: room });
  reader.findActiveById.mockResolvedValue(null);
  expect((await detail().expect(404)).body.error.code).toBe('ROOM_NOT_FOUND');
});
it('validates UUID before persistence for detail and delete', async () => {
  await detail('bad-id').expect(400);
  await deactivate('bad-id').expect(400);
  expect(reader.findActiveById).not.toHaveBeenCalled();
  expect(transaction.lockById).not.toHaveBeenCalled();
});
it('requires Admin before deactivation', async () => {
  await deactivate(room.id, null).expect(401);
  await deactivate(room.id, employee).expect(403);
  expect(transaction.lockById).not.toHaveBeenCalled();
});
it('deactivates existing active or inactive rooms with 204 and no body', async () => {
  for (const isActive of [true, false]) {
    transaction.lockById.mockResolvedValue({ id: room.id, isActive });
    const response = await deactivate().expect(204);
    expect(response.text).toBe('');
    expect(response.headers['content-type']).toBeUndefined();
  }
  expect(transaction.setActive).toHaveBeenCalledWith(room.id, false);
});
it('returns 404 without a write on missing room', async () => {
  transaction.lockById.mockResolvedValue(null);
  expect((await deactivate().expect(404)).body.error.code).toBe('ROOM_NOT_FOUND');
  expect(transaction.setActive).not.toHaveBeenCalled();
});
it('publishes correct query, response, security and namespace Swagger', async () => {
  const client = (
    await request(app.getHttpServer()).get('/api/v1/docs/client/openapi.json').expect(200)
  ).body;
  expect(
    Object.keys(client.paths).filter((path) => path.startsWith('/api/v1/client/rooms')),
  ).toEqual([
    '/api/v1/client/rooms',
    '/api/v1/client/rooms/available',
    '/api/v1/client/rooms/{id}',
    '/api/v1/client/rooms/{id}/availability',
  ]);
  expect(Object.keys(client.paths['/api/v1/client/rooms'])).toEqual(['get']);
  expect(Object.keys(client.paths['/api/v1/client/rooms/available'])).toEqual(['get']);
  expect(Object.keys(client.paths['/api/v1/client/rooms/{id}'])).toEqual(['get']);
  expect(Object.keys(client.paths['/api/v1/client/rooms/{id}/availability'])).toEqual(['get']);
  const route = client.paths['/api/v1/client/rooms'].get;
  expect(route.responses['200'].content['application/json'].schema.$ref).toContain(
    'RoomPageResponseDto',
  );
  expect(route.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
  const params = Object.fromEntries(
    route.parameters.map((item: { name: string; schema: object }) => [item.name, item.schema]),
  );
  expect(params.page).toMatchObject({ minimum: 1, default: 1 });
  expect(params.limit).toMatchObject({ maximum: 100, default: 20 });
  expect(params.capacity).toMatchObject({ maximum: 2147483647 });
  expect(params.isActive).toBeUndefined();
  expect(client.paths['/api/v1/client/rooms/{id}'].get.responses['404']).toBeDefined();
  expect(client.paths['/api/v1/admin/rooms/{id}']).toBeUndefined();
  const adminDoc = (
    await request(app.getHttpServer()).get('/api/v1/docs/admin/openapi.json').expect(200)
  ).body;
  expect(
    Object.keys(adminDoc.paths).filter((path) => path.startsWith('/api/v1/admin/rooms')),
  ).toEqual(['/api/v1/admin/rooms', '/api/v1/admin/rooms/{id}', '/api/v1/admin/rooms/{id}/status']);
  expect(Object.keys(adminDoc.paths['/api/v1/admin/rooms']).sort()).toEqual(['get', 'post']);
  expect(Object.keys(adminDoc.paths['/api/v1/admin/rooms/{id}']).sort()).toEqual([
    'delete',
    'get',
    'patch',
  ]);
  expect(Object.keys(adminDoc.paths['/api/v1/admin/rooms/{id}/status'])).toEqual(['patch']);
  const deletion = adminDoc.paths['/api/v1/admin/rooms/{id}'].delete;
  expect(deletion.responses['204'].content).toBeUndefined();
  expect(deletion.responses['200']).toBeUndefined();
  expect(adminDoc.paths['/api/v1/client/rooms']).toBeUndefined();
});
