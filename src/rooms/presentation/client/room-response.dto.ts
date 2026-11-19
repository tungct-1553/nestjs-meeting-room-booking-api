import { ApiProperty } from '@nestjs/swagger';
import type { Room } from '../../application/models/room';

export class ClientRoomResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  capacity!: number;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty()
  isActive!: boolean;

  static from(room: Room): ClientRoomResponseDto {
    return Object.assign(new ClientRoomResponseDto(), {
      id: room.id,
      name: room.name,
      capacity: room.capacity,
      description: room.description,
      isActive: room.isActive,
    });
  }
}
