import { env } from '../../../config/env';
import type { BookSearchQuery, ProviderSearchResult } from '../book-discovery.types';
import { normalizeOpenLibraryResponse } from '../utils/normalize-book';
import {
  PROVIDER_TIMEOUT_MS,
  ProviderHttpError,
  ProviderResponseError,
  type BookSearchProvider,
  type Fetcher,
} from './book-search.provider';

const OPEN_LIBRARY_ENDPOINT = 'https://openlibrary.org/search.json';
const OPEN_LIBRARY_FIELDS = [
  'key',
  'title',
  'author_name',
  'description',
  'cover_i',
  'first_publish_year',
  'number_of_pages_median',
  'language',
  'editions',
  'editions.key',
  'editions.title',
  'editions.publisher',
  'editions.publishers',
  'editions.publish_date',
  'editions.number_of_pages',
  'editions.isbn_10',
  'editions.isbn_13',
  'editions.language',
  'editions.cover_i',
  'editions.physical_format',
].join(',');

const OPEN_LIBRARY_LANGUAGE_CODES: Readonly<Record<string, string>> = {
  en: 'eng',
  bn: 'ben',
};

function createRequestGate(minimumIntervalMs: number): () => Promise<void> {
  let lastRequestAt = 0;
  let queue = Promise.resolve();

  return async () => {
    let release = (): void => {};
    const previous = queue;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      const waitMs = lastRequestAt + minimumIntervalMs - Date.now();
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      lastRequestAt = Date.now();
    } finally {
      release();
    }
  };
}

export function createOpenLibraryProvider(
  options: {
    fetcher?: Fetcher;
    timeoutMs?: number;
    minimumIntervalMs?: number;
  } = {},
): BookSearchProvider {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const waitForRateLimit = createRequestGate(options.minimumIntervalMs ?? 1_000);

  return {
    id: 'openLibrary',
    async search(query: BookSearchQuery): Promise<ProviderSearchResult> {
      const params = new URLSearchParams({
        fields: OPEN_LIBRARY_FIELDS,
        title: query.q,
        page: String(query.page),
        limit: String(query.limit),
      });
      if (query.author) params.set('author', query.author);
      if (query.publisher) params.set('publisher', query.publisher);

      if (query.language) {
        if (query.language.length === 2) params.set('lang', query.language);
        const languageCode = OPEN_LIBRARY_LANGUAGE_CODES[query.language] ??
          (query.language.length === 3 ? query.language : null);
        if (languageCode) params.set('q', `language:${languageCode}`);
      }

      await waitForRateLimit();
      const response = await fetcher(`${OPEN_LIBRARY_ENDPOINT}?${params}`, {
        headers: {
          accept: 'application/json',
          'user-agent': env.openLibraryContact
            ? `LoreShelfBackend/0.1 (${env.openLibraryContact})`
            : 'LoreShelfBackend/0.1',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new ProviderHttpError('Open Library', response.status);

      const payload: unknown = await response.json();
      if (
        payload === null || typeof payload !== 'object' || Array.isArray(payload) ||
        !('docs' in payload) || !Array.isArray(payload.docs)
      ) {
        throw new ProviderResponseError('Open Library');
      }

      return normalizeOpenLibraryResponse(payload, query.limit);
    },
  };
}

export const openLibraryProvider = createOpenLibraryProvider();
