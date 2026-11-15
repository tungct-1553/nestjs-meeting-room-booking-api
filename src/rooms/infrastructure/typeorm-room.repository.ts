import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { RoomRepositoryPort } from '../ports/room-repository.port';
import { RoomNotFoundError } from '../errors/room.errors';
import { RoomEntity } from './room.entity';
@Injectable()
export class TypeormRoomRepository implements RoomRepositoryPort {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}
  async deactivate(roomId: string): Promise<void> {
    await this.source.transaction('READ COMMITTED', async (manager) => {
      const repository = manager.getRepository(RoomEntity);
      const room = await repository.findOne({ where: { id: roomId }, lock: { mode: 'pessimistic_write' } });
      if (!room) throw new RoomNotFoundError();
      await repository.update(room.id, { isActive: false });
    });
  }
}
