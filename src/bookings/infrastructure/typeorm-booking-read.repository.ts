import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Booking } from '../application/models/booking';
import type { BookingPage } from '../application/models/booking-page';
import type {
  BookingReadRepositoryPort,
  ListUserBookingsQuery,
} from '../application/ports/booking-read-repository.port';
import { BookingEntity } from './booking.entity';
import { toBooking } from './booking.mapper';

@Injectable()
export class TypeormBookingReadRepository implements BookingReadRepositoryPort {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}

  listByUser(input: ListUserBookingsQuery): Promise<BookingPage> {
    // Items and filtered total must observe the same snapshot during create/cancel.
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const query = manager
        .getRepository(BookingEntity)
        .createQueryBuilder('booking')
        .where('booking.userId = :userId', { userId: input.userId });
      if (input.status !== undefined) {
        query.andWhere('booking.status = :status', { status: input.status });
      }
      const [rows, total] = await query
        .orderBy('booking.createdAt', 'DESC')
        .addOrderBy('booking.id', 'DESC')
        .skip((input.page - 1) * input.limit)
        .take(input.limit)
        .getManyAndCount();
      return { items: rows.map(toBooking), page: input.page, limit: input.limit, total };
    });
  }

  async findById(id: string): Promise<Booking | null> {
    const row = await this.source.getRepository(BookingEntity).findOneBy({ id });
    return row === null ? null : toBooking(row);
  }
}
