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
import { TypeormRoomsUnitOfWork } from '../src/rooms/infrastructure/typeorm-rooms-unit-of-work';
import type { RoomsTransaction } from '../src/rooms/application/ports/rooms-unit-of-work.port';
import { createIdentityFixture } from './helpers/identity-fixture';

jest.setTimeout(20000);
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL is required; use an isolated test database');
}
const schema = `room_write_test_${randomUUID().replaceAll('-', '')}`;
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

const create = (body: object) =>
  request(app.getHttpServer())
    .post('/api/v1/admin/rooms')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const update = (id: string, body: object) =>
  request(app.getHttpServer())
    .patch(`/api/v1/admin/rooms/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const row = async (id: string) =>
  (
    await source.query('SELECT id,name,capacity,description,is_active FROM rooms WHERE id=$1', [id])
  )[0];

async function waitForBlockedTransactions(count: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await source.query(
      `SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND application_name=$1
      AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`,
      [schema],
    );
    if (waiting.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} transactions waiting for the room row lock`);
}

it('persists normalized create fields and explicit application defaults', async () => {
  const response = await create({ name: ' A ', capacity: 10 }).expect(201);
  expect(response.body.data).toEqual({
    id: expect.any(String),
    name: 'A',
    capacity: 10,
    description: null,
    isActive: true,
  });
  expect(await row(response.body.data.id)).toEqual({
    id: response.body.data.id,
    name: 'A',
    capacity: 10,
    description: null,
    is_active: true,
  });
});

it('keeps PostgreSQL integer limits, 200 Unicode characters and case-sensitive uniqueness', async () => {
  const name = '😀'.repeat(200);
  const response = await create({ name: ` ${name} `, capacity: 2147483647 }).expect(201);
  expect((await row(response.body.data.id)).name).toBe(name);
  await create({ name: 'A', capacity: 1 }).expect(201);
  await create({ name: 'a', capacity: 1 }).expect(201);
});

