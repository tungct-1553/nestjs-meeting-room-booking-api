import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { USER_REPOSITORY } from './ports/user-repository.port';
import { TypeormUserRepository } from './infrastructure/typeorm-user.repository';
import { UsersService } from './users.service';
@Module({ imports: [DatabaseModule], providers: [UsersService, { provide: USER_REPOSITORY, useClass: TypeormUserRepository }], exports: [UsersService] })
export class UsersModule {}
