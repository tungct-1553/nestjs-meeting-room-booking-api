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
}
