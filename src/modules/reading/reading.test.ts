import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import type { RequestHandler } from 'express';

import type { PrismaClient } from '../../generated/prisma/client';
import { errorHandler } from '../../middlewares/error.middleware';
import { createReadingRouter } from './reading.routes';
import { createReadingService } from './reading.service';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('reading stats counts all statuses and scopes the aggregate to one user', async () => {
  let query: unknown;
  const database = {
    userBook: {
      groupBy: async (args: unknown) => {
        query = args;
        return [
          { readingStatus: 'READING', _count: { _all: 2 } },
          { readingStatus: 'COMPLETED', _count: { _all: 1 } },
        ];
      },
    },
  } as unknown as PrismaClient;

  const stats = await createReadingService(database).getStats(userId);
  assert.deepEqual(stats, {
    counts: { WANT_TO_READ: 0, READING: 2, COMPLETED: 1, ON_HOLD: 0 },
    total: 3,
  });
  assert.deepEqual(query, { by: ['readingStatus'], where: { userId }, _count: { _all: true } });
});

test('GET /api/reading/stats returns the authenticated user counts', async () => {
  let receivedUserId: string | undefined;
  const app = express();
  const authenticate: RequestHandler = (req, _res, next) => {
    req.authUser = { id: userId, name: null, email: 'reader@example.com', avatar: null, createdAt: new Date() };
    next();
  };
  app.use('/api/reading', createReadingRouter({
    getStats: async (id) => {
      receivedUserId = id;
      return { counts: { WANT_TO_READ: 1, READING: 0, COMPLETED: 0, ON_HOLD: 0 }, total: 1 };
    },
  }, authenticate));
  app.use(errorHandler);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/reading/stats`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: { counts: { WANT_TO_READ: 1, READING: 0, COMPLETED: 0, ON_HOLD: 0 }, total: 1 },
    });
    assert.equal(receivedUserId, userId);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
