import { Inject, Injectable } from '@nestjs/common';
import { RoomNotFoundError } from './errors/room.errors';
import { ROOMS_UNIT_OF_WORK } from './ports/rooms-unit-of-work.port';
import type { RoomsUnitOfWork } from './ports/rooms-unit-of-work.port';
import { ROOM_CREATION_REPOSITORY } from './ports/room-creation-repository.port';
import type { RoomCreationRepositoryPort } from './ports/room-creation-repository.port';
import type { CreateRoomInput } from './inputs/create-room.input';
import type { Room } from './models/room';
import { normalizeCreateRoom, normalizeRoomPatch } from './policies/room-details.policy';
import type { UpdateRoomInput } from './inputs/update-room.input';

@Injectable()
export class RoomsService {
  constructor(
    @Inject(ROOMS_UNIT_OF_WORK) private readonly uow: RoomsUnitOfWork,
    @Inject(ROOM_CREATION_REPOSITORY) private readonly creator: RoomCreationRepositoryPort,
  ) {}

  create(input: CreateRoomInput): Promise<Room> {
    return this.creator.create(normalizeCreateRoom(input));
  }

  async update(input: UpdateRoomInput): Promise<Room> {
    const patch = normalizeRoomPatch(input);
    return this.uow.run(async ({ rooms }) => {
      const room = await rooms.lockById(input.roomId);
      if (room === null) {
        throw new RoomNotFoundError();
      }
      return rooms.updateDetails(room.id, patch);
    });
  }

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
