import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
import { cloudinaryCoverService } from '../uploads/covers.service';
import type { CreateLibraryEntryInput, LibraryListQuery, UpdateLibraryEntryInput } from './library.types';

const libraryEntrySelect = {
  id: true,
  bookId: true,
  ownership: true,
  readingStatus: true,
  personalNote: true,
  isFavorite: true,
  rating: true,
  currentPage: true,
  addedAt: true,
  purchaseDate: true,
  purchasePrice: true,
  finishedAt: true,
  discoverySource: true,
  priority: true,
  customCoverUri: true,
  coverTheme: true,
  updatedAt: true,
  book: {
    select: {
      id: true,
      title: true,
      description: true,
      genre: true,
      publisher: true,
      isbn10: true,
      isbn13: true,
      coverUrl: true,
      publishedDate: true,
      publishedYear: true,
      pageCount: true,
      language: true,
      edition: true,
      source: true,
      authors: {
        orderBy: { position: 'asc' as const },
        select: {
          position: true,
          author: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

export function calculateProgressPercentage(currentPage: number | null, pageCount: number | null): number | null {
  if (currentPage === null || pageCount === null || pageCount <= 0) return null;
  return Math.min(100, Math.max(0, (currentPage / pageCount) * 100));
}

function withProgress<T extends { currentPage: number | null; book: { pageCount: number | null } }>(entry: T) {
  return {
    ...entry,
    progressPercentage: calculateProgressPercentage(entry.currentPage, entry.book.pageCount),
  };
}

const entryNotFound = () => new AppError(404, 'LIBRARY_ENTRY_NOT_FOUND', 'Library entry not found.');

export function createLibraryService(
  database = prisma,
  verifyUserCover: (userId: string, coverUrl: string) => Promise<void> = (userId, coverUrl) => cloudinaryCoverService.verifyUserCover(userId, coverUrl),
) {
  async function create(userId: string, input: CreateLibraryEntryInput) {
    const book = await database.book.findUnique({ where: { id: input.bookId }, select: { id: true } });
    if (!book) throw new AppError(404, 'BOOK_NOT_FOUND', 'Catalog book not found.');

    try {
      const entry = await database.userBook.create({
        data: {
          userId,
          bookId: input.bookId,
          ownership: input.ownership,
          readingStatus: 'WANT_TO_READ',
        },
        select: libraryEntrySelect,
      });
      return withProgress(entry);
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) {
        throw new AppError(409, 'DUPLICATE_LIBRARY_ENTRY', 'This book is already in your library.');
      }
      if (isPrismaCode(error, 'P2003')) {
        throw new AppError(404, 'BOOK_NOT_FOUND', 'Catalog book not found.');
      }
      throw error;
    }
  }

  async function list(userId: string, query: LibraryListQuery) {
    const where: Prisma.UserBookWhereInput = {
      userId,
      ...(query.ownership ? { ownership: query.ownership } : {}),
      ...(query.readingStatus ? { readingStatus: query.readingStatus } : {}),
      ...(query.q ? {
        book: {
          is: {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { authors: { some: { author: { is: { name: { contains: query.q, mode: 'insensitive' } } } } } },
            ],
          },
        },
      } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      database.userBook.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ addedAt: 'desc' }, { id: 'desc' }],
        select: libraryEntrySelect,
      }),
      database.userBook.count({ where }),
    ]);
    return { items: items.map(withProgress), pagination: { page: query.page, limit: query.limit, total } };
  }

  async function get(userId: string, userBookId: string) {
    const entry = await database.userBook.findFirst({
      where: { id: userBookId, userId },
      select: libraryEntrySelect,
    });
    if (!entry) throw entryNotFound();
    return withProgress(entry);
  }

  async function update(userId: string, userBookId: string, input: UpdateLibraryEntryInput) {
    if (input.customCoverUri) {
      const ownedEntry = await database.userBook.findFirst({ where: { id: userBookId, userId }, select: { id: true } });
      if (!ownedEntry) throw entryNotFound();
      await verifyUserCover(userId, input.customCoverUri);
    }
    return database.$transaction(async (tx) => {
      const existing = await tx.userBook.findFirst({
        where: { id: userBookId, userId },
        select: { readingStatus: true },
      });
      if (!existing) throw entryNotFound();

      const data: UpdateLibraryEntryInput = { ...input };
      if (input.readingStatus !== undefined && input.readingStatus !== existing.readingStatus) {
        if (input.readingStatus === 'COMPLETED') {
          if (!Object.hasOwn(input, 'finishedAt')) data.finishedAt = new Date();
        } else {
          data.finishedAt = null;
        }
      }

      const result = await tx.userBook.updateMany({
        where: { id: userBookId, userId },
        data,
      });
      if (result.count === 0) throw entryNotFound();

      const updated = await tx.userBook.findFirst({
        where: { id: userBookId, userId },
        select: libraryEntrySelect,
      });
      if (!updated) throw entryNotFound();
      return withProgress(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async function remove(userId: string, userBookId: string): Promise<void> {
    const result = await database.userBook.deleteMany({ where: { id: userBookId, userId } });
    if (result.count === 0) throw entryNotFound();
  }

  return { create, list, get, update, remove };
}

export const libraryService = createLibraryService();
