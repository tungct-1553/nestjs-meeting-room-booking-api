import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';
import { RAW_RESPONSE } from '../decorators/raw-response.decorator';
import { PaginatedResponse } from '../types/paginated-response';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);
    return next.handle().pipe(
      map((value: unknown) => {
        if (
          raw ||
          context.switchToHttp().getResponse<{ statusCode: number }>().statusCode === 204
        ) {
          return value;
        }
        if (value instanceof PaginatedResponse) {
          return { data: value.data, meta: value.meta };
        }
        return { data: value };
      }),
    );
  }
}
