import { prisma } from '../../config/database';
import type { ReadingStatus } from '../../generated/prisma/enums';

export function createReadingService(database = prisma) {
  return {
    async getStats(userId: string) {
      const grouped = await database.userBook.groupBy({
        by: ['readingStatus'],
        where: { userId },
        _count: { _all: true },
      });
      const counts: Record<ReadingStatus, number> = {
        WANT_TO_READ: 0,
        READING: 0,
        COMPLETED: 0,
        ON_HOLD: 0,
      };
      for (const group of grouped) counts[group.readingStatus] = group._count._all;
      return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
    },
  };
}

export const readingService = createReadingService();
