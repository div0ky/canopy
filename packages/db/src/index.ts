import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const globalDatabase = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalDatabase.prisma ??
  new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalDatabase.prisma = prisma;
}

export type DatabaseClient = PrismaClient;
export type DatabaseTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
