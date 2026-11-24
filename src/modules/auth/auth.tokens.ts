import { randomBytes, createHash, randomUUID } from 'node:crypto';

import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';

export const ACCESS_TOKEN_TTL_SECONDS = 600 as const;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

interface TokenConfig {
  secret: string;
  issuer: string;
  audience: string;
}

function tokenConfig(): { key: Uint8Array; issuer: string; audience: string } {
  if (!env.jwtAccessSecret || !env.jwtIssuer || !env.jwtAudience) {
    throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Authentication is not configured.');
  }
  return {
    key: new TextEncoder().encode(env.jwtAccessSecret),
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
  };
}

export function createRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createSessionFamilyId(): string {
  return randomUUID();
}

export function createAuthTokenManager(config?: TokenConfig) {
  const configProvider = config
    ? () => ({ key: new TextEncoder().encode(config.secret), issuer: config.issuer, audience: config.audience })
    : tokenConfig;
  return {
    assertConfigured(): void { configProvider(); },
    async createAccessToken(userId: string, sessionId: string): Promise<string> {
      const { SignJWT } = await import('jose');
      const config = configProvider();
      return new SignJWT({})
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setSubject(userId)
        .setJti(sessionId)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(config.key);
    },
    async verifyAccessToken(token: string): Promise<{ userId: string; sessionId: string }> {
      const { jwtVerify } = await import('jose');
      const config = configProvider();
      try {
        const { payload } = await jwtVerify(token, config.key, {
          algorithms: ['HS256'],
          issuer: config.issuer,
          audience: config.audience,
          requiredClaims: ['sub', 'jti', 'iat', 'exp'],
        });
        if (!payload.sub || !payload.jti) throw new Error('Missing identity claims.');
        return { userId: payload.sub, sessionId: payload.jti };
      } catch {
        throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'Authentication is required.');
      }
    },
  };
}

export const authTokens = createAuthTokenManager();
export const assertAuthConfigured = authTokens.assertConfigured;
export const createAccessToken = authTokens.createAccessToken;
export const verifyAccessToken = authTokens.verifyAccessToken;
