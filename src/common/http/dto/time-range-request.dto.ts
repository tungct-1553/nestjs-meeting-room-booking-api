import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsString, Matches } from 'class-validator';

const TIME_WITH_OFFSET = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export class TimeRangeRequestDto {
  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601 with timezone. Fractional seconds are truncated to milliseconds.',
    example: '2099-01-01T10:00:00Z',
  })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(TIME_WITH_OFFSET)
  startAt!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601 with timezone. Fractional seconds are truncated to milliseconds.',
    example: '2099-01-01T11:00:00Z',
  })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(TIME_WITH_OFFSET)
  endAt!: string;
}
