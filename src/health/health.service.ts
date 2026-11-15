import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
@Injectable()
export class HealthService {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}
  async ready(): Promise<{ status: string }> {
    try { await this.source.query('SELECT 1'); }
    catch { throw new ServiceUnavailableException('Database is unavailable'); }
    return { status: 'ok' };
  }
}
