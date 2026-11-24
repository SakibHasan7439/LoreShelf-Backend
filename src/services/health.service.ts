import { prisma } from '../config/database';
import { logger } from '../utils/logger';

const DB_CHECK_TIMEOUT_MS = 5_000;

export interface DatabaseHealth {
  /** True only when a real query against PostgreSQL succeeded. */
  reachable: boolean;
  /** Round-trip time of the probe, or null when the check failed. */
  latencyMs: number | null;
  /** Whether the failure was a timeout rather than a connection error. */
  timedOut: boolean;
}

/**
 * Probes PostgreSQL with a trivial query. Never throws: an unreachable database
 * is a normal, reportable state for a health endpoint.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const startedAt = Date.now();
  let timeout: NodeJS.Timeout | undefined;
  let timedOut = false;

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          reject(new Error('Database health check timed out.'));
        }, DB_CHECK_TIMEOUT_MS);
      }),
    ]);

    return { reachable: true, latencyMs: Date.now() - startedAt, timedOut: false };
  } catch (error) {
    // Log the reason internally, but never return it to the client.
    logger.warn(
      {
        databaseError: error instanceof Error ? error.message : 'Unknown database error',
        timedOut,
      },
      'Database health check failed',
    );

    return { reachable: false, latencyMs: null, timedOut };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
