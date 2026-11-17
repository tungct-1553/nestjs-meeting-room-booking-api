import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
export function databaseOptions(url: string, poolMax: number) {
  return {
    type: 'postgres',
    url,
    extra: { max: poolMax },
    entities: [join(__dirname, '..', '**', 'infrastructure', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    migrationsRun: false,
    logging: false,
    installExtensions: false,
  } satisfies DataSourceOptions;
}
