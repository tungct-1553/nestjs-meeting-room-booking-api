import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { UsersService } from '../src/users/users.service';
import { Roles } from '../src/identity/decorators/roles.decorator';
import { Public } from '../src/identity/decorators/public.decorator';
import { createIdentityFixture } from './helpers/identity-fixture';

@Roles('admin')
@Controller('identity-probe')
class IdentityProbe {
  @Get() secured() { return 'admin'; }
  @Public() @Get('public') public() { return 'public'; }
}

describe('Identity HTTP with signed JWT and JWKS', () => {
  let app: INestApplication;
  let fixture: Awaited<ReturnType<typeof createIdentityFixture>>;
  const profile = { id: 'local-uuid', email: 'verified@example.test', displayName: 'Verified User' };
  const users = { getOrSync: jest.fn().mockResolvedValue(profile) };
  beforeAll(async () => {
    fixture = await createIdentityFixture();
    const module = await Test.createTestingModule({ imports: [AppModule], controllers: [IdentityProbe] })
      .overrideProvider(DataSource).useValue({ isInitialized: false, query: jest.fn().mockResolvedValue([]) })
      .overrideProvider(ConfigService).useValue(fixture.config)
      .overrideProvider(UsersService).useValue(users).compile();
    app = module.createNestApplication({ logger: false }); configureApp(app); await app.init();
  });
  afterAll(async () => { if (app) await app.close(); if (fixture) await fixture.close(); });
  const me = (token?: string, zone = 'client') => {
    const call = request(app.getHttpServer()).get(`/api/v1/${zone}/users/me`);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };
  it('authenticates employee, maps profile and syncs only verified identity', async () => {
    const response = await me(fixture.token()).expect(200);
    expect(response.body).toEqual({ data: profile });
    expect(users.getOrSync).toHaveBeenCalledWith({ sub: 'verified-user', email: profile.email, displayName: profile.displayName, roles: ['employee'] });
  });
  it('enforces employee/admin roles and authentication before authorization', async () => {
    await me().expect(401);
    await me(fixture.token(), 'admin').expect(403);
    const admin = fixture.token({ resource_access: { 'meeting-room-api': { roles: ['admin'] } } });
    await me(admin).expect(200); await me(admin, 'admin').expect(200);
    await request(app.getHttpServer()).get('/api/v1/identity-probe').expect(401);
    await request(app.getHttpServer()).get('/api/v1/identity-probe/public').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
  it.each([
    ['no roles', undefined], ['other client', { another: { roles: ['admin'] } }],
    ['malformed role container', 'admin'], ['malformed role list', { 'meeting-room-api': { roles: [7, 'admin'] } }],
  ])('rejects %s without producing 500', async (_label, resource_access) => {
    await me(fixture.token({ resource_access })).expect(403);
  });
  it.each([
    ['expired', { exp: 1 }], ['future nbf', { nbf: Math.floor(Date.now()/1000)+600 }], ['no exp', { exp: undefined }],
    ['empty sub', { sub: '' }], ['invalid sub', { sub: 12 }], ['ID token', { typ: 'ID' }], ['refresh token', { typ: 'Refresh' }],
  ])('rejects %s token', async (_label, payload) => { await me(fixture.token(payload)).expect(401); });
  it('rejects wrong issuer, audience, signature, algorithm, kid and malformed bearer', async () => {
    await me(fixture.token({}, { issuer: 'http://wrong.example/realms/test' })).expect(401);
    await me(fixture.token({}, { audience: 'other-api' })).expect(401);
    await me(fixture.token({}, { keyid: 'first' }, true)).expect(401);
    await me(fixture.token({}, { keyid: '' })).expect(401);
    await me(sign({ sub: 'user', typ: 'Bearer' }, 'shared-secret', { algorithm: 'HS256', keyid: 'first', expiresIn: '5m' })).expect(401);
    await me('not-a-jwt').expect(401);
    await request(app.getHttpServer()).get('/api/v1/client/users/me').set('Authorization', 'Basic bad').expect(401);
    await me(fixture.token({}, { keyid: 'unknown' })).expect(401);
  });
  it('maps optional profile fields and preserves null values', async () => {
    await me(fixture.token({ name: undefined, preferred_username: 'fallback', email: 12 })).expect(200);
    expect(users.getOrSync).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: 'fallback', email: null }));
    await me(fixture.token({ name: undefined, preferred_username: undefined, email: undefined })).expect(200);
    expect(users.getOrSync).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: null, email: null }));
  });
  it('publishes isolated Swagger documents, client IDs and callback routes', async () => {
    for (const zone of ['client', 'admin']) {
      const response = await request(app.getHttpServer()).get(`/api/v1/docs/${zone}/openapi.json`).expect(200);
      expect(Object.keys(response.body.paths)).toEqual([`/api/v1/${zone}/users/me`]);
      expect(response.body.components.securitySchemes.oauth2.flows.authorizationCode).toBeDefined();
      const setup = await request(app.getHttpServer()).get(`/api/v1/docs/${zone}/swagger-ui-init.js`).expect(200);
      expect(setup.text).toContain(`meeting-room-${zone}`);
      expect(setup.text).toContain('usePkceWithAuthorizationCodeGrant');
      await request(app.getHttpServer()).get(`/api/v1/docs/${zone}/oauth2-redirect.html`).expect(200);
    }
    await request(app.getHttpServer()).get('/api/v1/docs').expect(200);
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(404);
  });
  it('refreshes JWKS for a new kid and keeps cached keys when JWKS fails', async () => {
    fixture.rotate(); await me(fixture.token({}, {}, true)).expect(200);
    const before = fixture.requests(); fixture.unavailable();
    await me(fixture.token()).expect(200); expect(fixture.requests()).toBe(before);
    const failure = await me(fixture.token({}, { keyid: 'new-key-while-offline' })).expect(503);
    expect(failure.body.error).toEqual({ code: 'HTTP_503', message: 'Identity provider is unavailable', details: [] });
  });
});
