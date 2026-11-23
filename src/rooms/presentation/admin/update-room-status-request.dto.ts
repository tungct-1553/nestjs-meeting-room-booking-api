import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateRoomStatusRequestDto {
  @ApiProperty({ type: Boolean, description: 'Whether the room can be booked' })
  @IsBoolean()
  isActive!: boolean;
}
