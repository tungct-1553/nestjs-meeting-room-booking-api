import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../../../identity/decorators/current-principal.decorator';
import { Roles } from '../../../identity/decorators/roles.decorator';
import type { Principal } from '../../../identity/public/principal';
import { UsersService } from '../../users.service';
import { ClientUserResponseDto } from './user-response.dto';
@ApiTags('Client Users')
@ApiBearerAuth()
@Roles('employee')
@Controller('client/users')
export class ClientUsersController {
  constructor(private readonly users: UsersService) {}
  @Get('me')
  @ApiOkResponse({ schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/ClientUserResponseDto' } } } })
  async me(@CurrentPrincipal() principal: Principal): Promise<ClientUserResponseDto> { return ClientUserResponseDto.from(await this.users.requireBySub(principal.sub)); }
  @Post('sync')
  @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/ClientUserResponseDto' } } } })
  async sync(@CurrentPrincipal() principal: Principal, @Body() body: unknown, @Req() request: Request): Promise<ClientUserResponseDto> {
    const unparsedPayload = body === undefined && (Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined);
    if (unparsedPayload || body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)) throw new BadRequestException('Request body must be empty');
    return ClientUserResponseDto.from(await this.users.sync(principal));
  }
}
