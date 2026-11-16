import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '../identity/public/principal';
import { USER_READ_REPOSITORY, USER_SYNC_REPOSITORY } from './ports/user-repository.port';
import type { UserReadRepositoryPort, UserSyncRepositoryPort } from './ports/user-repository.port';
import { InvalidProfileTokenError, UserNotProvisionedError } from './errors/user.errors';
@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_READ_REPOSITORY) private readonly reader: UserReadRepositoryPort,
    @Inject(USER_SYNC_REPOSITORY) private readonly writer: UserSyncRepositoryPort,
  ) {}
  findBySub(sub: string) { return this.reader.findBySub(sub); }
  async requireBySub(sub: string) {
    const user = await this.findBySub(sub);
    if (!user) throw new UserNotProvisionedError();
    return user;
  }
  sync(principal: Principal) {
    const issuedAt = principal.issuedAt;
    if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt) || issuedAt < 0 || issuedAt > Number.MAX_SAFE_INTEGER) throw new InvalidProfileTokenError();
    return this.writer.sync({ sub: principal.sub, email: principal.email, displayName: principal.displayName, issuedAt });
  }
}
