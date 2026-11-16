import { ApiProperty } from '@nestjs/swagger';
import type { User } from '../../public/user';
export class ClientUserResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
  static from(user: User): ClientUserResponseDto { return Object.assign(new ClientUserResponseDto(), { id: user.id, email: user.email, displayName: user.displayName }); }
}
