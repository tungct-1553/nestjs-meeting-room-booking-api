import { ApiProperty } from '@nestjs/swagger';

class AvailableIntervalResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  startAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  endAt!: Date;
}

export class RoomAvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' })
  roomId!: string;

  @ApiProperty({ type: [AvailableIntervalResponseDto] })
  availableIntervals!: AvailableIntervalResponseDto[];
}
