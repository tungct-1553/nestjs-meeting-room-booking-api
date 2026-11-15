// Produced only by a future verified Keycloak access-token guard, never a request body.
export interface Principal {
  sub: string;
  email: string | null;
  displayName: string | null;
}
