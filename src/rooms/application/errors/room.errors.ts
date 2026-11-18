import { ApplicationError } from '../../../common/application/application.error';
export class RoomNotFoundError extends ApplicationError {
  constructor() {
    super('ROOM_NOT_FOUND', 'not_found', 'Room was not found');
  }
}

export class RoomNameConflictError extends ApplicationError {
  constructor(options?: ErrorOptions) {
    super('ROOM_NAME_CONFLICT', 'conflict', 'Room name is already in use', options);
  }
}

export class InvalidRoomInputError extends ApplicationError {
  constructor(message: string) {
    super('INVALID_ROOM_INPUT', 'invalid_input', message);
  }
}
