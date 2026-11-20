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

export class InvalidBookingInputError extends ApplicationError {
  constructor() {
    super(
      'INVALID_BOOKING_INPUT',
      'invalid_input',
      'Booking title must contain 1..200 characters and no NUL',
    );
  }
}

export class BookingNotFoundError extends ApplicationError {
  constructor() {
    super('BOOKING_NOT_FOUND', 'not_found', 'Booking was not found');
  }
}

export class BookingOwnerRequiredError extends ApplicationError {
  constructor() {
    super('BOOKING_OWNER_REQUIRED', 'forbidden', 'Only the booking owner can access it');
  }
}

export class InvalidBookingQueryError extends ApplicationError {
  constructor() {
    super('INVALID_BOOKING_QUERY', 'invalid_input', 'Invalid booking pagination or status filter');
  }
}
