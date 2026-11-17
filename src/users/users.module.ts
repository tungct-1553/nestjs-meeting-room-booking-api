import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { captureUnparsedPayload } from '../common/http/middleware/payload-capture.middleware';
import { ClientUsersController } from './presentation/client/users.controller';
import { AdminUsersController } from './presentation/admin/users.controller';
import { DatabaseModule } from '../database/database.module';
import {
  USER_READ_REPOSITORY,
  USER_SYNC_REPOSITORY,
} from './application/ports/user-repository.port';
import { TypeormUserRepository } from './infrastructure/typeorm-user.repository';
import { UsersService } from './application/users.service';
import { USERS_QUERY_API } from './public/users-query.api';

@Module({
  controllers: [ClientUsersController, AdminUsersController],
  imports: [DatabaseModule],
  providers: [
    UsersService,
    TypeormUserRepository,
    { provide: USER_READ_REPOSITORY, useExisting: TypeormUserRepository },
    { provide: USER_SYNC_REPOSITORY, useExisting: TypeormUserRepository },
    { provide: USERS_QUERY_API, useExisting: UsersService },
  ],
  exports: [USERS_QUERY_API],
})
export class UsersModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(captureUnparsedPayload)
      .forRoutes({ path: 'client/users/sync', method: RequestMethod.POST });
  }
}
