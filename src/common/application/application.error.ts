export type ApplicationErrorKind =
  'invalid_input' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable';

export class ApplicationError extends Error {
  constructor(
    public readonly code: string,
    public readonly kind: ApplicationErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}
