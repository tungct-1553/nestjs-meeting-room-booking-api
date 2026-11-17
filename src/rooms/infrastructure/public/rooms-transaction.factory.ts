import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { RoomsBookingAccess } from '../../public/rooms-booking-access';
import { TypeormRoomRepository } from '../typeorm-room.repository';

@Injectable()
export class RoomsTransactionFactory {
  bind(manager: EntityManager): RoomsBookingAccess {
    const rooms = new TypeormRoomRepository(manager);
    return { lockForBooking: (roomId) => rooms.lockById(roomId) };
  }
}
