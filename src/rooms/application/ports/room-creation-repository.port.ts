import type { Room } from '../models/room';

export const ROOM_CREATION_REPOSITORY = Symbol('ROOM_CREATION_REPOSITORY');

export interface NewRoom {
  name: string;
  capacity: number;
  description: string | null;
  isActive: boolean;
}

export interface RoomCreationRepositoryPort {
  create(input: NewRoom): Promise<Room>;
}
