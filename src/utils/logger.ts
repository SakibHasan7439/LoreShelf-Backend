import pino from 'pino';

import { env } from '../config/env';

/**
 * Single application logger. JSON in production so it can be shipped to any
 * log collector; human-readable in development.
 */
export const logger = pino({
  level: env.isProduction ? 'info' : 'debug',
  base: { service: 'loreshelf-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.DATABASE_URL'],
    censor: '[redacted]',
  },
});
