import { ApiProperty } from '@nestjs/swagger';
import { ClientBookingResponseDto } from './booking-response.dto';

export class BookingPageMetaResponseDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}

export class BookingPageResponseDto {
  @ApiProperty({ type: [ClientBookingResponseDto] })
  data!: ClientBookingResponseDto[];

  @ApiProperty({ type: BookingPageMetaResponseDto })
  meta!: BookingPageMetaResponseDto;
}
