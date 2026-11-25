import { Inject, Injectable } from '@nestjs/common';
import { USERS_QUERY_API } from '../../users/public/users-query.api';
import type { UsersQueryApi } from '../../users/public/users-query.api';
import { BOOKING_UNIT_OF_WORK } from './ports/booking-unit-of-work.port';
import type { BookingUnitOfWork } from './ports/booking-unit-of-work.port';
import type { Booking } from './models/booking';
import type { CreateBookingInput } from './inputs/create-booking.input';
import {
  BookingNotFoundError,
  BookingOwnerRequiredError,
  InvalidBookingTimeError,
  RoomUnavailableError,
} from './errors/booking.errors';
import type { CancelBookingInput } from './inputs/cancel-booking.input';
import { normalizeBookingTitle } from './policies/booking-title.policy';
import { isValidBookingTime } from './policies/booking-time.policy';
import type { ListBookingsInput } from './inputs/list-bookings.input';
import type { GetBookingInput } from './inputs/get-booking.input';
import type { BookingPage } from './models/booking-page';
import { BOOKING_READ_REPOSITORY } from './ports/booking-read-repository.port';
import type { BookingReadRepositoryPort } from './ports/booking-read-repository.port';
import { normalizeBookingList } from './policies/booking-list.policy';

@Injectable()
export class BookingsService {
  constructor(
    @Inject(USERS_QUERY_API) private readonly users: UsersQueryApi,
    @Inject(BOOKING_UNIT_OF_WORK) private readonly uow: BookingUnitOfWork,
    @Inject(BOOKING_READ_REPOSITORY) private readonly reader: BookingReadRepositoryPort,
  ) {}

  async list(input: ListBookingsInput): Promise<BookingPage> {
    const query = normalizeBookingList(input);
    const user = await this.users.requireBySub(query.actorSub);
    return this.reader.listByUser({
      userId: user.id,
      page: query.page,
      limit: query.limit,
      status: query.status,
    });
  }

  async detail(input: GetBookingInput): Promise<Booking> {
    const user = await this.users.requireBySub(input.actorSub);
    const booking = await this.reader.findById(input.bookingId);
    if (booking === null) {
      throw new BookingNotFoundError();
    }
    if (booking.userId !== user.id) {
      throw new BookingOwnerRequiredError();
    }
    return booking;
  }

  async create(input: CreateBookingInput): Promise<Booking> {
    const title = normalizeBookingTitle(input.title);
    const user = await this.users.requireBySub(input.actorSub);

    return this.uow.run(async ({ rooms, bookings }) => {
      const room = await rooms.lockForBooking(input.roomId);
      if (room === null || !room.isActive) {
        throw new RoomUnavailableError();
      }
      if (!isValidBookingTime(input.startAt, input.endAt, Date.now())) {
        throw new InvalidBookingTimeError();
      }
      return bookings.insert({
        roomId: room.id,
        userId: user.id,
        title,
        startAt: input.startAt,
        endAt: input.endAt,
        status: 'confirmed',
      });
    });
  }

  async cancel(input: CancelBookingInput): Promise<Booking> {
    const user = await this.users.requireBySub(input.actorSub);
    return this.uow.run(async ({ bookings }) => {
      const booking = await bookings.lockById(input.bookingId);
      if (booking === null) {
        throw new BookingNotFoundError();
      }
      if (booking.userId !== user.id) {
        throw new BookingOwnerRequiredError();
      }
      if (booking.status === 'cancelled') {
        return booking;
      }
      return bookings.updateStatus(booking.id, 'cancelled');
    });
  }
}
