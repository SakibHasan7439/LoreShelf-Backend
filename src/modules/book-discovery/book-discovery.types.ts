import { z } from 'zod';

export const bookSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q is required and must not be blank.').max(200),
  author: z.string().trim().min(1).max(160).optional(),
  publisher: z.string().trim().min(1).max(160).optional(),
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2,3}$/, 'language must be a 2- or 3-letter language code.')
    .optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type BookSearchQuery = z.infer<typeof bookSearchQuerySchema>;

export type BookSearchSource = 'google-books' | 'open-library';

/** Provider-neutral book metadata. Missing catalog fields are represented as null. */
export interface BookSearchResult {
  source: BookSearchSource;
  externalId: string;
  title: string;
  authors: string[];
  publisher: string | null;
  description: string | null;
  coverUrl: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  language: string | null;
  edition: string | null;
}

export type ProviderStatus = 'success' | 'empty' | 'failed' | 'not_attempted' | 'not_configured';

export interface ProviderStatuses {
  googleBooks: ProviderStatus;
  openLibrary: ProviderStatus;
}

export interface ProviderSearchResult {
  results: BookSearchResult[];
  total: number | null;
}

export interface BookSearchData {
  results: BookSearchResult[];
  total: number | null;
  providers: ProviderStatuses;
}
