import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import type { ProfileSyncInput, UserReadRepositoryPort, UserSyncRepositoryPort } from '../ports/user-repository.port';
import type { User } from '../public/user';
import { ProfileSyncUnavailableError } from '../errors/user.errors';
import { UserEntity } from './user.entity';

const connectionCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', '53300', '53400', '57P01', '57P02', '57P03']);
function isConnectionFailure(error: unknown): boolean {
  const cause = error instanceof QueryFailedError ? error.driverError : error;
  if (!(cause instanceof Error)) return false;
  const code = (cause as Error & { code?: string }).code;
  return typeof code === 'string' && (code.startsWith('08') || connectionCodes.has(code))
    || ['Connection terminated unexpectedly', 'Connection terminated', 'timeout exceeded when trying to connect'].includes(cause.message);
}
@Injectable()
export class TypeormUserRepository implements UserReadRepositoryPort, UserSyncRepositoryPort {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}
  async findBySub(sub: string): Promise<User | null> {
    const row = await this.source.getRepository(UserEntity).findOne({ where: { keycloakSub: sub } });
    return row ? { id: row.id, email: row.email, displayName: row.displayName } : null;
  }
  async sync(input: ProfileSyncInput): Promise<User> {
    try {
      return await this.source.transaction('READ COMMITTED', async (manager) => {
        const rows = await manager.query(`INSERT INTO users (keycloak_sub, email, display_name, profile_token_iat)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (keycloak_sub) DO UPDATE SET email = EXCLUDED.email,
            display_name = EXCLUDED.display_name, profile_token_iat = EXCLUDED.profile_token_iat, updated_at = now()
          WHERE users.profile_token_iat IS NULL OR users.profile_token_iat < EXCLUDED.profile_token_iat
          RETURNING id, email, display_name`, [input.sub, input.email, input.displayName, input.issuedAt]);
        // A skipped conflict still holds the row lock until this transaction ends.
        // READ COMMITTED gives the next SELECT a fresh snapshot after a concurrent insert.
        const row = rows[0] ?? (await manager.query('SELECT id, email, display_name FROM users WHERE keycloak_sub = $1', [input.sub]))[0];
        if (!row) throw new Error('Profile disappeared during synchronization');
        return { id: row.id, email: row.email, displayName: row.display_name };
      });
    } catch (error) {
      if (isConnectionFailure(error)) throw new ProfileSyncUnavailableError();
      throw error;
    }
  }
}
