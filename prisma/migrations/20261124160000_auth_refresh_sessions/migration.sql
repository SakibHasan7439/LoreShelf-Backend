-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(64) NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6),
    "replacedBySessionId" UUID,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_refreshTokenHash_key" ON "refresh_sessions"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_replacedBySessionId_key" ON "refresh_sessions"("replacedBySessionId");

-- CreateIndex
CREATE INDEX "refresh_sessions_userId_familyId_idx" ON "refresh_sessions"("userId", "familyId");

-- CreateIndex
CREATE INDEX "refresh_sessions_familyId_revokedAt_idx" ON "refresh_sessions"("familyId", "revokedAt");

-- CreateIndex
CREATE INDEX "refresh_sessions_expiresAt_idx" ON "refresh_sessions"("expiresAt");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_replacedBySessionId_fkey" FOREIGN KEY ("replacedBySessionId") REFERENCES "refresh_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
