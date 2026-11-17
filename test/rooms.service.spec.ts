import { RoomsService } from '../src/rooms/application/rooms.service';
import { RoomNotFoundError } from '../src/rooms/application/errors/room.errors';
import { InvalidRoomInputError } from '../src/rooms/application/errors/room.errors';
import type { CreateRoomInput } from '../src/rooms/application/inputs/create-room.input';
import type { UpdateRoomInput } from '../src/rooms/application/inputs/update-room.input';
import type { RoomsUnitOfWork } from '../src/rooms/application/ports/rooms-unit-of-work.port';

const lockById = jest.fn();
const setActive = jest.fn();
const updateDetails = jest.fn();
const uow: RoomsUnitOfWork = {
  run: (work) => work({ rooms: { lockById, setActive, updateDetails } }),
};
const creator = { create: jest.fn() };
const service = new RoomsService(uow, creator);

describe('Rooms create use case', () => {
  beforeEach(() => jest.resetAllMocks());

  it('normalizes name and chooses active/default description before persistence', async () => {
    const result = { id: 'room-id', name: 'A', capacity: 10, description: null, isActive: true };
    creator.create.mockResolvedValue(result);
    await expect(service.create({ name: ' A ', capacity: 10 })).resolves.toBe(result);
    expect(creator.create).toHaveBeenCalledWith({
      name: 'A',
      capacity: 10,
      description: null,
      isActive: true,
    });
    expect(lockById).not.toHaveBeenCalled();
  });

  it.each([
    { name: '  ', capacity: 10 },
    { name: null, capacity: 10 },
    { name: 'A', capacity: 0 },
    { name: 'A', capacity: NaN },
    { name: 'A', capacity: Infinity },
    { name: 'A', capacity: 1.5 },
    { name: 'A', capacity: 2147483648 },
    { name: 'A', capacity: '1' },
    { name: 'A', capacity: 10, description: 2 },
    { name: 'A'.repeat(201), capacity: 10 },
    { name: 'A\0B', capacity: 10 },
    { name: 'A', capacity: 10, description: 'A\0B' },
  ])('protects input invariant %j outside HTTP', (input) => {
    expect(() => service.create(input as CreateRoomInput)).toThrow(InvalidRoomInputError);
    expect(creator.create).not.toHaveBeenCalled();
  });

  it.each([null, ''])('retains explicit description %j', async (description) => {
    await service.create({ name: 'A', capacity: 1, description });
    expect(creator.create).toHaveBeenCalledWith({
      name: 'A',
      capacity: 1,
      description,
      isActive: true,
    });
  });
});

describe('Rooms update use case', () => {
  beforeEach(() => jest.resetAllMocks());

  it('locks before updating only supplied details, including for inactive rooms', async () => {
    lockById.mockResolvedValue({ id: 'room-id', isActive: false });
    const result = { id: 'room-id', name: 'A', capacity: 10, description: null, isActive: false };
    updateDetails.mockResolvedValue(result);
    await expect(service.update({ roomId: 'room-id', name: ' A ' })).resolves.toBe(result);
    expect(updateDetails).toHaveBeenCalledWith('room-id', { name: 'A' });
    expect(lockById.mock.invocationCallOrder[0]).toBeLessThan(
      updateDetails.mock.invocationCallOrder[0],
    );
    expect(setActive).not.toHaveBeenCalled();
  });

  it.each([null, ''])(
    'preserves explicit description %j while omitting other fields',
    async (description) => {
      lockById.mockResolvedValue({ id: 'room-id', isActive: true });
      await service.update({ roomId: 'room-id', description });
      expect(updateDetails).toHaveBeenCalledWith('room-id', { description });
    },
  );

  it('makes the missing-room business decision before any write', async () => {
    lockById.mockResolvedValue(null);
    await expect(service.update({ roomId: 'missing', capacity: 10 })).rejects.toBeInstanceOf(
      RoomNotFoundError,
    );
    expect(updateDetails).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { name: undefined },
    { name: null },
    { name: '  ' },
    { capacity: null },
    { capacity: '1' },
    { capacity: 0 },
    { capacity: 1.5 },
    { capacity: 2147483648 },
    { description: 3 },
    { name: 'A'.repeat(201) },
    { name: 'A\0B' },
    { description: 'A\0B' },
  ])('rejects invalid patch %j before opening transactional access', async (patch) => {
    await expect(
      service.update({ roomId: 'room-id', ...patch } as UpdateRoomInput),
    ).rejects.toBeInstanceOf(InvalidRoomInputError);
    expect(lockById).not.toHaveBeenCalled();
    expect(updateDetails).not.toHaveBeenCalled();
  });

  it('counts Unicode code points after trimming rather than UTF-16 code units', async () => {
    const name = '😀'.repeat(200);
    creator.create.mockResolvedValue({ id: 'room-id', name });
    await service.create({ name: ` ${name} `, capacity: 1 });
    expect(creator.create).toHaveBeenCalledWith(expect.objectContaining({ name }));
    lockById.mockResolvedValue({ id: 'room-id', isActive: true });
    await service.update({ roomId: 'room-id', name: ` ${name} ` });
    expect(updateDetails).toHaveBeenCalledWith('room-id', { name });
  });
});

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
