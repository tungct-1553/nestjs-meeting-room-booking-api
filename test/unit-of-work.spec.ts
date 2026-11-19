import type { DataSource, EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { TypeormBookingUnitOfWork } from '../src/bookings/infrastructure/typeorm-booking-unit-of-work';
import { RoomsTransactionFactory } from '../src/rooms/infrastructure/public/rooms-transaction.factory';
import { BookingTimeConflictError } from '../src/bookings/application/errors/booking.errors';
import { DatabaseLifecycle } from '../src/database/database.lifecycle';
import { validateEnvironment } from '../src/config/env.validation';

describe('UOW and database boundaries', () => {
  it('binds the rooms factory to the transaction manager', async () => {
    const manager = {} as EntityManager;
    const access = { lockForBooking: jest.fn() };
    const bind = jest.fn().mockReturnValue(access);
    const source = {
      transaction: jest.fn().mockImplementation(async (_level, work) => work(manager)),
    };
    const uow = new TypeormBookingUnitOfWork(
      source as unknown as DataSource,
      { bind } as unknown as RoomsTransactionFactory,
    );
    await uow.run(async (tx) => {
      expect(tx.rooms).toBe(access);
      return 'result';
    });
    expect(bind).toHaveBeenCalledWith(manager);
    expect(source.transaction).toHaveBeenCalledWith('READ COMMITTED', expect.any(Function));
  });
  it('maps only the named exclusion violation and preserves other failures', async () => {
    const conflict = new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error(), { code: '23P01', constraint: 'bookings_no_overlap' }),
    );
    const unrelated = new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error(), { code: '23503' }),
    );
    const otherExclusion = new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error(), { code: '23P01', constraint: 'unrelated_exclusion' }),
    );
    const source = {
      transaction: jest
        .fn()
        .mockRejectedValueOnce(conflict)
        .mockRejectedValueOnce(unrelated)
        .mockRejectedValueOnce(otherExclusion),
    };
    const uow = new TypeormBookingUnitOfWork(
      source as unknown as DataSource,
      new RoomsTransactionFactory(),
    );
    await expect(uow.run(async () => undefined)).rejects.toBeInstanceOf(BookingTimeConflictError);
    await expect(uow.run(async () => undefined)).rejects.toBe(unrelated);
    await expect(uow.run(async () => undefined)).rejects.toBe(otherExclusion);
  });
  it('closes an initialized DataSource and skips an already closed pool', async () => {
    const source = {
      isInitialized: true,
      destroy: jest.fn(async () => {
        source.isInitialized = false;
      }),
    };
    const lifecycle = new DatabaseLifecycle(source as unknown as DataSource);
    await lifecycle.onApplicationShutdown();
    await lifecycle.onApplicationShutdown();
    expect(source.destroy).toHaveBeenCalledTimes(1);
  });
  it('validates configuration without exposing URLs in errors', () => {
    expect(() => validateEnvironment({ DATABASE_URL: 'secret' })).toThrow('DATABASE_URL must be');
    expect(() =>
      validateEnvironment({ DATABASE_URL: process.env.DATABASE_URL, PORT: '0' }),
    ).toThrow('PORT must be');
    expect(() =>
      validateEnvironment({ DATABASE_URL: process.env.DATABASE_URL, CORS_ORIGINS: '*' }),
    ).toThrow('CORS_ORIGINS must');
  });
});
