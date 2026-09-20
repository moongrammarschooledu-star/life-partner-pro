import { prisma } from "@/lib/prisma";
import { requestContext } from "@/lib/observability/context";

// Lightweight metrics (spec §17/§53) stored as hourly buckets in PerfSample.
//  - Named counters ("errors:5xx", "security:403") via bumpCounter().
//  - Per-route latency/error/slow buckets via withRequestMetrics().
// Only instrumented routes are measured — the dashboard lists exactly which,
// so coverage is never overstated.

export function hourBucket(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

export async function bumpCounter(name: string, by = 1): Promise<void> {
  try {
    const bucketStart = hourBucket();
    await prisma.perfSample.upsert({
      where: { route_bucketStart: { route: name, bucketStart } },
      create: { route: name, bucketStart, count: by },
      update: { count: { increment: by } },
    });
  } catch {
    // metrics must never affect the request path
  }
}

export async function readCounter(name: string, hours: number): Promise<number> {
  const since = hourBucket(new Date(Date.now() - (hours - 1) * 3_600_000));
  const agg = await prisma.perfSample.aggregate({ where: { route: name, bucketStart: { gte: since } }, _sum: { count: true } });
  return agg._sum.count ?? 0;
}

async function recordRequest(route: string, ms: number, isError: boolean, slowMs: number): Promise<void> {
  try {
    const bucketStart = hourBucket();
    const rounded = Math.round(ms);
    const slow = rounded >= slowMs ? 1 : 0;
    await prisma.perfSample.upsert({
      where: { route_bucketStart: { route, bucketStart } },
      create: { route, bucketStart, count: 1, errorCount: isError ? 1 : 0, slowCount: slow, sumMs: rounded, maxMs: rounded },
      update: { count: { increment: 1 }, errorCount: { increment: isError ? 1 : 0 }, slowCount: { increment: slow }, sumMs: { increment: rounded } },
    });
    await prisma.perfSample.updateMany({ where: { route, bucketStart, maxMs: { lt: rounded } }, data: { maxMs: rounded } });
  } catch {
    // ignore
  }
}

type Handler<A extends unknown[]> = (...args: A) => Promise<Response>;

// Wraps a route handler: times it, buckets latency/errors by route label and
// makes the label visible to slow-query attribution via AsyncLocalStorage.
export function withRequestMetrics<A extends unknown[]>(route: string, handler: Handler<A>, slowMs = 2000): Handler<A> {
  return async (...args: A) => {
    const start = Date.now();
    let failed = false;
    try {
      const response = await requestContext.run({ route }, () => handler(...args));
      failed = response.status >= 500;
      return response;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      void recordRequest(route, Date.now() - start, failed, slowMs);
    }
  };
}

export const INSTRUMENTED_ROUTES_NOTE = "Latency is measured only for routes wrapped with withRequestMetrics().";
