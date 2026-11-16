import { ClientUsersController } from './presentation/client/users.controller';
import { AdminUsersController } from './presentation/admin/users.controller';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { USER_READ_REPOSITORY, USER_SYNC_REPOSITORY } from './ports/user-repository.port';
import { TypeormUserRepository } from './infrastructure/typeorm-user.repository';
import { UsersService } from './users.service';
@Module({ controllers: [ClientUsersController, AdminUsersController], imports: [DatabaseModule], providers: [UsersService, TypeormUserRepository, { provide: USER_READ_REPOSITORY, useExisting: TypeormUserRepository }, { provide: USER_SYNC_REPOSITORY, useExisting: TypeormUserRepository }], exports: [UsersService] })
export class UsersModule {}
