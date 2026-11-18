import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Room } from '../application/models/room';
import type {
  NewRoom,
  RoomCreationRepositoryPort,
} from '../application/ports/room-creation-repository.port';
import { rethrowRoomPersistenceError } from './postgres-room-error';
import { toRoom } from './room.mapper';
import { RoomEntity } from './room.entity';

@Injectable()
export class TypeormRoomCreationRepository implements RoomCreationRepositoryPort {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}

  async create(input: NewRoom): Promise<Room> {
    try {
      const repository = this.source.getRepository(RoomEntity);
      const room = await repository.save(repository.create(input));
      return toRoom(room);
    } catch (error) {
      rethrowRoomPersistenceError(error);
    }
  }
}
