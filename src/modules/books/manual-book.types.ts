import { z } from 'zod';
import { normalizeAuthorName } from './author-normalization';

function normalizeIsbn(value: string): string {
  return value.replace(/[\s-]/gu, '').toUpperCase();
}

function validIsbn10(value: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/u.test(value)) return false;
  return [...value].reduce((sum, char, index) => sum + Number(char === 'X' ? 10 : char) * (10 - index), 0) % 11 === 0;
}

function validIsbn13(value: string): boolean {
  if (!/^[0-9]{13}$/u.test(value)) return false;
  const check = [...value.slice(0, 12)].reduce((sum, char, index) => sum + Number(char) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (check % 10)) % 10 === Number(value[12]);
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const isbn10 = optionalText(32).transform((value) => value == null ? null : normalizeIsbn(value))
  .refine((value) => value == null || validIsbn10(value), 'isbn10 must be a valid ISBN-10.');
const isbn13 = optionalText(32).transform((value) => value == null ? null : normalizeIsbn(value))
  .refine((value) => value == null || validIsbn13(value), 'isbn13 must be a valid ISBN-13.');

export const manualBookSchema = z.object({
  title: z.string().trim().min(1, 'title must not be blank.').max(500),
  authors: z.array(z.string().trim().min(1, 'author names must not be blank.').max(255)).min(1).max(20),
  publisher: optionalText(255),
  genre: optionalText(120),
  coverUrl: optionalText(2048).refine((value) => value == null || /^https?:\/\//iu.test(value), 'coverUrl must be an HTTP(S) URL.'),
  description: optionalText(20_000),
  isbn10,
  isbn13,
  edition: optionalText(255),
  language: optionalText(16),
  publishedYear: z.number().int().min(1000).max(new Date().getFullYear() + 1).nullable().optional(),
}).superRefine(({ authors }, ctx) => {
  const seen = new Set<string>();
  authors.forEach((author, index) => {
    const key = normalizeAuthorName(author);
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['authors', index], message: 'Duplicate author name.' });
    seen.add(key);
  });
});

export type ManualBookInput = z.infer<typeof manualBookSchema>;
