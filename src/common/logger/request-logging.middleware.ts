import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
const logger = new Logger('HTTP');
export function requestLogging(request: Request, response: Response, next: NextFunction): void {
  const provided = request.get('x-request-id');
  const requestId = provided && /^[A-Za-z0-9._-]{1,128}$/.test(provided) ? provided : randomUUID();
  response.setHeader('x-request-id', requestId);
  const started = performance.now();
  response.once('finish', () => logger.log({ requestId, method: request.method, status: response.statusCode, durationMs: Math.round(performance.now() - started) }));
  next();
}
