export type BookingStatus = 'confirmed' | 'cancelled';

export interface Booking {
  id: string;
  roomId: string;
  userId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  status: BookingStatus;
  createdAt: Date;
}
