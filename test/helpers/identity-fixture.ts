import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SignOptions } from 'jsonwebtoken';
import { sign } from 'jsonwebtoken';

export async function createIdentityFixture() {
  const first = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const second = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = (key: typeof first, kid: string) => ({
    ...key.publicKey.export({ format: 'jwk' }),
    kid,
    use: 'sig',
    alg: 'RS256',
  });
  let keys = [jwk(first, 'first')];
  let unavailable = false;
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    if (unavailable) {
      response.writeHead(503).end();
      return;
    }
    if (request.url !== '/realms/test/protocol/openid-connect/certs') {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/test`;
  const token = (
    overrides: Record<string, unknown> = {},
    options: SignOptions = {},
    secondKey = false,
  ) =>
    sign(
      Object.fromEntries(
        Object.entries({
          sub: 'verified-user',
          typ: 'Bearer',
          exp: Math.floor(Date.now() / 1000) + 300,
          name: 'Verified User',
          email: 'verified@example.test',
          resource_access: { 'meeting-room-api': { roles: ['employee'] } },
          ...overrides,
        }).filter(([, value]) => value !== undefined),
      ),
      secondKey ? second.privateKey : first.privateKey,
      {
        algorithm: 'RS256',
        keyid: secondKey ? 'second' : 'first',
        issuer,
        audience: 'meeting-room-api',
        ...options,
      },
    );
  const config = {
    get: <T>(name: string): T =>
      (
        ({
          KEYCLOAK_ISSUER: issuer,
          API_CLIENT_ID: 'meeting-room-api',
          PORT: 3000,
          CORS_ORIGINS: [],
        }) as Record<string, unknown>
      )[name] as T,
    getOrThrow: <T>(name: string): T => config.get<T>(name),
  };
  return {
    issuer,
    config,
    token,
    requests: () => requests,
    rotate: () => {
      keys = [jwk(first, 'first'), jwk(second, 'second')];
    },
    unavailable: () => {
      unavailable = true;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
