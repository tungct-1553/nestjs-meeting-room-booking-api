import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  NotContains,
  ValidateIf,
} from 'class-validator';
import {
  MAX_ROOM_CAPACITY,
  MAX_ROOM_NAME_LENGTH,
} from '../../application/policies/room-details.policy';
import { formatRoomNameText } from '../../application/policies/room-name-text';

export class UpdateRoomRequestDto {
  @ApiPropertyOptional({
    description:
      'Trimmed and normalized to NFC before validation; the normalized name must contain 1..200 Unicode code points. Omit to keep the name; display capitalization is preserved.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? formatRoomNameText(value) : value,
  )
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(MAX_ROOM_NAME_LENGTH)
  @NotContains('\0')
  name?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: MAX_ROOM_CAPACITY })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(MAX_ROOM_CAPACITY)
  capacity?: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Omit to retain the description; null clears it.',
  })
  @IsOptional()
  @IsString()
  @NotContains('\0')
  description?: string | null;
}
