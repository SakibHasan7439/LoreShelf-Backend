import { logger } from '../../utils/logger';
import type {
  BookSearchData,
  BookSearchQuery,
  ProviderStatuses,
} from './book-discovery.types';
import { googleBooksProvider } from './providers/google-books.provider';
import type { BookSearchProvider } from './providers/book-search.provider';
import { openLibraryProvider } from './providers/open-library.provider';
import { deduplicateBookResults } from './utils/normalize-book';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  expiresAt: number;
  data: BookSearchData;
}

export interface BookSearchServiceOptions {
  providers?: readonly BookSearchProvider[];
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  now?: () => number;
  logProviderFailure?: (provider: string, error: unknown) => void;
}

function cacheKey(query: BookSearchQuery): string {
  return JSON.stringify([
    query.q.toLowerCase(),
    query.author?.toLowerCase() ?? null,
    query.publisher?.toLowerCase() ?? null,
    query.language ?? null,
    query.page,
    query.limit,
  ]);
}

function hasProviderFailure(statuses: ProviderStatuses): boolean {
  return Object.values(statuses).includes('failed');
}

/**
 * Provider orchestration is intentionally independent from HTTP and storage.
 * Google is primary; Open Library is called only when Google failed or yielded
 * no usable records. Cache and in-flight coalescing are process-local.
 */
export function createBookSearchService(options: BookSearchServiceOptions = {}) {
  const providers = options.providers ?? [googleBooksProvider, openLibraryProvider];
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<BookSearchData>>();
  const logProviderFailure = options.logProviderFailure ?? ((provider, error) => {
    logger.error({ provider, err: error }, 'Book discovery provider failed');
  });

  async function searchUncached(query: BookSearchQuery): Promise<BookSearchData> {
    const providersState: ProviderStatuses = {
      googleBooks: 'not_attempted',
      openLibrary: 'not_attempted',
    };
    let results: BookSearchData['results'] = [];
    let total: number | null = null;

    for (const provider of providers) {
      if (provider.enabled === false) {
        providersState[provider.id] = 'not_configured';
        continue;
      }

      try {
        const response = await provider.search(query);
        const normalized = deduplicateBookResults(response.results);
        providersState[provider.id] = normalized.length > 0 ? 'success' : 'empty';
        total = response.total;

        if (normalized.length > 0) {
          results = normalized.slice(0, query.limit);
          break;
        }
      } catch (error) {
        providersState[provider.id] = 'failed';
        logProviderFailure(provider.id, error);
      }
    }

    return { results, total, providers: providersState };
  }

  return async function searchBooks(query: BookSearchQuery): Promise<BookSearchData> {
    const key = cacheKey(query);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      // Refresh insertion order so eviction is least-recently-used.
      cache.delete(key);
      cache.set(key, cached);
      return cached.data;
    }
    if (cached) cache.delete(key);

    const pending = inFlight.get(key);
    if (pending) return pending;

    const searchPromise = searchUncached(query).then((data) => {
      if (cacheTtlMs > 0 && cacheMaxEntries > 0 && !hasProviderFailure(data.providers)) {
        while (cache.size >= cacheMaxEntries) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey === undefined) break;
          cache.delete(oldestKey);
        }
        cache.set(key, { data, expiresAt: now() + cacheTtlMs });
      }
      return data;
    });

    inFlight.set(key, searchPromise);
    try {
      return await searchPromise;
    } finally {
      if (inFlight.get(key) === searchPromise) inFlight.delete(key);
    }
  };
}

export const searchBooks = createBookSearchService();
