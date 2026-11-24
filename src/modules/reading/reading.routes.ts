import { Router } from 'express';
import type { RequestHandler } from 'express';

import { AppError } from '../../utils/app-error';
import { requireAuth } from '../auth/auth.middleware';
import { readingService } from './reading.service';

export function createReadingRouter(service = readingService, authenticate: RequestHandler = requireAuth): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/stats', async (req, res, next) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
      const stats = await service.getStats(userId);
      res.status(200).json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const readingRouter = createReadingRouter();
