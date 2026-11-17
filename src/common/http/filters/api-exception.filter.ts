import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApplicationError } from '../../application/application.error';
import type { ApplicationErrorKind } from '../../application/application.error';

const statusByKind: Record<ApplicationErrorKind, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
};

function sqlState(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const diagnostic = error as Error & { code?: unknown; driverError?: unknown };
  if (typeof diagnostic.code === 'string' && /^[0-9A-Z]{5}$/.test(diagnostic.code)) {
    return diagnostic.code;
  }

  if (diagnostic.driverError instanceof Error) {
    const code = (diagnostic.driverError as Error & { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return code;
    }
  }

  return undefined;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    let status = 500;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: string[] = [];

    if (exception instanceof ApplicationError) {
      status = statusByKind[exception.kind];
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = `HTTP_${status}`;
      const body = exception.getResponse();
      const bodyMessage =
        typeof body === 'object' && body !== null && 'message' in body ? body.message : body;
      if (Array.isArray(bodyMessage)) {
        message = 'Validation failed';
        details = bodyMessage.map(String);
      } else if (typeof bodyMessage === 'string') {
        message = bodyMessage;
      }
    }

    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    if (status >= 500) {
      const request = http.getRequest<Request>();
      const cause = exception instanceof Error ? exception.cause : undefined;
      this.logger.error({
        requestId: response.getHeader('x-request-id'),
        operation: request.method,
        status,
        code,
        errorClass: exception instanceof Error ? exception.name : 'UnknownError',
        sqlState: sqlState(exception) ?? sqlState(cause),
      });
    }
    response.status(status).json({ error: { code, message, details } });
  }
}
