import { Router } from 'express';

import { createManualBook } from './manual-book.service';
import { manualBookSchema, type ManualBookInput } from './manual-book.types';

interface ManualBookResult { book: unknown; created: boolean }
type ManualBookCreator = (input: ManualBookInput) => Promise<ManualBookResult>;

export function createBooksRouter(createBook: ManualBookCreator = createManualBook): Router {
  const router = Router();
  router.post('/manual', async (req, res, next) => {
    try {
      const input = manualBookSchema.parse(req.body);
      const result = await createBook(input);
      res.status(result.created ? 201 : 200).json({ success: true, data: result.book });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

export const booksRouter = createBooksRouter();
