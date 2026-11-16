import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Principal } from '../public/principal';
export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => context.switchToHttp().getRequest<{ user: Principal }>().user);
