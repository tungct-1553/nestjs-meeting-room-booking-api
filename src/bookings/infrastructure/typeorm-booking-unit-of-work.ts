import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { RoomsTransactionFactory } from '../../rooms/infrastructure/public/rooms-transaction.factory';
import type { BookingTransaction, BookingUnitOfWork } from '../ports/booking-unit-of-work.port';
import { BookingTimeConflictError } from '../errors/booking.errors';
import { TypeormBookingRepository } from './typeorm-booking.repository';
@Injectable()
export class TypeormBookingUnitOfWork implements BookingUnitOfWork {
  constructor(@Inject(DataSource) private readonly source: DataSource, private readonly roomsFactory: RoomsTransactionFactory) {}
  async run<T>(work: (tx: BookingTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.source.transaction('READ COMMITTED', (manager) => work({ rooms: this.roomsFactory.bind(manager), bookings: new TypeormBookingRepository(manager) }));
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const pg = error.driverError as { code?: string; constraint?: string };
        if (pg.code === '23P01' && pg.constraint === 'bookings_no_overlap') throw new BookingTimeConflictError();
      }
      throw error;
    }
  }
}
