import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../public/http/public.decorator';
import { REQUIRED_ROLES } from '../public/http/roles.decorator';
import type { Principal, Role } from '../public/principal';

function hasRequiredRole(principal: Principal | undefined, required: Role[]): boolean {
  const granted = new Set(principal?.roles ?? []);
  return required.some(
    (role) => granted.has(role) || (role === 'employee' && granted.has('admin')),
  );
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }
    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, targets);
    if (!required?.length) {
      return true;
    }
    const principal = context.switchToHttp().getRequest<{ user?: Principal }>().user;
    if (hasRequiredRole(principal, required)) {
      return true;
    }
    throw new ForbiddenException('Insufficient permissions');
  }
}
