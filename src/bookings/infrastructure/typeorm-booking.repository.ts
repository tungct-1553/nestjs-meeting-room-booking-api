import type { EntityManager } from 'typeorm';
import type {
  BookingRepositoryPort,
  InsertBookingInput,
} from '../application/ports/booking-repository.port';
import type { Booking } from '../application/models/booking';
import { BookingEntity } from './booking.entity';

export class TypeormBookingRepository implements BookingRepositoryPort {
  constructor(private readonly manager: EntityManager) {}

  async insert(input: InsertBookingInput): Promise<Booking> {
    if (!this.manager.queryRunner?.isTransactionActive || this.manager.queryRunner.isReleased) {
      throw new Error('Booking insert requires an active transaction');
    }
    const repository = this.manager.getRepository(BookingEntity);
    const row = await repository.save(repository.create(input));
    return {
      id: row.id,
      roomId: row.roomId,
      userId: row.userId,
      title: row.title,
      startAt: row.startAt,
      endAt: row.endAt,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}
