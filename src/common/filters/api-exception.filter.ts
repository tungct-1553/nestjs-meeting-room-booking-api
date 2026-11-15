import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ApplicationError } from '../errors/application.error';

const applicationStatus: Record<string, number> = {
  ROOM_UNAVAILABLE: 404,
  ROOM_NOT_FOUND: 404,
  BOOKING_TIME_CONFLICT: 409,
  INVALID_BOOKING_TIME: 400,
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    let status = 500;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: string[] = [];
    if (exception instanceof ApplicationError && applicationStatus[exception.code]) {
      status = applicationStatus[exception.code];
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = `HTTP_${status}`;
      const body = exception.getResponse();
      const bodyMessage = typeof body === 'object' && body !== null && 'message' in body ? body.message : body;
      if (Array.isArray(bodyMessage)) {
        message = 'Validation failed';
        details = bodyMessage.map(String);
      } else if (typeof bodyMessage === 'string') message = bodyMessage;
    }
    const response = host.switchToHttp().getResponse<Response>();
    if (status >= 500) this.logger.error({ requestId: response.getHeader('x-request-id'), status, code });
    response.status(status).json({ error: { code, message, details } });
  }
}
