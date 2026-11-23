import type { TimeRange } from '../../../common/validation/time-range';
import type { ListRoomsInput } from '../inputs/list-rooms.input';
import type { Room } from '../models/room';
import type { RoomPage } from '../models/room-page';

export const ROOM_READ_REPOSITORY = Symbol('ROOM_READ_REPOSITORY');

export interface RoomReadRepositoryPort {
  /** Active rooms only; items and filtered total share one database snapshot. */
  listActive(input: ListRoomsInput, availableDuring?: TimeRange): Promise<RoomPage>;
  /** Both states by default; items and filtered total share one database snapshot. */
  listForAdmin(input: ListRoomsInput, isActive?: boolean): Promise<RoomPage>;
  findActiveById(id: string): Promise<Room | null>;
  findById(id: string): Promise<Room | null>;
  /** Confirmed bookings overlapping the range, ordered by start time. Null means no active room. */
  findActiveRoomBusyIntervals(id: string, range: TimeRange): Promise<TimeRange[] | null>;
}
