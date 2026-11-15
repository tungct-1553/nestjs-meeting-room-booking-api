import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  try {
    configureApp(app);
    app.enableShutdownHooks();
    await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'));
  } catch (error) {
    await app.close();
    throw error;
  }
}
void bootstrap().catch(() => {
  new Logger('Bootstrap').error('Application startup failed; check configuration and database availability');
  process.exitCode = 1;
});
