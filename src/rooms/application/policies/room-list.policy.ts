import { InvalidRoomInputError } from '../errors/room.errors';
import type { ListRoomsInput } from '../inputs/list-rooms.input';
import { MAX_ROOM_CAPACITY, MAX_ROOM_NAME_LENGTH } from './room-details.policy';
import { formatRoomNameText } from './room-name-text';

export function normalizeRoomList(input: ListRoomsInput): ListRoomsInput {
  if (
    !Number.isSafeInteger(input.page) ||
    input.page < 1 ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100 ||
    !Number.isSafeInteger((input.page - 1) * input.limit)
  ) {
    throw new InvalidRoomInputError('Invalid room pagination');
  }
  if (
    input.capacity !== undefined &&
    (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > MAX_ROOM_CAPACITY)
  ) {
    throw new InvalidRoomInputError('Invalid minimum room capacity');
  }
  let search: string | undefined;
  if (input.search !== undefined) {
    if (typeof input.search !== 'string') {
      throw new InvalidRoomInputError('Room search must be a string');
    }
    search = formatRoomNameText(input.search);
    if ([...search].length > MAX_ROOM_NAME_LENGTH || search.includes('\0')) {
      throw new InvalidRoomInputError('Room search must contain at most 200 characters and no NUL');
    }
  }
  return {
    page: input.page,
    limit: input.limit,
    capacity: input.capacity,
    search: search || undefined,
  };
}
