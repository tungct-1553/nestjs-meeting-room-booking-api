import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { getPayloadSize } from '../middleware/payload-capture.middleware';

type PayloadRequest = Request<Record<string, string>, unknown, unknown>;

@Injectable()
export class EmptyBodyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<PayloadRequest>();
    const size = getPayloadSize(request);
    if (size === undefined) {
      throw new InternalServerErrorException('Payload validation is unavailable');
    }
    if (size === 0) {
      return next.handle();
    }

    const body = request.body;
    const isEmptyJsonObject =
      request.is('application/json') &&
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0;

    if (!isEmptyJsonObject) {
      throw new BadRequestException('Request body must be empty');
    }

    return next.handle();
  }
}
