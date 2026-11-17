import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { gzipSync } from 'node:zlib';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { UsersService } from '../src/users/application/users.service';
import { Roles } from '../src/identity/public/http/roles.decorator';
import { Public } from '../src/identity/public/http/public.decorator';
import { createIdentityFixture } from './helpers/identity-fixture';

@Roles('admin')
@Controller('identity-probe')
class IdentityProbe {
  @Get() secured() {
    return 'admin';
  }
  @Public() @Get('public') public() {
    return 'public';
  }
}

describe('Identity HTTP with signed JWT and JWKS', () => {
  let app: INestApplication;
  let fixture: Awaited<ReturnType<typeof createIdentityFixture>>;
  const profile = {
    id: 'local-uuid',
    email: 'verified@example.test',
    displayName: 'Verified User',
  };
  const users = {
    requireBySub: jest.fn().mockResolvedValue(profile),
    sync: jest.fn().mockResolvedValue(profile),
  };
  beforeAll(async () => {
    fixture = await createIdentityFixture();
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [IdentityProbe],
    })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false, query: jest.fn().mockResolvedValue([]) })
      .overrideProvider(ConfigService)
      .useValue({
        ...fixture.config,
        get: <T>(name: string): T =>
          name === 'CORS_ORIGINS' ? (['http://localhost:3001'] as T) : fixture.config.get<T>(name),
      })
      .overrideProvider(UsersService)
      .useValue(users)
      .compile();
    app = module.createNestApplication({ logger: false, bodyParser: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (fixture) {
      await fixture.close();
    }
  });
  const me = (token?: string, zone = 'client') => {
    const call = request(app.getHttpServer()).get(`/api/v1/${zone}/users/me`);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };
  const sync = (token: string, body?: object) => {
    const call = request(app.getHttpServer())
      .post('/api/v1/client/users/sync')
      .set('Authorization', `Bearer ${token}`);
    return body === undefined ? call : call.send(body);
  };
  const rawSyncResponse = async (
    token: string,
    headers: Record<string, string>,
    payload?: string | Buffer,
  ): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> => {
    const url = new URL('/api/v1/client/users/sync', await app.getUrl());
    return new Promise((resolve, reject) => {
      const call = httpRequest(
        url,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, ...headers },
        },
        (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += chunk.toString();
          });
          response.on('end', () =>
            resolve({
              status: response.statusCode!,
              headers: response.headers,
              body,
            }),
          );
        },
      );
      call.on('error', reject);
      call.end(payload);
    });
  };
  const rawSync = async (
    token: string,
    headers: Record<string, string>,
    payload?: string | Buffer,
  ): Promise<number> => (await rawSyncResponse(token, headers, payload)).status;

  it('accepts valid gzip JSON objects and empty decoded plain payloads', async () => {
    const token = fixture.token();
    expect(
      await rawSync(
        token,
        {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
        },
        gzipSync('{}'),
      ),
    ).toBe(200);
    expect(
      await rawSync(
        token,
        {
          'content-type': 'text/plain',
          'content-encoding': 'gzip',
        },
        gzipSync(''),
      ),
    ).toBe(200);
    const before = users.sync.mock.calls.length;
    expect(
      await rawSync(
        token,
        {
          'content-type': 'text/plain',
          'content-encoding': 'gzip',
        },
        gzipSync('nonempty unsupported body'),
      ),
    ).toBe(400);
    expect(users.sync.mock.calls.length).toBe(before);
  });

  it.each(['application/json', 'text/plain'])(
    'returns sanitized 400 with CORS for malformed/truncated gzip %s',
    async (type) => {
      const encoded = gzipSync('{}');
      for (const payload of [
        Buffer.from('private invalid gzip payload'),
        encoded.subarray(0, encoded.length - 5),
      ]) {
        const before = users.sync.mock.calls.length;
        const response = await rawSyncResponse(
          fixture.token(),
          {
            'content-type': type,
            'content-encoding': 'gzip',
            origin: 'http://localhost:3001',
          },
          payload,
        );
        expect(response.status).toBe(400);
        expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3001');
        expect(JSON.parse(response.body)).toEqual({
          error: { code: 'HTTP_400', message: 'Invalid request body', details: [] },
        });
        expect(response.body).not.toContain('private');
        expect(users.sync.mock.calls.length).toBe(before);
      }
    },
  );

  it('limits gzip expansion rather than only the encoded byte count', async () => {
    const token = fixture.token();
    expect(
      await rawSync(
        token,
        {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
        },
        gzipSync('{}'.padEnd(100 * 1024, ' ')),
      ),
    ).toBe(200);
    const before = users.sync.mock.calls.length;
    for (const type of ['application/json', 'text/plain']) {
      const response = await rawSyncResponse(
        token,
        {
          'content-type': type,
          'content-encoding': 'gzip',
          origin: 'http://localhost:3001',
        },
        gzipSync('{}'.padEnd(100 * 1024 + 1, ' ')),
      );
      expect(response.status).toBe(413);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    }
    expect(users.sync.mock.calls.length).toBe(before);
  });

  it('accepts truly empty chunked requests independently of content type', async () => {
    for (const type of [
      undefined,
      'application/json',
      'text/plain',
      'application/x-www-form-urlencoded',
    ]) {
      const headers: Record<string, string> = { 'transfer-encoding': 'chunked' };
      if (type) {
        headers['content-type'] = type;
      }
      expect(await rawSync(fixture.token(), headers)).toBe(200);
    }
  });

  it('rejects nonempty chunked and unparsed payloads before calling the use case', async () => {
    for (const [type, payload] of [
      ['text/plain', '{}'],
      ['application/octet-stream', 'unexpected'],
      ['application/x-www-form-urlencoded', '&'],
    ]) {
      const before = users.sync.mock.calls.length;
      expect(
        await rawSync(
          fixture.token(),
          {
            'transfer-encoding': 'chunked',
            'content-type': type,
          },
          payload,
        ),
      ).toBe(400);
      expect(users.sync.mock.calls.length).toBe(before);
    }
    expect(await rawSync(fixture.token(), { 'transfer-encoding': 'chunked' }, '{}')).toBe(400);
  });

  it.each(['null', 'false', '1', '"text"', '[]', '{"sub":"spoofed"}'])(
    'rejects JSON payload %s before calling the use case',
    async (payload) => {
      const before = users.sync.mock.calls.length;
      expect(await rawSync(fixture.token(), { 'content-type': 'application/json' }, payload)).toBe(
        400,
      );
      expect(users.sync.mock.calls.length).toBe(before);
    },
  );

  it('bounds supported and unsupported payloads at 100 KiB', async () => {
    const limit = 100 * 1024;
    const token = fixture.token();
    const json = '{}'.padEnd(limit, ' ');
    expect(await rawSync(token, { 'content-type': 'application/json' }, json)).toBe(200);
    const before = users.sync.mock.calls.length;
    expect(await rawSync(token, { 'content-type': 'application/json' }, json + ' ')).toBe(413);
    expect(await rawSync(token, { 'content-type': 'text/plain' }, 'x'.repeat(limit))).toBe(400);
    expect(await rawSync(token, { 'content-type': 'text/plain' }, 'x'.repeat(limit + 1))).toBe(413);
    expect(users.sync.mock.calls.length).toBe(before);
  });

  it('reads the provisioned profile without invoking synchronization', async () => {
    const before = users.sync.mock.calls.length;
    const response = await me(fixture.token()).expect(200);
    expect(response.body).toEqual({ data: profile });
    expect(users.requireBySub).toHaveBeenCalledWith('verified-user');
    expect(users.sync.mock.calls.length).toBe(before);
  });
  it('enforces employee/admin roles and authentication before authorization', async () => {
    await me().expect(401);
    await me(fixture.token(), 'admin').expect(403);
    const admin = fixture.token({ resource_access: { 'meeting-room-api': { roles: ['admin'] } } });
    await me(admin).expect(200);
    await me(admin, 'admin').expect(200);
    await request(app.getHttpServer()).get('/api/v1/identity-probe').expect(401);
    await request(app.getHttpServer()).get('/api/v1/identity-probe/public').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
  it.each([
    ['no roles', undefined],
    ['other client', { another: { roles: ['admin'] } }],
    ['malformed role container', 'admin'],
    ['malformed role list', { 'meeting-room-api': { roles: [7, 'admin'] } }],
  ])('rejects %s without producing 500', async (_label, resource_access) => {
    await me(fixture.token({ resource_access })).expect(403);
  });
  it.each([
    ['expired', { exp: 1 }],
    ['future nbf', { nbf: Math.floor(Date.now() / 1000) + 600 }],
    ['no exp', { exp: undefined }],
    ['empty sub', { sub: '' }],
    ['invalid sub', { sub: 12 }],
    ['ID token', { typ: 'ID' }],
    ['refresh token', { typ: 'Refresh' }],
  ])('rejects %s token', async (_label, payload) => {
    await me(fixture.token(payload)).expect(401);
  });
  it('rejects wrong issuer, audience, signature, algorithm, kid and malformed bearer', async () => {
    await me(fixture.token({}, { issuer: 'http://wrong.example/realms/test' })).expect(401);
    await me(fixture.token({}, { audience: 'other-api' })).expect(401);
    await me(fixture.token({}, { keyid: 'first' }, true)).expect(401);
    await me(fixture.token({}, { keyid: '' })).expect(401);
    await me(
      sign({ sub: 'user', typ: 'Bearer' }, 'shared-secret', {
        algorithm: 'HS256',
        keyid: 'first',
        expiresIn: '5m',
      }),
    ).expect(401);
    await me('not-a-jwt').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/client/users/me')
      .set('Authorization', 'Basic bad')
      .expect(401);
    await me(fixture.token({}, { keyid: 'unknown' })).expect(401);
  });
  it('maps optional profile fields and preserves null values', async () => {
    await sync(
      fixture.token({ name: undefined, preferred_username: 'fallback', email: 12 }),
    ).expect(200);
    expect(users.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayName: 'fallback', email: null }),
    );
    await sync(
      fixture.token({ name: undefined, preferred_username: undefined, email: undefined }),
    ).expect(200);
    expect(users.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayName: null, email: null }),
    );
  });
  it('accepts only verified claims and an empty sync body', async () => {
    await sync(fixture.token()).expect(200);
    expect(users.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ sub: 'verified-user', issuedAt: expect.any(Number) }),
    );
    for (const body of [{ sub: 'attacker' }, { email: 'fake' }, { roles: ['admin'] }, []]) {
      const before = users.sync.mock.calls.length;
      await sync(fixture.token(), body).expect(400);
      expect(users.sync.mock.calls.length).toBe(before);
    }
    await sync(fixture.token(), {}).expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/client/users/sync')
      .set('Authorization', `Bearer ${fixture.token()}`)
      .set('Content-Type', 'text/plain')
      .send('unexpected')
      .expect(400);
    await sync(fixture.token({ resource_access: {} })).expect(403);
    await sync(
      fixture.token({ resource_access: { 'meeting-room-api': { roles: ['admin'] } } }),
    ).expect(200);
    await request(app.getHttpServer()).post('/api/v1/admin/users/sync').expect(404);
  });
  it('publishes isolated Swagger documents, client IDs and callback routes', async () => {
    for (const zone of ['client', 'admin']) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/docs/${zone}/openapi.json`)
        .expect(200);
      expect(Object.keys(response.body.paths)).toEqual(
        zone === 'client'
          ? ['/api/v1/client/users/me', '/api/v1/client/users/sync']
          : ['/api/v1/admin/users/me'],
      );
      expect(response.body.components.securitySchemes.oauth2.flows.authorizationCode).toBeDefined();
      const setup = await request(app.getHttpServer())
        .get(`/api/v1/docs/${zone}/swagger-ui-init.js`)
        .expect(200);
      expect(setup.text).toContain(`meeting-room-${zone}`);
      expect(setup.text).toContain('usePkceWithAuthorizationCodeGrant');
      await request(app.getHttpServer())
        .get(`/api/v1/docs/${zone}/oauth2-redirect.html`)
        .expect(200);
    }
    await request(app.getHttpServer()).get('/api/v1/docs').expect(200);
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(404);
  });
  it('refreshes JWKS for a new kid and keeps cached keys when JWKS fails', async () => {
    fixture.rotate();
    await me(fixture.token({}, {}, true)).expect(200);
    const before = fixture.requests();
    fixture.unavailable();
    await me(fixture.token()).expect(200);
    expect(fixture.requests()).toBe(before);
    const failure = await me(fixture.token({}, { keyid: 'new-key-while-offline' })).expect(503);
    expect(failure.body.error).toEqual({
      code: 'HTTP_503',
      message: 'Identity provider is unavailable',
      details: [],
    });
  });
});
