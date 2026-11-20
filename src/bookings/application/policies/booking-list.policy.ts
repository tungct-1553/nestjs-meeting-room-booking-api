import { InvalidBookingQueryError } from '../errors/booking.errors';
import type { ListBookingsInput } from '../inputs/list-bookings.input';

export function normalizeBookingList(input: ListBookingsInput): ListBookingsInput {
  const validPagination =
    Number.isSafeInteger(input.page) &&
    input.page >= 1 &&
    Number.isInteger(input.limit) &&
    input.limit >= 1 &&
    input.limit <= 100 &&
    Number.isSafeInteger((input.page - 1) * input.limit);
  const validStatus =
    input.status === undefined || input.status === 'confirmed' || input.status === 'cancelled';
  if (!validPagination || !validStatus) {
    throw new InvalidBookingQueryError();
  }
  return {
    actorSub: input.actorSub,
    page: input.page,
    limit: input.limit,
    status: input.status,
  };
}
