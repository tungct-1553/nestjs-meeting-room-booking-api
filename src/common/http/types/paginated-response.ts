export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export class PaginatedResponse<T> {
  constructor(
    public readonly data: T[],
    public readonly meta: PaginationMeta,
  ) {}
}
