import {
  Body,
  Delete,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiDataResponse } from '../../../common/http/decorators/api-data-response.decorator';
import { Roles } from '../../../identity/public/http/roles.decorator';
import { RoomsService } from '../../application/rooms.service';
import { CreateRoomRequestDto } from './create-room-request.dto';
import { AdminRoomResponseDto } from './room-response.dto';
import { UpdateRoomRequestDto } from './update-room-request.dto';

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
}
