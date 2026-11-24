import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
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

const entryNotFound = () => new AppError(404, 'LIBRARY_ENTRY_NOT_FOUND', 'Library entry not found.');

export function createLibraryService(database = prisma) {
  async function create(userId: string, input: CreateLibraryEntryInput) {
    const book = await database.book.findUnique({ where: { id: input.bookId }, select: { id: true } });
    if (!book) throw new AppError(404, 'BOOK_NOT_FOUND', 'Catalog book not found.');

    try {
      return await database.userBook.create({
        data: {
          userId,
          bookId: input.bookId,
          ownership: input.ownership,
          readingStatus: 'WANT_TO_READ',
        },
        select: libraryEntrySelect,
      });
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
    return { items, pagination: { page: query.page, limit: query.limit, total } };
  }

  async function get(userId: string, userBookId: string) {
    const entry = await database.userBook.findFirst({
      where: { id: userBookId, userId },
      select: libraryEntrySelect,
    });
    if (!entry) throw entryNotFound();
    return entry;
  }

  async function update(userId: string, userBookId: string, input: UpdateLibraryEntryInput) {
    const result = await database.userBook.updateMany({
      where: { id: userBookId, userId },
      data: input,
    });
    if (result.count === 0) throw entryNotFound();
    return get(userId, userBookId);
  }

  async function remove(userId: string, userBookId: string): Promise<void> {
    const result = await database.userBook.deleteMany({ where: { id: userBookId, userId } });
    if (result.count === 0) throw entryNotFound();
  }

  return { create, list, get, update, remove };
}

export const libraryService = createLibraryService();
