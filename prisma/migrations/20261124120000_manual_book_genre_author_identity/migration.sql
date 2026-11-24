ALTER TABLE "books" ADD COLUMN "genre" VARCHAR(120);

ALTER TABLE "authors" ADD COLUMN "normalizedName" VARCHAR(255);
UPDATE "authors"
SET "normalizedName" = lower(btrim(regexp_replace("name", '[[:space:]]+', ' ', 'g')));
ALTER TABLE "authors" ALTER COLUMN "normalizedName" SET NOT NULL;
CREATE UNIQUE INDEX "authors_normalizedName_key" ON "authors"("normalizedName");
