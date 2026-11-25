import { ApiProperty } from '@nestjs/swagger';
import { RoomPageMetaResponseDto } from '../room-page-meta-response.dto';
import { ClientRoomResponseDto } from './room-response.dto';

export class RoomPageResponseDto {
  @ApiProperty({ type: [ClientRoomResponseDto] })
  data!: ClientRoomResponseDto[];

  @ApiProperty({ type: RoomPageMetaResponseDto })
  meta!: RoomPageMetaResponseDto;
}
