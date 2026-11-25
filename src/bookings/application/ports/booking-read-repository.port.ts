import type { Booking, BookingStatus } from '../models/booking';
import type { BookingPage } from '../models/booking-page';

export const BOOKING_READ_REPOSITORY = Symbol('BOOKING_READ_REPOSITORY');

export interface ListUserBookingsQuery {
  userId: string;
  page: number;
  limit: number;
  status?: BookingStatus;
}

export interface BookingReadRepositoryPort {
  listByUser(query: ListUserBookingsQuery): Promise<BookingPage>;
  findById(id: string): Promise<Booking | null>;
}
