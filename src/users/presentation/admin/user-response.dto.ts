import { ApiProperty } from '@nestjs/swagger';
import type { User } from '../../public/user';
export class AdminUserResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
  static from(user: User): AdminUserResponseDto { return Object.assign(new AdminUserResponseDto(), { id: user.id, email: user.email, displayName: user.displayName }); }
}
