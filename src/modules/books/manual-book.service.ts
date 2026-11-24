import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
import { normalizeAuthorDisplayName, normalizeAuthorName } from './author-normalization';
import type { ManualBookInput } from './manual-book.types';

export function createManualBookService(database = prisma) {
  return async (input: ManualBookInput) => {
    try {
      return await database.$transaction(async (tx) => {
        const isbn10Match = input.isbn10
          ? await tx.book.findUnique({ where: { isbn10: input.isbn10 }, include: { authors: { include: { author: true }, orderBy: { position: 'asc' } } } })
          : null;
        const isbn13Match = input.isbn13
          ? await tx.book.findUnique({ where: { isbn13: input.isbn13 }, include: { authors: { include: { author: true }, orderBy: { position: 'asc' } } } })
          : null;

        if (isbn10Match && isbn13Match && isbn10Match.id !== isbn13Match.id) {
          throw new AppError(409, 'BOOK_CONFLICT', 'The submitted ISBNs belong to different books.');
        }
        const isbnMatch = isbn10Match ?? isbn13Match;
        if (isbnMatch) return { book: isbnMatch, created: false };

        const authorNames = input.authors.map(normalizeAuthorDisplayName);
        await tx.author.createMany({
          data: authorNames.map((name) => ({ name, normalizedName: normalizeAuthorName(name) })),
          skipDuplicates: true,
        });
        const authors = await tx.author.findMany({
          where: { normalizedName: { in: authorNames.map(normalizeAuthorName) } },
        });
        const authorsByName = new Map(authors.map((author) => [author.normalizedName, author]));

        // A full metadata match avoids repeated manual submissions. Title/author
        // alone is deliberately insufficient because distinct editions exist.
        const candidates = await tx.book.findMany({
          where: {
            title: input.title,
            publisher: input.publisher ?? null,
            publishedYear: input.publishedYear ?? null,
            edition: input.edition ?? null,
            description: input.description ?? null,
            coverUrl: input.coverUrl ?? null,
            genre: input.genre ?? null,
            language: input.language ?? null,
            source: 'MANUAL',
          },
          include: { authors: { include: { author: true }, orderBy: { position: 'asc' } } },
        });
        const requestedAuthors = authorNames.map(normalizeAuthorName);
        const duplicate = candidates.find((book) => {
          if ((input.isbn10 && book.isbn10 !== input.isbn10) || (input.isbn13 && book.isbn13 !== input.isbn13)) return false;
          if (!input.isbn10 && book.isbn10) return false;
          if (!input.isbn13 && book.isbn13) return false;
          const existing = book.authors.map((entry) => entry.author.normalizedName);
          return existing.length === requestedAuthors.length && existing.every((name, i) => name === requestedAuthors[i]);
        });
        if (duplicate) return { book: duplicate, created: false };

        const book = await tx.book.create({
          data: {
            title: input.title,
            authors: { create: requestedAuthors.map((name, position) => {
              const author = authorsByName.get(name);
              if (!author) throw new Error('Author creation failed.');
              return { position, author: { connect: { id: author.id } } };
            }) },
            publisher: input.publisher ?? null,
            genre: input.genre ?? null,
            coverUrl: input.coverUrl ?? null,
            description: input.description ?? null,
            isbn10: input.isbn10 ?? null,
            isbn13: input.isbn13 ?? null,
            edition: input.edition ?? null,
            language: input.language ?? null,
            publishedYear: input.publishedYear ?? null,
            source: 'MANUAL',
          },
          include: { authors: { include: { author: true }, orderBy: { position: 'asc' } } },
        });
        return { book, created: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'DUPLICATE_BOOK', 'A book with this ISBN or identity already exists.');
      }
      throw error;
    }
  };
}

export const createManualBook = createManualBookService();
