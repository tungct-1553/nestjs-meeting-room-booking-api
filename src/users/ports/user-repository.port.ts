import type { Principal } from '../../identity/public/principal';
import type { User } from '../public/user';
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export interface UserRepositoryPort { getOrSync(principal: Principal): Promise<User>; }
