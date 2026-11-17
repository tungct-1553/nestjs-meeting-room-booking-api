import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { ApiExceptionFilter } from './common/http/filters/api-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/http/interceptors/response-envelope.interceptor';
import { requestLogging } from './common/http/logger/request-logging.middleware';
import {
  BODY_LIMIT_BYTES,
  capturePayloadSize,
  parsePayload,
} from './common/http/middleware/payload-capture.middleware';
import { configureSwagger } from './http/swagger';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.use(requestLogging);
  app.getHttpAdapter().enableCors({ origin: config.get<string[]>('CORS_ORIGINS') ?? [] });
  app.use(parsePayload(json({ limit: BODY_LIMIT_BYTES, verify: capturePayloadSize })));
  app.use(
    parsePayload(
      urlencoded({ extended: true, limit: BODY_LIMIT_BYTES, verify: capturePayloadSize }),
    ),
  );
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));
  configureSwagger(app);
}
