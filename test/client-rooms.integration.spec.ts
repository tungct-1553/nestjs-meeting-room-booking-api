import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { databaseOptions } from '../src/database/options';
import { RoomsService } from '../src/rooms/application/rooms.service';
import { createIdentityFixture } from './helpers/identity-fixture';

jest.setTimeout(20000);
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL is required; use an isolated test database');
}
const schema = `room_read_test_${randomUUID().replaceAll('-', '')}`;
let admin: DataSource;
let source: DataSource;
let app: INestApplication;
let fixture: Awaited<ReturnType<typeof createIdentityFixture>>;
let token: string;
let rooms: RoomsService;

beforeAll(async () => {
  admin = await new DataSource({ type: 'postgres', url, installExtensions: false }).initialize();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  source = await new DataSource({
    ...databaseOptions(url, 10),
    schema,
    extra: { max: 10, application_name: schema, options: `-c search_path=${schema},public` },
  }).initialize();
  await source.runMigrations();
  fixture = await createIdentityFixture();
  token = fixture.token({ resource_access: { 'meeting-room-api': { roles: ['admin'] } } });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(ConfigService)
    .useValue(fixture.config)
    .compile();
  app = module.createNestApplication({ logger: false, bodyParser: false });
  configureApp(app);
  await app.init();
  rooms = module.get(RoomsService);
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

const list = (query: string = '') =>
  request(app.getHttpServer())
    .get(`/api/v1/client/rooms${query}`)
    .set('Authorization', `Bearer ${token}`);
const detail = (id: string) =>
  request(app.getHttpServer())
    .get(`/api/v1/client/rooms/${id}`)
    .set('Authorization', `Bearer ${token}`);
const deactivate = (id: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/admin/rooms/${id}`)
    .set('Authorization', `Bearer ${token}`);

it('filters active rooms and minimum capacity before count/offset, retaining stable name order', async () => {
  const alpha = await rooms.create({ name: 'A', capacity: 5 });
  const bravo = await rooms.create({ name: 'B', capacity: 10 });
  const charlie = await rooms.create({ name: 'C', capacity: 20 });
  const inactive = await rooms.create({ name: 'D', capacity: 50 });
  await rooms.deactivate(inactive.id);
  const first = await list('?capacity=10&limit=1').expect(200);
  expect(first.body).toEqual({ data: [bravo], meta: { page: 1, limit: 1, total: 2 } });
  const second = await list('?capacity=10&limit=1&page=2').expect(200);
  expect(second.body).toEqual({ data: [charlie], meta: { page: 2, limit: 1, total: 2 } });
  const beyond = await list('?capacity=10&limit=1&page=3').expect(200);
  expect(beyond.body).toEqual({ data: [], meta: { page: 3, limit: 1, total: 2 } });
  expect((await list().expect(200)).body.data).toEqual([alpha, bravo, charlie]);
});

it('returns an empty page with zero filtered total when no active rooms match', async () => {
  await rooms.create({ name: 'A', capacity: 5 });
  expect((await list('?capacity=10').expect(200)).body).toEqual({
    data: [],
    meta: { page: 1, limit: 20, total: 0 },
  });
});

it('matches NFC substrings with Unicode case folding while retaining accent differences', async () => {
  const target = await rooms.create({ name: 'Phòng Họp Á', capacity: 10 });
  await rooms.create({ name: 'Phong Hop A', capacity: 10 });
  const hidden = await rooms.create({ name: 'Phòng Họp B', capacity: 10 });
  await rooms.deactivate(hidden.id);
  const result = await list(`?search=${encodeURIComponent(' PHÒNG '.normalize('NFD'))}`).expect(
    200,
  );
  expect(result.body).toEqual({ data: [target], meta: { page: 1, limit: 20, total: 1 } });
  expect(
    (await list('?search=phong').expect(200)).body.data.map((room: { name: string }) => room.name),
  ).toEqual(['Phong Hop A']);
});

it.each(['%', '_', '\\', "' OR 1=1 --"])(
  'treats search %j as literal parameterized text',
  async (literal) => {
    const target = await rooms.create({ name: `A${literal}B`, capacity: 1 });
    await rooms.create({ name: 'AotherB', capacity: 1 });
    const response = await list(`?search=${encodeURIComponent(literal)}`).expect(200);
    expect(response.body.data).toEqual([target]);
    expect(response.body.meta.total).toBe(1);
  },
);

it('applies the same filters to count on later pages and accepts empty search as unfiltered', async () => {
  await rooms.create({ name: 'A room', capacity: 10 });
  const target = await rooms.create({ name: 'B room', capacity: 20 });
  await rooms.create({ name: 'C other', capacity: 20 });
  expect((await list('?search=room&capacity=15&limit=1&page=2').expect(200)).body).toEqual({
    data: [],
    meta: { page: 2, limit: 1, total: 1 },
  });
  expect((await list('?search=room&capacity=15').expect(200)).body.data).toEqual([target]);
  expect((await list('?search=%20%20').expect(200)).body.meta.total).toBe(3);
});

it('returns only active detail and keeps missing/inactive responses identical', async () => {
  const target = await rooms.create({ name: 'A', capacity: 10, description: 'Room' });
  expect((await detail(target.id).expect(200)).body).toEqual({ data: target });
  await deactivate(target.id).expect(204);
  const inactive = await detail(target.id).expect(404);
  const missing = await detail(randomUUID()).expect(404);
  expect(inactive.body.error).toEqual(missing.body.error);
  expect(inactive.body.error.code).toBe('ROOM_NOT_FOUND');
});

it('deactivates idempotently without deleting rooms or their bookings', async () => {
  const target = await rooms.create({ name: 'A', capacity: 10 });
  const [user] = await source.query<Array<{ id: string }>>(
    "INSERT INTO users(keycloak_sub) VALUES ('room-reader') RETURNING id",
  );
  const [booking] = await source.query<Array<{ id: string }>>(
    "INSERT INTO bookings(room_id,user_id,title,start_at,end_at) VALUES ($1,$2,'History','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z') RETURNING id",
    [target.id, user.id],
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await deactivate(target.id).expect(204);
    expect(result.text).toBe('');
  }
  expect(await source.query('SELECT id,is_active FROM rooms')).toEqual([
    { id: target.id, is_active: false },
  ]);
  expect(await source.query('SELECT id,status FROM bookings')).toEqual([
    { id: booking.id, status: 'confirmed' },
  ]);
  expect((await list().expect(200)).body.meta.total).toBe(0);
  expect((await deactivate(randomUUID()).expect(404)).body.error.code).toBe('ROOM_NOT_FOUND');
});
