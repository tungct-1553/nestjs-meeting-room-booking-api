import { Controller, Get, HttpCode, INestApplication, Query } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PaginationRequestDto } from '../src/common/http/dto/pagination-request.dto';
import { Public } from '../src/identity/public/http/public.decorator';
import { PaginatedResponse } from '../src/common/http/types/paginated-response';
import { BookingsService } from '../src/bookings/application/bookings.service';
import { RoomsTransactionFactory } from '../src/rooms/infrastructure/public/rooms-transaction.factory';
import { parsePayload } from '../src/common/http/middleware/payload-capture.middleware';

@Public()
@Controller('probe')
class ProbeController {
  @Get() read(@Query() pagination: PaginationRequestDto) {
    return pagination;
  }
  @Get('list') list(): PaginatedResponse<{ id: string }> {
    return new PaginatedResponse([{ id: 'room-id' }], { page: 2, limit: 20, total: 21 });
  }
  @Get('empty') @HttpCode(204) empty() {}
  @Get('failure') failure() {
    throw new Error('sensitive-database-password');
  }
}

describe('HTTP foundation and module DI', () => {
  let app: INestApplication;
  const source = {
    query: jest.fn().mockResolvedValue([{ result: 1 }]),
    isInitialized: true,
    destroy: jest.fn().mockResolvedValue(undefined),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
      .overrideProvider(DataSource)
      .useValue(source)
      .compile();
    app = module.createNestApplication({ logger: false, bodyParser: false });
    configureApp(app);
    app.use(
      '/api/v1/parser-defect',
      parsePayload((_request, _response, next) => {
        next(Object.assign(new Error('private parser defect'), { status: 500 }));
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('resolves application and public factory through module imports', () => {
    expect(app.get(BookingsService)).toBeInstanceOf(BookingsService);
    expect(app.get(RoomsTransactionFactory)).toBeInstanceOf(RoomsTransactionFactory);
  });
  it('keeps health raw and assigns request IDs', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'review-test')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBe('review-test');
  });
  it('separates dependency readiness from liveness', async () => {
    source.query.mockRejectedValueOnce(new Error('secret connection string'));
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(response.body.error).toEqual({
      code: 'HTTP_503',
      message: 'Database is unavailable',
      details: [],
    });
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
  it('transforms and validates query DTOs and wraps success once', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe?page=2&limit=10')
      .expect(200);
    expect(response.body).toEqual({ data: { page: 2, limit: 10 } });
    const invalid = await request(app.getHttpServer())
      .get('/api/v1/probe?limit=101&userId=untrusted')
      .expect(400);
    expect(invalid.body.error.details.length).toBeGreaterThan(0);
  });
  it('retains 204 semantics and sanitizes unexpected errors', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/probe/empty').expect(204)).text).toBe(
      '',
    );
    const response = await request(app.getHttpServer()).get('/api/v1/probe/failure').expect(500);
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
  });
  it('serializes an explicit paginated response without nesting its data envelope', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/list').expect(200);
    expect(response.body).toEqual({
      data: [{ id: 'room-id' }],
      meta: { page: 2, limit: 20, total: 21 },
    });
  });
  it('exposes Swagger with the API prefix and bearer scheme', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/docs/client/openapi.json')
      .expect(200);
    expect(response.body.paths['/api/v1/client/users/me']).toBeDefined();
    expect(response.body.paths['/api/v1/admin/users/me']).toBeUndefined();
    expect(response.body.components.securitySchemes.bearer).toBeDefined();
  });
  it('allows only configured CORS origins', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3001')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    const denied = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://untrusted.example')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
  it.each([
    ['parameter count', Array.from({ length: 1001 }, (_, index) => `k${index}=v`).join('&'), 413],
    ['nesting depth', `a${'[b]'.repeat(34)}=private-form-data`, 400],
  ])('retains sanitized form %s errors and CORS', async (_label, payload, status) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/client/users/sync')
      .set('Origin', 'http://localhost:3001')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(payload)
      .expect(status);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(response.body.error.code).toBe(`HTTP_${status}`);
    expect(response.body.error.message).toBe(
      status === 413 ? 'Request body exceeds allowed limits' : 'Invalid request body',
    );
    expect(JSON.stringify(response.body)).not.toContain('private-form-data');
  });
  it('keeps unexpected parser defects as sanitized 500 errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/parser-defect')
      .set('Origin', 'http://localhost:3001')
      .expect(500);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(response.body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      details: [],
    });
  });
  it.each([
    ['malformed JSON', '{', 400, 'identity'],
    ['oversized JSON', '{}'.padEnd(100 * 1024 + 1, ' '), 413, 'identity'],
    ['unsupported encoding', '{}', 415, 'unsupported'],
  ])('retains CORS headers for %s parser failures', async (_label, payload, status, encoding) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/client/users/sync')
      .set('Origin', 'http://localhost:3001')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', encoding)
      .send(payload)
      .expect(status);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body.error.code).toBe(`HTTP_${status}`);
  });
});
