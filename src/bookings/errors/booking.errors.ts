import { ApplicationError } from '../../common/errors/application.error';
export class BookingTimeConflictError extends ApplicationError {
  constructor() { super('BOOKING_TIME_CONFLICT', 'Room is already booked for this time'); }
}
export class RoomUnavailableError extends ApplicationError {
  constructor() { super('ROOM_UNAVAILABLE', 'Room is unavailable'); }
}
export class InvalidBookingTimeError extends ApplicationError {
  constructor() { super('INVALID_BOOKING_TIME', 'Booking must start in the future and end after it starts'); }
}
