import { ApplicationError } from '../../../common/application/application.error';
export class UserNotProvisionedError extends ApplicationError {
  constructor() {
    super('USER_NOT_PROVISIONED', 'conflict', 'User profile has not been provisioned');
  }
}
export class InvalidProfileTokenError extends ApplicationError {
  constructor() {
    super(
      'INVALID_PROFILE_TOKEN',
      'unauthenticated',
      'Access token must contain a valid issued-at claim',
    );
  }
}
export class ProfileSyncUnavailableError extends ApplicationError {
  constructor(options?: ErrorOptions) {
    super(
      'PROFILE_SYNC_UNAVAILABLE',
      'unavailable',
      'User profile synchronization is unavailable',
      options,
    );
  }
}
