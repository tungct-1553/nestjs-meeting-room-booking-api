import type { RoomTransactionRepositoryPort } from './room-repository.port';

export const ROOMS_UNIT_OF_WORK = Symbol('ROOMS_UNIT_OF_WORK');

export interface RoomsTransaction {
  rooms: RoomTransactionRepositoryPort;
}

export interface RoomsUnitOfWork {
  run<T>(work: (tx: RoomsTransaction) => Promise<T>): Promise<T>;
}
