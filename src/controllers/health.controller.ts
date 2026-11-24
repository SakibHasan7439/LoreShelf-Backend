import type { RequestHandler } from 'express';

import { env } from '../config/env';
import { checkDatabaseHealth } from '../services/health.service';

/** GET /api/health — proves the process is up and serving requests. */
export const getHealth: RequestHandler = (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'loreshelf-api',
    environment: env.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};

/**
 * GET /api/health/database — reports PostgreSQL reachability.
 *
 * Returns 200 when the database answered, 503 otherwise. The response is
 * intentionally generic: no host, credentials or driver errors.
 */
export const getDatabaseHealth: RequestHandler = async (_req, res) => {
  const health = await checkDatabaseHealth();

  res.status(health.reachable ? 200 : 503).json({
    status: health.reachable ? 'ok' : 'unavailable',
    service: 'loreshelf-api',
    database: {
      reachable: health.reachable,
      latencyMs: health.latencyMs,
      checkedAt: new Date().toISOString(),
    },
  });
};
