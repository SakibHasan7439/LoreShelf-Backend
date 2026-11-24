import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
import type { CreateShelfInput, UpdateShelfInput } from './shelves.types';

const shelfSelect = {
  id: true,
  name: true,
  normalizedName: true,
  tagline: true,
  description: true,
  theme: true,
  icon: true,
  createdAt: true,
  updatedAt: true,
} as const;

const shelfWithBooksSelect = {
  ...shelfSelect,
  books: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      createdAt: true,
      userBook: {
        select: {
          id: true,
          ownership: true,
          readingStatus: true,
          book: {
            select: {
              id: true,
              title: true,
              coverUrl: true,
              authors: { orderBy: { position: 'asc' as const }, select: { position: true, author: { select: { id: true, name: true } } } },
            },
          },
        },
      },
    },
  },
} as const;

function displayName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim();
}

function normalizedName(name: string): string {
  return displayName(name).toLocaleLowerCase('en-US');
}

function jsonField(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null ? Prisma.DbNull : value as Prisma.InputJsonValue;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

export function createShelfService(database = prisma) {
  return {
    async create(userId: string, input: CreateShelfInput) {
      try {
        const { theme, ...fields } = input;
        return await database.shelf.create({
          data: { ...fields, name: displayName(input.name), ...(theme === undefined ? {} : { theme: jsonField(theme) }), userId, normalizedName: normalizedName(input.name) },
          select: shelfSelect,
        });
      } catch (error) {
        if (isPrismaCode(error, 'P2002')) throw new AppError(409, 'DUPLICATE_SHELF_NAME', 'A shelf with this name already exists.');
        throw error;
      }
    },

    async list(userId: string) {
      return database.shelf.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: shelfSelect });
    },

    async get(userId: string, shelfId: string) {
      return database.shelf.findFirst({ where: { id: shelfId, userId }, select: shelfWithBooksSelect });
    },

    async update(userId: string, shelfId: string, input: UpdateShelfInput) {
      const current = await database.shelf.findFirst({ where: { id: shelfId, userId }, select: { id: true } });
      if (!current) return null;
      const { theme, ...fields } = input;
      const data = { ...fields, ...(input.name === undefined ? {} : { name: displayName(input.name), normalizedName: normalizedName(input.name) }), ...(theme === undefined ? {} : { theme: jsonField(theme) }) };
      try {
        return await database.shelf.update({ where: { id: shelfId, userId }, data, select: shelfSelect });
      } catch (error) {
        if (isPrismaCode(error, 'P2002')) throw new AppError(409, 'DUPLICATE_SHELF_NAME', 'A shelf with this name already exists.');
        if (isPrismaCode(error, 'P2025')) return null;
        throw error;
      }
    },

    async remove(userId: string, shelfId: string) {
      const result = await database.shelf.deleteMany({ where: { id: shelfId, userId } });
      return result.count > 0;
    },

    async addBook(userId: string, shelfId: string, userBookId: string) {
      const [shelf, userBook] = await Promise.all([
        database.shelf.findFirst({ where: { id: shelfId, userId }, select: { id: true } }),
        database.userBook.findFirst({ where: { id: userBookId, userId }, select: { id: true } }),
      ]);
      if (!shelf || !userBook) return null;
      try {
        return await database.userBookShelf.create({ data: { userId, shelfId, userBookId }, select: { id: true, shelfId: true, userBookId: true, createdAt: true } });
      } catch (error) {
        if (isPrismaCode(error, 'P2002')) throw new AppError(409, 'DUPLICATE_SHELF_BOOK', 'This book is already on the shelf.');
        if (isPrismaCode(error, 'P2003')) return null;
        throw error;
      }
    },

    async removeBook(userId: string, shelfId: string, userBookId: string) {
      const result = await database.userBookShelf.deleteMany({ where: { userId, shelfId, userBookId } });
      return result.count > 0;
    },
  };
}

export const shelfService = createShelfService();
