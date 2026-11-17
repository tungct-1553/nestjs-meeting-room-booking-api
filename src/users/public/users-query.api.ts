import type { User } from './user';

export const USERS_QUERY_API = Symbol('USERS_QUERY_API');

export interface UsersQueryApi {
  /** Only reads an existing profile; fails with USER_NOT_PROVISIONED if absent. */
  requireBySub(sub: string): Promise<User>;
}
