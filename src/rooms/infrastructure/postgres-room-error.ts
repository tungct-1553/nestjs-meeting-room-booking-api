import { QueryFailedError } from 'typeorm';
import { RoomNameConflictError } from '../application/errors/room.errors';

export function rethrowRoomPersistenceError(error: unknown): never {
  if (error instanceof QueryFailedError) {
    const detail: unknown = error.driverError;
    if (
      typeof detail === 'object' &&
      detail !== null &&
      'code' in detail &&
      detail.code === '23505' &&
      'constraint' in detail &&
      detail.constraint === 'rooms_name_key'
    ) {
      throw new RoomNameConflictError({ cause: error });
    }
  }
  throw error;
}
