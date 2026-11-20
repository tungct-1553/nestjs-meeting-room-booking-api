import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { PaginationRequestDto } from '../../../common/http/dto/pagination-request.dto';
import type { BookingStatus } from '../../application/models/booking';

export class ListBookingsRequestDto extends PaginationRequestDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    default: 1,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  declare page: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 20 })
  declare limit: number;

  @ApiPropertyOptional({ enum: ['confirmed', 'cancelled'] })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['confirmed', 'cancelled'])
  status?: BookingStatus;
}
