import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { RoomReadRepositoryPort } from '../application/ports/room-read-repository.port';
import type { ListRoomsInput } from '../application/inputs/list-rooms.input';
import type { RoomPage } from '../application/models/room-page';
import type { Room } from '../application/models/room';
import { RoomEntity } from './room.entity';
import { toRoom } from './room.mapper';

@Injectable()
export class TypeormRoomReadRepository implements RoomReadRepositoryPort {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}

  listActive(input: ListRoomsInput): Promise<RoomPage> {
    // Two SELECTs need one snapshot so concurrent writes cannot disagree with total.
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const query = manager
        .getRepository(RoomEntity)
        .createQueryBuilder('room')
        .where('room.isActive = :active', { active: true });
      if (input.capacity !== undefined) {
        query.andWhere('room.capacity >= :capacity', { capacity: input.capacity });
      }
      if (input.search !== undefined) {
        const literal = input.search.replace(/[\\%_]/g, '\\$&');
        query.andWhere(
          `lower(room.name COLLATE pg_catalog."pg_c_utf8") LIKE lower(CAST(:search AS text) COLLATE pg_catalog."pg_c_utf8") ESCAPE '\\'`,
          { search: `%${literal}%` },
        );
      }
      const [rows, total] = await query
        .orderBy('room.name', 'ASC')
        .addOrderBy('room.id', 'ASC')
        .skip((input.page - 1) * input.limit)
        .take(input.limit)
        .getManyAndCount();
      return { items: rows.map(toRoom), page: input.page, limit: input.limit, total };
    });
  }

  async findActiveById(id: string): Promise<Room | null> {
    const row = await this.source.getRepository(RoomEntity).findOneBy({ id, isActive: true });
    return row === null ? null : toRoom(row);
  }
}
