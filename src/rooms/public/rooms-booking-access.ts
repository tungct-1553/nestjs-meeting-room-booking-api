export interface RoomsBookingAccess {
  lockForBooking(roomId: string): Promise<{ id: string; isActive: boolean } | null>;
}
