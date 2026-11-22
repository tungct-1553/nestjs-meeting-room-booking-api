import {
  Body,
  Controller,
  Delete,
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
  ApiBearerAuth,
  ApiConflictResponse,
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
import { CurrentPrincipal } from '../../../identity/public/http/current-principal.decorator';
import { Roles } from '../../../identity/public/http/roles.decorator';
import type { Principal } from '../../../identity/public/principal';
import { BookingsService } from '../../application/bookings.service';
import { ClientBookingResponseDto } from './booking-response.dto';
import { CreateBookingRequestDto } from './create-booking-request.dto';
import { PaginatedResponse } from '../../../common/http/types/paginated-response';
import { ListBookingsRequestDto } from './list-bookings-request.dto';
import { BookingPageResponseDto } from './booking-page-response.dto';

@ApiTags('Client Bookings')
@ApiBearerAuth()
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Employee/Admin role or booking ownership is required' })
@ApiBadRequestResponse({ description: 'Invalid booking input' })
@ApiConflictResponse({ description: 'User profile is not provisioned' })
@Roles('employee', 'admin')
@Controller('client/bookings')
export class ClientBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @ApiOkResponse({ type: BookingPageResponseDto })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() dto: ListBookingsRequestDto,
  ): Promise<PaginatedResponse<ClientBookingResponseDto>> {
    const result = await this.bookings.list({
      actorSub: principal.sub,
      page: dto.page,
      limit: dto.limit,
      status: dto.status,
    });
    return new PaginatedResponse(result.items.map(ClientBookingResponseDto.from), {
      page: result.page,
      limit: result.limit,
      total: result.total,
    });
  }

  @Get(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNotFoundResponse({ description: 'Booking was not found' })
  @ApiDataResponse(ClientBookingResponseDto)
  async detail(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ClientBookingResponseDto> {
    const booking = await this.bookings.detail({ actorSub: principal.sub, bookingId: id });
    return ClientBookingResponseDto.from(booking);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiConflictResponse({
    description:
      'User profile is not provisioned or booking overlaps an existing confirmed booking',
  })
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

  @Patch(':id/schedule')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNotFoundResponse({ description: 'Booking was not found or room is unavailable' })
  @ApiConflictResponse({
    description: 'Profile is not provisioned, booking cannot be rescheduled, or time overlaps',
  })
  @ApiDataResponse(ClientBookingResponseDto)
  async reschedule(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TimeRangeRequestDto,
  ): Promise<ClientBookingResponseDto> {
    const booking = await this.bookings.reschedule({
      actorSub: principal.sub,
      bookingId: id,
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
