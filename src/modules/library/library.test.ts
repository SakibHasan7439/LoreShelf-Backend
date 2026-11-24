import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import type { RequestHandler } from 'express';

import { Prisma } from '../../generated/prisma/client';
import type { PrismaClient } from '../../generated/prisma/client';
import { errorHandler } from '../../middlewares/error.middleware';
import { AppError } from '../../utils/app-error';
import { createLibraryRouter } from './library.routes';
import { createLibraryService } from './library.service';
import { createLibraryEntrySchema, libraryListQuerySchema, updateLibraryEntrySchema } from './library.types';

const userIdA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userIdB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bookId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const entryId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const authorId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const catalogBook = {
  id: bookId,
  title: 'A Sample Book',
  description: null,
  genre: null,
  publisher: null,
  isbn10: null,
  isbn13: null,
  coverUrl: null,
  publishedDate: null,
  publishedYear: null,
  pageCount: 200,
  language: 'en',
  edition: null,
  source: 'MANUAL',
  authors: [{ position: 0, author: { id: authorId, name: 'An Author' } }],
};

const entry = {
  id: entryId,
  bookId,
  ownership: 'WISHLIST',
  readingStatus: 'WANT_TO_READ',
  personalNote: null,
  isFavorite: false,
  rating: null,
  currentPage: null,
  addedAt: new Date('2026-02-01T00:00:00.000Z'),
  purchaseDate: null,
  purchasePrice: null,
  finishedAt: null,
  discoverySource: null,
  priority: null,
  customCoverUri: null,
  coverTheme: null,
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
  book: catalogBook,
};

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`test ${code}`, { code, clientVersion: 'test' });
}

function fakeDatabase(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown> = {};
  const delegates = {
    book: {
      findUnique: async (args: unknown) => { calls.bookFindUnique = args; return { id: bookId }; },
    },
    userBook: {
      create: async (args: unknown) => { calls.create = args; return entry; },
      findMany: async (args: unknown) => { calls.findMany = args; return [entry]; },
      count: async (args: unknown) => { calls.count = args; return 1; },
      findFirst: async (args: unknown) => { calls.findFirst = args; return entry; },
      updateMany: async (args: unknown) => { calls.updateMany = args; return { count: 1 }; },
      deleteMany: async (args: unknown) => { calls.deleteMany = args; return { count: 1 }; },
    },
    ...overrides,
  };
  return { database: delegates as unknown as PrismaClient, calls };
}

function authAs(userId: string): RequestHandler {
  return (req, _res, next) => {
    req.authUser = { id: userId, name: 'Reader', email: 'reader@example.com', avatar: null, createdAt: new Date() };
    next();
  };
}

async function withServer(app: express.Express, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await run(`http://127.0.0.1:${address.port}/api/library`);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

test('create/list schemas apply defaults and reject invalid or client-owned fields', () => {
  assert.deepEqual(libraryListQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.equal(createLibraryEntrySchema.safeParse({ bookId, ownership: 'OWNED' }).success, true);
  assert.equal(createLibraryEntrySchema.safeParse({ bookId, ownership: 'COLLECTION' }).success, false);
  assert.equal(libraryListQuerySchema.safeParse({ limit: '51' }).success, false);
  assert.equal(libraryListQuerySchema.safeParse({ userId: userIdB }).success, false);
});

test('patch schema allows only valid UserBook fields and rejects empty, immutable, and invalid values', () => {
  assert.equal(updateLibraryEntrySchema.safeParse({ ownership: 'OWNED' }).success, true);
  assert.equal(updateLibraryEntrySchema.safeParse({ ownership: 'OWNED', readingStatus: 'READING' }).success, true);
  assert.equal(updateLibraryEntrySchema.safeParse({ rating: 5, currentPage: 0, purchasePrice: 12.5 }).success, true);
  assert.equal(updateLibraryEntrySchema.safeParse({ rating: 6 }).success, false);
  assert.equal(updateLibraryEntrySchema.safeParse({ currentPage: -1 }).success, false);
  assert.equal(updateLibraryEntrySchema.safeParse({ purchasePrice: 1.234 }).success, false);
  assert.equal(updateLibraryEntrySchema.safeParse({ purchaseDate: 'not-a-date' }).success, false);
  assert.equal(updateLibraryEntrySchema.safeParse({}).success, false);
  assert.equal(updateLibraryEntrySchema.safeParse({ userId: userIdB }).success, false);
  assert.equal(updateLibraryEntrySchema.safeParse({ bookId }).success, false);
});

test('create uses the authenticated owner, validates catalog existence, and maps duplicates to 409', async () => {
  const state = fakeDatabase();
  const service = createLibraryService(state.database);
  await service.create(userIdA, { bookId, ownership: 'OWNED' });
  const createArgs = state.calls.create as { data: Record<string, unknown> };
  assert.deepEqual(createArgs.data, { userId: userIdA, bookId, ownership: 'OWNED', readingStatus: 'WANT_TO_READ' });
  assert.deepEqual(state.calls.bookFindUnique, { where: { id: bookId }, select: { id: true } });

  const duplicateState = fakeDatabase({ userBook: {
    create: async () => { throw prismaError('P2002'); },
  } });
  await assert.rejects(createLibraryService(duplicateState.database).create(userIdA, { bookId, ownership: 'WISHLIST' }),
    (error: unknown) => error instanceof AppError && error.statusCode === 409 && error.code === 'DUPLICATE_LIBRARY_ENTRY');

  const missingState = fakeDatabase({ book: { findUnique: async () => null } });
  await assert.rejects(createLibraryService(missingState.database).create(userIdA, { bookId, ownership: 'WISHLIST' }),
    (error: unknown) => error instanceof AppError && error.statusCode === 404 && error.code === 'BOOK_NOT_FOUND');
});

test('list scopes both item and count queries, searches titles/authors, and orders entries deterministically', async () => {
  const state = fakeDatabase();
  const result = await createLibraryService(state.database).list(userIdA, libraryListQuerySchema.parse({
    ownership: 'OWNED', readingStatus: 'READING', q: 'author', page: '2', limit: '10',
  }));
  const findArgs = state.calls.findMany as { where: Record<string, unknown>; skip: number; take: number; orderBy: unknown; select: { book: { select: { authors: { orderBy: unknown } } } } };
  const countArgs = state.calls.count as { where: Record<string, unknown> };
  assert.equal(findArgs.where.userId, userIdA);
  assert.equal(findArgs.where.ownership, 'OWNED');
  assert.equal(findArgs.where.readingStatus, 'READING');
  assert.equal(findArgs.skip, 10);
  assert.equal(findArgs.take, 10);
  assert.deepEqual(findArgs.orderBy, [{ addedAt: 'desc' }, { id: 'desc' }]);
  assert.deepEqual(findArgs.select.book.select.authors.orderBy, { position: 'asc' });
  assert.equal(JSON.stringify(findArgs.where).includes('author'), true);
  assert.equal(countArgs.where.userId, userIdA);
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 1 });
});

