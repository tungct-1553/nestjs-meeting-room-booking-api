import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { TimeRange } from '../../common/validation/time-range';
import type { RoomReadRepositoryPort } from '../application/ports/room-read-repository.port';
import type { ListRoomsInput } from '../application/inputs/list-rooms.input';
import type { RoomPage } from '../application/models/room-page';
import type { Room } from '../application/models/room';
import { RoomEntity } from './room.entity';
import { toRoom } from './room.mapper';

const OVERLAPPING_CONFIRMED_BOOKING = `
  booking.room_id = room.id
  AND booking.status = 'confirmed'
  AND tstzrange(booking.start_at, booking.end_at, '[)')
    && tstzrange(CAST(:startAt AS timestamptz), CAST(:endAt AS timestamptz), '[)')
`;

@Injectable()
export class TypeormRoomReadRepository implements RoomReadRepositoryPort {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}

  listActive(input: ListRoomsInput, availableDuring?: TimeRange): Promise<RoomPage> {
    return this.listRooms(input, true, availableDuring);
  }

  listForAdmin(input: ListRoomsInput, isActive?: boolean): Promise<RoomPage> {
    return this.listRooms(input, isActive);
  }

  private listRooms(
    input: ListRoomsInput,
    isActive?: boolean,
    availableDuring?: TimeRange,
  ): Promise<RoomPage> {
    // Two SELECTs need one snapshot so concurrent writes cannot disagree with total.
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const query = manager.getRepository(RoomEntity).createQueryBuilder('room');
      if (isActive !== undefined) {
        query.andWhere('room.isActive = :active', { active: isActive });
      }
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
      if (availableDuring !== undefined) {
        const conflictingBookings = query
          .subQuery()
          .select('1')
          .from('bookings', 'booking')
          .where(OVERLAPPING_CONFIRMED_BOOKING);
        query.andWhere(`NOT EXISTS ${conflictingBookings.getQuery()}`, {
          startAt: availableDuring.startAt,
          endAt: availableDuring.endAt,
        });
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

  async findById(id: string): Promise<Room | null> {
    const row = await this.source.getRepository(RoomEntity).findOneBy({ id });
    return row === null ? null : toRoom(row);
  }

  async findActiveRoomBusyIntervals(id: string, range: TimeRange): Promise<TimeRange[] | null> {
    const rows = await this.source
      .getRepository(RoomEntity)
      .createQueryBuilder('room')
      .leftJoin('bookings', 'booking', OVERLAPPING_CONFIRMED_BOOKING, {
        startAt: range.startAt,
        endAt: range.endAt,
      })
      // Bound the busy interval within the window and round it outward before Date hydration.
      .select(
        `CASE WHEN booking.start_at <= CAST(:startAt AS timestamptz)
          THEN CAST(:startAt AS timestamptz)
          ELSE date_trunc('milliseconds', booking.start_at)
        END`,
        'startAt',
      )
      .addSelect(
        `CASE WHEN booking.end_at >= CAST(:endAt AS timestamptz)
          THEN CAST(:endAt AS timestamptz)
          ELSE date_trunc('milliseconds', booking.end_at + interval '999 microseconds')
        END`,
        'endAt',
      )
      .where('room.id = :id AND room.isActive = true', { id })
      .orderBy('booking.start_at', 'ASC')
      .getRawMany<{ startAt: Date | null; endAt: Date | null }>();
    if (rows.length === 0) {
      return null;
    }
    return rows.flatMap(({ startAt, endAt }) =>
      startAt !== null && endAt !== null ? [{ startAt, endAt }] : [],
    );
  }
}
