import { Inject, Injectable } from '@nestjs/common';
import { isFutureTimeRange } from '../../common/validation/time-range';
import { USERS_QUERY_API } from '../../users/public/users-query.api';
import type { UsersQueryApi } from '../../users/public/users-query.api';
import { BOOKING_UNIT_OF_WORK } from './ports/booking-unit-of-work.port';
import type { BookingUnitOfWork } from './ports/booking-unit-of-work.port';
import type { Booking } from './models/booking';
import type { CreateBookingInput } from './inputs/create-booking.input';
import {
  BookingNotFoundError,
  BookingNotReschedulableError,
  BookingOwnerRequiredError,
  InvalidBookingTimeError,
  RoomUnavailableError,
} from './errors/booking.errors';
import type { CancelBookingInput } from './inputs/cancel-booking.input';
import { normalizeBookingTitle } from './policies/booking-title.policy';
import type { ListBookingsInput } from './inputs/list-bookings.input';
import type { GetBookingInput } from './inputs/get-booking.input';
import type { BookingPage } from './models/booking-page';
import { BOOKING_READ_REPOSITORY } from './ports/booking-read-repository.port';
import type { BookingReadRepositoryPort } from './ports/booking-read-repository.port';
import { normalizeBookingList } from './policies/booking-list.policy';
import type { RescheduleBookingInput } from './inputs/reschedule-booking.input';

function requireOwnedBooking(booking: Booking | null, userId: string): Booking {
  if (booking === null) {
    throw new BookingNotFoundError();
  }
  if (booking.userId !== userId) {
    throw new BookingOwnerRequiredError();
  }
  return booking;
}

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
    return requireOwnedBooking(await this.reader.findById(input.bookingId), user.id);
  }

  async create(input: CreateBookingInput): Promise<Booking> {
    const title = normalizeBookingTitle(input.title);
    const user = await this.users.requireBySub(input.actorSub);

    return this.uow.run(async ({ rooms, bookings }) => {
      const room = await rooms.lockForBooking(input.roomId);
      if (room === null || !room.isActive) {
        throw new RoomUnavailableError();
      }
      if (!isFutureTimeRange(input, Date.now())) {
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

  async reschedule(input: RescheduleBookingInput): Promise<Booking> {
    const user = await this.users.requireBySub(input.actorSub);
    const current = requireOwnedBooking(await this.reader.findById(input.bookingId), user.id);

    return this.uow.run(async ({ rooms, bookings }) => {
      // The room ID is immutable. Lock the room before the booking to serialize writes with creation.
      const room = await rooms.lockForBooking(current.roomId);
      const booking = requireOwnedBooking(await bookings.lockById(current.id), user.id);
      if (room === null || !room.isActive) {
        throw new RoomUnavailableError();
      }
      const now = Date.now();
      if (booking.status !== 'confirmed' || booking.startAt.getTime() <= now) {
        throw new BookingNotReschedulableError();
      }
      if (!isFutureTimeRange(input, now)) {
        throw new InvalidBookingTimeError();
      }
      return bookings.updateSchedule(booking.id, { startAt: input.startAt, endAt: input.endAt });
    });
  }

  async cancel(input: CancelBookingInput): Promise<Booking> {
    const user = await this.users.requireBySub(input.actorSub);
    return this.uow.run(async ({ bookings }) => {
      const booking = requireOwnedBooking(await bookings.lockById(input.bookingId), user.id);
      if (booking.status === 'cancelled') {
        return booking;
      }
      return bookings.updateStatus(booking.id, 'cancelled');
    });
  }
}
