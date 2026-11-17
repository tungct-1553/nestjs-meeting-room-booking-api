import type { EntityManager } from 'typeorm';
import type { RoomSnapshot } from '../application/models/room-snapshot';
import type { RoomTransactionRepositoryPort } from '../application/ports/room-repository.port';
import { RoomEntity } from './room.entity';

export class TypeormRoomRepository implements RoomTransactionRepositoryPort {
  constructor(private readonly manager: EntityManager) {
    this.assertActive();
  }

  async lockById(id: string): Promise<RoomSnapshot | null> {
    this.assertActive();
    const room = await this.manager.getRepository(RoomEntity).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return room ? { id: room.id, isActive: room.isActive } : null;
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    this.assertActive();
    await this.manager.getRepository(RoomEntity).update(id, { isActive });
  }

  private assertActive(): void {
    if (!this.manager.queryRunner?.isTransactionActive || this.manager.queryRunner.isReleased) {
      throw new Error('Room access requires an active transaction');
    }
  }
}
