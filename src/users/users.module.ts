import { ClientUsersController } from './presentation/client/users.controller';
import { AdminUsersController } from './presentation/admin/users.controller';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { USER_REPOSITORY } from './ports/user-repository.port';
import { TypeormUserRepository } from './infrastructure/typeorm-user.repository';
import { UsersService } from './users.service';
@Module({ controllers: [ClientUsersController, AdminUsersController], imports: [DatabaseModule], providers: [UsersService, { provide: USER_REPOSITORY, useClass: TypeormUserRepository }], exports: [UsersService] })
export class UsersModule {}
