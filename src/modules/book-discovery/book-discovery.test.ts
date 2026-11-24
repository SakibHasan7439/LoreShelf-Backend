import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';

import { errorHandler } from '../../middlewares/error.middleware';
import {
  bookSearchQuerySchema,
  type BookSearchData,
  type BookSearchQuery,
  type BookSearchResult,
} from './book-discovery.types';
import { createBookSearchService } from './book-discovery.service';
import { createBookDiscoveryRouter } from './book-discovery.routes';
import type { BookSearchProvider } from './providers/book-search.provider';
import { createGoogleBooksProvider } from './providers/google-books.provider';
import { createOpenLibraryProvider } from './providers/open-library.provider';
import {
  deduplicateBookResults,
  normalizeGoogleBooksResponse,
  normalizeOpenLibraryResponse,
} from './utils/normalize-book';

const query: BookSearchQuery = {
  q: 'The Wind-Up Bird Chronicle',
  page: 1,
  limit: 10,
};

function result(
  changes: Partial<BookSearchResult> = {},
): BookSearchResult {
  return {
    source: 'google-books',
    externalId: 'volume-1',
    title: 'Example Book',
    authors: [],
    publisher: null,
    description: null,
    coverUrl: null,
    isbn10: null,
    isbn13: null,
    publishedDate: null,
    publishedYear: null,
    pageCount: null,
    language: null,
    edition: null,
    ...changes,
  };
}

function provider(
  id: BookSearchProvider['id'],
  search: BookSearchProvider['search'],
): BookSearchProvider {
  return { id, search };
}

test('query validation requires a title and applies pagination defaults and limits', () => {
  assert.deepEqual(bookSearchQuerySchema.parse({ q: '  হুমায়ূন আহমেদ  ' }), {
    q: 'হুমায়ূন আহমেদ',
    page: 1,
    limit: 10,
  });
  assert.equal(bookSearchQuerySchema.safeParse({ q: '  ' }).success, false);
  assert.equal(bookSearchQuerySchema.safeParse({ q: 'title', limit: '21' }).success, false);
  assert.equal(bookSearchQuerySchema.safeParse({ q: 'title', page: '0' }).success, false);
  assert.equal(bookSearchQuerySchema.safeParse({ q: 'title', language: 'english' }).success, false);
});

test('Google Books normalization handles English metadata, multiple authors, and preferred covers', () => {
  const normalized = normalizeGoogleBooksResponse({
    totalItems: 42,
    items: [{
      id: 'google-volume-1',
      volumeInfo: {
        title: 'The Wind-Up Bird Chronicle',
        authors: ['Haruki Murakami', 'Jay Rubin'],
        publisher: 'Vintage',
        description: '  A   novel. ',
        imageLinks: {
          thumbnail: 'http://books.example/low.jpg',
          large: 'https://books.example/high.jpg',
        },
        industryIdentifiers: [
          { type: 'ISBN_10', identifier: '0-679-77543-9' },
          { type: 'ISBN_13', identifier: '978-0679775430' },
        ],
        publishedDate: '1997-10-01',
        pageCount: 607,
        language: 'en',
      },
    }],
  });

  assert.equal(normalized.total, 42);
  assert.deepEqual(normalized.results[0], result({
    externalId: 'google-volume-1',
    title: 'The Wind-Up Bird Chronicle',
    authors: ['Haruki Murakami', 'Jay Rubin'],
    publisher: 'Vintage',
    description: 'A novel.',
    coverUrl: 'https://books.example/high.jpg',
    isbn10: '0679775439',
    isbn13: '9780679775430',
    publishedDate: '1997-10-01',
    publishedYear: 1997,
    pageCount: 607,
    language: 'en',
  }));
});

test('Google Books preserves Bangla Unicode and tolerates missing metadata and malformed items', () => {
  const normalized = normalizeGoogleBooksResponse({
    items: [
      {
        id: 'bangla-volume',
        volumeInfo: { title: 'নন্দিত নরকে', authors: ['হুমায়ূন আহমেদ'], language: 'bn' },
      },
      { id: 'missing-title', volumeInfo: { authors: ['Ignored'] } },
      null,
    ],
  });

  assert.equal(normalized.results.length, 1);
  assert.equal(normalized.results[0]?.title, 'নন্দিত নরকে');
  assert.deepEqual(normalized.results[0]?.authors, ['হুমায়ূন আহমেদ']);
  assert.equal(normalized.results[0]?.coverUrl, null);
  assert.equal(normalized.results[0]?.isbn10, null);
  assert.equal(normalized.results[0]?.isbn13, null);
  assert.equal(normalizeGoogleBooksResponse({ unexpected: true }).results.length, 0);
});

