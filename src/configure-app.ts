import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { requestLogging } from './common/logger/request-logging.middleware';
import { ClientUserResponseDto } from './users/presentation/client/user-response.dto';
import { AdminUserResponseDto } from './users/presentation/admin/user-response.dto';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.use(requestLogging);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.get<string[]>('CORS_ORIGINS') ?? [] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));
  const issuer = config.getOrThrow<string>('KEYCLOAK_ISSUER');
  const documentConfig = new DocumentBuilder().setTitle('Meeting Room Booking API').setVersion('1').addBearerAuth().addOAuth2({
    type: 'oauth2', flows: { authorizationCode: { authorizationUrl: `${issuer}/protocol/openid-connect/auth`, tokenUrl: `${issuer}/protocol/openid-connect/token`, scopes: { openid: 'OpenID Connect', profile: 'Profile', email: 'Email' } } },
  }).build();
  const document = SwaggerModule.createDocument(app, documentConfig, { extraModels: [ClientUserResponseDto, AdminUserResponseDto] });
  for (const zone of ['client', 'admin'] as const) {
    const filtered = structuredClone(document) as OpenAPIObject;
    filtered.info.title = `${zone === 'client' ? 'Client' : 'Admin'} API`;
    filtered.paths = Object.fromEntries(Object.entries(filtered.paths).filter(([path]) => path.startsWith(`/api/v1/${zone}/`)));
    for (const path of Object.values(filtered.paths)) for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) if (path[method]) path[method]!.security = [{ bearer: [] }, { oauth2: ['openid', 'profile', 'email'] }];
    SwaggerModule.setup(`api/v1/docs/${zone}`, app, filtered, {
      swaggerOptions: { oauth2RedirectUrl: `http://localhost:${config.getOrThrow<number>('PORT')}/api/v1/docs/${zone}/oauth2-redirect.html`, persistAuthorization: false, initOAuth: { clientId: `meeting-room-${zone}`, scopes: ['openid', 'profile', 'email'], usePkceWithAuthorizationCodeGrant: true } },
      jsonDocumentUrl: `/api/v1/docs/${zone}/openapi.json`,
    });
  }
  app.getHttpAdapter().get('/api/v1/docs', (_request: unknown, response: { type: (type: string) => { send: (body: string) => void } }) => response.type('html').send('<!doctype html><html><head><title>API documentation</title></head><body><h1>API documentation</h1><ul><li><a href="/api/v1/docs/client">Client API</a></li><li><a href="/api/v1/docs/admin">Admin API</a></li></ul></body></html>'));
}
