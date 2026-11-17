import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Observable } from 'rxjs';
import { IS_PUBLIC } from '../public/http/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser>(error: unknown, user: TUser, info: unknown): TUser {
    const providerUnavailable =
      error instanceof ServiceUnavailableException || info instanceof ServiceUnavailableException;
    if (providerUnavailable) {
      throw new ServiceUnavailableException('Identity provider is unavailable');
    }
    if (error || !user) {
      throw new UnauthorizedException('Invalid or missing access token');
    }
    return user;
  }
}
