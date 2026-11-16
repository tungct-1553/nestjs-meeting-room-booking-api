import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '../identity/public/principal';
import { UsersService } from '../users/users.service';
import { BOOKING_UNIT_OF_WORK } from './ports/booking-unit-of-work.port';
import type { BookingUnitOfWork } from './ports/booking-unit-of-work.port';
import type { Booking } from './ports/booking-repository.port';
import type { CreateBookingDto } from './dto/create-booking.dto';
import { InvalidBookingTimeError, RoomUnavailableError } from './errors/booking.errors';
@Injectable()
export class BookingsService {
  constructor(private readonly users: UsersService, @Inject(BOOKING_UNIT_OF_WORK) private readonly uow: BookingUnitOfWork) {}
  async create(principal: Principal, dto: CreateBookingDto): Promise<Booking> {
    const user = await this.users.requireBySub(principal.sub);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    return this.uow.run(async ({ rooms, bookings }) => {
      const room = await rooms.lockForBooking(dto.roomId);
      if (!room?.isActive) throw new RoomUnavailableError();
      if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || startAt.getTime() <= Date.now() || startAt >= endAt) throw new InvalidBookingTimeError();
      return bookings.insert({ roomId: room.id, userId: user.id, title: dto.title, startAt, endAt });
    });
  }
}
