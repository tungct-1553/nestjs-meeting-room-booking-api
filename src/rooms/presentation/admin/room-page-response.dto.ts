import { ApiProperty } from '@nestjs/swagger';
import { RoomPageMetaResponseDto } from '../room-page-meta-response.dto';
import { AdminRoomResponseDto } from './room-response.dto';

export class AdminRoomPageResponseDto {
  @ApiProperty({ type: [AdminRoomResponseDto] })
  data!: AdminRoomResponseDto[];

  @ApiProperty({ type: RoomPageMetaResponseDto })
  meta!: RoomPageMetaResponseDto;
}
