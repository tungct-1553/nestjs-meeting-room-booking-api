import { Controller, Get, Logger, Param } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApplicationError } from '../src/common/application/application.error';
import type { ApplicationErrorKind } from '../src/common/application/application.error';
import { ApiExceptionFilter } from '../src/common/http/filters/api-exception.filter';

const statuses: Record<ApplicationErrorKind, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
};
const errors = new Map<string, Error>(
  Object.keys(statuses).map((kind) => [
    kind,
    new ApplicationError(
      `NEW_FEATURE_${kind}`,
      kind as ApplicationErrorKind,
      'Safe public message',
      {
        cause: Object.assign(new Error('private password and SQL'), { code: '08006' }),
      },
    ),
  ]),
);

@Controller('errors')
class ErrorProbe {
  @Get(':kind')
  fail(@Param('kind') kind: string): never {
    throw errors.get(kind) ?? new Error('private unexpected SQL and password');
  }
}

describe('Application error HTTP boundary', () => {
  let app: INestApplication;
  const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [ErrorProbe] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    log.mockRestore();
  });

  it.each(Object.entries(statuses))(
    'maps %s without registering a feature code',
    async (kind, status) => {
      const response = await request(app.getHttpServer()).get(`/errors/${kind}`).expect(status);
      expect(response.body).toEqual({
        error: { code: `NEW_FEATURE_${kind}`, message: 'Safe public message', details: [] },
      });
      expect(JSON.stringify(response.body)).not.toContain('private');
    },
  );

  it('retains safe cause diagnostics while keeping private error data out of logs', async () => {
    await request(app.getHttpServer()).get('/errors/unavailable').expect(503);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'GET',
        errorClass: 'ApplicationError',
        sqlState: '08006',
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
  });

  it('sanitizes unexpected failures', async () => {
    const response = await request(app.getHttpServer()).get('/errors/unexpected').expect(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        details: [],
      },
    });
  });
});
