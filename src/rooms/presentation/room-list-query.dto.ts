import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, NotContains, ValidateIf } from 'class-validator';
import { PaginationRequestDto } from '../../common/http/dto/pagination-request.dto';
import {
  MAX_ROOM_CAPACITY,
  MAX_ROOM_NAME_LENGTH,
} from '../application/policies/room-details.policy';
import { formatRoomNameText } from '../application/policies/room-name-text';

export class RoomListQueryDto extends PaginationRequestDto {
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

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_ROOM_CAPACITY,
    description: 'Minimum room capacity',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(MAX_ROOM_CAPACITY)
  capacity?: number;

  @ApiPropertyOptional({
    type: String,
    description:
      'Trimmed NFC substring, up to 200 normalized Unicode code points. Case-insensitive, accent-sensitive; %, _ and backslash are literal.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? formatRoomNameText(value) : value,
  )
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(MAX_ROOM_NAME_LENGTH)
  @NotContains('\0')
  search?: string;
}
