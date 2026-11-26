import {
  Body,
  Delete,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiNoContentResponse,
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
import { CreateRoomRequestDto } from './create-room-request.dto';
import { ListAdminRoomsRequestDto } from './list-admin-rooms-request.dto';
import { AdminRoomPageResponseDto } from './room-page-response.dto';
import { AdminRoomResponseDto } from './room-response.dto';
import { UpdateRoomRequestDto } from './update-room-request.dto';
import { UpdateRoomStatusRequestDto } from './update-room-status-request.dto';

@ApiTags('Admin Rooms')
@ApiBearerAuth()
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Admin role is required' })
@ApiBadRequestResponse({ description: 'Invalid room input' })
@Roles('admin')
@Controller('admin/rooms')
export class AdminRoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @ApiOkResponse({ type: AdminRoomPageResponseDto })
  async list(
    @Query() dto: ListAdminRoomsRequestDto,
  ): Promise<PaginatedResponse<AdminRoomResponseDto>> {
    const result = await this.rooms.listForAdmin(
      { page: dto.page, limit: dto.limit, capacity: dto.capacity, search: dto.search },
      dto.isActive,
    );
    return new PaginatedResponse(result.items.map(AdminRoomResponseDto.from), {
      page: result.page,
      limit: result.limit,
      total: result.total,
    });
  }

  @Get(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNotFoundResponse({ description: 'Room was not found' })
  @ApiDataResponse(AdminRoomResponseDto)
  async detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<AdminRoomResponseDto> {
    return AdminRoomResponseDto.from(await this.rooms.detailForAdmin(id));
  }

  @Post()
  @ApiConflictResponse({ description: 'Room name is already in use' })
  @HttpCode(HttpStatus.CREATED)
  @ApiDataResponse(AdminRoomResponseDto, HttpStatus.CREATED)
  async create(@Body() dto: CreateRoomRequestDto): Promise<AdminRoomResponseDto> {
    const room = await this.rooms.create({
      name: dto.name,
      capacity: dto.capacity,
      description: dto.description,
    });
    return AdminRoomResponseDto.from(room);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse({ description: 'Room deactivated; existing bookings are preserved' })
  @ApiNotFoundResponse({ description: 'Room was not found' })
  async deactivate(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.rooms.deactivate(id);
  }

  @Patch(':id')
  @ApiConflictResponse({ description: 'Room name is already in use' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({
    type: UpdateRoomRequestDto,
    description:
      'Provide at least one editable field. Omitted fields stay unchanged; description: null clears the description.',
  })
  @ApiNotFoundResponse({ description: 'Room was not found' })
  @ApiDataResponse(AdminRoomResponseDto)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRoomRequestDto,
  ): Promise<AdminRoomResponseDto> {
    const room = await this.rooms.update({
      roomId: id,
      name: dto.name,
      capacity: dto.capacity,
      description: dto.description,
    });
    return AdminRoomResponseDto.from(room);
  }

  @Patch(':id/status')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNotFoundResponse({ description: 'Room was not found' })
  @ApiDataResponse(AdminRoomResponseDto)
  async setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRoomStatusRequestDto,
  ): Promise<AdminRoomResponseDto> {
    return AdminRoomResponseDto.from(await this.rooms.setStatus(id, dto.isActive));
  }
}
