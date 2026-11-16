import { ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC } from '../decorators/public.decorator';
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) { super(); }
  canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    return super.canActivate(context);
  }
  handleRequest<TUser>(error: unknown, user: TUser, info: unknown): TUser {
    if (error instanceof ServiceUnavailableException || info instanceof ServiceUnavailableException) throw new ServiceUnavailableException('Identity provider is unavailable');
    if (error || !user) throw new UnauthorizedException('Invalid or missing access token');
    return user;
  }
}
