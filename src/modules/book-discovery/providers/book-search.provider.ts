import type {
  BookSearchQuery,
  ProviderSearchResult,
} from '../book-discovery.types';

export type BookSearchProviderId = 'googleBooks' | 'openLibrary';

export interface BookSearchProvider {
  readonly id: BookSearchProviderId;
  readonly enabled?: boolean;
  search(query: BookSearchQuery): Promise<ProviderSearchResult>;
}

export type Fetcher = typeof fetch;

export class ProviderHttpError extends Error {
  readonly statusCode: number;

  constructor(provider: string, statusCode: number) {
    super(`${provider} returned HTTP ${statusCode}.`);
    this.name = 'ProviderHttpError';
    this.statusCode = statusCode;
  }
}

export class ProviderResponseError extends Error {
  constructor(provider: string) {
    super(`${provider} returned an unexpected response shape.`);
    this.name = 'ProviderResponseError';
  }
}

export const PROVIDER_TIMEOUT_MS = 8_000;
