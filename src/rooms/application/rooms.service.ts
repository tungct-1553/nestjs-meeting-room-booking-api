import { Inject, Injectable } from '@nestjs/common';
import { RoomNotFoundError } from './errors/room.errors';
import { ROOMS_UNIT_OF_WORK } from './ports/rooms-unit-of-work.port';
import type { RoomsUnitOfWork } from './ports/rooms-unit-of-work.port';

@Injectable()
export class RoomsService {
  constructor(@Inject(ROOMS_UNIT_OF_WORK) private readonly uow: RoomsUnitOfWork) {}

  async deactivate(roomId: string): Promise<void> {
    await this.uow.run(async ({ rooms }) => {
      const room = await rooms.lockById(roomId);
      if (room === null) {
        throw new RoomNotFoundError();
      }
      await rooms.setActive(room.id, false);
    });
  }
}
