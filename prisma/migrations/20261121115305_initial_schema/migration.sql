-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BookSource" AS ENUM ('GOOGLE_BOOKS', 'OPEN_LIBRARY', 'ROKOMARI', 'WAFILIFE', 'MANUAL');

-- CreateEnum
CREATE TYPE "Ownership" AS ENUM ('WISHLIST', 'OWNED');

-- CreateEnum
CREATE TYPE "ReadingStatus" AS ENUM ('WANT_TO_READ', 'READING', 'COMPLETED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "DiscoverySource" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'FRIEND', 'OTHER');

-- CreateEnum
CREATE TYPE "BookPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "CoverTheme" AS ENUM ('EMERALD', 'MIDNIGHT', 'WINE', 'PLUM', 'CHARCOAL', 'OCHRE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120),
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(255),
    "avatar" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "publisher" VARCHAR(255),
    "isbn10" VARCHAR(10),
    "isbn13" VARCHAR(13),
    "coverUrl" TEXT,
    "publishedDate" VARCHAR(32),
    "publishedYear" SMALLINT,
    "pageCount" INTEGER,
    "language" VARCHAR(16),
    "edition" VARCHAR(255),
    "source" "BookSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authors" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_authors" (
    "bookId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "book_authors_pkey" PRIMARY KEY ("bookId","authorId")
);

-- CreateTable
CREATE TABLE "user_books" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "ownership" "Ownership" NOT NULL DEFAULT 'WISHLIST',
    "readingStatus" "ReadingStatus" NOT NULL DEFAULT 'WANT_TO_READ',
    "personalNote" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "rating" SMALLINT,
    "currentPage" INTEGER,
    "addedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseDate" DATE,
    "purchasePrice" DECIMAL(10,2),
    "finishedAt" DATE,
    "discoverySource" "DiscoverySource",
    "priority" "BookPriority",
    "customCoverUri" TEXT,
    "coverTheme" "CoverTheme",
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelves" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,
    "tagline" VARCHAR(160),
    "description" TEXT,
    "theme" JSONB,
    "icon" VARCHAR(32),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_book_shelves" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userBookId" UUID NOT NULL,
    "shelfId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_book_shelves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "books_isbn10_key" ON "books"("isbn10");

-- CreateIndex
CREATE UNIQUE INDEX "books_isbn13_key" ON "books"("isbn13");

-- CreateIndex
CREATE INDEX "books_title_idx" ON "books"("title");

-- CreateIndex
CREATE INDEX "books_publisher_idx" ON "books"("publisher");

-- CreateIndex
CREATE UNIQUE INDEX "books_source_externalId_key" ON "books"("source", "externalId");

-- CreateIndex
CREATE INDEX "authors_name_idx" ON "authors"("name");

-- CreateIndex
CREATE INDEX "book_authors_authorId_idx" ON "book_authors"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "book_authors_bookId_position_key" ON "book_authors"("bookId", "position");

-- CreateIndex
CREATE INDEX "user_books_userId_readingStatus_idx" ON "user_books"("userId", "readingStatus");

-- CreateIndex
CREATE INDEX "user_books_userId_ownership_idx" ON "user_books"("userId", "ownership");

-- CreateIndex
CREATE INDEX "user_books_userId_isFavorite_idx" ON "user_books"("userId", "isFavorite");

-- CreateIndex
CREATE INDEX "user_books_bookId_idx" ON "user_books"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "user_books_userId_bookId_key" ON "user_books"("userId", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "user_books_userId_id_key" ON "user_books"("userId", "id");

-- CreateIndex
CREATE INDEX "shelves_userId_createdAt_idx" ON "shelves"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "shelves_userId_normalizedName_key" ON "shelves"("userId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "shelves_userId_id_key" ON "shelves"("userId", "id");

-- CreateIndex
CREATE INDEX "user_book_shelves_userId_idx" ON "user_book_shelves"("userId");

-- CreateIndex
CREATE INDEX "user_book_shelves_shelfId_idx" ON "user_book_shelves"("shelfId");

-- CreateIndex
CREATE UNIQUE INDEX "user_book_shelves_userBookId_shelfId_key" ON "user_book_shelves"("userBookId", "shelfId");

-- AddForeignKey
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_books" ADD CONSTRAINT "user_books_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_books" ADD CONSTRAINT "user_books_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_book_shelves" ADD CONSTRAINT "user_book_shelves_userId_userBookId_fkey" FOREIGN KEY ("userId", "userBookId") REFERENCES "user_books"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_book_shelves" ADD CONSTRAINT "user_book_shelves_userId_shelfId_fkey" FOREIGN KEY ("userId", "shelfId") REFERENCES "shelves"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
