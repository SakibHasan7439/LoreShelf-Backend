import type { BookSearchResult } from '../book-discovery.types';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length > 0 ? normalized : null;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((item): item is string => item !== null);
}

function firstText(value: unknown): string | null {
  return textList(value)[0] ?? text(value);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizedIsbn(value: unknown, length: 10 | 13): string | null {
  if (typeof value !== 'string') return null;
  const isbn = value.replace(/[\s-]/gu, '').toUpperCase();
  const valid = length === 10 ? /^[0-9]{9}[0-9X]$/u.test(isbn) : /^[0-9]{13}$/u.test(isbn);
  return valid ? isbn : null;
}

function coverUrl(value: unknown): string | null {
  const url = text(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return null;
  }
}

function yearFromDate(date: string | null): number | null {
  const year = date?.match(/^(\d{4})/u)?.[1];
  return year ? Number(year) : null;
}

function languageCode(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const code = candidate.split('/').at(-1)?.toLowerCase() ?? candidate.toLowerCase();
  if (code === 'eng') return 'en';
  if (code === 'ben') return 'bn';
  return code;
}

function firstLanguage(value: unknown): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  const object = record(item);
  return languageCode(object?.key ?? item);
}

function descriptionText(value: unknown): string | null {
  const object = record(value);
  return text(object?.value ?? value);
}

function isbnFromIdentifiers(
  value: unknown,
  wantedType: 'ISBN_10' | 'ISBN_13',
  length: 10 | 13,
): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const identifier = record(item);
    if (identifier?.type === wantedType) {
      const isbn = normalizedIsbn(identifier.identifier, length);
      if (isbn) return isbn;
    }
  }
  return null;
}

function googleBookResult(value: unknown): BookSearchResult | null {
  const item = record(value);
  const info = record(item?.volumeInfo);
  const externalId = text(item?.id);
  const title = text(info?.title);
  if (!externalId || !title) return null;

  const images = record(info?.imageLinks);
  const publishedDate = text(info?.publishedDate);
  const identifiers = info?.industryIdentifiers;

  return {
    source: 'google-books',
    externalId,
    title,
    authors: textList(info?.authors),
    publisher: text(info?.publisher),
    description: text(info?.description),
    coverUrl:
      coverUrl(images?.extraLarge) ??
      coverUrl(images?.large) ??
      coverUrl(images?.medium) ??
      coverUrl(images?.thumbnail) ??
      coverUrl(images?.smallThumbnail),
    isbn10: isbnFromIdentifiers(identifiers, 'ISBN_10', 10),
    isbn13: isbnFromIdentifiers(identifiers, 'ISBN_13', 13),
    publishedDate,
    publishedYear: yearFromDate(publishedDate),
    pageCount: positiveInteger(info?.pageCount),
    language: languageCode(info?.language),
    edition: text(info?.edition),
  };
}

/** Convert the Google Books Volume List shape without assuming fields exist. */
export function normalizeGoogleBooksResponse(payload: unknown): {
  results: BookSearchResult[];
  total: number | null;
} {
  const response = record(payload);
  const items = response?.items;
  return {
    results: Array.isArray(items)
      ? items.map(googleBookResult).filter((item): item is BookSearchResult => item !== null)
      : [],
    total: count(response?.totalItems),
  };
}

function openLibraryResult(workValue: unknown, editionValue?: unknown): BookSearchResult | null {
  const work = record(workValue);
  const edition = record(editionValue);
  const externalId = text(edition?.key ?? work?.key);
  const title = text(edition?.title ?? work?.title);
  if (!externalId || !title) return null;

  const publishedDate = firstText(edition?.publish_date) ?? firstText(work?.publish_date);
  const coverId = positiveInteger(edition?.cover_i) ?? positiveInteger(work?.cover_i);
  const isbn10 = textList(edition?.isbn_10)
    .map((isbn) => normalizedIsbn(isbn, 10))
    .find((isbn): isbn is string => isbn !== null) ?? null;
  const isbn13 = textList(edition?.isbn_13)
    .map((isbn) => normalizedIsbn(isbn, 13))
    .find((isbn): isbn is string => isbn !== null) ?? null;

  return {
    source: 'open-library',
    externalId,
    title,
    authors: textList(work?.author_name),
    publisher: firstText(edition?.publishers) ?? text(edition?.publisher) ?? text(work?.publisher),
    description: descriptionText(edition?.description) ?? descriptionText(work?.description),
    coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null,
    isbn10,
    isbn13,
    publishedDate,
    publishedYear:
      yearFromDate(publishedDate) ?? positiveInteger(work?.first_publish_year),
    pageCount:
      positiveInteger(edition?.number_of_pages) ??
      positiveInteger(work?.number_of_pages_median),
    language: firstLanguage(edition?.language) ?? firstLanguage(work?.language),
    edition: text(edition?.physical_format ?? edition?.edition_name),
  };
}

/**
 * Open Library search returns work records, with edition records optionally
 * nested under `editions`. Keep edition IDs separate whenever available.
 */
export function normalizeOpenLibraryResponse(
  payload: unknown,
  limit = 20,
): { results: BookSearchResult[]; total: number | null } {
  const response = record(payload);
  const docs = response?.docs;
  if (!Array.isArray(docs)) {
    return { results: [], total: count(response?.num_found ?? response?.numFound) };
  }

  const results = docs.flatMap((raw): BookSearchResult[] => {
    const work = record(raw);
    const editionContainer = record(work?.editions);
    const editions = editionContainer?.docs;
    if (Array.isArray(editions) && editions.length > 0) {
      return editions
        .map((edition) => openLibraryResult(work, edition))
        .filter((item): item is BookSearchResult => item !== null);
    }

    const result = openLibraryResult(work);
    return result ? [result] : [];
  });

  return {
    results: results.slice(0, limit),
    total: count(response?.num_found ?? response?.numFound),
  };
}

export function deduplicateBookResults(results: readonly BookSearchResult[]): BookSearchResult[] {
  const unique = new Map<string, BookSearchResult>();

  for (const result of results) {
    const key = result.isbn13
      ? `isbn13:${result.isbn13}`
      : result.isbn10
        ? `isbn10:${result.isbn10}`
        : `${result.source}:${result.externalId}`;
    const existing = unique.get(key);
    if (!existing || metadataScore(result) > metadataScore(existing)) unique.set(key, result);
  }

  return [...unique.values()];
}

function metadataScore(result: BookSearchResult): number {
  return [
    result.authors.length > 0,
    result.publisher,
    result.description,
    result.coverUrl,
    result.isbn10,
    result.isbn13,
    result.publishedDate,
    result.pageCount,
    result.language,
    result.edition,
  ].filter(Boolean).length;
}

