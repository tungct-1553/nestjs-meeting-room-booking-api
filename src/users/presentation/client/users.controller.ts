import { Controller, Get, HttpCode, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse } from '../../../common/http/decorators/api-data-response.decorator';
import { EmptyBodyInterceptor } from '../../../common/http/interceptors/empty-body.interceptor';
import { CurrentPrincipal } from '../../../identity/public/http/current-principal.decorator';
import { Roles } from '../../../identity/public/http/roles.decorator';
import type { Principal } from '../../../identity/public/principal';
import { UsersService } from '../../application/users.service';
import { ClientUserResponseDto } from './user-response.dto';

@ApiTags('Client Users')
@ApiBearerAuth()
@ApiOAuth2(['openid', 'profile', 'email'])
@Roles('employee')
@Controller('client/users')
export class ClientUsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiDataResponse(ClientUserResponseDto)
  async me(@CurrentPrincipal() principal: Principal): Promise<ClientUserResponseDto> {
    const user = await this.users.requireBySub(principal.sub);
    return ClientUserResponseDto.from(user);
  }

  @Post('sync')
  @HttpCode(200)
  @UseInterceptors(EmptyBodyInterceptor)
  @ApiDataResponse(ClientUserResponseDto)
  async sync(@CurrentPrincipal() principal: Principal): Promise<ClientUserResponseDto> {
    const user = await this.users.sync({
      sub: principal.sub,
      email: principal.email,
      displayName: principal.displayName,
      issuedAt: principal.issuedAt,
    });
    return ClientUserResponseDto.from(user);
  }
}
