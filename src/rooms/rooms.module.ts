import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RoomsTransactionFactory } from './infrastructure/public/rooms-transaction.factory';
import { TypeormRoomRepository } from './infrastructure/typeorm-room.repository';
import { ROOM_REPOSITORY } from './ports/room-repository.port';
import { RoomsService } from './rooms.service';
@Module({ imports: [DatabaseModule], providers: [RoomsService, RoomsTransactionFactory, { provide: ROOM_REPOSITORY, useClass: TypeormRoomRepository }], exports: [RoomsService, RoomsTransactionFactory] })
export class RoomsModule {}
