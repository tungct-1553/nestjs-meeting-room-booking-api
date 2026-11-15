export const ROOM_REPOSITORY = Symbol('ROOM_REPOSITORY');
export interface RoomRepositoryPort { deactivate(roomId: string): Promise<void>; }
