import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { decode } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import type { Principal, Role } from './public/principal';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const issuer = config.getOrThrow<string>('KEYCLOAK_ISSUER');
    const clientId = config.getOrThrow<string>('API_CLIENT_ID');
    const keys = new JwksClient({ jwksUri: `${issuer}/protocol/openid-connect/certs`, cache: true, cacheMaxEntries: 5, cacheMaxAge: 600000, rateLimit: true, jwksRequestsPerMinute: 10, timeout: 5000 });
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), issuer, audience: clientId, algorithms: ['RS256'], ignoreExpiration: false,
      secretOrKeyProvider: (_request, token, done) => {
        const decoded = decode(token, { complete: true });
        const kid = decoded?.header.kid;
        if (decoded?.header.alg !== 'RS256' || typeof kid !== 'string' || !kid.trim() || kid.length > 256) return done(new UnauthorizedException('Invalid access token'));
        keys.getSigningKey(kid).then(key => done(null, key.getPublicKey()), (error: unknown) => {
          const name = error instanceof Error ? error.name : '';
          done(name === 'SigningKeyNotFoundError' ? new UnauthorizedException('Invalid access token') : new ServiceUnavailableException('Identity provider is unavailable'));
        });
      },
    });
    this.clientId = clientId;
  }
  private readonly clientId: string;
  validate(payload: Record<string, unknown>): Principal {
    if (!payload || typeof payload !== 'object' || typeof payload.sub !== 'string' || !payload.sub.trim() || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.typ !== 'Bearer') throw new UnauthorizedException('Invalid access token');
    const access = payload.resource_access;
    const client = access && typeof access === 'object' && !Array.isArray(access) ? (access as Record<string, unknown>)[this.clientId] : undefined;
    const claims = client && typeof client === 'object' && !Array.isArray(client) ? (client as Record<string, unknown>).roles : undefined;
    const roles: Role[] = Array.isArray(claims) && claims.every(role => typeof role === 'string') ? [...new Set(claims.filter((role): role is Role => role === 'admin' || role === 'employee'))] : [];
    const text = (value: unknown) => typeof value === 'string' ? value : null;
    return { sub: payload.sub, email: text(payload.email), displayName: text(payload.name) ?? text(payload.preferred_username), roles, ...(typeof payload.iat === 'number' && Number.isFinite(payload.iat) && payload.iat >= 0 && payload.iat <= Number.MAX_SAFE_INTEGER ? { issuedAt: payload.iat } : {}) };
  }
}
