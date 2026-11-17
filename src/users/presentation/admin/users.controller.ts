import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse } from '../../../common/http/decorators/api-data-response.decorator';
import { CurrentPrincipal } from '../../../identity/public/http/current-principal.decorator';
import { Roles } from '../../../identity/public/http/roles.decorator';
import type { Principal } from '../../../identity/public/principal';
import { UsersService } from '../../application/users.service';
import { AdminUserResponseDto } from './user-response.dto';
@ApiTags('Admin Users')
@ApiBearerAuth()
@ApiOAuth2(['openid', 'profile', 'email'])
@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}
  @Get('me')
  @ApiDataResponse(AdminUserResponseDto)
  async me(@CurrentPrincipal() principal: Principal): Promise<AdminUserResponseDto> {
    const user = await this.users.requireBySub(principal.sub);
    return AdminUserResponseDto.from(user);
  }
}
