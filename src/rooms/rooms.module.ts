import { ROOM_READ_REPOSITORY } from './application/ports/room-read-repository.port';
import { TypeormRoomReadRepository } from './infrastructure/typeorm-room-read.repository';
import { ClientRoomsController } from './presentation/client/rooms.controller';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RoomsService } from './application/rooms.service';
import { ROOMS_UNIT_OF_WORK } from './application/ports/rooms-unit-of-work.port';
import { RoomsTransactionFactory } from './infrastructure/public/rooms-transaction.factory';
import { TypeormRoomsUnitOfWork } from './infrastructure/typeorm-rooms-unit-of-work';
import { ROOM_CREATION_REPOSITORY } from './application/ports/room-creation-repository.port';
import { TypeormRoomCreationRepository } from './infrastructure/typeorm-room-creation.repository';
import { AdminRoomsController } from './presentation/admin/rooms.controller';

@Module({
  controllers: [AdminRoomsController, ClientRoomsController],
  imports: [DatabaseModule],
  providers: [
    RoomsService,
    { provide: ROOM_READ_REPOSITORY, useClass: TypeormRoomReadRepository },
    RoomsTransactionFactory,
    { provide: ROOMS_UNIT_OF_WORK, useClass: TypeormRoomsUnitOfWork },
    { provide: ROOM_CREATION_REPOSITORY, useClass: TypeormRoomCreationRepository },
  ],
  exports: [RoomsTransactionFactory],
})
export class RoomsModule {}
