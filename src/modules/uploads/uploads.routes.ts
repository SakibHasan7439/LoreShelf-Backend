import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';
import { requireAuth } from '../auth/auth.middleware';
import { cloudinaryCoverService } from './covers.service';

function uploadLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.nodeEnv === 'test',
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many upload signature requests. Please try again later.' } },
  });
}

export function createUploadsRouter(
  service: Pick<typeof cloudinaryCoverService, 'createSignature'> = cloudinaryCoverService,
  authenticate: RequestHandler = requireAuth,
): Router {
  const router = Router();
  router.post('/covers/signature', authenticate, uploadLimiter(), (req, res, next) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
      res.status(200).json({ success: true, data: service.createSignature(userId) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

export const uploadsRouter = createUploadsRouter();
