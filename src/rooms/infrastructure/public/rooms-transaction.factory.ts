import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { RoomsBookingAccess } from '../../public/rooms-booking-access';
import { RoomEntity } from '../room.entity';
@Injectable()
export class RoomsTransactionFactory {
  bind(manager: EntityManager): RoomsBookingAccess {
    const assertActive = () => {
      if (!manager.queryRunner?.isTransactionActive || manager.queryRunner.isReleased) throw new Error('Room access requires an active transaction');
    };
    assertActive();
    return {
      lockForBooking: async (roomId) => {
        assertActive();
        const room = await manager.getRepository(RoomEntity).findOne({ where: { id: roomId }, lock: { mode: 'pessimistic_write' } });
        return room ? { id: room.id, isActive: room.isActive } : null;
      },
    };
  }
}
