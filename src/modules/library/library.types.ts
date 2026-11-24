import { z } from 'zod';

import { BookPriority, CoverTheme, DiscoverySource, Ownership, ReadingStatus } from '../../generated/prisma/enums';

export const createLibraryEntrySchema = z.object({
  bookId: z.string().uuid(),
  ownership: z.enum(Ownership),
}).strict();

export const libraryListQuerySchema = z.object({
  ownership: z.enum(Ownership).optional(),
  readingStatus: z.enum(ReadingStatus).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

const isoDate = z.iso.date().transform((value) => new Date(`${value}T00:00:00.000Z`));
const purchasePrice = z.union([
  z.number().finite().min(0).max(99_999_999.99).refine((value) => Number(value.toFixed(2)) === value, 'purchasePrice supports at most two decimal places.'),
  z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/u, 'purchasePrice must be a nonnegative decimal with at most two decimal places.'),
]).nullable().optional();

export const updateLibraryEntrySchema = z.object({
  ownership: z.enum(Ownership).optional(),
  readingStatus: z.enum(ReadingStatus).optional(),
  personalNote: z.string().max(20_000).nullable().optional(),
  isFavorite: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  currentPage: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  purchaseDate: isoDate.nullable().optional(),
  purchasePrice,
  finishedAt: isoDate.nullable().optional(),
  discoverySource: z.enum(DiscoverySource).nullable().optional(),
  priority: z.enum(BookPriority).nullable().optional(),
  customCoverUri: z.string().max(2_048).nullable().optional(),
  coverTheme: z.enum(CoverTheme).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({ code: 'custom', message: 'At least one updatable field is required.' });
  }
});

export const userBookIdSchema = z.string().uuid();

export type CreateLibraryEntryInput = z.infer<typeof createLibraryEntrySchema>;
export type LibraryListQuery = z.infer<typeof libraryListQuerySchema>;
export type UpdateLibraryEntryInput = z.infer<typeof updateLibraryEntrySchema>;