it('maps an atomic duplicate create race to one success and one safe conflict', async () => {
  const responses = await Promise.all([
    create({ name: 'A', capacity: 1 }),
    create({ name: ' A ', capacity: 2 }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  const conflict = responses.find((response) => response.status === 409)!;
  expect(conflict.body.error.code).toBe('ROOM_NAME_CONFLICT');
  expect(JSON.stringify(conflict.body)).not.toContain('INSERT');
  expect(await source.query('SELECT id FROM rooms')).toHaveLength(1);
});

it('updates only provided fields and distinguishes description null from omission', async () => {
  const created = await rooms.create({ name: 'A', capacity: 10, description: 'Original' });
  const capacity = await update(created.id, { capacity: 20 }).expect(200);
  expect(capacity.body.data).toEqual({ ...created, capacity: 20 });
  const clear = await update(created.id, { description: null }).expect(200);
  expect(clear.body.data).toEqual({ ...created, capacity: 20, description: null });
  const sameName = await update(created.id, { name: ' A ' }).expect(200);
  expect(sameName.body.data.name).toBe('A');
});

it('rolls back all changed fields on a duplicate update and returns safe 409', async () => {
  const first = await rooms.create({ name: 'A', capacity: 10 });
  await rooms.create({ name: 'B', capacity: 20 });
  const before = await row(first.id);
  const response = await update(first.id, {
    name: 'B',
    capacity: 99,
    description: 'Do not apply',
  }).expect(409);
  expect(response.body.error.code).toBe('ROOM_NAME_CONFLICT');
  expect(await row(first.id)).toEqual(before);
  await update(first.id, { capacity: 30 }).expect(200);
});

it('returns missing-room 404 without inserting a replacement', async () => {
  const response = await update(randomUUID(), { name: 'A' }).expect(404);
  expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
  expect(await source.query('SELECT id FROM rooms')).toHaveLength(0);
});

it('preserves UUID, inactive status and existing bookings when room details change', async () => {
  const created = await rooms.create({ name: 'A', capacity: 10 });
  const [user] = await source.query(
    "INSERT INTO users(keycloak_sub) VALUES('room-write-user') RETURNING id",
  );
  const [booking] = await source.query(
    `INSERT INTO bookings(room_id,user_id,title,start_at,end_at)
    VALUES($1,$2,'Existing','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z') RETURNING id`,
    [created.id, user.id],
  );
  await rooms.deactivate(created.id);
  const response = await update(created.id, { name: 'B', capacity: 20 }).expect(200);
  expect(response.body.data).toEqual({ ...created, name: 'B', capacity: 20, isActive: false });
  expect(await source.query('SELECT id,room_id,status FROM bookings')).toEqual([
    { id: booking.id, room_id: created.id, status: 'confirmed' },
  ]);
});

it('serializes competing patches without losing independent fields', async () => {
  const created = await rooms.create({ name: 'A', capacity: 10 });
  const owner = source.createQueryRunner();
  await owner.connect();
  await owner.startTransaction();
  let pending: Promise<unknown>[] = [];
  try {
    await owner.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [created.id]);
    pending = [
      rooms.update({ roomId: created.id, name: 'B' }),
      rooms.update({ roomId: created.id, capacity: 20 }),
    ];
    await waitForBlockedTransactions(2);
    await owner.commitTransaction();
    await Promise.all(pending);
    expect(await row(created.id)).toEqual({
      id: created.id,
      name: 'B',
      capacity: 20,
      description: null,
      is_active: true,
    });
  } finally {
    if (owner.isTransactionActive) {
      await owner.rollbackTransaction();
    }
    await owner.release();
    await Promise.allSettled(pending);
  }
});

it('keeps a committed deactivate when an update waits on the same row lock', async () => {
  const created = await rooms.create({ name: 'A', capacity: 10 });
  const owner = source.createQueryRunner();
  await owner.connect();
  await owner.startTransaction();
  let pending: Promise<unknown> | undefined;
  try {
    await owner.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [created.id]);
    pending = rooms.update({ roomId: created.id, name: 'B' });
    await waitForBlockedTransactions(1);
    await owner.query('UPDATE rooms SET is_active=false WHERE id=$1', [created.id]);
    await owner.commitTransaction();
    await pending;
    expect((await row(created.id)).is_active).toBe(false);
    expect((await row(created.id)).name).toBe('B');
  } finally {
    if (owner.isTransactionActive) {
      await owner.rollbackTransaction();
    }
    await owner.release();
    if (pending) {
      await pending;
    }
  }
});

it('rolls back updated details on callback failure and rejects escaped write access', async () => {
  const created = await rooms.create({ name: 'A', capacity: 10 });
  const uow = new TypeormRoomsUnitOfWork(source);
  let escaped: RoomsTransaction | undefined;
  await expect(
    uow.run(async (tx) => {
      escaped = tx;
      await tx.rooms.lockById(created.id);
      await tx.rooms.updateDetails(created.id, { capacity: 99 });
      throw new Error('rollback requested');
    }),
  ).rejects.toThrow('rollback requested');
  expect((await row(created.id)).capacity).toBe(10);
  await expect(escaped!.rooms.updateDetails(created.id, { capacity: 20 })).rejects.toThrow(
    'active transaction',
  );
});

it('keeps unrelated unique violations as unexpected errors for create and update', async () => {
  const first = await rooms.create({ name: 'A', capacity: 10 });
  const second = await rooms.create({ name: 'B', capacity: 20 });
  await source.query('CREATE UNIQUE INDEX room_capacity_test_unique ON rooms(capacity)');
  try {
    const createFailure = await create({ name: 'C', capacity: 10 }).expect(500);
    expect(createFailure.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    const updateFailure = await update(second.id, { capacity: first.capacity }).expect(500);
    expect(updateFailure.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect((await row(second.id)).capacity).toBe(20);
    expect(JSON.stringify([createFailure.body, updateFailure.body])).not.toContain(
      'room_capacity_test_unique',
    );
  } finally {
    await source.query('DROP INDEX room_capacity_test_unique');
  }
});
