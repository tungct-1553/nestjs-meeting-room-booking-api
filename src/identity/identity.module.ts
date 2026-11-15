import { Module } from '@nestjs/common';

// Keycloak verifier/guards will be added before exposing business HTTP controllers.
@Module({})
export class IdentityModule {}
