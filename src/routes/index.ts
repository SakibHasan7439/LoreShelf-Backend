import { Router } from 'express';

import { bookDiscoveryRouter } from '../modules/book-discovery/book-discovery.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { booksRouter } from '../modules/books/books.routes';
import { libraryRouter } from '../modules/library/library.routes';
import { healthRouter } from './health.routes';

/**
 * API surface. Feature routers (books, search, shelves, auth) mount here as
 * they are built — keep `app.ts` free of route-level details.
 */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/books', bookDiscoveryRouter);
apiRouter.use('/books', booksRouter);
apiRouter.use('/library', libraryRouter);
