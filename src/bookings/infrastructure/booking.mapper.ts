import type { Booking } from '../application/models/booking';
import type { BookingEntity } from './booking.entity';

export function toBooking(row: BookingEntity): Booking {
  return {
    id: row.id,
    roomId: row.roomId,
    userId: row.userId,
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    createdAt: row.createdAt,
  };
}
