import { InvalidBookingInputError } from '../errors/booking.errors';

export const MAX_BOOKING_TITLE_LENGTH = 200;

export function normalizeBookingTitle(value: string): string {
  if (typeof value !== 'string') {
    throw new InvalidBookingInputError();
  }
  const title = value.trim();
  if (title.length === 0 || [...title].length > MAX_BOOKING_TITLE_LENGTH || title.includes('\0')) {
    throw new InvalidBookingInputError();
  }
  return title;
}
