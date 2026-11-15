import { Inject, Injectable } from '@nestjs/common';
import { ROOM_REPOSITORY } from './ports/room-repository.port';
import type { RoomRepositoryPort } from './ports/room-repository.port';
@Injectable()
export class RoomsService {
  constructor(@Inject(ROOM_REPOSITORY) private readonly repository: RoomRepositoryPort) {}
  deactivate(roomId: string): Promise<void> { return this.repository.deactivate(roomId); }
}
