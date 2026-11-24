import 'dotenv/config';

import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma ORM 7).
 *
 * Prisma 7 no longer reads `.env` on its own, hence the `dotenv/config`
 * import above. `process.env` is used instead of the `env()` helper so that
 * commands which do not need a database (e.g. `prisma generate`) still work
 * when `DATABASE_URL` is missing.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
