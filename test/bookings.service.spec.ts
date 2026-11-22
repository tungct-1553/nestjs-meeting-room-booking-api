import { BookingsService } from '../src/bookings/application/bookings.service';
import type { BookingUnitOfWork } from '../src/bookings/application/ports/booking-unit-of-work.port';
import {
  BookingNotFoundError,
  BookingOwnerRequiredError,
  InvalidBookingInputError,
  InvalidBookingTimeError,
  RoomUnavailableError,
} from '../src/bookings/application/errors/booking.errors';
const principal = {
  sub: 'verified-sub',
  email: null,
  displayName: null,
  roles: ['employee' as const],
};
const input = {
  actorSub: principal.sub,
  roomId: 'room-id',
  title: 'Meeting',
  startAt: new Date('2099-01-01T10:00:00Z'),
  endAt: new Date('2099-01-01T11:00:00Z'),
};
describe('BookingsService', () => {
  const insert = jest.fn().mockImplementation(async (value) => value);
  const lockForBooking = jest.fn();
  const lockById = jest.fn();
  const updateSchedule = jest.fn();
  const updateStatus = jest.fn();
  const users = { requireBySub: jest.fn().mockResolvedValue({ id: 'local-user' }) };
  const reader = { listByUser: jest.fn(), findById: jest.fn() };
  const uow: BookingUnitOfWork = {
    run: (work) =>
      work({
        rooms: { lockForBooking },
        bookings: { insert, lockById, updateStatus, updateSchedule },
      }),
  };
  const service = new BookingsService(users, uow, reader);
  beforeEach(() => {
    jest.clearAllMocks();
    lockForBooking.mockResolvedValue({ id: 'room-id', isActive: true });
    lockById.mockResolvedValue({
      ...input,
      id: 'booking-id',
      userId: 'local-user',
      status: 'confirmed',
    });
    updateStatus.mockImplementation(async (id, status) => ({
      ...input,
      id,
      userId: 'local-user',
      status,
    }));
  });
  it('takes ownership only from provisioned user lookup', async () => {
    await service.create({ ...input, userId: 'attacker' } as typeof input);
    expect(users.requireBySub).toHaveBeenCalledWith(principal.sub);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'local-user', status: 'confirmed' }),
    );
  });
  it('does not start booking writes for an unprovisioned identity', async () => {
    users.requireBySub.mockRejectedValueOnce(new Error('not provisioned'));
    await expect(service.create(input)).rejects.toThrow('not provisioned');
    expect(lockForBooking).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
  it('rejects missing or inactive rooms without writes', async () => {
    lockForBooking
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'room-id', isActive: false });
    await expect(service.create(input)).rejects.toBeInstanceOf(RoomUnavailableError);
    await expect(service.create(input)).rejects.toBeInstanceOf(RoomUnavailableError);
    expect(insert).not.toHaveBeenCalled();
  });
  it('rejects invalid or elapsed time after acquiring the room lock', async () => {
    lockForBooking.mockImplementationOnce(async () => {
      jest.spyOn(Date, 'now').mockReturnValue(new Date('2099-01-01T10:00:01Z').getTime());
      return { id: 'room-id', isActive: true };
    });
    try {
      await expect(service.create(input)).rejects.toBeInstanceOf(InvalidBookingTimeError);
    } finally {
      jest.restoreAllMocks();
    }
    await expect(service.create({ ...input, endAt: new Date('invalid') })).rejects.toBeInstanceOf(
      InvalidBookingTimeError,
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('normalizes title before persisting without changing owner or status', async () => {
    await service.create({ ...input, title: '  Team meeting  ' });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Team meeting', status: 'confirmed' }),
    );
  });

  it.each(['', '  ', 'x'.repeat(201), 'A\0B', null, 1])(
    'rejects invalid application title %j before lookup/transaction',
    async (title) => {
      await expect(service.create({ ...input, title: title as string })).rejects.toBeInstanceOf(
        InvalidBookingInputError,
      );
      expect(users.requireBySub).not.toHaveBeenCalled();
      expect(lockForBooking).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it('accepts the Unicode code point title limit', async () => {
    await service.create({ ...input, title: '😀'.repeat(200) });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ title: '😀'.repeat(200) }));
  });

  it('locks the booking and selects cancelled status only after checking its owner', async () => {
    const result = await service.cancel({ actorSub: principal.sub, bookingId: 'booking-id' });
    expect(users.requireBySub).toHaveBeenCalledWith(principal.sub);
    expect(lockById).toHaveBeenCalledWith('booking-id');
    expect(updateStatus).toHaveBeenCalledWith('booking-id', 'cancelled');
    expect(lockById.mock.invocationCallOrder[0]).toBeLessThan(
      updateStatus.mock.invocationCallOrder[0],
    );
    expect(lockForBooking).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
  });

  it('returns an already cancelled booking without an additional write', async () => {
    const booking = { ...input, id: 'booking-id', userId: 'local-user', status: 'cancelled' };
    lockById.mockResolvedValueOnce(booking);
    await expect(service.cancel({ actorSub: principal.sub, bookingId: booking.id })).resolves.toBe(
      booking,
    );
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('reports missing booking and rejects a different owner even for a cancelled booking', async () => {
    lockById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'booking-id', userId: 'other-user', status: 'cancelled' });
    const cancel = () => service.cancel({ actorSub: principal.sub, bookingId: 'booking-id' });
    await expect(cancel()).rejects.toBeInstanceOf(BookingNotFoundError);
    await expect(cancel()).rejects.toBeInstanceOf(BookingOwnerRequiredError);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('does not access a booking for an unprovisioned actor', async () => {
    users.requireBySub.mockRejectedValueOnce(new Error('not provisioned'));
    await expect(
      service.cancel({ actorSub: principal.sub, bookingId: 'booking-id' }),
    ).rejects.toThrow('not provisioned');
    expect(lockById).not.toHaveBeenCalled();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('propagates a persistence failure from cancellation', async () => {
    const error = new Error('write failed');
    updateStatus.mockRejectedValueOnce(error);
    await expect(service.cancel({ actorSub: principal.sub, bookingId: 'booking-id' })).rejects.toBe(
      error,
    );
  });
});
