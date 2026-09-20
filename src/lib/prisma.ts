import { PrismaClient } from "@prisma/client";
import { attachSlowQueryMonitor } from "@/lib/observability/slow-query";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  // "query" is emitted as an event (never printed) so slow-query monitoring
  // can read duration + table name only — see observability/slow-query.ts.
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] }) as unknown as PrismaClient;
  attachSlowQueryMonitor(client);
  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