test('get, update, and delete scope by both entry ID and authenticated user ID', async () => {
  const state = fakeDatabase();
  const service = createLibraryService(state.database);
  await service.get(userIdA, entryId);
  assert.deepEqual(state.calls.findFirst, { where: { id: entryId, userId: userIdA }, select: state.calls.findFirst && (state.calls.findFirst as { select: unknown }).select });

  await service.update(userIdA, entryId, { ownership: 'OWNED' });
  const updateArgs = state.calls.updateMany as { where: unknown; data: unknown };
  assert.deepEqual(updateArgs.where, { id: entryId, userId: userIdA });
  assert.deepEqual(updateArgs.data, { ownership: 'OWNED' });

  await service.remove(userIdA, entryId);
  assert.deepEqual(state.calls.deleteMany, { where: { id: entryId, userId: userIdA } });

  const missingState = fakeDatabase({ userBook: { findFirst: async () => null } });
  await assert.rejects(createLibraryService(missingState.database).get(userIdA, entryId),
    (error: unknown) => error instanceof AppError && error.statusCode === 404);
});

test('authenticated routes ignore supplied userId, return the expected envelopes, and require auth', async () => {
  const state = fakeDatabase();
  const service = createLibraryService(state.database);
  const app = express();
  app.use(express.json());
  app.use('/api/library', createLibraryRouter(service, authAs(userIdA)));
  app.use(errorHandler);

  await withServer(app, async (base) => {
    const created = await fetch(base, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookId, ownership: 'WISHLIST', userId: userIdB }),
    });
    assert.equal(created.status, 400);

    const response = await fetch(base, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookId, ownership: 'WISHLIST' }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(state.calls.create && (state.calls.create as { data: unknown }).data,
      { userId: userIdA, bookId, ownership: 'WISHLIST', readingStatus: 'WANT_TO_READ' });

    const list = await fetch(`${base}?page=1&limit=20`);
    assert.equal(list.status, 200);
    const body = await list.json() as { success: boolean; data: { pagination: { page: number; limit: number; total: number } } };
    assert.equal(body.success, true);
    assert.deepEqual(body.data.pagination, { page: 1, limit: 20, total: 1 });

    const retrieved = await fetch(`${base}/${entryId}`);
    assert.equal(retrieved.status, 200);
    assert.deepEqual(state.calls.findFirst && (state.calls.findFirst as { where: unknown }).where, { id: entryId, userId: userIdA });

    const patched = await fetch(`${base}/${entryId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownership: 'OWNED' }),
    });
    assert.equal(patched.status, 200);
    assert.deepEqual((state.calls.updateMany as { data: unknown }).data, { ownership: 'OWNED' });

    const deleted = await fetch(`${base}/${entryId}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { success: true, data: { removed: true } });
    assert.deepEqual(state.calls.deleteMany, { where: { id: entryId, userId: userIdA } });
  });

  const unauthenticated = express();
  unauthenticated.use('/api/library', createLibraryRouter(service, (_req, _res, next) => next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.'))));
  unauthenticated.use(errorHandler);
  await withServer(unauthenticated, async (base) => {
    assert.equal((await fetch(base)).status, 401);
  });
});
