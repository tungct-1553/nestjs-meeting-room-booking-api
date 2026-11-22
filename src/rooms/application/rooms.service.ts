import { Inject, Injectable } from '@nestjs/common';
import type { TimeRange } from '../../common/validation/time-range';
import type { ListRoomsInput } from './inputs/list-rooms.input';
import type { RoomPage } from './models/room-page';
import { ROOM_READ_REPOSITORY } from './ports/room-read-repository.port';
import type { RoomReadRepositoryPort } from './ports/room-read-repository.port';
import { normalizeRoomList } from './policies/room-list.policy';
import { RoomNotFoundError } from './errors/room.errors';
import { ROOMS_UNIT_OF_WORK } from './ports/rooms-unit-of-work.port';
import type { RoomsUnitOfWork } from './ports/rooms-unit-of-work.port';
import { ROOM_CREATION_REPOSITORY } from './ports/room-creation-repository.port';
import type { RoomCreationRepositoryPort } from './ports/room-creation-repository.port';
import type { CreateRoomInput } from './inputs/create-room.input';
import type { Room } from './models/room';
import { normalizeCreateRoom, normalizeRoomPatch } from './policies/room-details.policy';
import type { UpdateRoomInput } from './inputs/update-room.input';
import {
  findAvailableIntervals,
  validateAvailabilityRange,
} from './policies/room-availability.policy';

@Injectable()
export class RoomsService {
  constructor(
    @Inject(ROOMS_UNIT_OF_WORK) private readonly uow: RoomsUnitOfWork,
    @Inject(ROOM_CREATION_REPOSITORY) private readonly creator: RoomCreationRepositoryPort,
    @Inject(ROOM_READ_REPOSITORY) private readonly reader: RoomReadRepositoryPort,
  ) {}

  list(input: ListRoomsInput): Promise<RoomPage> {
    return this.reader.listActive(normalizeRoomList(input));
  }

  listAvailable(input: ListRoomsInput, range: TimeRange): Promise<RoomPage> {
    validateAvailabilityRange(range);
    return this.reader.listActive(normalizeRoomList(input), range);
  }

  async availability(id: string, range: TimeRange): Promise<TimeRange[]> {
    validateAvailabilityRange(range);
    const busy = await this.reader.findActiveRoomBusyIntervals(id, range);
    if (busy === null) {
      throw new RoomNotFoundError();
    }
    return findAvailableIntervals(range, busy);
  }

  async detail(roomId: string): Promise<Room> {
    const room = await this.reader.findActiveById(roomId);
    if (room === null) {
      throw new RoomNotFoundError();
    }
    return room;
  }

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
