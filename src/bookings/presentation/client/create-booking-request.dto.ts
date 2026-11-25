import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Matches, MaxLength, NotContains } from 'class-validator';
import { TimeRangeRequestDto } from '../../../common/http/dto/time-range-request.dto';
import { MAX_BOOKING_TITLE_LENGTH } from '../../application/policies/booking-title.policy';

export class CreateBookingRequestDto extends TimeRangeRequestDto {
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
}
