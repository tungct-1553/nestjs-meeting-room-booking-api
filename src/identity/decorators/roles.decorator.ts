import { SetMetadata } from '@nestjs/common';
import type { Role } from '../public/principal';
export const REQUIRED_ROLES = 'identity:roles';
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);
