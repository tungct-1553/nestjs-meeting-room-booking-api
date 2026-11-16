import { ApplicationError } from '../../common/errors/application.error';
export class UserNotProvisionedError extends ApplicationError {
  constructor() { super('USER_NOT_PROVISIONED', 'User profile has not been provisioned'); }
}
export class InvalidProfileTokenError extends ApplicationError {
  constructor() { super('INVALID_PROFILE_TOKEN', 'Access token must contain a valid issued-at claim'); }
}
export class ProfileSyncUnavailableError extends ApplicationError {
  constructor() { super('PROFILE_SYNC_UNAVAILABLE', 'User profile synchronization is unavailable'); }
}
