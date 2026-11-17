import { ApiProperty } from '@nestjs/swagger';
import type { Room } from '../../application/models/room';

export class AdminRoomResponseDto {
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

  static from(room: Room): AdminRoomResponseDto {
    return Object.assign(new AdminRoomResponseDto(), {
      id: room.id,
      name: room.name,
      capacity: room.capacity,
      description: room.description,
      isActive: room.isActive,
    });
  }
}
