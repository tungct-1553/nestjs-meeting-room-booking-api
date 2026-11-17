import { ApplicationError } from '../../../common/application/application.error';
export class BookingTimeConflictError extends ApplicationError {
  constructor(options?: ErrorOptions) {
    super('BOOKING_TIME_CONFLICT', 'conflict', 'Room is already booked for this time', options);
  }
}
export class RoomUnavailableError extends ApplicationError {
  constructor() {
    super('ROOM_UNAVAILABLE', 'not_found', 'Room is unavailable');
  }
}
export class InvalidBookingTimeError extends ApplicationError {
  constructor() {
    super(
      'INVALID_BOOKING_TIME',
      'invalid_input',
      'Booking must start in the future and end after it starts',
    );
  }
}
