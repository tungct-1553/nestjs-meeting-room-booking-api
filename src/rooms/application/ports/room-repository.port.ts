import type { RoomSnapshot } from '../models/room-snapshot';

export interface RoomTransactionRepositoryPort {
  lockById(id: string): Promise<RoomSnapshot | null>;
  setActive(id: string, isActive: boolean): Promise<void>;
}
