import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  RoomsTransaction,
  RoomsUnitOfWork,
} from '../application/ports/rooms-unit-of-work.port';
import { TypeormRoomRepository } from './typeorm-room.repository';
import { rethrowRoomPersistenceError } from './postgres-room-error';

@Injectable()
export class TypeormRoomsUnitOfWork implements RoomsUnitOfWork {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}

  async run<T>(work: (tx: RoomsTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.source.transaction('READ COMMITTED', (manager) =>
        work({ rooms: new TypeormRoomRepository(manager) }),
      );
    } catch (error) {
      rethrowRoomPersistenceError(error);
    }
  }
}
