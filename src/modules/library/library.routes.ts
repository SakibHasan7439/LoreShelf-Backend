import { Router } from 'express';
import type { RequestHandler } from 'express';

import { AppError } from '../../utils/app-error';
import { requireAuth } from '../auth/auth.middleware';
import { libraryService } from './library.service';
import { createLibraryEntrySchema, libraryListQuerySchema, updateLibraryEntrySchema, userBookIdSchema } from './library.types';

function authenticatedUserId(req: Parameters<RequestHandler>[0]): string {
  if (!req.authUser?.id) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  return req.authUser.id;
}

export function createLibraryRouter(service = libraryService, authenticate: RequestHandler = requireAuth): Router {
  const router = Router();
  router.use(authenticate);

  router.post('/', async (req, res, next) => {
    try {
      const entry = await service.create(authenticatedUserId(req), createLibraryEntrySchema.parse(req.body));
      res.status(201).json({ success: true, data: entry });
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const result = await service.list(authenticatedUserId(req), libraryListQuerySchema.parse(req.query));
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:userBookId', async (req, res, next) => {
    try {
      const userBookId = userBookIdSchema.parse(req.params.userBookId);
      const entry = await service.get(authenticatedUserId(req), userBookId);
      res.status(200).json({ success: true, data: entry });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:userBookId', async (req, res, next) => {
    try {
      const userBookId = userBookIdSchema.parse(req.params.userBookId);
      const input = updateLibraryEntrySchema.parse(req.body);
      const entry = await service.update(authenticatedUserId(req), userBookId, input);
      res.status(200).json({ success: true, data: entry });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:userBookId', async (req, res, next) => {
    try {
      const userBookId = userBookIdSchema.parse(req.params.userBookId);
      await service.remove(authenticatedUserId(req), userBookId);
      res.status(200).json({ success: true, data: { removed: true } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const libraryRouter = createLibraryRouter();
