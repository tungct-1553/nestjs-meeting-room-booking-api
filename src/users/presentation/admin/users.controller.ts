import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../../../identity/decorators/current-principal.decorator';
import { Roles } from '../../../identity/decorators/roles.decorator';
import type { Principal } from '../../../identity/public/principal';
import { UsersService } from '../../users.service';
import { AdminUserResponseDto } from './user-response.dto';
@ApiTags('Admin Users')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}
  @Get('me')
  @ApiOkResponse({ schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/AdminUserResponseDto' } } } })
  async me(@CurrentPrincipal() principal: Principal): Promise<AdminUserResponseDto> { return AdminUserResponseDto.from(await this.users.requireBySub(principal.sub)); }
}
