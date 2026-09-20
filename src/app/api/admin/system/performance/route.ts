import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getSystemControl } from "@/lib/ops/system-control";

// Performance (spec §17) and slow queries (spec §18). Latency is measured only
// for routes wrapped with withRequestMetrics(); the response lists exactly
// which, so coverage is never overstated. Counters are hourly buckets.
export async function GET() {
  try {
    await requireAdmin("system:view");
    const control = await getSystemControl();
    const since = new Date(Date.now() - 24 * 3_600_000);

    const samples = await prisma.perfSample.findMany({ where: { bucketStart: { gte: since } } });
    const routes = new Map<string, { count: number; errorCount: number; slowCount: number; sumMs: number; maxMs: number }>();
    const counters: Record<string, number> = {};
    for (const s of samples) {
      if (s.route.includes(":")) {
        counters[s.route] = (counters[s.route] ?? 0) + s.count;
        continue;
      }
      const r = routes.get(s.route) ?? { count: 0, errorCount: 0, slowCount: 0, sumMs: 0, maxMs: 0 };
      r.count += s.count; r.errorCount += s.errorCount; r.slowCount += s.slowCount; r.sumMs += s.sumMs; r.maxMs = Math.max(r.maxMs, s.maxMs);
      routes.set(s.route, r);
    }

    const slowQueries = await prisma.slowQueryStat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 50 });
    return NextResponse.json({
      windowHours: 24,
      thresholds: { apiLatencyWarnMs: control.apiLatencyWarnMs, slowQueryThresholdMs: control.slowQueryThresholdMs },
      instrumentedRoutes: [...routes.entries()].map(([route, r]) => ({ route, requests: r.count, errors: r.errorCount, slow: r.slowCount, avgMs: r.count ? Math.round(r.sumMs / r.count) : 0, maxMs: r.maxMs, errorRate: r.count ? r.errorCount / r.count : 0 })).sort((a, b) => b.requests - a.requests),
      counters,
      slowQueries: slowQueries.map((s) => ({ id: s.id, operation: s.operation, table: s.tableName, route: s.route, count: s.count, avgMs: Math.round(s.totalMs / Math.max(1, s.count)), maxMs: s.maxMs, lastMs: s.lastMs, lastSeenAt: s.lastSeenAt })),
      note: "Only routes wrapped with withRequestMetrics() are measured. Slow-query records hold operation + table + duration only — never SQL text or parameters.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
