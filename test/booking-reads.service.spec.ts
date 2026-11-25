import { BookingsService } from '../src/bookings/application/bookings.service';
import type { BookingUnitOfWork } from '../src/bookings/application/ports/booking-unit-of-work.port';
import {
  BookingNotFoundError,
  BookingOwnerRequiredError,
  InvalidBookingQueryError,
} from '../src/bookings/application/errors/booking.errors';

const users = { requireBySub: jest.fn() };
const reader = { listByUser: jest.fn(), findById: jest.fn() };
const uow: BookingUnitOfWork = { run: jest.fn() };
const service = new BookingsService(users, uow, reader);
const query = { actorSub: 'verified-sub', page: 1, limit: 20 };
const booking = { id: 'booking-id', userId: 'local-user', status: 'confirmed' };

beforeEach(() => {
  jest.resetAllMocks();
  users.requireBySub.mockResolvedValue({ id: 'local-user' });
});

it('lists using only the UUID resolved from the verified subject', async () => {
  const page = { items: [], page: 2, limit: 5, total: 0 };
  reader.listByUser.mockResolvedValueOnce(page);
  await expect(service.list({ ...query, page: 2, limit: 5, status: 'cancelled' })).resolves.toBe(
    page,
  );
  expect(users.requireBySub).toHaveBeenCalledWith(query.actorSub);
  expect(reader.listByUser).toHaveBeenCalledWith({
    userId: 'local-user',
    page: 2,
    limit: 5,
    status: 'cancelled',
  });
  expect(uow.run).not.toHaveBeenCalled();
});

it('omits the status predicate when no filter was requested', async () => {
  await service.list(query);
  expect(reader.listByUser).toHaveBeenCalledWith({
    userId: 'local-user',
    page: 1,
    limit: 20,
    status: undefined,
  });
});

it.each([
  { page: 0 },
  { page: 1.5 },
  { page: NaN },
  { page: Number.MAX_SAFE_INTEGER + 1, limit: 1 },
  { page: Number.MAX_SAFE_INTEGER, limit: 100 },
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
  { status: '' },
  { status: 'pending' },
  { status: null },
])('rejects invalid read input %j before user lookup', async (patch) => {
  await expect(
    service.list({ ...query, ...patch } as Parameters<BookingsService['list']>[0]),
  ).rejects.toBeInstanceOf(InvalidBookingQueryError);
  expect(users.requireBySub).not.toHaveBeenCalled();
  expect(reader.listByUser).not.toHaveBeenCalled();
});

it.each(['confirmed', 'cancelled'] as const)(
  'returns own %s booking without a write',
  async (status) => {
    const result = { ...booking, status };
    reader.findById.mockResolvedValueOnce(result);
    await expect(service.detail({ actorSub: query.actorSub, bookingId: booking.id })).resolves.toBe(
      result,
    );
    expect(reader.findById).toHaveBeenCalledWith(booking.id);
    expect(uow.run).not.toHaveBeenCalled();
  },
);

it('makes missing and owner decisions in application for both booking statuses', async () => {
  reader.findById
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ ...booking, userId: 'someone-else' })
    .mockResolvedValueOnce({ ...booking, userId: 'someone-else', status: 'cancelled' });
  const detail = () => service.detail({ actorSub: query.actorSub, bookingId: booking.id });
  await expect(detail()).rejects.toBeInstanceOf(BookingNotFoundError);
  await expect(detail()).rejects.toBeInstanceOf(BookingOwnerRequiredError);
  await expect(detail()).rejects.toBeInstanceOf(BookingOwnerRequiredError);
});

it('stops both reads before persistence when the actor has no profile', async () => {
  const error = new Error('not provisioned');
  users.requireBySub.mockRejectedValueOnce(error).mockRejectedValueOnce(error);
  await expect(service.list(query)).rejects.toBe(error);
  await expect(service.detail({ actorSub: query.actorSub, bookingId: booking.id })).rejects.toBe(
    error,
  );
  expect(reader.listByUser).not.toHaveBeenCalled();
  expect(reader.findById).not.toHaveBeenCalled();
});

it('propagates read failures without returning an empty list or not-found', async () => {
  const error = new Error('database read failed');
  reader.listByUser.mockRejectedValueOnce(error);
  reader.findById.mockRejectedValueOnce(error);
  await expect(service.list(query)).rejects.toBe(error);
  await expect(service.detail({ actorSub: query.actorSub, bookingId: booking.id })).rejects.toBe(
    error,
  );
});
