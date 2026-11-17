import { BookingsService } from '../src/bookings/application/bookings.service';
import type { BookingUnitOfWork } from '../src/bookings/application/ports/booking-unit-of-work.port';
import {
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
  const users = { requireBySub: jest.fn().mockResolvedValue({ id: 'local-user' }) };
  const uow: BookingUnitOfWork = {
    run: (work) => work({ rooms: { lockForBooking }, bookings: { insert } }),
  };
  const service = new BookingsService(users, uow);
  beforeEach(() => {
    jest.clearAllMocks();
    lockForBooking.mockResolvedValue({ id: 'room-id', isActive: true });
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
});
