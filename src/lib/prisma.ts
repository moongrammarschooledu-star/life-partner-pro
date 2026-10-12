import { PrismaClient } from "@prisma/client";
import { attachSlowQueryMonitor } from "@/lib/observability/slow-query";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  // "query" is emitted as an event (never printed) so slow-query monitoring
  // can read duration + table name only — see observability/slow-query.ts.
  // STEP 34 §11 - bounded interactive transactions: wait at most 5 s for a pooled connection and cut a transaction off after 15 s, so one stuck
  // request cannot hold a connection (and starve the pool) until the function times out. Prisma's default is 2 s / 5 s.
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }], transactionOptions: { maxWait: 5_000, timeout: 15_000 } }) as unknown as PrismaClient;
  attachSlowQueryMonitor(client);
  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
