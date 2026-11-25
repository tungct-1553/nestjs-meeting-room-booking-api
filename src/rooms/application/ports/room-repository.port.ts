import type { RoomSnapshot } from '../models/room-snapshot';
import type { Room, RoomDetailsPatch } from '../models/room';

export interface RoomTransactionRepositoryPort {
  lockById(id: string): Promise<RoomSnapshot | null>;
  /** Sets the state of a locked room and returns it. An unchanged state leaves the row untouched. */
  setActive(id: string, isActive: boolean): Promise<Room>;
  updateDetails(id: string, patch: RoomDetailsPatch): Promise<Room>;
}
