import { RoomsService } from '../src/rooms/application/rooms.service';
import { RoomNotFoundError } from '../src/rooms/application/errors/room.errors';
import type { RoomsUnitOfWork } from '../src/rooms/application/ports/rooms-unit-of-work.port';

const lockById = jest.fn();
const setActive = jest.fn();
const uow: RoomsUnitOfWork = { run: (work) => work({ rooms: { lockById, setActive } }) };
const service = new RoomsService(uow);

describe('Rooms deactivate use case', () => {
  beforeEach(() => jest.resetAllMocks());

  it('decides not-found in application and performs no update', async () => {
    lockById.mockResolvedValue(null);
    await expect(service.deactivate('missing')).rejects.toBeInstanceOf(RoomNotFoundError);
    expect(setActive).not.toHaveBeenCalled();
  });

  it.each([true, false])('deactivates an existing room with active=%s', async (isActive) => {
    lockById.mockResolvedValue({ id: 'room-id', isActive });
    await service.deactivate('room-id');
    expect(lockById).toHaveBeenCalledWith('room-id');
    expect(setActive).toHaveBeenCalledWith('room-id', false);
  });

  it('propagates lock or persistence failures without continuing the workflow', async () => {
    const unavailable = new Error('database unavailable');
    lockById.mockRejectedValue(unavailable);
    await expect(service.deactivate('room-id')).rejects.toBe(unavailable);
    expect(setActive).not.toHaveBeenCalled();
    lockById.mockResolvedValue({ id: 'room-id', isActive: true });
    setActive.mockRejectedValue(unavailable);
    await expect(service.deactivate('room-id')).rejects.toBe(unavailable);
  });
});
