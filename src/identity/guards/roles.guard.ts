import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { REQUIRED_ROLES } from '../decorators/roles.decorator';
import type { Principal, Role } from '../public/principal';
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const principal = context.switchToHttp().getRequest<{ user?: Principal }>().user;
    if (required.some(role => principal?.roles.includes(role) || (role === 'employee' && principal?.roles.includes('admin')))) return true;
    throw new ForbiddenException('Insufficient permissions');
  }
}
