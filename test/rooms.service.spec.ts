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
const reader = {
  listActive: jest.fn(),
  listForAdmin: jest.fn(),
  findActiveById: jest.fn(),
  findById: jest.fn(),
  findActiveRoomBusyIntervals: jest.fn(),
};
const service = new RoomsService(uow, creator, reader);

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

  it('normalizes canonically equivalent names to NFC without changing display capitalization', async () => {
    const name = 'Phòng Họp';
    await service.create({ name: ` \u00a0${name.normalize('NFD')}\ufeff `, capacity: 1 });
    expect(creator.create).toHaveBeenCalledWith(expect.objectContaining({ name }));
    lockById.mockResolvedValue({ id: 'room-id', isActive: true });
    await service.update({ roomId: 'room-id', name: name.normalize('NFD') });
    expect(updateDetails).toHaveBeenCalledWith('room-id', { name });
  });

  it('validates the NFC code point length for both use cases, including decomposed input', async () => {
    const normalized = 'Ắ'.repeat(200);
    const decomposed = normalized.normalize('NFD');
    expect([...decomposed].length).toBeGreaterThan(200);
    await service.create({ name: decomposed, capacity: 1 });
    expect(creator.create).toHaveBeenCalledWith(expect.objectContaining({ name: normalized }));
    lockById.mockResolvedValue({ id: 'room-id', isActive: true });
    await service.update({ roomId: 'room-id', name: decomposed });
    expect(updateDetails).toHaveBeenCalledWith('room-id', { name: normalized });
    const tooLong = 'Ắ'.repeat(201).normalize('NFD');
    expect(() => service.create({ name: tooLong, capacity: 1 })).toThrow(InvalidRoomInputError);
    await expect(service.update({ roomId: 'room-id', name: tooLong })).rejects.toBeInstanceOf(
      InvalidRoomInputError,
    );
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

describe('Room status use cases', () => {
  beforeEach(() => jest.resetAllMocks());

  it.each([true, false])(
    'returns the room after setting isActive=%s under its lock',
    async (isActive) => {
      const result = { id: 'room-id', name: 'A', capacity: 10, description: null, isActive };
      lockById.mockResolvedValue({ id: 'room-id', isActive: !isActive });
      setActive.mockResolvedValue(result);
      await expect(service.setStatus('room-id', isActive)).resolves.toBe(result);
      expect(lockById).toHaveBeenCalledWith('room-id');
      expect(setActive).toHaveBeenCalledWith('room-id', isActive);
      expect(lockById.mock.invocationCallOrder[0]).toBeLessThan(
        setActive.mock.invocationCallOrder[0],
      );
    },
  );

  it('rejects invalid room status before locking', async () => {
    await expect(service.setStatus('room-id', 'false' as never)).rejects.toBeInstanceOf(
      InvalidRoomInputError,
    );
    expect(lockById).not.toHaveBeenCalled();
    expect(setActive).not.toHaveBeenCalled();
  });

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

describe('Rooms read use cases', () => {
  beforeEach(() => jest.resetAllMocks());

  it.each([undefined, true, false])(
    'passes Admin room filter %s with normalized pagination and search',
    async (isActive) => {
      const result = { items: [], page: 2, limit: 5, total: 9 };
      reader.listForAdmin.mockResolvedValue(result);
      await expect(
        service.listForAdmin(
          { page: 2, limit: 5, capacity: 10, search: ' PHÒNG '.normalize('NFD') },
          isActive,
        ),
      ).resolves.toBe(result);
      expect(reader.listForAdmin).toHaveBeenCalledWith(
        { page: 2, limit: 5, capacity: 10, search: 'PHÒNG' },
        isActive,
      );
    },
  );

  it('rejects invalid Admin list input before reading', () => {
    expect(() => service.listForAdmin({ page: 0, limit: 20 })).toThrow(InvalidRoomInputError);
    expect(() => service.listForAdmin({ page: 1, limit: 20 }, null as never)).toThrow(
      InvalidRoomInputError,
    );
    expect(reader.listForAdmin).not.toHaveBeenCalled();
  });

  it('returns an inactive room to Admin and reports a missing room in application', async () => {
    const result = { id: 'room-id', name: 'A', capacity: 1, description: null, isActive: false };
    reader.findById.mockResolvedValueOnce(result).mockResolvedValueOnce(null);
    await expect(service.detailForAdmin('room-id')).resolves.toBe(result);
    expect(reader.findById).toHaveBeenCalledWith('room-id');
    await expect(service.detailForAdmin('missing')).rejects.toBeInstanceOf(RoomNotFoundError);
    expect(lockById).not.toHaveBeenCalled();
  });

  it('normalizes list input and delegates active filtering through the read port', async () => {
    const result = { items: [], page: 2, limit: 5, total: 8 };
    reader.listActive.mockResolvedValue(result);
    await expect(
      service.list({ page: 2, limit: 5, capacity: 10, search: ' PHÒNG '.normalize('NFD') }),
    ).resolves.toBe(result);
    expect(reader.listActive).toHaveBeenCalledWith({
      page: 2,
      limit: 5,
      capacity: 10,
      search: 'PHÒNG',
    });
    expect(lockById).not.toHaveBeenCalled();
  });

  it('treats an empty normalized search as no filter', async () => {
    await service.list({ page: 1, limit: 20, search: ' \u00a0 ' });
    expect(reader.listActive).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      capacity: undefined,
      search: undefined,
    });
  });

  it.each([
    { page: 0, limit: 20 },
    { page: 1.5, limit: 20 },
    { page: NaN, limit: 20 },
    { page: 1, limit: 0 },
    { page: 1, limit: 101 },
    { page: 1, limit: 1.5 },
    { page: Number.MAX_SAFE_INTEGER + 1, limit: 1 },
    { page: Number.MAX_SAFE_INTEGER, limit: 100 },
    { page: 1, limit: 20, capacity: 0 },
    { page: 1, limit: 20, capacity: 1.5 },
    { page: 1, limit: 20, capacity: 2147483648 },
    { page: 1, limit: 20, search: '\0' },
    { page: 1, limit: 20, search: 'A'.repeat(201) },
  ])('rejects invalid list input %j before persistence', (input) => {
    expect(() => service.list(input)).toThrow(InvalidRoomInputError);
    expect(reader.listActive).not.toHaveBeenCalled();
  });

  it('returns an active detail and makes the null lookup decision in application', async () => {
    const result = { id: 'room-id', name: 'A', capacity: 1, description: null, isActive: true };
    reader.findActiveById.mockResolvedValue(result);
    await expect(service.detail('room-id')).resolves.toBe(result);
    expect(reader.findActiveById).toHaveBeenCalledWith('room-id');
    reader.findActiveById.mockResolvedValue(null);
    await expect(service.detail('missing')).rejects.toBeInstanceOf(RoomNotFoundError);
    expect(lockById).not.toHaveBeenCalled();
  });

  it('propagates persistence failures rather than replacing them with empty results', async () => {
    const error = new Error('read unavailable');
    reader.listActive.mockRejectedValue(error);
    reader.findActiveById.mockRejectedValue(error);
    await expect(service.list({ page: 1, limit: 20 })).rejects.toBe(error);
    await expect(service.detail('room-id')).rejects.toBe(error);
  });
});
