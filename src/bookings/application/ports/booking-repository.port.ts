import type { TimeRange } from '../../../common/validation/time-range';
import type { Booking, BookingStatus } from '../models/booking';

export interface InsertBookingInput {
  roomId: string;
  userId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  status: BookingStatus;
}

export interface BookingRepositoryPort {
  insert(input: InsertBookingInput): Promise<Booking>;
  lockById(id: string): Promise<Booking | null>;
  updateStatus(id: string, status: BookingStatus): Promise<Booking>;
  /** Returns the booking and writes only when the stored interval differs. */
  updateSchedule(id: string, range: TimeRange): Promise<Booking>;
}
