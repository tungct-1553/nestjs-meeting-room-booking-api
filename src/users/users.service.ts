import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '../identity/public/principal';
import { USER_REPOSITORY } from './ports/user-repository.port';
import type { UserRepositoryPort } from './ports/user-repository.port';
@Injectable()
export class UsersService {
  constructor(@Inject(USER_REPOSITORY) private readonly repository: UserRepositoryPort) {}
  getOrSync(principal: Principal) { return this.repository.getOrSync(principal); }
}
