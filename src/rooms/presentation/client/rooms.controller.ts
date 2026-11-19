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
import { PaginatedResponse } from '../../../common/http/types/paginated-response';
import { Roles } from '../../../identity/public/http/roles.decorator';
import { RoomsService } from '../../application/rooms.service';
import { ListRoomsRequestDto } from './list-rooms-request.dto';
import { ClientRoomResponseDto } from './room-response.dto';
import { RoomPageResponseDto } from './room-page-response.dto';

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
    return new PaginatedResponse(result.items.map(ClientRoomResponseDto.from), {
      page: result.page,
      limit: result.limit,
      total: result.total,
    });
  }

  @Get(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiDataResponse(ClientRoomResponseDto)
  @ApiNotFoundResponse({ description: 'Room was not found or is inactive' })
  async detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<ClientRoomResponseDto> {
    return ClientRoomResponseDto.from(await this.rooms.detail(id));
  }
}
