import { Inject, Injectable } from '@nestjs/common';
import { isValidNumericDate } from '../../common/validation/numeric-date';
import type { User } from '../public/user';
import type { UsersQueryApi } from '../public/users-query.api';
import { USER_READ_REPOSITORY, USER_SYNC_REPOSITORY } from './ports/user-repository.port';
import type { UserReadRepositoryPort, UserSyncRepositoryPort } from './ports/user-repository.port';
import { InvalidProfileTokenError, UserNotProvisionedError } from './errors/user.errors';
import type { SyncUserInput } from './inputs/sync-user.input';

@Injectable()
export class UsersService implements UsersQueryApi {
  constructor(
    @Inject(USER_READ_REPOSITORY) private readonly reader: UserReadRepositoryPort,
    @Inject(USER_SYNC_REPOSITORY) private readonly writer: UserSyncRepositoryPort,
  ) {}

  findBySub(sub: string): Promise<User | null> {
    return this.reader.findBySub(sub);
  }

  async requireBySub(sub: string): Promise<User> {
    const user = await this.findBySub(sub);
    if (user === null) {
      throw new UserNotProvisionedError();
    }
    return user;
  }

  sync(input: SyncUserInput): Promise<User> {
    const issuedAt = input.issuedAt;
    if (!isValidNumericDate(issuedAt)) {
      throw new InvalidProfileTokenError();
    }
    return this.writer.upsertIfNewer({
      sub: input.sub,
      email: input.email,
      displayName: input.displayName,
      issuedAt,
    });
  }
}
