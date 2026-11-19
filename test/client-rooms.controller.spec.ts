import { ClientRoomsController } from '../src/rooms/presentation/client/rooms.controller';
import { AdminRoomsController } from '../src/rooms/presentation/admin/rooms.controller';
import { RoomsService } from '../src/rooms/application/rooms.service';
import { Test } from '@nestjs/testing';
import { RoomNotFoundError } from '../src/rooms/application/errors/room.errors';

const room = { id: 'room-id', name: 'A', capacity: 10, description: null, isActive: true };
const rooms = { list: jest.fn(), detail: jest.fn(), deactivate: jest.fn() };
let client: ClientRoomsController;
let admin: AdminRoomsController;
beforeEach(async () => {
  jest.resetAllMocks();
  const module = await Test.createTestingModule({
    controllers: [ClientRoomsController, AdminRoomsController],
    providers: [{ provide: RoomsService, useValue: rooms }],
  }).compile();
  client = module.get(ClientRoomsController);
  admin = module.get(AdminRoomsController);
});

it('maps list query and removes fields outside the Client contract', async () => {
  rooms.list.mockResolvedValue({
    items: [{ ...room, secret: 'hidden' }],
    page: 2,
    limit: 5,
    total: 8,
  });
  const result = await client.list({ page: 2, limit: 5, capacity: 4, search: 'A' });
  expect(rooms.list).toHaveBeenCalledWith({ page: 2, limit: 5, capacity: 4, search: 'A' });
  expect(result).toEqual({ data: [room], meta: { page: 2, limit: 5, total: 8 } });
});

it('maps detail response fields explicitly and propagates application errors', async () => {
  rooms.detail.mockResolvedValue({ ...room, secret: 'hidden' });
  expect(await client.detail(room.id)).toEqual(room);
  expect(rooms.detail).toHaveBeenCalledWith(room.id);
  const error = new RoomNotFoundError();
  rooms.detail.mockRejectedValue(error);
  await expect(client.detail(room.id)).rejects.toBe(error);
});

it('awaits deactivate and propagates failures without adding HTTP translation', async () => {
  await expect(admin.deactivate(room.id)).resolves.toBeUndefined();
  expect(rooms.deactivate).toHaveBeenCalledWith(room.id);
  const error = new RoomNotFoundError();
  rooms.deactivate.mockRejectedValue(error);
  await expect(admin.deactivate(room.id)).rejects.toBe(error);
});
