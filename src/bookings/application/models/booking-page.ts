import type { Booking } from './booking';

export interface BookingPage {
  items: Booking[];
  page: number;
  limit: number;
  total: number;
}
