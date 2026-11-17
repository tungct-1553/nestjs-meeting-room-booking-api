import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  RoomsTransaction,
  RoomsUnitOfWork,
} from '../application/ports/rooms-unit-of-work.port';
import { TypeormRoomRepository } from './typeorm-room.repository';

@Injectable()
export class TypeormRoomsUnitOfWork implements RoomsUnitOfWork {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}

  run<T>(work: (tx: RoomsTransaction) => Promise<T>): Promise<T> {
    return this.source.transaction('READ COMMITTED', (manager) =>
      work({ rooms: new TypeormRoomRepository(manager) }),
    );
  }
}
