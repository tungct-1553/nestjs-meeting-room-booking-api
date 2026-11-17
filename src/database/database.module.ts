import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DatabaseLifecycle } from './database.lifecycle';
import { databaseOptions } from './options';
@Module({
  providers: [
    {
      provide: DataSource,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new DataSource(
          databaseOptions(
            config.getOrThrow<string>('DATABASE_URL'),
            config.getOrThrow<number>('DB_POOL_MAX'),
          ),
        ).initialize(),
    },
    DatabaseLifecycle,
  ],
  exports: [DataSource],
})
export class DatabaseModule {}
