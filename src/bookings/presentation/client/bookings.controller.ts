import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOAuth2,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiDataResponse } from '../../../common/http/decorators/api-data-response.decorator';
import { CurrentPrincipal } from '../../../identity/public/http/current-principal.decorator';
import { Roles } from '../../../identity/public/http/roles.decorator';
import type { Principal } from '../../../identity/public/principal';
import { BookingsService } from '../../application/bookings.service';
import { ClientBookingResponseDto } from './booking-response.dto';
import { CreateBookingRequestDto } from './create-booking-request.dto';

@ApiTags('Client Bookings')
@ApiBearerAuth()
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Employee/Admin role or booking ownership is required' })
@ApiBadRequestResponse({ description: 'Invalid booking input' })
@ApiConflictResponse({
  description: 'User profile is not provisioned or booking overlaps an existing confirmed booking',
})
@Roles('employee', 'admin')
@Controller('client/bookings')
export class ClientBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiNotFoundResponse({ description: 'Room is unavailable' })
  @ApiDataResponse(ClientBookingResponseDto, HttpStatus.CREATED)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateBookingRequestDto,
  ): Promise<ClientBookingResponseDto> {
    const booking = await this.bookings.create({
      actorSub: principal.sub,
      roomId: dto.roomId,
      title: dto.title,
      startAt: new Date(dto.startAt),
      endAt: new Date(dto.endAt),
    });
    return ClientBookingResponseDto.from(booking);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNotFoundResponse({ description: 'Booking was not found' })
  @ApiDataResponse(ClientBookingResponseDto)
  async cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ClientBookingResponseDto> {
    const booking = await this.bookings.cancel({ actorSub: principal.sub, bookingId: id });
    return ClientBookingResponseDto.from(booking);
  }
}
