import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

export function configureSwagger(app: INestApplication): void {
  const config = app.get(ConfigService);
  const issuer = config.getOrThrow<string>('KEYCLOAK_ISSUER');
  const documentConfig = new DocumentBuilder()
    .setTitle('Meeting Room Booking API')
    .setVersion('1')
    .addBearerAuth()
    .addOAuth2({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: `${issuer}/protocol/openid-connect/auth`,
          tokenUrl: `${issuer}/protocol/openid-connect/token`,
          scopes: { openid: 'OpenID Connect', profile: 'Profile', email: 'Email' },
        },
      },
    })
    .build();
  const document = SwaggerModule.createDocument(app, documentConfig);

  for (const zone of ['client', 'admin'] as const) {
    const filtered: OpenAPIObject = structuredClone(document);
    filtered.info.title = `${zone === 'client' ? 'Client' : 'Admin'} API`;
    filtered.paths = Object.fromEntries(
      Object.entries(filtered.paths).filter(([path]) => path.startsWith(`/api/v1/${zone}/`)),
    );
    SwaggerModule.setup(`api/v1/docs/${zone}`, app, filtered, {
      swaggerOptions: {
        oauth2RedirectUrl: `http://localhost:${config.getOrThrow<number>('PORT')}/api/v1/docs/${zone}/oauth2-redirect.html`,
        persistAuthorization: false,
        initOAuth: {
          clientId: `meeting-room-${zone}`,
          scopes: ['openid', 'profile', 'email'],
          usePkceWithAuthorizationCodeGrant: true,
        },
      },
      jsonDocumentUrl: `/api/v1/docs/${zone}/openapi.json`,
    });
  }

  app.getHttpAdapter().get(
    '/api/v1/docs',
    (
      _request: unknown,
      response: {
        type: (type: string) => { send: (body: string) => void };
      },
    ) =>
      response
        .type('html')
        .send(
          '<!doctype html><html><head><title>API documentation</title></head><body><h1>API documentation</h1><ul><li><a href="/api/v1/docs/client">Client API</a></li><li><a href="/api/v1/docs/admin">Admin API</a></li></ul></body></html>',
        ),
  );
}
