import type { EntityManager } from 'typeorm';
import type { Booking, BookingRepositoryPort, NewBooking } from '../ports/booking-repository.port';
import { BookingEntity } from './booking.entity';
export class TypeormBookingRepository implements BookingRepositoryPort {
  constructor(private readonly manager: EntityManager) {}
  async insert(input: NewBooking): Promise<Booking> {
    if (!this.manager.queryRunner?.isTransactionActive || this.manager.queryRunner.isReleased) throw new Error('Booking insert requires an active transaction');
    const repository = this.manager.getRepository(BookingEntity);
    const row = await repository.save(repository.create({ ...input, status: 'confirmed' }));
    return { id: row.id, roomId: row.roomId, userId: row.userId, title: row.title, startAt: row.startAt, endAt: row.endAt, status: row.status, createdAt: row.createdAt };
  }
}
