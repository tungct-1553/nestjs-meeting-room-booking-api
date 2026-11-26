import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnvironment } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { UsersModule } from './users/users.module';
import { RoomsModule } from './rooms/rooms.module';
import { BookingsModule } from './bookings/bookings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    IdentityModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        issuer: config.getOrThrow<string>('KEYCLOAK_ISSUER'),
        apiClientId: config.getOrThrow<string>('API_CLIENT_ID'),
      }),
    }),
    UsersModule,
    RoomsModule,
    BookingsModule,
    HealthModule,
  ],
})
export class AppModule {}
