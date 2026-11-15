import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UsersModule } from '../users/users.module';
import { RoomsModule } from '../rooms/rooms.module';
import { BookingsService } from './bookings.service';
import { BOOKING_UNIT_OF_WORK } from './ports/booking-unit-of-work.port';
import { TypeormBookingUnitOfWork } from './infrastructure/typeorm-booking-unit-of-work';
@Module({ imports: [DatabaseModule, UsersModule, RoomsModule], providers: [BookingsService, { provide: BOOKING_UNIT_OF_WORK, useClass: TypeormBookingUnitOfWork }], exports: [BookingsService] })
export class BookingsModule {}
