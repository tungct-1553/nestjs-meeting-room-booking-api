import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UsersModule } from '../users/users.module';
import { RoomsModule } from '../rooms/rooms.module';
import { BookingsService } from './application/bookings.service';
import { BOOKING_UNIT_OF_WORK } from './application/ports/booking-unit-of-work.port';
import { ClientBookingsController } from './presentation/client/bookings.controller';
import { TypeormBookingUnitOfWork } from './infrastructure/typeorm-booking-unit-of-work';
import { BOOKING_READ_REPOSITORY } from './application/ports/booking-read-repository.port';
import { TypeormBookingReadRepository } from './infrastructure/typeorm-booking-read.repository';
@Module({
  controllers: [ClientBookingsController],
  imports: [DatabaseModule, UsersModule, RoomsModule],
  providers: [
    BookingsService,
    { provide: BOOKING_UNIT_OF_WORK, useClass: TypeormBookingUnitOfWork },
    { provide: BOOKING_READ_REPOSITORY, useClass: TypeormBookingReadRepository },
  ],
})
export class BookingsModule {}
