import type { BookSearchQuery, ProviderSearchResult } from '../book-discovery.types';
import { env } from '../../../config/env';
import { normalizeGoogleBooksResponse } from '../utils/normalize-book';
import {
  PROVIDER_TIMEOUT_MS,
  ProviderHttpError,
  ProviderResponseError,
  type BookSearchProvider,
  type Fetcher,
} from './book-search.provider';

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';

export function createGoogleBooksProvider(
  options: { fetcher?: Fetcher; timeoutMs?: number; apiKey?: string } = {},
): BookSearchProvider {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const apiKey = options.apiKey ?? env.googleBooksApiKey;

  return {
    id: 'googleBooks',
    enabled: Boolean(apiKey),
    async search(query: BookSearchQuery): Promise<ProviderSearchResult> {
      const terms = [
        `intitle:${query.q}`,
        query.author ? `inauthor:${query.author}` : null,
        query.publisher ? `inpublisher:${query.publisher}` : null,
      ].filter((term): term is string => term !== null);

      const url = new URL(GOOGLE_BOOKS_ENDPOINT);
      url.searchParams.set('q', terms.join(' '));
      url.searchParams.set('startIndex', String((query.page - 1) * query.limit));
      url.searchParams.set('maxResults', String(query.limit));
      url.searchParams.set('printType', 'books');
      if (query.language?.length === 2) url.searchParams.set('langRestrict', query.language);
      if (apiKey) url.searchParams.set('key', apiKey);

      const response = await fetcher(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new ProviderHttpError('Google Books', response.status);

      const payload: unknown = await response.json();
      if (
        payload === null || typeof payload !== 'object' || Array.isArray(payload) ||
        ('items' in payload && payload.items !== undefined && !Array.isArray(payload.items)) ||
        ('totalItems' in payload && payload.totalItems !== undefined &&
          (typeof payload.totalItems !== 'number' || !Number.isSafeInteger(payload.totalItems) || payload.totalItems < 0))
      ) {
        throw new ProviderResponseError('Google Books');
      }

      const googleResponse = payload as { items?: unknown; totalItems?: unknown };
      if (googleResponse.items === undefined && googleResponse.totalItems !== 0) {
        throw new ProviderResponseError('Google Books');
      }

      return normalizeGoogleBooksResponse(payload);
    },
  };
}

export const googleBooksProvider = createGoogleBooksProvider();