test('Open Library keeps edition identities separate and maps edition metadata', () => {
  const normalized = normalizeOpenLibraryResponse({
    num_found: 2,
    docs: [{
      key: '/works/OL1W',
      title: 'The Dispossessed',
      author_name: ['Ursula K. Le Guin', 'Editor Name'],
      description: { value: 'A work description.' },
      editions: {
        docs: [
          {
            key: '/books/OL1M',
            title: 'The Dispossessed',
            publishers: ['Harper & Row'],
            publish_date: ['1974'],
            number_of_pages: 341,
            isbn_10: ['0-06-012563-X'],
            isbn_13: ['9780060125638'],
            language: ['/languages/eng'],
            physical_format: 'Hardcover',
            cover_i: 700,
          },
          {
            key: '/books/OL2M',
            title: 'The Dispossessed',
            publishers: ['Harper Perennial'],
            publish_date: ['2003'],
            isbn_13: ['9780061054884'],
          },
        ],
      },
    }],
  });

  assert.equal(normalized.total, 2);
  assert.equal(normalized.results.length, 2);
  assert.deepEqual(normalized.results.map((book) => book.externalId), ['/books/OL1M', '/books/OL2M']);
  assert.equal(normalized.results[0]?.isbn10, '006012563X');
  assert.equal(normalized.results[0]?.isbn13, '9780060125638');
  assert.equal(normalized.results[0]?.language, 'en');
  assert.equal(normalized.results[0]?.coverUrl, 'https://covers.openlibrary.org/b/id/700-L.jpg');
  assert.equal(normalized.results[1]?.coverUrl, null);
  assert.equal(normalized.results[1]?.isbn10, null);
  assert.equal(normalized.results[1]?.edition, null);
});

test('Open Library supports work-only records without cover or ISBN', () => {
  const normalized = normalizeOpenLibraryResponse({
    numFound: 1,
    docs: [{ key: '/works/OL3W', title: 'A Bangla Title', author_name: ['একজন লেখক'] }],
  });

  assert.equal(normalized.results[0]?.source, 'open-library');
  assert.equal(normalized.results[0]?.externalId, '/works/OL3W');
  assert.equal(normalized.results[0]?.authors[0], 'একজন লেখক');
  assert.equal(normalized.results[0]?.coverUrl, null);
  assert.equal(normalized.results[0]?.isbn13, null);
});

test('duplicate handling uses ISBN first and provider identity otherwise, never title alone', () => {
  const books = deduplicateBookResults([
    result({ externalId: 'google-1', isbn13: '9780000000001' }),
    result({ source: 'open-library', externalId: '/books/OL1M', isbn13: '9780000000001', description: 'Richer' }),
    result({ externalId: 'edition-1', title: 'Same Title' }),
    result({ externalId: 'edition-2', title: 'Same Title' }),
  ]);

  assert.equal(books.length, 3);
  assert.equal(books[0]?.source, 'open-library');
  assert.equal(books[0]?.description, 'Richer');
  assert.deepEqual(books.slice(1).map((book) => book.externalId), ['edition-1', 'edition-2']);
});

test('Google provider builds field filters and pagination, then falls back when there are no useful results', async () => {
  let googleUrl: URL | undefined;
  let openLibraryUrl: URL | undefined;
  const google = createGoogleBooksProvider({
    apiKey: 'test-key',
    fetcher: async (input) => {
      googleUrl = new URL(String(input));
      return new Response(JSON.stringify({ items: [{ id: 'bad', volumeInfo: {} }] }), { status: 200 });
    },
  });
  const openLibrary = createOpenLibraryProvider({
    minimumIntervalMs: 0,
    fetcher: async (input, init) => {
      openLibraryUrl = new URL(String(input));
      assert.ok(new Headers(init?.headers).get('user-agent')?.startsWith('LoreShelfBackend/0.1'));
      return new Response(JSON.stringify({ num_found: 1, docs: [] }), { status: 200 });
    },
  });
  const search = createBookSearchService({ providers: [google, openLibrary], logProviderFailure: () => {} });
  const response = await search({
    ...query,
    q: 'নন্দিত নরকে',
    author: 'হুমায়ূন আহমেদ',
    publisher: 'অন্যপ্রকাশ',
    language: 'bn',
    page: 3,
    limit: 8,
  });

  assert.equal(googleUrl?.searchParams.get('q'), 'intitle:নন্দিত নরকে inauthor:হুমায়ূন আহমেদ inpublisher:অন্যপ্রকাশ');
  assert.equal(googleUrl?.searchParams.get('startIndex'), '16');
  assert.equal(googleUrl?.searchParams.get('maxResults'), '8');
  assert.equal(googleUrl?.searchParams.get('key'), 'test-key');
  assert.equal(googleUrl?.searchParams.get('langRestrict'), 'bn');
  assert.equal(openLibraryUrl?.searchParams.get('title'), 'নন্দিত নরকে');
  assert.equal(openLibraryUrl?.searchParams.get('author'), 'হুমায়ূন আহমেদ');
  assert.equal(openLibraryUrl?.searchParams.get('publisher'), 'অন্যপ্রকাশ');
  assert.equal(openLibraryUrl?.searchParams.get('lang'), 'bn');
  assert.equal(openLibraryUrl?.searchParams.get('q'), 'language:ben');
  assert.equal(openLibraryUrl?.searchParams.get('page'), '3');
  assert.equal(response.providers.googleBooks, 'empty');
  assert.equal(response.providers.openLibrary, 'empty');
});

