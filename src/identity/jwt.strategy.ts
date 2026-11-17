import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { decode } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { isValidNumericDate } from '../common/validation/numeric-date';
import type { Principal, Role } from './public/principal';

interface AccessTokenClaims extends Record<string, unknown> {
  sub: string;
  exp: number;
  typ: 'Bearer';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAccessTokenClaims(value: unknown): value is AccessTokenClaims {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.sub === 'string' &&
    value.sub.trim().length > 0 &&
    typeof value.exp === 'number' &&
    Number.isFinite(value.exp) &&
    value.typ === 'Bearer'
  );
}

function isSigningKeyId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function isApplicationRole(value: unknown): value is Role {
  return value === 'admin' || value === 'employee';
}

function clientRoles(access: unknown, clientId: string): Role[] {
  if (!isRecord(access)) {
    return [];
  }
  const client = access[clientId];
  if (!isRecord(client)) {
    return [];
  }
  const roles = client.roles;
  if (!Array.isArray(roles) || !roles.every((role) => typeof role === 'string')) {
    return [];
  }
  return [...new Set(roles.filter(isApplicationRole))];
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly clientId: string;

  constructor(config: ConfigService) {
    const issuer = config.getOrThrow<string>('KEYCLOAK_ISSUER');
    const clientId = config.getOrThrow<string>('API_CLIENT_ID');
    const keys = new JwksClient({
      jwksUri: `${issuer}/protocol/openid-connect/certs`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      timeout: 5000,
    });
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer,
      audience: clientId,
      algorithms: ['RS256'],
      ignoreExpiration: false,
      secretOrKeyProvider: (_request, token, done): void => {
        const decoded = decode(token, { complete: true });
        const kid = decoded?.header.kid;
        if (decoded?.header.alg !== 'RS256' || !isSigningKeyId(kid)) {
          done(new UnauthorizedException('Invalid access token'));
          return;
        }
        void keys.getSigningKey(kid).then(
          (key) => done(null, key.getPublicKey()),
          (error: unknown) => {
            const missingKey = error instanceof Error && error.name === 'SigningKeyNotFoundError';
            done(
              missingKey
                ? new UnauthorizedException('Invalid access token')
                : new ServiceUnavailableException('Identity provider is unavailable'),
            );
          },
        );
      },
    });
    this.clientId = clientId;
  }

  validate(payload: unknown): Principal {
    if (!isAccessTokenClaims(payload)) {
      throw new UnauthorizedException('Invalid access token');
    }
    return {
      sub: payload.sub,
      email: optionalText(payload.email),
      displayName: optionalText(payload.name) ?? optionalText(payload.preferred_username),
      roles: clientRoles(payload.resource_access, this.clientId),
      ...(isValidNumericDate(payload.iat) ? { issuedAt: payload.iat } : {}),
    };
  }
}
