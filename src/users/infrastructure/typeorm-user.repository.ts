import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Principal } from '../../identity/public/principal';
import type { UserRepositoryPort } from '../ports/user-repository.port';
import type { User } from '../public/user';
import { UserEntity } from './user.entity';
@Injectable()
export class TypeormUserRepository implements UserRepositoryPort {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}
  async getOrSync(principal: Principal): Promise<User> {
    const result = await this.source.getRepository(UserEntity).createQueryBuilder().insert().values({
      keycloakSub: principal.sub, email: principal.email, displayName: principal.displayName,
    }).orUpdate(['email', 'display_name'], ['keycloak_sub']).returning(['id', 'email', 'displayName']).execute();
    const row = result.raw[0] as { id: string; email: string | null; display_name: string | null };
    return { id: row.id, email: row.email, displayName: row.display_name };
  }
}
