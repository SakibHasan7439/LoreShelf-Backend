import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import type { RequestHandler } from 'express';

import { Prisma } from '../../generated/prisma/client';
import type { PrismaClient } from '../../generated/prisma/client';
import { errorHandler } from '../../middlewares/error.middleware';
import { AppError } from '../../utils/app-error';
import { createShelvesRouter } from './shelves.routes';
import { createShelfService } from './shelves.service';

const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const shelfId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const userBookId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('test error', { code, clientVersion: 'test' });
}

async function withServer(app: express.Express, action: (base: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await action(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

test('shelf create normalizes names and scopes all operations to authenticated user', async () => {
  const calls: Record<string, unknown> = {};
  const shelf = { id: shelfId, name: 'My Shelf', normalizedName: 'my shelf' };
  const database = {
    shelf: {
      create: async (args: unknown) => { calls.create = args; return shelf; },
      findMany: async (args: unknown) => { calls.list = args; return [shelf]; },
      findFirst: async (args: unknown) => { calls.find = args; return shelf; },
      update: async (args: unknown) => { calls.update = args; return shelf; },
      deleteMany: async (args: unknown) => { calls.delete = args; return { count: 1 }; },
    },
    userBook: { findFirst: async (args: unknown) => { calls.userBookFind = args; return { id: userBookId }; } },
    userBookShelf: {
      create: async (args: unknown) => { calls.linkCreate = args; return { id: 'link-id' }; },
      deleteMany: async (args: unknown) => { calls.linkDelete = args; return { count: 1 }; },
    },
  } as unknown as PrismaClient;
  const service = createShelfService(database);
  await service.create(userA, { name: '  My   Shelf\t', tagline: null, description: null, theme: null, icon: null });
  assert.equal((calls.create as { data: { name: string; normalizedName: string; userId: string } }).data.name, 'My Shelf');
  assert.equal((calls.create as { data: { normalizedName: string } }).data.normalizedName, 'my shelf');
  assert.equal((calls.create as { data: { userId: string } }).data.userId, userA);
  await service.list(userA);
  assert.deepEqual(calls.list, { where: { userId: userA }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: (calls.list as { select?: unknown })?.select });
  await service.get(userA, shelfId);
  assert.deepEqual(calls.find, { where: { id: shelfId, userId: userA }, select: (calls.find as { select?: unknown })?.select });
  await service.update(userA, shelfId, { name: 'MY shelf' });
  assert.equal((calls.update as { where: { userId: string }; data: { normalizedName: string } }).where.userId, userA);
  assert.equal((calls.update as { data: { normalizedName: string } }).data.normalizedName, 'my shelf');
  assert.equal(await service.remove(userA, shelfId), true);
  assert.deepEqual(calls.delete, { where: { id: shelfId, userId: userA } });
});

test('adding and removing books uses only the authenticated user and conflicts on duplicate links', async () => {
  const calls: Record<string, unknown> = {};
  let duplicate = false;
  const database = {
    shelf: { findFirst: async (args: unknown) => { calls.shelfFind = args; return { id: shelfId }; } },
    userBook: { findFirst: async (args: unknown) => { calls.bookFind = args; return { id: userBookId }; } },
    userBookShelf: {
      create: async (args: unknown) => { calls.linkCreate = args; if (duplicate) throw knownError('P2002'); return { id: 'link-id' }; },
      deleteMany: async (args: unknown) => { calls.linkDelete = args; return { count: 1 }; },
    },
  } as unknown as PrismaClient;
  const service = createShelfService(database);
  await service.addBook(userA, shelfId, userBookId);
  assert.deepEqual(calls.shelfFind, { where: { id: shelfId, userId: userA }, select: { id: true } });
  assert.deepEqual(calls.bookFind, { where: { id: userBookId, userId: userA }, select: { id: true } });
  assert.equal((calls.linkCreate as { data: { userId: string } }).data.userId, userA);
  duplicate = true;
  await assert.rejects(service.addBook(userA, shelfId, userBookId), (error: unknown) => error instanceof AppError && error.statusCode === 409 && error.code === 'DUPLICATE_SHELF_BOOK');
  assert.equal(await service.removeBook(userA, shelfId, userBookId), true);
  assert.deepEqual(calls.linkDelete, { where: { userId: userA, shelfId, userBookId } });
});

test('duplicate normalized shelf names return a conflict', async () => {
  const database = {
    shelf: { create: async () => { throw knownError('P2002'); } },
  } as unknown as PrismaClient;
  await assert.rejects(createShelfService(database).create(userA, { name: 'Reading Shelf' }),
    (error: unknown) => error instanceof AppError && error.statusCode === 409 && error.code === 'DUPLICATE_SHELF_NAME');
});

test('shelf and library entry belonging to another user are reported as missing', async () => {
  const database = {
    shelf: { findFirst: async () => null },
    userBook: { findFirst: async () => null },
    userBookShelf: { create: async () => ({}) },
  } as unknown as PrismaClient;
  const service = createShelfService(database);
  assert.equal(await service.get(userA, shelfId), null);
  assert.equal(await service.addBook(userA, shelfId, userBookId), null);
});

test('shelf routes use authenticated user identity and return 404 for foreign resources', async () => {
  let receivedUserId: string | undefined;
  const auth: RequestHandler = (req, _res, next) => {
    req.authUser = { id: userA, name: null, email: 'reader@example.com', avatar: null, createdAt: new Date() };
    next();
  };
  const service = {
    create: async (id: string, input: { name: string }) => { receivedUserId = id; return { id: shelfId, ...input }; },
    list: async (id: string) => { receivedUserId = id; return []; },
    get: async (id: string) => { receivedUserId = id; return id === userB ? { id: shelfId } : null; },
    update: async () => null,
    remove: async () => false,
    addBook: async () => null,
    removeBook: async () => false,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/shelves', createShelvesRouter(service as unknown as ReturnType<typeof createShelfService>, auth));
  app.use(errorHandler);
  await withServer(app, async (base) => {
    const created = await fetch(`${base}/api/shelves/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Reading', userId: userB }) });
    assert.equal(created.status, 400);
    const valid = await fetch(`${base}/api/shelves/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Reading' }) });
    assert.equal(valid.status, 201);
    assert.equal(receivedUserId, userA);
    const foreign = await fetch(`${base}/api/shelves/${shelfId}`);
    assert.equal(foreign.status, 404);
    const deleted = await fetch(`${base}/api/shelves/${shelfId}`, { method: 'DELETE' });
    assert.equal(deleted.status, 404);
  });
});
