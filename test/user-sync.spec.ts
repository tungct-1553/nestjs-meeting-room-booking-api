import type { DataSource } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { UsersService } from '../src/users/application/users.service';
import { TypeormUserRepository } from '../src/users/infrastructure/typeorm-user.repository';
import {
  InvalidProfileTokenError,
  ProfileSyncUnavailableError,
  UserNotProvisionedError,
} from '../src/users/application/errors/user.errors';

const principal = { sub: 'subject', email: null, displayName: null, roles: ['employee' as const] };
describe('User provisioning boundaries', () => {
  const reader = { findBySub: jest.fn() };
  const writer = { upsertIfNewer: jest.fn() };
  const service = new UsersService(reader, writer);
  beforeEach(() => jest.clearAllMocks());
  it('requires explicit provisioning and never writes from read lookup', async () => {
    reader.findBySub.mockResolvedValue(null);
    await expect(service.requireBySub('missing')).rejects.toBeInstanceOf(UserNotProvisionedError);
    expect(writer.upsertIfNewer).not.toHaveBeenCalled();
  });
  it.each([undefined, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid issued-at %s before persistence',
    async (issuedAt) => {
      expect(() => service.sync({ ...principal, issuedAt })).toThrow(InvalidProfileTokenError);
      expect(writer.upsertIfNewer).not.toHaveBeenCalled();
    },
  );
  it('retains fractional NumericDate precision', async () => {
    writer.upsertIfNewer.mockResolvedValue({ id: 'id', email: null, displayName: null });
    await service.sync({ ...principal, issuedAt: 1700000000.5 });
    expect(writer.upsertIfNewer).toHaveBeenCalledWith({
      sub: 'subject',
      email: null,
      displayName: null,
      issuedAt: 1700000000.5,
    });
  });
  it.each(['ECONNREFUSED', 'ECONNRESET', '08006', '57P01', '53300'])(
    'classifies database availability %s as retryable',
    async (code) => {
      const error = new QueryFailedError(
        'sensitive query',
        [],
        Object.assign(new Error('database unavailable'), { code }),
      );
      const source = { transaction: jest.fn().mockRejectedValue(error) } as unknown as DataSource;
      await expect(
        new TypeormUserRepository(source).upsertIfNewer({ ...principal, issuedAt: 1 }),
      ).rejects.toBeInstanceOf(ProfileSyncUnavailableError);
    },
  );
  it.each(['23502', '42P01'])('keeps SQL/data defects %s as unexpected errors', async (code) => {
    const error = new QueryFailedError('query', [], Object.assign(new Error('defect'), { code }));
    const source = { transaction: jest.fn().mockRejectedValue(error) } as unknown as DataSource;
    await expect(
      new TypeormUserRepository(source).upsertIfNewer({ ...principal, issuedAt: 1 }),
    ).rejects.toBe(error);
  });
});
