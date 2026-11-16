process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.PORT ??= '3000';
process.env.CORS_ORIGINS ??= 'http://localhost:3001';
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8081/realms/meeting-room';
process.env.API_CLIENT_ID ??= 'meeting-room-api';
