import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';
import { RoomListQueryDto } from '../room-list-query.dto';

export class ListAdminRoomsRequestDto extends RoomListQueryDto {
  @ApiPropertyOptional({ type: Boolean, description: 'Filter by room activation status' })
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
