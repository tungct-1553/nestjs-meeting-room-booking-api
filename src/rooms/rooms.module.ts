import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RoomsService } from './application/rooms.service';
import { ROOMS_UNIT_OF_WORK } from './application/ports/rooms-unit-of-work.port';
import { RoomsTransactionFactory } from './infrastructure/public/rooms-transaction.factory';
import { TypeormRoomsUnitOfWork } from './infrastructure/typeorm-rooms-unit-of-work';

@Module({
  imports: [DatabaseModule],
  providers: [
    RoomsService,
    RoomsTransactionFactory,
    { provide: ROOMS_UNIT_OF_WORK, useClass: TypeormRoomsUnitOfWork },
  ],
  exports: [RoomsTransactionFactory],
})
export class RoomsModule {}
