import type { EntityManager } from 'typeorm';
import type { TimeRange } from '../../common/validation/time-range';
import type {
  BookingRepositoryPort,
  InsertBookingInput,
} from '../application/ports/booking-repository.port';
import type { Booking, BookingStatus } from '../application/models/booking';
import { BookingEntity } from './booking.entity';
import { toBooking } from './booking.mapper';

export class TypeormBookingRepository implements BookingRepositoryPort {
  constructor(private readonly manager: EntityManager) {}

  async insert(input: InsertBookingInput): Promise<Booking> {
    this.assertActiveTransaction();
    const repository = this.manager.getRepository(BookingEntity);
    return toBooking(await repository.save(repository.create(input)));
  }

  async lockById(id: string): Promise<Booking | null> {
    this.assertActiveTransaction();
    const row = await this.manager.getRepository(BookingEntity).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return row === null ? null : toBooking(row);
  }

  async updateStatus(id: string, status: BookingStatus): Promise<Booking> {
    this.assertActiveTransaction();
    const repository = this.manager.getRepository(BookingEntity);
    await repository.update(id, { status });
    return toBooking(await repository.findOneByOrFail({ id }));
  }

  async updateSchedule(id: string, { startAt, endAt }: TimeRange): Promise<Booking> {
    this.assertActiveTransaction();
    const repository = this.manager.getRepository(BookingEntity);
    // Compare at PostgreSQL precision so a sub-millisecond interval can still be corrected.
    await repository
      .createQueryBuilder()
      .update()
      .set({ startAt, endAt })
      .where('id = :id', { id })
      .andWhere(
        '(start_at, end_at) IS DISTINCT FROM (CAST(:startAt AS timestamptz), CAST(:endAt AS timestamptz))',
        { startAt, endAt },
      )
      .execute();
    return toBooking(await repository.findOneByOrFail({ id }));
  }

  private assertActiveTransaction(): void {
    if (!this.manager.queryRunner?.isTransactionActive || this.manager.queryRunner.isReleased) {
      throw new Error('Booking repository requires an active transaction');
    }
  }
}
