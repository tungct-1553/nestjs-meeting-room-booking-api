import { ApplicationError } from '../../common/errors/application.error';
export class RoomNotFoundError extends ApplicationError {
  constructor() { super('ROOM_NOT_FOUND', 'Room was not found'); }
}
