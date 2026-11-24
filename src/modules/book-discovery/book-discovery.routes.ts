import { Router } from 'express';

import { searchBooks } from './book-discovery.service';
import { bookSearchQuerySchema } from './book-discovery.types';
import type { BookSearchData, BookSearchQuery } from './book-discovery.types';

export type BookSearch = (query: BookSearchQuery) => Promise<BookSearchData>;

export function createBookDiscoveryRouter(search: BookSearch = searchBooks): Router {
  const router = Router();

  router.get('/search', async (req, res, next) => {
    try {
      const query = bookSearchQuerySchema.parse(req.query);
      const data = await search(query);

      res.status(200).json({
        success: true,
        data: {
          results: data.results,
          pagination: {
            page: query.page,
            limit: query.limit,
            total: data.total,
          },
          providers: data.providers,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const bookDiscoveryRouter = createBookDiscoveryRouter();
