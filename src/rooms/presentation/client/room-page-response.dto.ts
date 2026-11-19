import { ApiProperty } from '@nestjs/swagger';
import { ClientRoomResponseDto } from './room-response.dto';

export class RoomPageMetaResponseDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}

export class RoomPageResponseDto {
  @ApiProperty({ type: [ClientRoomResponseDto] })
  data!: ClientRoomResponseDto[];

  @ApiProperty({ type: RoomPageMetaResponseDto })
  meta!: RoomPageMetaResponseDto;
}
