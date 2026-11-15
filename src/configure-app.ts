import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { requestLogging } from './common/logger/request-logging.middleware';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.use(requestLogging);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.get<string[]>('CORS_ORIGINS') ?? [] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));
  const swaggerConfig = new DocumentBuilder().setTitle('Meeting Room Booking API').setVersion('1').addBearerAuth().build();
  SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
}
