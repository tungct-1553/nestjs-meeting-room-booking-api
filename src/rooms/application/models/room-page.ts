import type { Room } from './room';

export interface RoomPage {
  items: Room[];
  page: number;
  limit: number;
  total: number;
}
