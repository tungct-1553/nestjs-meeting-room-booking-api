import { ApplicationError } from '../../../common/application/application.error';
export class RoomNotFoundError extends ApplicationError {
  constructor() {
    super('ROOM_NOT_FOUND', 'not_found', 'Room was not found');
  }
}
