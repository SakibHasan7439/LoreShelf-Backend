import type { RequestHandler } from 'express';

import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
import type { PrismaClient } from '../../generated/prisma/client';
import { verifyAccessToken } from './auth.tokens';
import type { SafeUser } from './auth.types';

const required = () => new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');

export function createAuthMiddleware(
  database: PrismaClient = prisma,
  verifyToken: typeof verifyAccessToken = verifyAccessToken,
): RequestHandler {
  return async (req, _res, next) => {
    try {
      const authorization = req.get('authorization');
      const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/u);
      if (!match) throw required();
      const identity = await verifyToken(match[1]!);
      const session = await database.refreshSession.findFirst({
        where: {
          id: identity.sessionId,
          userId: identity.userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: {
          user: { select: { id: true, name: true, email: true, avatar: true, createdAt: true } },
        },
      });
      if (!session) throw required();
      req.authUser = session.user as SafeUser;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth = createAuthMiddleware();
