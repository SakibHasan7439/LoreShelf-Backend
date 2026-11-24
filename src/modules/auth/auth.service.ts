import argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
import type { AuthTokenPair, LoginInput, RegisterInput, SafeUser } from './auth.types';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  authTokens,
  createRefreshToken,
  createSessionFamilyId,
  hashRefreshToken,
} from './auth.tokens';

const passwordHashOptions = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
// A fixed non-secret hash keeps unknown/passwordless-account checks comparable
// to the normal Argon2 verification path without generating a hash on demand.
const dummyPasswordHash = '$argon2id$v=19$m=19456,t=2,p=1$9q6ZW5gXEZHW+jeVLFcvbg$ADEaaTFRuWiweCPT4dVFOr/uJN2WWAkwEMed45fGdb8';
const safeUserSelect = { id: true, name: true, email: true, avatar: true, createdAt: true } as const;
const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
const invalidRefreshToken = () => new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

export function createAuthService(database = prisma, tokens: typeof authTokens = authTokens) {
  async function createSession(tx: Prisma.TransactionClient, userId: string, familyId = createSessionFamilyId()) {
    const refreshToken = createRefreshToken();
    const session = await tx.refreshSession.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
      select: { id: true },
    });
    return { refreshToken, sessionId: session.id };
  }

  async function issuePair(user: SafeUser, sessionId: string, refreshToken: string): Promise<AuthTokenPair> {
    return {
      accessToken: await tokens.createAccessToken(user.id, sessionId),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user,
    };
  }

  async function register(input: RegisterInput): Promise<AuthTokenPair> {
    tokens.assertConfigured();
    const email = input.email.trim().toLowerCase();
    try {
      const result = await database.$transaction(async (tx) => {
        const existing = await tx.user.findMany({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
          take: 2,
        });
        if (existing.length > 0) throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');

        const user = await tx.user.create({
          data: {
            name: input.name.trim(),
            email,
            passwordHash: await argon2.hash(input.password, passwordHashOptions),
          },
          select: safeUserSelect,
        });
        const session = await createSession(tx, user.id);
        return { user, ...session };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return issuePair(result.user, result.sessionId, result.refreshToken);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isPrismaCode(error, 'P2002') || isPrismaCode(error, 'P2034')) {
        throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
      }
      throw error;
    }
  }

  async function login(input: LoginInput): Promise<AuthTokenPair> {
    tokens.assertConfigured();
    const email = input.email.trim().toLowerCase();
    const matches = await database.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { ...safeUserSelect, passwordHash: true },
      take: 2,
    });
    const user = matches.length === 1 ? matches[0] : undefined;
    const hash = user?.passwordHash ?? dummyPasswordHash;
    let validPassword = false;
    try {
      validPassword = await argon2.verify(hash, input.password);
    } catch {
      // Malformed or unsupported stored hashes are indistinguishable from bad credentials.
    }
    if (!user || !user.passwordHash || !validPassword) throw invalidCredentials();

    const safeUser: SafeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      createdAt: user.createdAt,
    };
    const result = await database.$transaction(async (tx) => {
      const session = await createSession(tx, user.id);
      return session;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return issuePair(safeUser, result.sessionId, result.refreshToken);
  }

  async function revokeFamily(familyId: string): Promise<void> {
    await database.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async function detectReplay(refreshTokenHash: string): Promise<void> {
    const session = await database.refreshSession.findUnique({
      where: { refreshTokenHash },
      select: { familyId: true, revokedAt: true, replacedBySessionId: true },
    });
    if (session?.revokedAt && session.replacedBySessionId) await revokeFamily(session.familyId);
  }

  async function refresh(refreshToken: string): Promise<AuthTokenPair> {
    tokens.assertConfigured();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    try {
      const result = await database.$transaction(async (tx) => {
        const current = await tx.refreshSession.findUnique({
          where: { refreshTokenHash },
          include: { user: { select: safeUserSelect } },
        });
        if (!current) return { kind: 'invalid' as const };

        if (current.revokedAt) {
          if (current.replacedBySessionId) {
            await tx.refreshSession.updateMany({ where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
            return { kind: 'replayed' as const };
          }
          return { kind: 'invalid' as const };
        }
        if (current.expiresAt.getTime() <= Date.now() || !current.user) return { kind: 'invalid' as const };

        const now = new Date();
        const claimed = await tx.refreshSession.updateMany({
          where: { id: current.id, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now, lastUsedAt: now },
        });
        if (claimed.count !== 1) return { kind: 'race' as const, familyId: current.familyId };

        const replacement = await createSession(tx, current.userId, current.familyId);
        await tx.refreshSession.update({ where: { id: current.id }, data: { replacedBySessionId: replacement.sessionId } });
        return {
          kind: 'rotated' as const,
          user: current.user,
          ...replacement,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (result.kind === 'replayed') throw invalidRefreshToken();
      if (result.kind === 'race') {
        await detectReplay(refreshTokenHash);
        throw invalidRefreshToken();
      }
      if (result.kind === 'invalid') throw invalidRefreshToken();
      return issuePair(result.user, result.sessionId, result.refreshToken);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isPrismaCode(error, 'P2034')) {
        await detectReplay(refreshTokenHash);
        throw invalidRefreshToken();
      }
      throw error;
    }
  }

  async function logout(refreshToken: string): Promise<void> {
    await database.refreshSession.updateMany({
      where: { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
  }

  return { register, login, refresh, logout };
}

export const authService = createAuthService();
