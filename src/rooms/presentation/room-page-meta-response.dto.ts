import { ApiProperty } from '@nestjs/swagger';

export class RoomPageMetaResponseDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}
