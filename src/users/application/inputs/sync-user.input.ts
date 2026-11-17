export interface SyncUserInput {
  sub: string;
  email: string | null;
  displayName: string | null;
  issuedAt?: number;
}
