import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
} from 'class-validator';
import {
  MAX_ROOM_CAPACITY,
  MAX_ROOM_NAME_LENGTH,
} from '../../application/policies/room-details.policy';

export class CreateRoomRequestDto {
  @ApiProperty({ minLength: 1, maxLength: MAX_ROOM_NAME_LENGTH, pattern: '\\S' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(MAX_ROOM_NAME_LENGTH)
  @NotContains('\0')
  name!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_ROOM_CAPACITY })
  @IsInt()
  @Min(1)
  @Max(MAX_ROOM_CAPACITY)
  capacity!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @NotContains('\0')
  description?: string | null;
}
