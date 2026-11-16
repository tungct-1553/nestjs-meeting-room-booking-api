import type { User } from '../public/user';
export const USER_READ_REPOSITORY = Symbol('USER_READ_REPOSITORY');
export const USER_SYNC_REPOSITORY = Symbol('USER_SYNC_REPOSITORY');
export interface UserReadRepositoryPort { findBySub(sub: string): Promise<User | null>; }
export interface ProfileSyncInput { sub: string; email: string | null; displayName: string | null; issuedAt: number; }
export interface UserSyncRepositoryPort { sync(input: ProfileSyncInput): Promise<User>; }
