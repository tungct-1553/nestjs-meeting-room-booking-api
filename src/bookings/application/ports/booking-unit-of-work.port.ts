import type { RoomsBookingAccess } from '../../../rooms/public/rooms-booking-access';
import type { BookingRepositoryPort } from './booking-repository.port';
export const BOOKING_UNIT_OF_WORK = Symbol('BOOKING_UNIT_OF_WORK');
export interface BookingTransaction {
  rooms: RoomsBookingAccess;
  bookings: BookingRepositoryPort;
}
export interface BookingUnitOfWork {
  run<T>(work: (tx: BookingTransaction) => Promise<T>): Promise<T>;
}
