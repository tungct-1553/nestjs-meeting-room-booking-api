export type Role = 'employee' | 'admin';
export interface Principal {
  sub: string;
  email: string | null;
  displayName: string | null;
  roles: Role[];
}
