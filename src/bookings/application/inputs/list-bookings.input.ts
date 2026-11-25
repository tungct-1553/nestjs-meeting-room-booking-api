import type { BookingStatus } from '../models/booking';

export interface ListBookingsInput {
  actorSub: string;
  page: number;
  limit: number;
  status?: BookingStatus;
}
