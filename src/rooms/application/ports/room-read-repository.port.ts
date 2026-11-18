import type { ListRoomsInput } from '../inputs/list-rooms.input';
import type { Room } from '../models/room';
import type { RoomPage } from '../models/room-page';

export const ROOM_READ_REPOSITORY = Symbol('ROOM_READ_REPOSITORY');

export interface RoomReadRepositoryPort {
  /** Active rooms only; items and filtered total share one database snapshot. */
  listActive(input: ListRoomsInput): Promise<RoomPage>;
  findActiveById(id: string): Promise<Room | null>;
}
