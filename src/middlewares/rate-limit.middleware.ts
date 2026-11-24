import rateLimit from 'express-rate-limit';

import { env } from '../config/env';

/**
 * Baseline abuse protection for every endpoint. Auth, search and third-party
 * integrations will get their own tighter limits later.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.isProduction ? 120 : 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.nodeEnv === 'test',
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests. Please slow down and try again shortly.',
    },
  },
});
