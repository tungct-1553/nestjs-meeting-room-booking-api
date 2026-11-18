import type { Room } from '../application/models/room';
import type { RoomEntity } from './room.entity';

export function toRoom(row: RoomEntity): Room {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    description: row.description,
    isActive: row.isActive,
  };
}
