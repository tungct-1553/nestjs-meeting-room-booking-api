import { InvalidRoomInputError } from '../errors/room.errors';
import type { CreateRoomInput } from '../inputs/create-room.input';
import type { UpdateRoomInput } from '../inputs/update-room.input';
import type { RoomDetailsPatch } from '../models/room';
import type { NewRoom } from '../ports/room-creation-repository.port';
import { formatRoomNameText } from './room-name-text';

export const MAX_ROOM_CAPACITY = 2147483647;
export const MAX_ROOM_NAME_LENGTH = 200;

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidRoomInputError('Room name must be a non-empty string');
  }
  const name = formatRoomNameText(value);
  if (name.length === 0) {
    throw new InvalidRoomInputError('Room name must be a non-empty string');
  }
  if ([...name].length > MAX_ROOM_NAME_LENGTH || name.includes('\0')) {
    throw new InvalidRoomInputError(
      `Room name must contain at most ${MAX_ROOM_NAME_LENGTH} characters and no NUL`,
    );
  }
  return name;
}

function validateCapacity(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_ROOM_CAPACITY
  ) {
    throw new InvalidRoomInputError(
      `Room capacity must be an integer between 1 and ${MAX_ROOM_CAPACITY}`,
    );
  }
  return value;
}

function validateDescription(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new InvalidRoomInputError('Room description must be a string or null');
  }
  if (typeof value === 'string' && value.includes('\0')) {
    throw new InvalidRoomInputError('Room description must not contain NUL');
  }
  return value;
}

export function normalizeCreateRoom(input: CreateRoomInput): NewRoom {
  return {
    name: normalizeName(input.name),
    capacity: validateCapacity(input.capacity),
    description: input.description === undefined ? null : validateDescription(input.description),
    isActive: true,
  };
}

export function normalizeRoomPatch(input: UpdateRoomInput): RoomDetailsPatch {
  const patch: RoomDetailsPatch = {};
  if (input.name !== undefined) {
    patch.name = normalizeName(input.name);
  }
  if (input.capacity !== undefined) {
    patch.capacity = validateCapacity(input.capacity);
  }
  if (input.description !== undefined) {
    patch.description = validateDescription(input.description);
  }
  if (Object.keys(patch).length === 0) {
    throw new InvalidRoomInputError('At least one room detail must be provided');
  }
  return patch;
}
