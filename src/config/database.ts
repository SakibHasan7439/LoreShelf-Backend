import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';
import { env } from './env';

/**
 * Prisma Client with the `pg` driver adapter (required in Prisma ORM 7).
 *
 * The connection string comes from the validated environment. Pool settings
 * are explicit so a bad/unreachable database fails fast instead of hanging a
 * request: `pg` defaults to no connection timeout at all.
 */
const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

export const prisma = new PrismaClient({ adapter });

/** Closes pooled connections. Call during graceful shutdown. */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
