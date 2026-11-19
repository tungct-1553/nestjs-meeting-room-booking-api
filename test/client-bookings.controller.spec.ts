import { Test } from '@nestjs/testing';
import { BookingsService } from '../src/bookings/application/bookings.service';
import { BookingOwnerRequiredError } from '../src/bookings/application/errors/booking.errors';
import { ClientBookingsController } from '../src/bookings/presentation/client/bookings.controller';

const principal = {
  sub: 'verified-sub',
  email: null,
  displayName: null,
  roles: ['employee' as const],
};
const booking = {
  id: 'booking-id',
  roomId: 'room-id',
  userId: 'user-id',
  title: 'Meeting',
  startAt: new Date('2099-01-01T10:00:00Z'),
  endAt: new Date('2099-01-01T11:00:00Z'),
  status: 'confirmed' as const,
  createdAt: new Date('2098-12-01T10:00:00Z'),
};
const response = {
  ...booking,
  startAt: booking.startAt.toISOString(),
  endAt: booking.endAt.toISOString(),
  createdAt: booking.createdAt.toISOString(),
};

describe('ClientBookingsController', () => {
  let controller: ClientBookingsController;
  const bookings = { create: jest.fn(), cancel: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ClientBookingsController],
      providers: [{ provide: BookingsService, useValue: bookings }],
    }).compile();
    controller = module.get(ClientBookingsController);
  });

  it('maps verified sub and dates, returning only response fields serialized in UTC', async () => {
    bookings.create.mockResolvedValue({ ...booking, privateField: 'hidden' });
    const dto = {
      roomId: booking.roomId,
      title: booking.title,
      startAt: '2099-01-01T17:00:00+07:00',
      endAt: '2099-01-01T18:00:00+07:00',
    };
    expect(await controller.create(principal, dto)).toEqual(response);
    expect(bookings.create).toHaveBeenCalledWith({
      actorSub: principal.sub,
      roomId: booking.roomId,
      title: booking.title,
      startAt: booking.startAt,
      endAt: booking.endAt,
    });
  });

  it('maps cancel route and verified identity, preserving response whitelist', async () => {
    bookings.cancel.mockResolvedValue({ ...booking, status: 'cancelled', privateField: 'hidden' });
    expect(await controller.cancel(principal, booking.id)).toEqual({
      ...response,
      status: 'cancelled',
    });
    expect(bookings.cancel).toHaveBeenCalledWith({
      actorSub: principal.sub,
      bookingId: booking.id,
    });
  });

  it('propagates application errors without HTTP-specific translation', async () => {
    const error = new BookingOwnerRequiredError();
    bookings.cancel.mockRejectedValue(error);
    await expect(controller.cancel(principal, booking.id)).rejects.toBe(error);
  });
});
