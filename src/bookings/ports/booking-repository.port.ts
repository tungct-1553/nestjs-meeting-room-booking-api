export interface NewBooking {
  roomId: string; userId: string; title: string; startAt: Date; endAt: Date;
}
export interface Booking extends NewBooking {
  id: string; status: 'confirmed' | 'cancelled'; createdAt: Date;
}
export interface BookingRepositoryPort { insert(input: NewBooking): Promise<Booking>; }
