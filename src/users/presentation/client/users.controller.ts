import { Controller, Get } from '@nestjs/common';
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
  async me(@CurrentPrincipal() principal: Principal): Promise<ClientUserResponseDto> { return ClientUserResponseDto.from(await this.users.getOrSync(principal)); }
}
