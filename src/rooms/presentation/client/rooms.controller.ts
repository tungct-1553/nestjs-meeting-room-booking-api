import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOAuth2,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiDataResponse } from '../../../common/http/decorators/api-data-response.decorator';
import { TimeRangeRequestDto } from '../../../common/http/dto/time-range-request.dto';
import { PaginatedResponse } from '../../../common/http/types/paginated-response';
import { Roles } from '../../../identity/public/http/roles.decorator';
import { RoomsService } from '../../application/rooms.service';
import { ListRoomsRequestDto } from './list-rooms-request.dto';
import { ClientRoomResponseDto } from './room-response.dto';
import { RoomPageResponseDto } from './room-page-response.dto';
import { ListAvailableRoomsRequestDto } from './list-available-rooms-request.dto';
import { RoomAvailabilityResponseDto } from './room-availability-response.dto';
import type { RoomPage } from '../../application/models/room-page';

function toRoomPage(result: RoomPage): PaginatedResponse<ClientRoomResponseDto> {
  return new PaginatedResponse(result.items.map(ClientRoomResponseDto.from), {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
}

@ApiTags('Client Rooms')
@ApiBearerAuth()
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Employee or Admin role is required' })
@ApiBadRequestResponse({ description: 'Invalid room query or UUID' })
@Roles('employee')
@Controller('client/rooms')
export class ClientRoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @ApiOkResponse({ type: RoomPageResponseDto })
  async list(@Query() dto: ListRoomsRequestDto): Promise<PaginatedResponse<ClientRoomResponseDto>> {
    const result = await this.rooms.list({
      page: dto.page,
      limit: dto.limit,
      capacity: dto.capacity,
      search: dto.search,
    });
    return toRoomPage(result);
  }

  @Get('available')
  @ApiOkResponse({ type: RoomPageResponseDto })
  async listAvailable(
    @Query() dto: ListAvailableRoomsRequestDto,
  ): Promise<PaginatedResponse<ClientRoomResponseDto>> {
    const result = await this.rooms.listAvailable(
      { page: dto.page, limit: dto.limit, capacity: dto.capacity, search: dto.search },
      { startAt: new Date(dto.startAt), endAt: new Date(dto.endAt) },
    );
    return toRoomPage(result);
  }

  @Get(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiDataResponse(ClientRoomResponseDto)
  @ApiNotFoundResponse({ description: 'Room was not found or is inactive' })
  async detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<ClientRoomResponseDto> {
    return ClientRoomResponseDto.from(await this.rooms.detail(id));
  }

  @Get(':id/availability')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiDataResponse(RoomAvailabilityResponseDto)
  @ApiNotFoundResponse({ description: 'Room was not found or is inactive' })
  async availability(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() dto: TimeRangeRequestDto,
  ): Promise<RoomAvailabilityResponseDto> {
    const availableIntervals = await this.rooms.availability(id, {
      startAt: new Date(dto.startAt),
      endAt: new Date(dto.endAt),
    });
    return { roomId: id, availableIntervals };
  }
}
