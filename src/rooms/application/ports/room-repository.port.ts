import type { RoomSnapshot } from '../models/room-snapshot';
import type { Room, RoomDetailsPatch } from '../models/room';

export interface RoomTransactionRepositoryPort {
  lockById(id: string): Promise<RoomSnapshot | null>;
  setActive(id: string, isActive: boolean): Promise<void>;
  updateDetails(id: string, patch: RoomDetailsPatch): Promise<Room>;
}