test('provider failure is logged and Open Library fallback can still return results', async () => {
  const logged: string[] = [];
  const fallbackBook = result({
    source: 'open-library',
    externalId: '/books/OL3M',
    title: 'Fallback title',
  });
  const search = createBookSearchService({
    providers: [
      provider('googleBooks', async () => { throw new Error('timeout'); }),
      provider('openLibrary', async () => ({ results: [fallbackBook], total: 1 })),
    ],
    logProviderFailure: (id) => logged.push(id),
  });

  const response = await search(query);
  assert.deepEqual(logged, ['googleBooks']);
  assert.equal(response.providers.googleBooks, 'failed');
  assert.equal(response.providers.openLibrary, 'success');
  assert.equal(response.results[0]?.externalId, '/books/OL3M');
});

test('Google Books is skipped cleanly when its required API key is not configured', async () => {
  let openLibraryCalls = 0;
  const google = createGoogleBooksProvider({ apiKey: '', fetcher: async () => {
    throw new Error('Google Books should not be called without an API key.');
  } });
  const openLibrary = provider('openLibrary', async () => {
    openLibraryCalls += 1;
    return { results: [], total: 0 };
  });
  const search = createBookSearchService({ providers: [google, openLibrary], logProviderFailure: () => {} });

  const response = await search(query);
  assert.equal(openLibraryCalls, 1);
  assert.equal(response.providers.googleBooks, 'not_configured');
  assert.equal(response.providers.openLibrary, 'empty');
});

test('provider errors are not cached and timeouts propagate from provider adapters', async () => {
  let requestCount = 0;
  const failing = provider('googleBooks', async () => {
    requestCount += 1;
    throw new Error('malformed response');
  });
  const empty = provider('openLibrary', async () => ({ results: [], total: 0 }));
  const search = createBookSearchService({
    providers: [failing, empty],
    logProviderFailure: () => {},
  });

  const first = await search(query);
  const second = await search(query);
  assert.equal(requestCount, 2);
  assert.equal(first.providers.googleBooks, 'failed');
  assert.equal(second.providers.openLibrary, 'empty');

  const timedProvider = createGoogleBooksProvider({
    timeoutMs: 5,
    fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
    }),
  });
  const keepEventLoopAlive = setTimeout(() => {}, 50);
  try {
    await assert.rejects(timedProvider.search(query), /timed out/u);
  } finally {
    clearTimeout(keepEventLoopAlive);
  }
});

test('provider adapters reject malformed response shapes instead of treating them as empty results', async () => {
  const google = createGoogleBooksProvider({
    fetcher: async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
  });
  const openLibrary = createOpenLibraryProvider({
    minimumIntervalMs: 0,
    fetcher: async () => new Response(JSON.stringify({ docs: 'not-an-array' }), { status: 200 }),
  });

  await assert.rejects(google.search(query), /unexpected response shape/u);
  await assert.rejects(openLibrary.search(query), /unexpected response shape/u);
});

test('identical concurrent and recently repeated searches share cached results', async () => {
  let providerCalls = 0;
  const google = provider('googleBooks', async () => {
    providerCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { results: [result()], total: 1 };
  });
  const search = createBookSearchService({ providers: [google] });

  const [first, concurrent] = await Promise.all([search(query), search(query)]);
  const cached = await search(query);
  assert.equal(providerCalls, 1);
  assert.deepEqual(concurrent, first);
  assert.deepEqual(cached, first);
});

test('search cache expires after its configured TTL', async () => {
  let providerCalls = 0;
  let now = 100;
  const search = createBookSearchService({
    providers: [provider('googleBooks', async () => {
      providerCalls += 1;
      return { results: [result()], total: 1 };
    })],
    cacheTtlMs: 50,
    now: () => now,
  });

  await search(query);
  now += 51;
  await search(query);
  assert.equal(providerCalls, 2);
});

test('HTTP endpoint validates query parameters and returns the normalized response envelope', async () => {
  const serviceData: BookSearchData = {
    results: [result()],
    total: 17,
    providers: { googleBooks: 'success', openLibrary: 'not_attempted' },
  };
  const app = express();
  app.use('/api/books', createBookDiscoveryRouter(async (parsed) => {
    assert.equal(parsed.q, 'The Dispossessed');
    return serviceData;
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/books/search`;
    const response = await fetch(`${base}?q=${encodeURIComponent('The Dispossessed')}&page=2&limit=5`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: {
        results: serviceData.results,
        pagination: { page: 2, limit: 5, total: 17 },
        providers: serviceData.providers,
      },
    });

    const invalid = await fetch(`${base}?limit=21`);
    assert.equal(invalid.status, 400);
    const invalidBody = await invalid.json() as { error: { code: string } };
    assert.equal(invalidBody.error.code, 'VALIDATION_ERROR');
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
