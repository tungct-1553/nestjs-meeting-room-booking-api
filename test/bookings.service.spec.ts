import { BookingsService } from '../src/bookings/bookings.service';
import { UsersService } from '../src/users/users.service';
import type { BookingUnitOfWork } from '../src/bookings/ports/booking-unit-of-work.port';
import { InvalidBookingTimeError, RoomUnavailableError } from '../src/bookings/errors/booking.errors';
const principal = { sub: 'verified-sub', email: null, displayName: null, roles: ['employee' as const] };
const dto = { roomId: 'room-id', title: 'Meeting', startAt: '2099-01-01T10:00:00Z', endAt: '2099-01-01T11:00:00Z' };
describe('BookingsService', () => {
  const insert = jest.fn().mockImplementation(async (value) => value);
  const lockForBooking = jest.fn();
  const users = { requireBySub: jest.fn().mockResolvedValue({ id: 'local-user' }) };
  const uow: BookingUnitOfWork = { run: (work) => work({ rooms: { lockForBooking }, bookings: { insert } }) };
  const service = new BookingsService(users as unknown as UsersService, uow);
  beforeEach(() => { jest.clearAllMocks(); lockForBooking.mockResolvedValue({ id: 'room-id', isActive: true }); });
  it('takes ownership only from provisioned user lookup', async () => {
    await service.create(principal, { ...dto, userId: 'attacker' } as typeof dto);
    expect(users.requireBySub).toHaveBeenCalledWith(principal.sub);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'local-user' }));
  });
  it('does not start booking writes for an unprovisioned identity', async () => {
    users.requireBySub.mockRejectedValueOnce(new Error('not provisioned'));
    await expect(service.create(principal, dto)).rejects.toThrow('not provisioned');
    expect(lockForBooking).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
  it('rejects missing or inactive rooms without writes', async () => {
    lockForBooking.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'room-id', isActive: false });
    await expect(service.create(principal, dto)).rejects.toBeInstanceOf(RoomUnavailableError);
    await expect(service.create(principal, dto)).rejects.toBeInstanceOf(RoomUnavailableError);
    expect(insert).not.toHaveBeenCalled();
  });
  it('rejects invalid or elapsed time after acquiring the room lock', async () => {
    lockForBooking.mockImplementationOnce(async () => { jest.spyOn(Date, 'now').mockReturnValue(new Date('2099-01-01T10:00:01Z').getTime()); return { id: 'room-id', isActive: true }; });
    try { await expect(service.create(principal, dto)).rejects.toBeInstanceOf(InvalidBookingTimeError); }
    finally { jest.restoreAllMocks(); }
    await expect(service.create(principal, { ...dto, endAt: 'invalid' })).rejects.toBeInstanceOf(InvalidBookingTimeError);
    expect(insert).not.toHaveBeenCalled();
  });
});
