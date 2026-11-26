import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IdentityModule } from '../src/identity/identity.module';
import { JwtStrategy } from '../src/identity/jwt.strategy';

const fixtureOptions = {
  issuer: 'https://identity.example.test/realms/async',
  apiClientId: 'async-api',
};
const FIXTURE_OPTIONS = Symbol('FIXTURE_OPTIONS');

@Module({
  providers: [{ provide: FIXTURE_OPTIONS, useValue: fixtureOptions }],
  exports: [FIXTURE_OPTIONS],
})
class FixtureOptionsModule {}

describe('IdentityModule configuration', () => {
  it.each([
    [
      'register',
      IdentityModule.register({
        issuer: 'https://identity.example.test/realms/sync',
        apiClientId: 'sync-api',
      }),
      ['employee'],
    ],
    [
      'registerAsync',
      IdentityModule.registerAsync({
        imports: [FixtureOptionsModule],
        inject: [FIXTURE_OPTIONS],
        useFactory: (options: typeof fixtureOptions) => Promise.resolve(options),
      }),
      ['admin'],
    ],
  ] as const)('resolves its own client roles with %s', async (_method, registration, roles) => {
    const module = await Test.createTestingModule({ imports: [registration] }).compile();
    try {
      const strategy = module.get(JwtStrategy);
      expect(
        strategy.validate({
          sub: 'standalone-user',
          exp: 2_000_000_000,
          typ: 'Bearer',
          resource_access: {
            'sync-api': { roles: ['employee'] },
            'async-api': { roles: ['admin'] },
          },
        }).roles,
      ).toEqual(roles);
    } finally {
      await module.close();
    }
  });
});
