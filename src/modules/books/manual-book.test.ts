import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';

import { errorHandler } from '../../middlewares/error.middleware';
import type { PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../utils/app-error';
import { normalizeAuthorName } from './author-normalization';
import { createBooksRouter } from './books.routes';
import { createManualBookService } from './manual-book.service';
import { manualBookSchema } from './manual-book.types';

test('manual book validation trims title and authors, supports null/missing metadata and ISBN normalization', () => {
  const parsed = manualBookSchema.parse({
    title: '  Example title  ', authors: ['  Ada Lovelace  ', 'Grace Hopper'],
    isbn10: '0-8044-2957-X', publisher: null,
  });
  assert.equal(parsed.title, 'Example title');
  assert.deepEqual(parsed.authors, ['Ada Lovelace', 'Grace Hopper']);
  assert.equal(parsed.isbn10, '080442957X');
  assert.equal(parsed.genre, undefined);
  assert.equal(manualBookSchema.safeParse({ title: ' ', authors: ['Author'] }).success, false);
  assert.equal(manualBookSchema.safeParse({ title: 'Title', authors: ['  '] }).success, false);
  assert.equal(manualBookSchema.safeParse({ title: 'Title', authors: ['Ada', ' ada '] }).success, false);
  assert.equal(manualBookSchema.safeParse({ title: 'Title', authors: ['Ada'], isbn13: '9780000000000' }).success, false);
});

test('author identity normalization collapses tabs and surrounding whitespace consistently', () => {
  assert.equal(normalizeAuthorName('\t Ada  \n Lovelace \t'), 'ada lovelace');
  assert.equal(normalizeAuthorName('ADA\u00a0LOVELACE'), 'ada lovelace');
});

test('manual book lookup rejects ISBN-10 and ISBN-13 assigned to different books', async () => {
  const book10 = { id: 'book-10', isbn10: '080442957X', isbn13: null, authors: [] };
  const book13 = { id: 'book-13', isbn10: null, isbn13: '9780306406157', authors: [] };
  const lookups: string[] = [];
  const fakeDatabase = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      book: {
        findUnique: async ({ where }: { where: { isbn10?: string; isbn13?: string } }) => {
          if (where.isbn10) { lookups.push('isbn10'); return book10; }
          if (where.isbn13) { lookups.push('isbn13'); return book13; }
          return null;
        },
      },
    }),
  } as unknown as PrismaClient;
  const createBook = createManualBookService(fakeDatabase);

  await assert.rejects(
    createBook({ title: 'Any title', authors: ['Author'], isbn10: '080442957X', isbn13: '9780306406157' }),
    (error: unknown) => error instanceof AppError && error.statusCode === 409,
  );
  assert.deepEqual(lookups, ['isbn10', 'isbn13']);
});

test('manual book lookup returns a compatible record when both ISBNs identify it', async () => {
  const existing = { id: 'same-book', isbn10: '080442957X', isbn13: '9780306406157', authors: [] };
  const fakeDatabase = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      book: { findUnique: async () => existing },
    }),
  } as unknown as PrismaClient;
  const result = await createManualBookService(fakeDatabase)(
    { title: 'Any title', authors: ['Author'], isbn10: '080442957X', isbn13: '9780306406157' },
  );
  assert.deepEqual(result, { book: existing, created: false });
});

test('manual book route creates a shared catalogue record and returns duplicate as existing', async () => {
  const book = { id: 'book-id', title: 'Example', source: 'MANUAL', authors: [] };
  let calls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/books', createBooksRouter(async (input) => {
    calls += 1;
    assert.deepEqual(input.authors, ['First Author', 'Second Author']);
    assert.equal(input.isbn13, null);
    return { book, created: calls === 1 };
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/books/manual`;
    const body = JSON.stringify({ title: ' Example ', authors: [' First Author ', 'Second Author'] });
    const first = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(first.status, 201);
    assert.deepEqual(await first.json(), { success: true, data: book });
    const again = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(again.status, 200);
    const invalid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"","authors":[]}' });
    assert.equal(invalid.status, 400);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
