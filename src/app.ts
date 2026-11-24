import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { env } from './config/env';
import { errorHandler } from './middlewares/error.middleware';
import { notFoundHandler } from './middlewares/not-found.middleware';
import { apiRateLimiter } from './middlewares/rate-limit.middleware';
import { apiRouter } from './routes';
import { logger } from './utils/logger';

/**
 * Builds the Express application. Kept separate from `server.ts` so the app can
 * be imported by tests without opening a port.
 */
export function createApp(): Express {
  const app = express();

  // Do not advertise the framework.
  app.disable('x-powered-by');

  // Behind a proxy/load balancer (Render, Railway, Fly, Vercel, ...) the client
  // IP lives in X-Forwarded-For; rate limiting and logs need it.
  app.set('trust proxy', 1);

  app.use(helmet());

  app.use(
    cors({
      origin: env.corsOrigins.includes('*') ? '*' : [...env.corsOrigins],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 86_400,
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  app.use(
    pinoHttp({
      logger,
      // Health probes are frequent and noisy; everything else is logged.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  app.use(apiRateLimiter);

  app.use('/api', apiRouter);

  // Terminal middleware — order matters.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
