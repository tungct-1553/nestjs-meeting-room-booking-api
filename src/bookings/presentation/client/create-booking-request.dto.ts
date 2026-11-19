import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsString, IsUUID, Matches, MaxLength, NotContains } from 'class-validator';
import { MAX_BOOKING_TITLE_LENGTH } from '../../application/policies/booking-title.policy';

export class CreateBookingRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roomId!: string;

  @ApiProperty({
    description: 'Trimmed title, 1..200 Unicode code points; no NUL',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(MAX_BOOKING_TITLE_LENGTH)
  @NotContains('\0')
  title!: string;

  @ApiProperty({ format: 'date-time', example: '2099-01-01T10:00:00Z' })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/)
  startAt!: string;

  @ApiProperty({ format: 'date-time', example: '2099-01-01T11:00:00Z' })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/)
  endAt!: string;
}
