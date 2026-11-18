import { ApiProperty } from '@nestjs/swagger';
import type { Booking, BookingStatus } from '../../application/models/booking';

export class ClientBookingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  roomId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ format: 'date-time' })
  startAt!: string;

  @ApiProperty({ format: 'date-time' })
  endAt!: string;

  @ApiProperty({ enum: ['confirmed', 'cancelled'] })
  status!: BookingStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  static from(booking: Booking): ClientBookingResponseDto {
    return {
      id: booking.id,
      roomId: booking.roomId,
      userId: booking.userId,
      title: booking.title,
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      status: booking.status,
      createdAt: booking.createdAt.toISOString(),
    };
  }
}
