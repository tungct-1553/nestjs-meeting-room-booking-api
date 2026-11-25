import { IntersectionType } from '@nestjs/swagger';
import { TimeRangeRequestDto } from '../../../common/http/dto/time-range-request.dto';
import { ListRoomsRequestDto } from './list-rooms-request.dto';

export class ListAvailableRoomsRequestDto extends IntersectionType(
  ListRoomsRequestDto,
  TimeRangeRequestDto,
) {}
