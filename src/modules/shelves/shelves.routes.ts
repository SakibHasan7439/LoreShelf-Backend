import { Router } from 'express';
import type { RequestHandler } from 'express';

import { AppError } from '../../utils/app-error';
import { requireAuth } from '../auth/auth.middleware';
import { shelfService } from './shelves.service';
import { addShelfBookSchema, createShelfSchema, shelfBookParamsSchema, shelfIdSchema, updateShelfSchema } from './shelves.types';

function userId(req: Parameters<RequestHandler>[0]): string {
  if (!req.authUser?.id) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  return req.authUser.id;
}

function notFound(): AppError {
  return new AppError(404, 'SHELF_OR_BOOK_NOT_FOUND', 'Shelf or library entry not found.');
}

export function createShelvesRouter(service = shelfService, authenticate: RequestHandler = requireAuth): Router {
  const router = Router();
  router.use(authenticate);

  router.post('/', async (req, res, next) => {
    try {
      const shelf = await service.create(userId(req), createShelfSchema.parse(req.body));
      res.status(201).json({ success: true, data: shelf });
    } catch (error) { next(error); }
  });

  router.get('/', async (req, res, next) => {
    try {
      res.status(200).json({ success: true, data: await service.list(userId(req)) });
    } catch (error) { next(error); }
  });

  router.get('/:shelfId', async (req, res, next) => {
    try {
      const shelf = await service.get(userId(req), shelfIdSchema.parse(req.params.shelfId));
      if (!shelf) throw notFound();
      res.status(200).json({ success: true, data: shelf });
    } catch (error) { next(error); }
  });

  router.patch('/:shelfId', async (req, res, next) => {
    try {
      const shelf = await service.update(userId(req), shelfIdSchema.parse(req.params.shelfId), updateShelfSchema.parse(req.body));
      if (!shelf) throw notFound();
      res.status(200).json({ success: true, data: shelf });
    } catch (error) { next(error); }
  });

  router.delete('/:shelfId/books/:userBookId', async (req, res, next) => {
    try {
      const { shelfId, userBookId } = shelfBookParamsSchema.parse(req.params);
      if (!await service.removeBook(userId(req), shelfId, userBookId)) throw notFound();
      res.status(200).json({ success: true, data: { removed: true } });
    } catch (error) { next(error); }
  });

  router.post('/:shelfId/books', async (req, res, next) => {
    try {
      const shelfId = shelfIdSchema.parse(req.params.shelfId);
      const { userBookId } = addShelfBookSchema.parse(req.body);
      const association = await service.addBook(userId(req), shelfId, userBookId);
      if (!association) throw notFound();
      res.status(201).json({ success: true, data: association });
    } catch (error) { next(error); }
  });

  router.delete('/:shelfId', async (req, res, next) => {
    try {
      if (!await service.remove(userId(req), shelfIdSchema.parse(req.params.shelfId))) throw notFound();
      res.status(200).json({ success: true, data: { removed: true } });
    } catch (error) { next(error); }
  });

  return router;
}

export const shelvesRouter = createShelvesRouter();
