import { IsISO8601, IsNotEmpty, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
export class CreateBookingRequestDto {
  @IsUUID() roomId!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsISO8601({ strict: true }) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) startAt!: string;
  @IsISO8601({ strict: true }) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) endAt!: string;
}
