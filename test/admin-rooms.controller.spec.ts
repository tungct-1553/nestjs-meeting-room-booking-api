import { Test } from '@nestjs/testing';
import { RoomsService } from '../src/rooms/application/rooms.service';
import { RoomNameConflictError } from '../src/rooms/application/errors/room.errors';
import { AdminRoomsController } from '../src/rooms/presentation/admin/rooms.controller';

const room = { id: 'room-id', name: 'A', capacity: 10, description: null, isActive: true };

describe('AdminRoomsController', () => {
  let controller: AdminRoomsController;
  const rooms = { create: jest.fn(), update: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      controllers: [AdminRoomsController],
      providers: [{ provide: RoomsService, useValue: rooms }],
    }).compile();
    controller = module.get(AdminRoomsController);
  });

  it('maps create input and returns only the public room fields', async () => {
    rooms.create.mockResolvedValue({ ...room, privateField: 'hidden' });
    const result = await controller.create({ name: ' A ', capacity: 10 });
    expect(rooms.create).toHaveBeenCalledWith({
      name: ' A ',
      capacity: 10,
      description: undefined,
    });
    expect(result).toEqual(room);
    expect(result).not.toHaveProperty('privateField');
  });

  it('preserves nullable descriptions and propagates application errors', async () => {
    const error = new RoomNameConflictError();
    rooms.create.mockRejectedValue(error);
    await expect(controller.create({ name: 'A', capacity: 10, description: null })).rejects.toBe(
      error,
    );
    expect(rooms.create).toHaveBeenCalledWith({ name: 'A', capacity: 10, description: null });
  });

  it('maps the route ID and preserves null versus omitted update fields', async () => {
    rooms.update.mockResolvedValue({
      ...room,
      description: null,
      isActive: false,
      privateField: 'hidden',
    });
    const result = await controller.update(room.id, { description: null });
    expect(rooms.update).toHaveBeenCalledWith({
      roomId: room.id,
      name: undefined,
      capacity: undefined,
      description: null,
    });
    expect(result).toEqual({ ...room, isActive: false });
    expect(result).not.toHaveProperty('privateField');
  });

  it('propagates update errors without HTTP-specific translation', async () => {
    const error = new RoomNameConflictError();
    rooms.update.mockRejectedValue(error);
    await expect(controller.update(room.id, { name: 'B' })).rejects.toBe(error);
  });
});
